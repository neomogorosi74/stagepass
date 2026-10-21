import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import logo from '../assets/logo.png'
import blLogo from '../assets/bl-logo.png'

const SPLASH_DURATION = 4000
const AUTH_PASSWORD = 'blacklabone2024'

export default function Login() {
  const [flowState, setFlowState] = useState('splash-bl')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    if (flowState === 'splash-bl') {
      const t = setTimeout(() => setFlowState('splash-sp'), SPLASH_DURATION)
      return () => clearTimeout(t)
    }
    if (flowState === 'splash-sp') {
      const t = setTimeout(() => setFlowState('login'), SPLASH_DURATION)
      return () => clearTimeout(t)
    }
  }, [flowState])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (password === AUTH_PASSWORD) {
      sessionStorage.setItem('stagepass.admin', 'granted')
      navigate('/admin', { replace: true })
    } else {
      setError('Incorrect password')
      setPassword('')
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#FAFAF7', color: '#0A0A0A', fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
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
      {flowState === 'login' && (
        <>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '300px', width: '100%' }}>
            <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Admin Login</h1>
            <p style={{ margin: 0, color: 'rgba(10,10,10,0.4)', fontSize: '14px' }}>Enter the organizer password to access the dashboard.</p>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              style={{ padding: '14px 16px', borderRadius: '12px', border: '1px solid rgba(10,10,10,0.1)', fontSize: '17px', background: '#FFFFFF', fontWeight: 400, outline: 'none' }}
            />
            {error && <p style={{ margin: 0, color: '#EC1E68', fontSize: '14px' }}>{error}</p>}
            <button type="submit" style={{
              padding: '14px 24px', borderRadius: '12px', border: 'none',
              background: '#0A0A0A', color: '#FFFFFF', fontSize: '17px',
              fontWeight: 600, cursor: 'pointer', letterSpacing: '-0.01em',
            }}>
              Log In
            </button>
          </form>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', paddingTop: '8px' }}>
            <img src={logo} alt="StagePass" style={{ width: '28px', height: 'auto', opacity: 0.45 }} />
            <p style={{ fontSize: '7px', fontWeight: 300, color: '#0A0A0A', letterSpacing: '0.05em', textAlign: 'center', margin: 0, opacity: 0.35 }}>Developed by Neo Mogorosi</p>
          </div>
        </>
      )}

      <style>{`
        @keyframes logoReveal {
          0% { opacity: 0; transform: scale(0.85); }
          40% { opacity: 1; transform: scale(1.03); }
          70% { transform: scale(0.98); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}
