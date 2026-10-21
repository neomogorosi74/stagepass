import { useRef, useEffect } from 'react'


const COLS = 20
const ROWS = 20
const SPACING = 1
const FOCAL = 600
const CAM_DIST = 14
const CAM_HEIGHT = 8

const PARTICLES = 30

export default function WarpedGridBackground() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let animId

    const seeds = Array.from({ length: PARTICLES }, () => ({
      ox: Math.random() * 2 - 1,
      oz: Math.random() * 2 - 1,
      speed: 0.1 + Math.random() * 0.2,
      phase: Math.random() * Math.PI * 2,
      size: 1 + Math.random() * 2,
    }))

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const project = (gx, gz, cosA, sinA) => {
      const rx = gx * cosA - gz * sinA
      const rz = gx * sinA + gz * cosA
      const tz = rz + CAM_DIST
      if (tz <= 0) return null
      return {
        sx: (window.innerWidth / 2) + rx * FOCAL / tz,
        sy: (window.innerHeight * 0.55) - CAM_HEIGHT * FOCAL / tz,
        tz,
      }
    }

    const draw = (time) => {
      const w = window.innerWidth
      const h = window.innerHeight
      const cx = w / 2
      const cy = h * 0.55
      const angle = time * 0.00008
      const cosA = Math.cos(angle)
      const sinA = Math.sin(angle)
      const t = time * 0.001
      const hw = (COLS - 1) * SPACING / 2
      const hd = (ROWS - 1) * SPACING / 2

      ctx.clearRect(0, 0, w, h)

      // ── horizon glow ──
      const hg = ctx.createRadialGradient(cx, cy - 20, 0, cx, cy - 20, h * 0.6)
      hg.addColorStop(0, 'rgba(30,144,216,0.04)')
      hg.addColorStop(0.5, 'rgba(236,30,104,0.02)')
      hg.addColorStop(1, 'rgba(10,10,10,0)')
      ctx.fillStyle = hg
      ctx.fillRect(0, 0, w, h)

      // ── grid lines ──
      ctx.lineWidth = 0.8
      ctx.strokeStyle = 'rgba(10,10,10,0.22)'
      ctx.shadowColor = 'rgba(30,144,216,0.06)'
      ctx.shadowBlur = 6

      for (let row = 0; row < ROWS; row++) {
        ctx.beginPath()
        let started = false
        for (let col = 0; col < COLS; col++) {
          const gx = col * SPACING - hw
          const gz = row * SPACING - hd
          const p = project(gx, gz, cosA, sinA)
          if (!p) continue
          if (!started) { ctx.moveTo(p.sx, p.sy); started = true }
          else ctx.lineTo(p.sx, p.sy)
        }
        ctx.stroke()
      }

      for (let col = 0; col < COLS; col++) {
        ctx.beginPath()
        let started = false
        for (let row = 0; row < ROWS; row++) {
          const gx = col * SPACING - hw
          const gz = row * SPACING - hd
          const p = project(gx, gz, cosA, sinA)
          if (!p) continue
          if (!started) { ctx.moveTo(p.sx, p.sy); started = true }
          else ctx.lineTo(p.sx, p.sy)
        }
        ctx.stroke()
      }

      // ── grid nodes ──
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const gx = col * SPACING - hw
          const gz = row * SPACING - hd
          const p = project(gx, gz, cosA, sinA)
          if (!p) continue
          const pulse = 0.5 + 0.5 * Math.sin(t * 1.2 + col * 0.5 + row * 0.7)
          const dist = Math.min(1, (p.tz || 1) / 25)
          const size = 1.5 * (1 - dist * 0.7) * (0.4 + 0.6 * pulse)
          const alpha = 0.35 * (1 - dist * 0.6) * (0.3 + 0.7 * pulse)
          ctx.beginPath()
          ctx.arc(p.sx, p.sy, size, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(10,10,10,${alpha})`
          ctx.fill()
        }
      }

      // ── floating particles ──
      ctx.shadowBlur = 0
      for (const s of seeds) {
        const gx = s.ox + Math.sin(t * s.speed + s.phase) * 6
        const gz = s.oz + Math.cos(t * s.speed * 0.7 + s.phase * 1.3) * 6
        const gy = 0.5 + Math.sin(t * s.speed * 0.5 + s.phase * 2) * 0.7
        const rx = gx * cosA - gz * sinA
        const rz = gx * sinA + gz * cosA
        const ty = -CAM_HEIGHT + gy
        const tz = rz + CAM_DIST
        if (tz <= 0) continue
        const sx = cx + rx * FOCAL / tz
        const sy = cy + ty * FOCAL / tz
        const alpha = 0.08 + 0.12 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase))
        ctx.beginPath()
        ctx.arc(sx, sy, s.size * 0.6, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(30,144,216,${alpha})`
        ctx.fill()
      }

      ctx.shadowBlur = 0

      animId = requestAnimationFrame(draw)
    }

    animId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  )
}
