import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import { jsPDF } from 'jspdf'
import { getVisits, getMembers, fetchAdminData, clearAdminSession } from '../utils/storage.js'
import EventManager from '../components/EventManager.jsx'
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

function getThursdayDate(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day <= 4 ? (4 - day) : (4 - day + 7)
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

function getLastThursdays(count = 8) {
  const now = new Date()
  const thursdays = []
  for (let i = 0; i < count; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - ((d.getDay() + 3) % 7) - i * 7)
    thursdays.push(d.toISOString().slice(0, 10))
  }
  return thursdays.reverse()
}

function buildTrafficData(visits) {
  const thursdays = getLastThursdays(8)
  const groups = {}
  for (const t of thursdays) groups[t] = 0
  for (const v of visits) {
    const day = v.timestamp.slice(0, 10)
    const thu = getThursdayDate(day)
    if (thu in groups) groups[thu]++
  }
  const shortMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return thursdays.map((date, i) => {
    const d = new Date(date)
    return {
      day: i + 1,
      count: groups[date],
      date,
      label: `${d.getDate()} ${shortMonths[d.getMonth()]}`,
    }
  })
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
  const thursdays = getLastThursdays(8)
  const memberFirstVisit = {}
  for (const m of members) {
    if (m.createdAt) {
      memberFirstVisit[m.phoneNumber] = m.createdAt.slice(0, 10)
    }
  }
  const shortMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return thursdays.map((date, i) => {
    const dayVisits = visits.filter(v => v.timestamp.slice(0, 10) === date)
    let firstTime = 0, repeat = 0
    for (const v of dayVisits) {
      if (memberFirstVisit[v.memberId] === date) firstTime++
      else repeat++
    }
    const d = new Date(date)
    return {
      day: i + 1,
      date,
      label: `${d.getDate()} ${shortMonths[d.getMonth()]}`,
      firstTime,
      repeat,
      total: firstTime + repeat,
    }
  })
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
  const navigate = useNavigate()
  const [trafficData, setTrafficData] = useState([])
  const [liveCheckins, setLiveCheckins] = useState([])
  const [activeCount, setActiveCount] = useState(0)
  const [todayCount, setTodayCount] = useState(0)
  const [loyalVisitors, setLoyalVisitors] = useState([])
  const [visitorPie, setVisitorPie] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedMember, setSelectedMember] = useState(null)
  const [visitorTrend, setVisitorTrend] = useState([])
  const [cloudMembers, setCloudMembers] = useState([])
  const [cloudVisits, setCloudVisits] = useState([])
  const [dataSource, setDataSource] = useState('local')
  const [loginTime] = useState(() => {
    const d = new Date()
    return d.toLocaleString('en-ZA', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  })

  const refreshData = useCallback(async () => {
    const { members, visits, source, authExpired } = await fetchAdminData()
    if (authExpired) {
      clearAdminSession()
      navigate('/login', { replace: true })
      return
    }
    setCloudMembers(members)
    setCloudVisits(visits)
    setDataSource(source)
    setTrafficData(buildTrafficData(visits))
    setLiveCheckins(buildLiveCheckins(visits, members))
    setActiveCount(countActive(visits))
    setTodayCount(countToday(visits))
    setLoyalVisitors(buildLoyalVisitors(members))
    setVisitorPie(buildVisitorPie(members))
    setVisitorTrend(buildVisitorTrend(visits, members))
  }, [navigate])

  useEffect(() => {
    refreshData()
    const iv = setInterval(refreshData, 5000)
    return () => clearInterval(iv)
  }, [refreshData])

  const handleLogout = () => {
    clearAdminSession()
    navigate('/login', { replace: true })
  }

  const filteredMembers = cloudMembers
    .filter(m => {
      if (!searchQuery) return true
      const q = searchQuery.toLowerCase()
      return (m.firstName || '').toLowerCase().includes(q) ||
             (m.phoneNumber || '').includes(q) ||
             String(m.totalVisits || '').includes(q)
    })
    .slice(0, 20)

  const nrCounts = countNewVsReturning(cloudMembers)

  const recentActivity = liveCheckins.slice(-20).reverse()

  const handleDownloadPDF = useCallback(() => {
    const visits = cloudVisits
    const members = cloudMembers
    const totalVisits = visits.length
    const totalVisitors = members.length
    const nr = countNewVsReturning(members)
    const today = countToday(visits)
    const traffic = buildTrafficData(visits)
    const totalThursday = traffic.reduce((a, b) => a + b.count, 0)
    const loyal = buildLoyalVisitors(members)
    const now = new Date().toLocaleString('en-ZA', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageW = 210
    const margin = 20
    const col1 = margin
    const col2 = 70
    let y = margin

    const heading = (text, size = 16) => { doc.setFont('Helvetica', 'bold'); doc.setFontSize(size); doc.text(text, margin, y); y += size * 0.55 }
    const sub = (text, size = 9) => { doc.setFont('Helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(140); doc.text(text, margin, y); y += size * 0.5; doc.setTextColor(0) }
    const bold = (text, size = 11) => { doc.setFont('Helvetica', 'bold'); doc.setFontSize(size); doc.text(text, margin, y); y += size * 0.5 }
    const normal = (text, size = 10) => { doc.setFont('Helvetica', 'normal'); doc.setFontSize(size); doc.text(text, margin, y); y += size * 0.55 }
    const divider = () => { y += 3; doc.setDrawColor(220); doc.line(margin, y, pageW - margin, y); y += 5 }
    const spacer = (h) => { y += h }

    heading('Black Labone')
    sub('Attendance Report — Every Thursday', 8)
    divider()

    bold('Today', 12)
    normal(`${today} check-ins`, 16)
    spacer(4)

    bold('Community Overview', 11)
    normal(`Total Thursday check-ins: ${totalThursday}`)
    normal(`Unique visitors: ${totalVisitors}`)
    normal(`New visitors: ${nr.new}`)
    normal(`Returning: ${nr.returning}`)
    divider()

    bold('Thursday Traffic (Last 8 Weeks)', 11)
    traffic.forEach(t => {
      normal(`${t.label}: ${t.count} check-ins`)
    })
    divider()

    bold('Loyal Visitors', 11)
    if (loyal.length > 0) {
      doc.setFont('Helvetica', 'bold')
      doc.setFontSize(9)
      doc.text('#', col1, y)
      doc.text('Name', col1 + 10, y)
      doc.text('Visits', col2, y)
      doc.text('Tier', col2 + 20, y)
      y += 5
      doc.setDrawColor(220)
      doc.line(margin, y - 1, pageW - margin, y - 1)
      doc.setFont('Helvetica', 'normal')
      doc.setFontSize(9)
      loyal.slice(0, 10).forEach(v => {
        doc.text(String(v.rank), col1, y)
        doc.text(v.name, col1 + 10, y)
        doc.text(String(v.visits), col2, y)
        doc.text(v.tier, col2 + 20, y)
        y += 5
      })
    }

    spacer(8)
    doc.setFont('Helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(180)
    doc.text('Powered by StagePass', margin, y)

    doc.save('black-labone-attendance-report.pdf')
  }, [cloudVisits, cloudMembers])

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
          <span className="admin-divider-rule" />
          <span className="admin-tagline">Showing up is showing love</span>
        </div>
        <div className="admin-header-right">
          <span className="admin-login-time">{loginTime}</span>
          <span className="admin-divider-rule" />
          <span className="admin-indicator" />
          <span className="admin-indicator-label">{dataSource === 'cloud' ? 'Live • Cloud' : 'Live • Local'}</span>
          <button type="button" className="admin-download-btn" onClick={handleLogout} style={{ padding: '3px 8px', fontSize: '8px' }}>
            Log out
          </button>
        </div>
      </header>

      {/* Live Activity — always on top */}
      <section className="admin-panel admin-live-section">
        <div className="admin-live-header">
          <h2 className="admin-panel-title">Live Activity</h2>
          <span className="admin-metric-value admin-live-count">{todayCount.toLocaleString()}</span>
          <span className="admin-metric-label">checked in today</span>
        </div>
        <div className="admin-table-scroll" style={{ maxHeight: 220 }}>
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
                    <span className="admin-activity-checkin">
                      <span className="admin-activity-name">{entry.name}</span>
                      <span className="admin-activity-action">checked in</span>
                    </span>
                  </td>
                  <td className="admin-td-time">{entry.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
          <span className="admin-metric-label">Check-ins Today</span>
        </div>
        <div className="admin-metric-item">
          <span className="admin-metric-value">{activeCount}</span>
          <span className="admin-metric-label">Active Now</span>
        </div>
        <div className="admin-metric-item">
          <span className="admin-metric-value">{cloudMembers.length}</span>
          <span className="admin-metric-label">Total Visitors</span>
        </div>
      </div>

      <div className="admin-grid">
        <div className="admin-grid-primary">
          <section className="admin-panel">
            <h2 className="admin-panel-title">Thursday Traffic / Last 8 Weeks</h2>
            <div className="admin-chart">
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={trafficData} onClick={(e) => e?.activePayload && alert(`Date: ${e.activePayload[0].payload.date}\nCheck-ins: ${e.activePayload[0].payload.count}`)}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#eee" strokeWidth={0.5} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#999' }} axisLine={{ stroke: '#ddd', strokeWidth: 0.5 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: '#999' }} axisLine={{ stroke: '#ddd', strokeWidth: 0.5 }} tickLine={false} width={28} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 0, border: '1px solid #000', boxShadow: 'none', padding: '6px 10px' }} labelStyle={{ fontSize: 9, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em' }} />
                  <Area type="monotone" dataKey="count" stroke="#00b894" strokeWidth={1.5} fill="none" dot={false} activeDot={{ r: 3, stroke: '#00b894', strokeWidth: 1, fill: '#fff' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        <div className="admin-grid-secondary">
          <section className="admin-panel">
            <h2 className="admin-panel-title">First-Time vs Returning / 8 Thursdays</h2>
            <div className="admin-chart">
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={visitorTrend} onClick={(e) => e?.activePayload && alert(`${e.activePayload[0].payload.date}\nFirst-time: ${e.activePayload[0].payload.firstTime}\nReturning: ${e.activePayload[0].payload.repeat}`)}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#eee" strokeWidth={0.5} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#999' }} axisLine={{ stroke: '#ddd', strokeWidth: 0.5 }} tickLine={false} />
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
            <h2 className="admin-panel-title">Growth Trend / 8 Thursdays</h2>
            <div className="admin-chart">
              <ResponsiveContainer width="100%" height={130}>
                <AreaChart data={visitorTrend} onClick={(e) => e?.activePayload && alert(`${e.activePayload[0].payload.date}\nTotal check-ins: ${e.activePayload[0].payload.total}`)}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#eee" strokeWidth={0.5} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#999' }} axisLine={{ stroke: '#ddd', strokeWidth: 0.5 }} tickLine={false} />
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
                  {cloudMembers.length > 0
                    ? (cloudMembers.reduce((a, b) => a + b.totalVisits, 0) / cloudMembers.length).toFixed(1)
                    : '0'}
                </span>
                <span className="admin-journey-label">Avg visits</span>
              </div>
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
                    <th className="admin-th-tier">Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map(m => (
                    <tr key={m.phoneNumber} className="admin-clickable-row" onClick={() => setSelectedMember(selectedMember?.phoneNumber === m.phoneNumber ? null : m)}>
                      <td className="admin-td-name">{m.firstName}</td>
                      <td className="admin-td-phone">{m.phoneNumber}</td>
                      <td className="admin-td-visits">{m.totalVisits}</td>
                      <td className="admin-td-tier">{tier(m.totalVisits)}</td>
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
                  <span className="admin-profile-stat-value">{tier(selectedMember.totalVisits)}</span>
                  <span className="admin-profile-stat-label">Tier</span>
                </div>
              </div>
            </section>
          )}

          <section className="admin-panel">
            <h2 className="admin-panel-title">Visitor Distribution</h2>
            <div className="admin-chart admin-chart-pie">
              <ResponsiveContainer width="100%" height={160}>
                <PieChart onClick={(e) => e?.activeLabel && alert(`${e.activeLabel}: ${e.activeValue}%`)}>
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

      <div style={{ padding: '0 16px' }}>
        <EventManager />
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', padding: '12px 0' }}>
        <button className="admin-download-btn" onClick={handleDownloadPDF}>Download Report</button>
      </div>
      <p style={{ fontSize: '8px', fontWeight: 300, color: '#0A0A0A', letterSpacing: '0.05em', textAlign: 'center', padding: '4px 0 16px' }}>Developed by Neo Mogorosi</p>
    </motion.div>
  )
}
