import { useEffect, useState, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  lookupMember,
  recordVisit,
  getCachedPhoneNumber,
  setCachedPhoneNumber,
} from '../utils/storage.js'
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
  const [animatingLine, setAnimatingLine] = useState(-1)
  const animatingLineTimer = useRef(null)

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
      setView('progress')
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const resetForNextScan = () => {
    setFirstName('')
    setKnownMember(null)
    setMember(null)
    setError('')
    setView('hero')
  }

  const milestone = member?.milestone ?? null
  const remaining = milestone ? Math.max(milestone.count - member.totalVisits, 0) : 0
  const progressPct = milestone
    ? Math.min(member.totalVisits / milestone.count, 1)
    : 0

  return (
    <div className="stagepass-screen">
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
      <div className="stagepass-headline">
        <span className="headline-line">SHOWING UP</span>
        <span className="headline-line">IS SHOWING LOVE</span>
      </div>

      {/* LAYER 4 — Hero actions */}
      {view === 'hero' && (
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
      {view === 'register' && (
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

      {/* LAYER 6 — Progress overlay */}
      {view === 'progress' && member && (
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
    </div>
  )
}
