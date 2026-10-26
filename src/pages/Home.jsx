import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import WarpedGridBackground from '../components/WarpedGridBackground'
import { recordVisit, setCachedPhoneNumber, clearCachedPhoneNumber, getNextConnectionSlot } from '../utils/storage'
import { getWeekItems } from '../utils/connections'
import { fetchEventPublic } from '../utils/events'
import logo from '../assets/logo.png'
import blLogo from '../assets/bl-logo.png'

const SPLASH_DURATION = 4000
const WELCOME_DURATION = 2500

const ordinal = n => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

const RARE_WELCOMES = [
  "Black Labone noticed you today.",
  "The theatre remembered you.",
  "The curtain was expecting you.",
  "Some faces become part of the room.",
  "You're becoming part of the story.",
  "You've been here before.",
  "The stage remembers familiar footsteps.",
]

export default function Home() {
  const [searchParams] = useSearchParams()
  const eventId = searchParams.get('eventId') || ''
  const eventToken = searchParams.get('t') || searchParams.get('token') || ''
  const [flowState, setFlowState] = useState('splash-bl')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [visitCount, setVisitCount] = useState(null)
  const [alreadyToday, setAlreadyToday] = useState(false)
  const [alreadyEvent, setAlreadyEvent] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [welcomeMessage, setWelcomeMessage] = useState('')
  const [connectionItem, setConnectionItem] = useState(null)
  const [eventInfo, setEventInfo] = useState(null)
  const [eventLinkError, setEventLinkError] = useState('')

  useEffect(() => {
    if (!eventId) return
    let active = true
    fetchEventPublic(eventId)
      .then(data => {
        if (!active) return
        setEventInfo(data)
        setEventLinkError('')
      })
      .catch(() => {
        if (!active) return
        setEventInfo(null)
        setEventLinkError('This event link is invalid or no longer available.')
      })
    return () => {
      active = false
    }
  }, [eventId])

  useEffect(() => {
    if (flowState === 'splash-bl') {
      const t = setTimeout(() => setFlowState('splash-sp'), SPLASH_DURATION)
      return () => clearTimeout(t)
    }
    if (flowState === 'splash-sp') {
      const t = setTimeout(() => setFlowState('checkin'), SPLASH_DURATION)
      return () => clearTimeout(t)
    }
    if (flowState === 'welcome') {
      const t = setTimeout(() => setFlowState('connection'), WELCOME_DURATION)
      return () => clearTimeout(t)
    }
  }, [flowState])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!phoneNumber) return
    setSubmitting(true)
    setError('')
    try {
      const result = await recordVisit({ firstName: firstName || 'Friend', lastName, phoneNumber, eventId, token: eventToken })
      setCachedPhoneNumber(phoneNumber)
      setVisitCount(result.totalVisits)
      const duplicate = Boolean(result.alreadyCheckedInToday)
      setAlreadyToday(duplicate)
      setAlreadyEvent(Boolean(result.alreadyCheckedInToEvent))
      const slot = getNextConnectionSlot()
      const weekItems = getWeekItems(slot.weekIndex)
      setConnectionItem(weekItems[slot.itemIndex])
      if (duplicate) {
        setWelcomeMessage('')
        setFlowState('already')
      } else {
        if (result.totalVisits > 1 && Math.random() < 0.2) {
          setWelcomeMessage(RARE_WELCOMES[Math.floor(Math.random() * RARE_WELCOMES.length)])
        } else {
          setWelcomeMessage('')
        }
        setFlowState('welcome')
      }
    } catch (e) {
      setError(e.message || 'Could not check in. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleConnectionDone = () => {
    setFlowState('visitCount')
  }

  const handleDone = () => {
    clearCachedPhoneNumber()
    setFirstName('')
    setLastName('')
    setPhoneNumber('')
    setVisitCount(null)
    setAlreadyToday(false)
    setAlreadyEvent(false)
    setWelcomeMessage('')
    setConnectionItem(null)
    setError('')
    setSubmitting(false)
    setFlowState('splash-bl')
  }

  return (
    <div style={{ minHeight: '100vh', color: '#0A0A0A', fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif", display: 'flex', flexDirection: 'column', padding: '24px', position: 'relative', zIndex: 1 }}>
      {flowState !== 'splash-bl' && flowState !== 'splash-sp' && <WarpedGridBackground />}

      {flowState !== 'splash-bl' && flowState !== 'splash-sp' && (
        <div style={{ textAlign: 'center', paddingBottom: '6px', position: 'relative', zIndex: 1 }}>
          <img src={blLogo} alt="Black Labone" style={{ width: '54px', height: 'auto', opacity: 0.85 }} />
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
      {flowState === 'splash-bl' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', animation: 'logoReveal 1s ease-out both' }}>
          <img src={blLogo} alt="Black Labone" style={{ width: 'min(200px, 50vw)', height: 'auto' }} />
        </div>
      )}

      {flowState === 'splash-sp' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', animation: 'logoReveal 1s ease-out both' }}>
          <img src={logo} alt="StagePass" style={{ width: 'min(280px, 60vw)', height: 'auto' }} />
        </div>
      )}

      {flowState === 'checkin' && (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '320px', width: '100%' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Check In</h1>
          {eventInfo && (
            <p style={{ margin: 0, color: 'rgba(10,10,10,0.55)', fontSize: '13px', fontWeight: 600, letterSpacing: '0.01em' }}>
              {eventInfo.eventName}
              {eventInfo.venue ? ` · ${eventInfo.venue}` : ''}
              {eventInfo.eventDate ? ` · ${eventInfo.eventDate}` : ''}
            </p>
          )}
          {eventLinkError && <p style={{ margin: 0, color: '#EC1E68', fontSize: '13px' }}>{eventLinkError}</p>}
          <p style={{ margin: '0 0 4px', color: 'rgba(10,10,10,0.4)', fontSize: '15px', fontWeight: 400 }}>Enter your details to mark your visit.</p>
          <input
            placeholder="First name"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            style={{ padding: '14px 16px', borderRadius: '12px', border: '1px solid rgba(10,10,10,0.1)', fontSize: '17px', background: '#FFFFFF', fontWeight: 400, outline: 'none' }}
          />
          <input
            placeholder="Surname"
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            style={{ padding: '14px 16px', borderRadius: '12px', border: '1px solid rgba(10,10,10,0.1)', fontSize: '17px', background: '#FFFFFF', fontWeight: 400, outline: 'none' }}
          />
          <input
            placeholder="Mobile number"
            value={phoneNumber}
            onChange={e => setPhoneNumber(e.target.value)}
            inputMode="tel"
            style={{ padding: '14px 16px', borderRadius: '12px', border: '1px solid rgba(10,10,10,0.1)', fontSize: '17px', background: '#FFFFFF', fontWeight: 400, outline: 'none' }}
          />
          {error && <p style={{ margin: 0, color: '#EC1E68', fontSize: '14px' }}>{error}</p>}
          <button type="submit" disabled={submitting} style={{
            padding: '14px 24px', borderRadius: '12px', border: 'none',
            background: '#0A0A0A', color: '#FFFFFF', fontSize: '17px',
            fontWeight: 600, cursor: 'pointer', marginTop: '8px',
            letterSpacing: '-0.01em',
          }}>
            {submitting ? 'Marking…' : 'Mark My Visit'}
          </button>
        </form>
      )}

      {flowState === 'welcome' && (
        <div style={{ textAlign: 'center', animation: 'fadeUp 0.6s ease-out' }}>
          {visitCount === 1 ? (
            <p style={{ fontSize: '32px', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Welcome to Black Labone</p>
          ) : welcomeMessage ? (
            <p style={{ fontSize: '26px', fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>{welcomeMessage}</p>
          ) : (
            <p style={{ fontSize: '28px', fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>The Regular Shadow has returned.</p>
          )}
        </div>
      )}

      {flowState === 'connection' && connectionItem && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '360px', animation: 'fadeUp 0.5s ease-out' }}>
          {connectionItem.type === 'question' ? (
            <>
              <p style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(10,10,10,0.3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '20px' }}>FIND SOMEONE AND ASK</p>
              <p style={{ fontSize: '20px', fontWeight: 600, textAlign: 'center', letterSpacing: '-0.01em', marginBottom: '20px' }}>{connectionItem.question}</p>
              <p style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(10,10,10,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>IF THEY ANSWER</p>
              <p style={{ fontSize: '17px', fontWeight: 500, textAlign: 'center', fontStyle: 'italic', letterSpacing: '-0.01em', marginBottom: '20px' }}>{connectionItem.answer}</p>
              <p style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(10,10,10,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>THEN ASK THEM</p>
              <p style={{ fontSize: '17px', fontWeight: 500, textAlign: 'center', letterSpacing: '-0.01em', marginBottom: '24px' }}>{connectionItem.conversationPrompt}</p>
            </>
          ) : (
            <>
              <p style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(10,10,10,0.3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '20px' }}>DO THIS TOGETHER</p>
              <p style={{ fontSize: '18px', fontWeight: 500, textAlign: 'center', letterSpacing: '-0.01em', lineHeight: 1.5, marginBottom: '24px' }}>{connectionItem.instruction}</p>
            </>
          )}
          <button onClick={handleConnectionDone} style={{
            padding: '14px 32px', borderRadius: '12px', border: 'none',
            background: '#0A0A0A', color: '#FFFFFF', fontSize: '17px',
            fontWeight: 600, cursor: 'pointer', letterSpacing: '-0.01em',
          }}>
            Done
          </button>
        </div>
      )}

      {flowState === 'already' && (
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', animation: 'fadeUp 0.5s ease-out' }}>
          <p style={{ fontSize: '28px', fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>
            {alreadyEvent ? "You're already checked in to this event." : "You're already signed in for today."}
          </p>
          <p style={{ fontSize: '15px', color: 'rgba(10,10,10,0.4)', margin: 0, fontWeight: 400 }}>
            {alreadyEvent ? 'Your spot is on the board.' : `Visit ${ordinal(visitCount)} Thursday is on the board.`}
          </p>
          <button onClick={handleDone} style={{
            marginTop: '20px', padding: '14px 32px', borderRadius: '12px', border: 'none',
            background: '#0A0A0A', color: '#FFFFFF', fontSize: '17px',
            fontWeight: 600, cursor: 'pointer', letterSpacing: '-0.01em',
          }}>
            Done
          </button>
        </div>
      )}

      {flowState === 'visitCount' && (
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', animation: 'fadeUp 0.5s ease-out' }}>
          <p style={{ fontSize: '32px', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>{ordinal(visitCount)} Thursday. You are most welcome.</p>
          <button onClick={handleDone} style={{
            marginTop: '20px', padding: '14px 32px', borderRadius: '12px', border: 'none',
            background: '#0A0A0A', color: '#FFFFFF', fontSize: '17px',
            fontWeight: 600, cursor: 'pointer', letterSpacing: '-0.01em',
          }}>
            Done
          </button>
        </div>
      )}

      </div>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes logoReveal {
          0% { opacity: 0; transform: scale(0.85); }
          40% { opacity: 1; transform: scale(1.03); }
          70% { transform: scale(0.98); }
          100% { opacity: 1; transform: scale(1); }
        }
        input:focus {
          border-color: rgba(10,10,10,0.3) !important;
        }
      `}</style>
    </div>
  )
}
