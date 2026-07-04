import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import { getVisits, getMembers } from '../utils/storage.js'
import { DISCOVERIES, REGIONS, getRecentDiscoveries, getRegionCompletion, getTotalDiscoveryCount } from '../utils/discoveries.js'
import './StagePassAdmin.css'

const PIE_COLORS = ['#87ceeb', '#00b894', '#ffd700']

const MILESTONES = [
  { threshold: 20, label: 'Founding Member' },
  { threshold: 10, label: 'Patron' },
  { threshold: 5, label: 'Supporter' },
]

function tier(visits) {
  for (const m of MILESTONES) {
    if (visits >= m.threshold) return m.label
  }
  return 'New'
}

function getDateStr(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

function countVisitsOnDate(visits, dateStr) {
  return visits.filter(v => v.timestamp.slice(0, 10) === dateStr).length
}

function buildTrafficData(visits, days = 30) {
  const now = new Date()
  const groups = {}
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    groups[key] = 0
  }
  for (const v of visits) {
    const day = v.timestamp.slice(0, 10)
    if (day in groups) groups[day]++
  }
  return Object.entries(groups).map(([date, count], i) => ({
    day: i + 1,
    count,
    date,
  }))
}

function buildLiveCheckins(visits, members) {
  const memberMap = {}
  for (const m of members) {
    memberMap[m.phoneNumber] = m.firstName
  }
  return visits
    .slice()
    .reverse()
    .slice(-40)
    .map(v => {
      const d = new Date(v.timestamp)
      return {
        id: v.visitId,
        name: memberMap[v.memberId] || 'Friend',
        phone: v.memberId,
        masked: v.memberId.replace(/(\d{3})(\d{4})(\d{4})/, '$1 **** $3'),
        time: d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      }
    })
    .reverse()
}

function buildLoyalVisitors(members) {
  return members
    .slice()
    .sort((a, b) => b.totalVisits - a.totalVisits)
    .slice(0, 10)
    .map((m, i) => ({
      rank: i + 1,
      name: m.firstName,
      visits: m.totalVisits,
      discoveries: (m.discoveries || []).length,
      tier: tier(m.totalVisits),
    }))
}

function buildVisitorPie(members) {
  let firstTimers = 0
  let frequent = 0
  let vip = 0
  for (const m of members) {
    if (m.totalVisits >= 10) vip++
    else if (m.totalVisits >= 3) frequent++
    else firstTimers++
  }
  const total = firstTimers + frequent + vip || 1
  return [
    { name: 'First-timers', value: Math.round((firstTimers / total) * 100) },
    { name: 'Frequent Supporters', value: Math.round((frequent / total) * 100) },
    { name: 'VIP Passes', value: Math.round((vip / total) * 100) },
  ]
}

function countToday(visits) {
  return countVisitsOnDate(visits, getDateStr(0))
}

function countActive(visits) {
  const hourAgo = Date.now() - 3600000
  return visits.filter(v => new Date(v.timestamp).getTime() > hourAgo).length
}

function countNewVsReturning(members) {
  let newV = 0, returning = 0
  for (const m of members) {
    if (m.totalVisits === 1) newV++
    else returning++
  }
  return { new: newV, returning }
}

function buildVisitorTrend(visits, members) {
  const now = new Date()
  const memberFirstVisit = {}
  for (const m of members) {
    if (m.createdAt) {
      memberFirstVisit[m.phoneNumber] = m.createdAt.slice(0, 10)
    }
  }
  const trend = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    const dayVisits = visits.filter(v => v.timestamp.slice(0, 10) === dateStr)
    let firstTime = 0, repeat = 0
    for (const v of dayVisits) {
      if (memberFirstVisit[v.memberId] === dateStr) firstTime++
      else repeat++
    }
    trend.push({
      day: i + 1,
      date: dateStr,
      firstTime,
      repeat,
      total: firstTime + repeat,
    })
  }
  return trend
}

function calcStreaks(members) {
  let longest = { name: '', streak: 0 }
  const streaks = []
  for (const m of members) {
    if (!m.lastVisitDate) continue
    let streak = 1
    const d = new Date(m.lastVisitDate)
    for (let i = 1; i < 365; i++) {
      d.setDate(d.getDate() - 1)
      const check = d.toISOString().slice(0, 10)
      if (m.visits && m.visits.some(v => v.slice(0, 10) === check)) streak++
      else break
    }
    if (streak > longest.streak) longest = { name: m.firstName, streak }
    streaks.push({ name: m.firstName, streak })
  }
  return longest
}

export default function StagePassAdmin() {
  const [trafficData, setTrafficData] = useState([])
  const [liveCheckins, setLiveCheckins] = useState([])
  const [activeCount, setActiveCount] = useState(0)
  const [todayCount, setTodayCount] = useState(0)
  const [yesterdayCount, setYesterdayCount] = useState(0)
  const [weekCount, setWeekCount] = useState(0)
  const [loyalVisitors, setLoyalVisitors] = useState([])
  const [visitorPie, setVisitorPie] = useState([])
  const [revealed, setRevealed] = useState({})
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedMember, setSelectedMember] = useState(null)
  const [visitorTrend, setVisitorTrend] = useState([])
  const [recentDiscoveries, setRecentDiscoveries] = useState([])
  const [discoveryStats, setDiscoveryStats] = useState({ totalUnlocked: 0, completionPct: 0, byRegion: {} })
  const [loginTime] = useState(() => {
    const d = new Date()
    return d.toLocaleString('en-ZA', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  })

  const refreshData = useCallback(() => {
    const visits = getVisits()
    const members = getMembers()
    setTrafficData(buildTrafficData(visits))
    setLiveCheckins(buildLiveCheckins(visits, members))
    setActiveCount(countActive(visits))
    setTodayCount(countToday(visits))
    setYesterdayCount(countVisitsOnDate(visits, getDateStr(-1)))
    const last7 = Array.from({ length: 7 }, (_, i) => countVisitsOnDate(visits, getDateStr(-i)))
    setWeekCount(last7.reduce((a, b) => a + b, 0))
    setLoyalVisitors(buildLoyalVisitors(members))
    setVisitorPie(buildVisitorPie(members))
    setVisitorTrend(buildVisitorTrend(visits, members))
    setRecentDiscoveries(getRecentDiscoveries(members, 30))
    setDiscoveryStats(getRegionCompletion(members))
  }, [])

  useEffect(() => {
    refreshData()
    const iv = setInterval(refreshData, 5000)
    return () => clearInterval(iv)
  }, [refreshData])

  const toggleReveal = useCallback(id => {
    setRevealed(prev => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const filteredMembers = getMembers()
    .filter(m => {
      if (!searchQuery) return true
      const q = searchQuery.toLowerCase()
      return m.firstName.toLowerCase().includes(q) ||
             m.phoneNumber.includes(q) ||
             String(m.totalVisits).includes(q)
    })
    .slice(0, 20)

  const growthPct = yesterdayCount > 0
    ? Math.round(((todayCount - yesterdayCount) / yesterdayCount) * 100)
    : todayCount > 0 ? 100 : 0

  const nrCounts = countNewVsReturning(getMembers())

  const recentActivity = [
    ...liveCheckins.slice(0, 10).map(c => ({ ...c, type: 'checkin' })),
    ...recentDiscoveries.slice(0, 10).map(d => ({
      id: d.discoveryId,
      name: d.memberName,
      type: 'discovery',
      content: d.content,
      region: d.region,
      tag: d.tag,
      time: new Date(d.timestamp).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }),
    })),
  ].sort((a, b) => {
    if (a.time > b.time) return -1
    if (a.time < b.time) return 1
    return 0
  }).slice(0, 20)

  return (
    <motion.div
      className="admin"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
    >
      <header className="admin-header">
        <div className="admin-header-primary">
          <span className="admin-identity">BLACK LABONE</span>
          <span className="admin-context">[ CURATOR ]</span>
        </div>
        <div className="admin-header-right">
          <span className="admin-login-time">{loginTime}</span>
          <span className="admin-divider-rule" />
          <span className="admin-indicator" />
          <span className="admin-indicator-label">Live</span>
        </div>
      </header>

      <div className="admin-search">
        <input
          className="admin-search-input"
          placeholder="Search visitors by name, phone, or visit count\u2026"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="admin-metrics">
        <div className="admin-metric-item">
          <span className="admin-metric-value">{todayCount.toLocaleString()}</span>
          <span className="admin-metric-label">Today</span>
        </div>
        <div className="admin-metric-item">
          <span className="admin-metric-value">{yesterdayCount.toLocaleString()}</span>
          <span className="admin-metric-label">Yesterday</span>
        </div>
        <div className="admin-metric-item">
          <span className="admin-metric-value">{weekCount.toLocaleString()}</span>
          <span className="admin-metric-label">Last 7 days</span>
        </div>
        <div className="admin-metric-item">
          <span className="admin-metric-value">{trafficData.reduce((a, b) => a + b.count, 0).toLocaleString()}</span>
          <span className="admin-metric-label">Last 30 days</span>
        </div>
        <div className="admin-metric-item">
          <span className={`admin-metric-value${growthPct < 0 ? ' admin-metric-negative' : ''}`}>
            {growthPct > 0 ? '+' : ''}{growthPct}%
          </span>
          <span className="admin-metric-label">Growth vs yesterday</span>
        </div>
      </div>

      <div className="admin-grid">
        <div className="admin-grid-primary">
          <section className="admin-panel">
            <h2 className="admin-panel-title">Check-in Traffic / 30 Days</h2>
            <div className="admin-chart">
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={trafficData}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#eee" strokeWidth={0.5} />
                  <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#999' }} axisLine={{ stroke: '#ddd', strokeWidth: 0.5 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: '#999' }} axisLine={{ stroke: '#ddd', strokeWidth: 0.5 }} tickLine={false} width={28} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 0, border: '1px solid #000', boxShadow: 'none', padding: '6px 10px' }} labelStyle={{ fontSize: 9, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em' }} />
                  <Area type="monotone" dataKey="count" stroke="#00b894" strokeWidth={1.5} fill="none" dot={false} activeDot={{ r: 3, stroke: '#00b894', strokeWidth: 1, fill: '#fff' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="admin-panel">
            <h2 className="admin-panel-title">Discovery Analytics</h2>
            <div className="admin-discovery-metrics">
              <div className="admin-discovery-stat">
                <span className="admin-discovery-value">{discoveryStats.totalUnlocked}</span>
                <span className="admin-discovery-label">Total discoveries unlocked</span>
              </div>
              <div className="admin-discovery-stat">
                <span className="admin-discovery-value">{discoveryStats.completionPct}%</span>
                <span className="admin-discovery-label">Discovery completion</span>
              </div>
              <div className="admin-discovery-stat">
                <span className="admin-discovery-value">{getTotalDiscoveryCount()}</span>
                <span className="admin-discovery-label">Total available</span>
              </div>
            </div>
            <div className="admin-discovery-breakdown">
              {REGIONS.map(r => {
                const count = discoveryStats.byRegion[r.id] || 0
                const regionMax = DISCOVERIES.filter(d => d.region === r.id).length
                const pct = regionMax > 0 ? Math.round((count / regionMax) * 100) : 0
                return (
                  <div key={r.id} className="admin-discovery-region">
                    <span className="admin-discovery-region-label">{r.label}</span>
                    <div className="admin-discovery-bar-track">
                      <div className="admin-discovery-bar-fill" style={{ width: `${pct}%`, background: r.id === 'palm' ? '#ff6b35' : r.id === 'thumb' ? '#4567b7' : r.id === 'index' ? '#e74c3c' : r.id === 'middle' ? '#2ecc71' : r.id === 'ring' ? '#9b59b6' : '#e67e22' }} />
                    </div>
                    <span className="admin-discovery-region-count">{count}</span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="admin-panel">
            <h2 className="admin-panel-title">Live Activity</h2>
            <div className="admin-table-scroll" style={{ maxHeight: 320 }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th className="admin-th-name">Activity</th>
                    <th className="admin-th-time">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {recentActivity.map((entry, i) => (
                    <tr key={`${entry.id}-${i}`}>
                      <td className="admin-td-name">
                        {entry.type === 'discovery' ? (
                          <span className="admin-activity-discovery">
                            <span className="admin-activity-name">{entry.name}</span>
                            <span className="admin-activity-action">unlocked</span>
                            <span className="admin-activity-content">&ldquo;{entry.content}&rdquo;</span>
                          </span>
                        ) : (
                          <span className="admin-activity-checkin">
                            <span className="admin-activity-name">{entry.name}</span>
                            <span className="admin-activity-action">checked in</span>
                          </span>
                        )}
                      </td>
                      <td className="admin-td-time">{entry.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="admin-grid-secondary">
          <section className="admin-panel">
            <h2 className="admin-panel-title">First-Time vs Returning / 14 Days</h2>
            <div className="admin-chart">
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={visitorTrend}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#eee" strokeWidth={0.5} />
                  <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#999' }} axisLine={{ stroke: '#ddd', strokeWidth: 0.5 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: '#999' }} axisLine={{ stroke: '#ddd', strokeWidth: 0.5 }} tickLine={false} width={28} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 0, border: '1px solid #000', boxShadow: 'none', padding: '6px 10px' }} />
                  <Legend wrapperStyle={{ fontSize: 9, color: '#999' }} />
                  <Bar dataKey="firstTime" name="First-time" fill="#87ceeb" stackId="a" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="repeat" name="Returning" fill="#00b894" stackId="a" radius={[0, 0, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="admin-panel">
            <h2 className="admin-panel-title">Growth Trend / 14 Days</h2>
            <div className="admin-chart">
              <ResponsiveContainer width="100%" height={130}>
                <AreaChart data={visitorTrend}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#eee" strokeWidth={0.5} />
                  <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#999' }} axisLine={{ stroke: '#ddd', strokeWidth: 0.5 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: '#999' }} axisLine={{ stroke: '#ddd', strokeWidth: 0.5 }} tickLine={false} width={28} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 0, border: '1px solid #000', boxShadow: 'none', padding: '6px 10px' }} />
                  <Area type="monotone" dataKey="total" stroke="#000" strokeWidth={1.5} fill="none" dot={false} activeDot={{ r: 3, stroke: '#000', strokeWidth: 1, fill: '#fff' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="admin-panel">
            <h2 className="admin-panel-title">Visitor Journey</h2>
            <div className="admin-journey-grid">
              <div className="admin-journey-item">
                <span className="admin-journey-value">{nrCounts.new}</span>
                <span className="admin-journey-label">New visitors</span>
              </div>
              <div className="admin-journey-item">
                <span className="admin-journey-value">{nrCounts.returning}</span>
                <span className="admin-journey-label">Returning</span>
              </div>
              <div className="admin-journey-item">
                <span className="admin-journey-value">
                  {getMembers().length > 0
                    ? (getMembers().reduce((a, b) => a + b.totalVisits, 0) / getMembers().length).toFixed(1)
                    : '0'}
                </span>
                <span className="admin-journey-label">Avg visits</span>
              </div>
            </div>
          </section>

          <section className="admin-panel">
            <h2 className="admin-panel-title">Recent Discoveries</h2>
            <div className="admin-table-scroll" style={{ maxHeight: 240 }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th className="admin-th-name">Visitor</th>
                    <th className="admin-th-name">Discovery</th>
                    <th className="admin-th-time">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {recentDiscoveries.slice(0, 15).map((d, i) => (
                    <tr key={`${d.discoveryId}-${i}`}>
                      <td className="admin-td-name">{d.memberName}</td>
                      <td className="admin-td-name">
                        <span className="admin-disc-tag">{d.tag}</span>
                        <span className="admin-disc-content">{d.content}</span>
                      </td>
                      <td className="admin-td-time">
                        {new Date(d.timestamp).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="admin-panel">
            <h2 className="admin-panel-title">Loyal Visitors</h2>
            <table className="admin-table admin-table-loyal">
              <thead>
                <tr>
                  <th className="admin-th-rank">#</th>
                  <th className="admin-th-name">Name</th>
                  <th className="admin-th-visits">Visits</th>
                  <th className="admin-th-tier">Tier</th>
                </tr>
              </thead>
              <tbody>
                {loyalVisitors.map(v => (
                  <tr key={v.rank}>
                    <td className="admin-td-rank">{v.rank}</td>
                    <td className="admin-td-name">{v.name}</td>
                    <td className="admin-td-visits">{v.visits}</td>
                    <td className="admin-td-tier">
                      <span className={`admin-tier admin-tier--${v.tier.toLowerCase().replace(/\s+/g, '-')}`}>
                        {v.tier}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {searchQuery && (
            <section className="admin-panel">
              <h2 className="admin-panel-title">Search Results</h2>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th className="admin-th-name">Name</th>
                    <th className="admin-th-phone">Phone</th>
                    <th className="admin-th-visits">Visits</th>
                    <th className="admin-th-tier">Discoveries</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map(m => (
                    <tr key={m.phoneNumber} className="admin-clickable-row" onClick={() => setSelectedMember(selectedMember?.phoneNumber === m.phoneNumber ? null : m)}>
                      <td className="admin-td-name">{m.firstName}</td>
                      <td className="admin-td-phone">{m.phoneNumber}</td>
                      <td className="admin-td-visits">{m.totalVisits}</td>
                      <td className="admin-td-tier">{(m.discoveries || []).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {selectedMember && (
            <section className="admin-panel admin-profile-panel">
              <h2 className="admin-panel-title">
                {selectedMember.firstName}
                <button className="admin-profile-close" onClick={() => setSelectedMember(null)}>[ Close ]</button>
              </h2>
              <div className="admin-profile-grid">
                <div className="admin-profile-stat">
                  <span className="admin-profile-stat-value">{selectedMember.totalVisits}</span>
                  <span className="admin-profile-stat-label">Visits</span>
                </div>
                <div className="admin-profile-stat">
                  <span className="admin-profile-stat-value">{(selectedMember.discoveries || []).length}</span>
                  <span className="admin-profile-stat-label">Discoveries</span>
                </div>
                <div className="admin-profile-stat">
                  <span className="admin-profile-stat-value">{tier(selectedMember.totalVisits)}</span>
                  <span className="admin-profile-stat-label">Tier</span>
                </div>
              </div>
              <div className="admin-profile-discoveries">
                <p className="admin-profile-disco-title">Unlocked discoveries:</p>
                {(selectedMember.discoveries || []).length > 0 ? (
                  <div className="admin-profile-disco-list">
                    {(selectedMember.discoveries || []).map(dId => {
                      const d = DISCOVERIES.find(dd => dd.id === dId)
                      return d ? (
                        <div key={dId} className="admin-profile-disco-item">
                          <span className="admin-disc-tag">{d.tag}</span>
                          <span className="admin-disc-content">&ldquo;{d.content}&rdquo;</span>
                          <span className="admin-disc-visit">Visit {d.visitNumber}</span>
                        </div>
                      ) : null
                    })}
                  </div>
                ) : (
                  <p className="admin-profile-disco-empty">No discoveries yet</p>
                )}
              </div>
              <div className="admin-profile-next">
                <p className="admin-profile-next-label">Next discovery at visit {(selectedMember.discoveries || []).length + 1}</p>
              </div>
            </section>
          )}

          <section className="admin-panel">
            <h2 className="admin-panel-title">Visitor Distribution</h2>
            <div className="admin-chart admin-chart-pie">
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={visitorPie} cx="50%" cy="50%" innerRadius={38} outerRadius={62} dataKey="value" strokeWidth={0.5} stroke="#fff">
                    {visitorPie.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 0, border: '1px solid #000', boxShadow: 'none', padding: '6px 10px' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="admin-pie-legend">
                {visitorPie.map((e, i) => (
                  <div key={i} className="admin-pie-legend-item">
                    <span className="admin-pie-dot" style={{ background: PIE_COLORS[i] }} />
                    <span className="admin-pie-label">{e.name}</span>
                    <span className="admin-pie-val">{e.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>

      <footer className="admin-footer">Developed by Neo Mogorosi</footer>
    </motion.div>
  )
}
