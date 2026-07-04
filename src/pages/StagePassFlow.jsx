import { useEffect, useState, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import handArt from '../assets/hand-artwork.png'
import {
  lookupMember,
  recordVisit,
  getCachedPhoneNumber,
  setCachedPhoneNumber,
} from '../utils/storage.js'
import { getDiscoveryById, REGIONS, REGION_ZOOMS, REGION_CONTOURS } from '../utils/discoveries.js'
import './StagePassFlow.css'

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

const CONTOUR_COUNT = 10

export default function StagePassFlow() {
  const [view, setView] = useState('hero')
  const [firstName, setFirstName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [knownMember, setKnownMember] = useState(null)
  const [member, setMember] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fingerZoomed, setFingerZoomed] = useState(false)
  const [animatingLine, setAnimatingLine] = useState(-1)
  const [discoveryPhase, setDiscoveryPhase] = useState(null)
  const [activeDiscovery, setActiveDiscovery] = useState(null)
  const animatingLineTimer = useRef(null)

  const hasOverlay = view !== 'hero' || discoveryPhase !== null
  const inDiscovery = discoveryPhase !== null

  useEffect(() => {
    const cached = getCachedPhoneNumber()
    if (cached) setPhoneNumber(cached)
  }, [])

  const scheduleLineAnimation = useCallback(() => {
    const delay = 15000 + Math.random() * 10000
    animatingLineTimer.current = setTimeout(() => {
      setAnimatingLine(Math.floor(Math.random() * CONTOUR_COUNT))
      setTimeout(() => {
        setAnimatingLine(-1)
        scheduleLineAnimation()
      }, 2800)
    }, delay)
  }, [])

  useEffect(() => {
    scheduleLineAnimation()
    return () => clearTimeout(animatingLineTimer.current)
  }, [scheduleLineAnimation])

  const isReturning = Boolean(knownMember)

  const handlePhoneBlur = async () => {
    setError('')
    const digits = phoneNumber.replace(/\D/g, '')
    if (digits.length < 9) {
      setKnownMember(null)
      return
    }
    try {
      const found = await lookupMember(phoneNumber)
      setKnownMember(found)
    } catch {
      setKnownMember(null)
    }
  }

  const handleMarkVisit = () => {
    setView('register')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!phoneNumber || (!isReturning && !firstName)) return

    setSubmitting(true)
    setError('')
    try {
      const result = await recordVisit({
        firstName: isReturning ? knownMember.firstName : firstName,
        phoneNumber,
      })
      setCachedPhoneNumber(phoneNumber)
      setMember(result)
      setActiveDiscovery(result.newDiscovery || null)

      setDiscoveryPhase('dimming')
      setTimeout(() => setDiscoveryPhase('zooming'), 1000)
      setTimeout(() => setDiscoveryPhase('tracing'), 4000)
      setTimeout(() => setDiscoveryPhase('revealed'), 6200)
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleContinue = () => {
    setDiscoveryPhase('zooming-out')
    setTimeout(() => {
      setView('progress')
      setDiscoveryPhase(null)
    }, 1400)
  }

  useEffect(() => {
    if (view === 'progress' && member?.totalVisits === 2) {
      setTimeout(() => setFingerZoomed(true), 600)
    }
  }, [view, member])

  const resetForNextScan = () => {
    setFirstName('')
    setKnownMember(null)
    setMember(null)
    setError('')
    setFingerZoomed(false)
    setView('hero')
  }

  const milestone = member?.milestone ?? null
  const remaining = milestone ? Math.max(milestone.count - member.totalVisits, 0) : 0
  const progressPct = milestone
    ? Math.min(member.totalVisits / milestone.count, 1)
    : 0

  const zoomConfig = activeDiscovery ? REGION_ZOOMS[activeDiscovery.region] : null
  const contourPath = activeDiscovery ? REGION_CONTOURS[activeDiscovery.region] : null

  return (
    <div className={`stagepass-screen${fingerZoomed ? ' state-zoomed-finger' : ''}${inDiscovery ? ` discovery-${discoveryPhase}` : ''}`}>
      {/* LAYER 1 — Ambient contour background */}
      <div className="bg-contours">
        <svg viewBox="0 0 430 932" preserveAspectRatio="none" className="contour-svg">
          {Array.from({ length: CONTOUR_COUNT }, (_, i) => {
            const paths = [
              ['M-40,160 C80,120 160,220 280,180 S380,260 470,220', 'M-40,260 C90,220 170,330 300,280 S400,370 470,330'],
              ['M-40,480 C60,440 150,530 240,490 S360,570 470,520', 'M-40,580 C70,540 170,630 270,580 S390,670 470,620'],
              ['M-40,720 C50,690 140,770 230,730 S350,810 470,760', 'M-40,820 C40,790 120,870 200,830 S330,910 470,860'],
              ['M80,-40 C60,100 160,180 120,300 S220,420 180,540', 'M170,-40 C150,80 240,160 200,280 S300,400 260,520'],
              ['M300,860 C320,740 240,660 290,540 S200,420 260,300', 'M360,880 C380,760 300,680 350,560 S260,440 320,320'],
            ]
            if (i >= paths.length) return null
            return (
              <g key={i} className={`contour-group contour-group-${i + 1}${animatingLine === i ? ' contour-animating' : ''}`}>
                {paths[i].map((d, j) => (
                  <path key={j} d={d} />
                ))}
              </g>
            )
          })}
        </svg>
      </div>

      {/* LAYER 2 — Headline (always visible) */}
      <div className={`stagepass-headline${hasOverlay ? ' headline-subtle' : ''}${inDiscovery ? ' headline-fade' : ''}`}>
        <span className="headline-line">SHOWING UP</span>
        <span className="headline-line">IS SHOWING LOVE</span>
      </div>

      {/* LAYER 3 — Hand artwork (always visible) */}
      <div
        className={`hand-artwork-container${hasOverlay ? ' state-lifted' : ''}${fingerZoomed ? ' state-zoomed-finger' : ''}${inDiscovery ? ' discovery-active' : ''}`}
        style={
          zoomConfig && (discoveryPhase === 'zooming' || discoveryPhase === 'tracing' || discoveryPhase === 'revealed')
            ? {
                '--zoom-origin-x': zoomConfig.originX,
                '--zoom-origin-y': zoomConfig.originY,
                '--zoom-scale': zoomConfig.scale,
                '--zoom-translate-x': zoomConfig.translateX,
                '--zoom-translate-y': zoomConfig.translateY,
              }
            : {}
        }
      >
        <div className="hand-glow" />
        <img
          src={handArt}
          className="living-hand-canvas"
          alt="Hand Vector Lines"
        />

        {/* Discovery contour tracing overlay */}
        {inDiscovery && discoveryPhase !== 'dimming' && discoveryPhase !== 'zooming-out' && contourPath && (
          <svg className="discovery-contour-svg" viewBox="0 0 430 932" preserveAspectRatio="none">
            {activeDiscovery?.visitNumber === 1 && (
              <defs>
                <path id="text-arc-path" d="M60,440 C140,400 280,430 370,380" />
              </defs>
            )}
            <path
              className="discovery-contour-path"
              d={contourPath}
            />
            {activeDiscovery?.visitNumber === 1 && discoveryPhase === 'tracing' && (
              <text className="discovery-contour-text">
                <textPath href="#text-arc-path" startOffset="50%" textAnchor="middle" letterSpacing="3">
                  i saw a white cat
                </textPath>
              </text>
            )}
          </svg>
        )}

        {/* Hidden discovery text embedded in the artwork */}
        {discoveryPhase === 'revealed' && activeDiscovery && (
          <div className="discovery-inset">
            <span className="discovery-tag">{activeDiscovery.tag}</span>
            <span className="discovery-text">{activeDiscovery.content}</span>
            {activeDiscovery.hint && (
              <span className="discovery-hint">{activeDiscovery.hint}</span>
            )}
          </div>
        )}

        <div className="telemetry">
          <svg viewBox="0 0 20 20" className="tele-crosshair">
            <line x1="10" y1="0" x2="10" y2="4" />
            <line x1="10" y1="16" x2="10" y2="20" />
            <line x1="0" y1="10" x2="4" y2="10" />
            <line x1="16" y1="10" x2="20" y2="10" />
            <circle cx="10" cy="10" r="2.5" fill="none" />
          </svg>
          <svg viewBox="0 0 20 20" className="tele-bracket">
            <path d="M0,4 L0,0 L4,0" />
            <path d="M20,4 L20,0 L16,0" />
            <path d="M0,16 L0,20 L4,20" />
            <path d="M20,16 L20,20 L16,20" />
          </svg>
          <p className="sys-coords">[SYS_LOC &sol;&sol; 0.26]</p>
        </div>
      </div>

      {/* LAYER 4 — Hero actions */}
      {view === 'hero' && !inDiscovery && (
        <div className="hero-actions-layer">
          <motion.button
            className="sp-mark-btn"
            onClick={handleMarkVisit}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            MARK MY VISIT
          </motion.button>
        </div>
      )}

      {/* LAYER 5 — Register form */}
      {view === 'register' && !inDiscovery && (
        <motion.div
          className="overlay register-overlay"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="register-backdrop" />
          <motion.form
            onSubmit={handleSubmit}
            className="register-form"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            {isReturning ? (
              <p className="register-message">
                {knownMember.firstName}, this is your{' '}
                {ordinal(knownMember.totalVisits + 1)} visit.
              </p>
            ) : (
              <p className="register-message">Thank you for showing up.</p>
            )}

            {!isReturning && (
              <input
                className="sp-input"
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
              />
            )}
            <input
              className="sp-input"
              placeholder="Mobile number"
              value={phoneNumber}
              onChange={(e) => {
                setPhoneNumber(e.target.value)
                setKnownMember(null)
              }}
              onBlur={handlePhoneBlur}
              inputMode="tel"
              autoComplete="tel"
            />

            {error && <p className="sp-error">{error}</p>}

            <button
              className="sp-submit-btn"
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Marking\u2026' : 'CONFIRM'}
            </button>
          </motion.form>
        </motion.div>
      )}

      {/* LAYER 6 — Discovery dim overlay */}
      {inDiscovery && (
        <div className="discovery-dim" />
      )}

      {/* LAYER 7 — Discovery region label / zoom indicator */}
      {inDiscovery && activeDiscovery && (discoveryPhase === 'zooming' || discoveryPhase === 'tracing') && (
        <div className="discovery-region-label">
          <motion.span
            className="discovery-region-name"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          >
            {REGIONS.find(r => r.id === activeDiscovery.region)?.label || activeDiscovery.region}
          </motion.span>
          <motion.span
            className="discovery-region-hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.3, ease: 'easeOut' }}
          >
            Visit {activeDiscovery.visitNumber}
          </motion.span>
        </div>
      )}

      {/* LAYER 8 — Discovery continue button (appears at revealed phase) */}
      {discoveryPhase === 'revealed' && activeDiscovery && (
        <motion.button
          className="discovery-continue-btn"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          onClick={handleContinue}
        >
          {activeDiscovery.visitNumber >= 100 ? 'Another discovery awaits' : 'Continue'}
        </motion.button>
      )}

      {/* LAYER 8 — Progress overlay */}
      {view === 'progress' && member && !inDiscovery && (
        <motion.div
          className="overlay progress-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="stagepass-ring-wrap">
            <svg viewBox="0 0 120 120" className="stagepass-ring">
              <circle cx="60" cy="60" r="52" className="stagepass-ring-track" />
              <motion.circle
                cx="60" cy="60" r="52"
                className="stagepass-ring-fill"
                strokeDasharray={2 * Math.PI * 52}
                initial={{ strokeDashoffset: 2 * Math.PI * 52 }}
                animate={{ strokeDashoffset: 2 * Math.PI * 52 * (1 - progressPct) }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
              />
            </svg>
            <div className="stagepass-ring-count">{member.totalVisits}</div>
          </div>

          <motion.p
            className="progress-message"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
          >
            {member.totalVisits} visit
            {member.totalVisits === 1 ? '' : 's'}
          </motion.p>
          <motion.p
            className="progress-milestone"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.35 }}
          >
            {remaining > 0
              ? `${remaining} more until ${milestone.label}`
              : `You're a ${milestone.label}`}
          </motion.p>

          <motion.button
            className="sp-done-btn"
            onClick={resetForNextScan}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.5 }}
          >
            See you at your next visit
          </motion.button>
        </motion.div>
      )}

      {/* LAYER 9 — Zoom reveal */}
      <div className="zoom-reveal-wrap">
        <motion.div
          className="zoom-reveal"
          initial={{ opacity: 0 }}
          animate={{ opacity: fingerZoomed ? 1 : 0 }}
          transition={{ duration: 0.8, delay: fingerZoomed ? 0.4 : 0 }}
        >
          <div className="zoom-reveal-content">
            <p className="zoom-reveal-label">Backup Pass</p>
            <p className="zoom-reveal-code">STAGE-PASS-4LIVE</p>
            <div className="zoom-reveal-divider" />
            <p className="zoom-reveal-label">Recovery Key</p>
            <p className="zoom-reveal-code">X8K2-M9P4-Q7R1-V3N6</p>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
