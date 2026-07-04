import { motion } from 'framer-motion'

/**
 * AbstractFace — the never-static hero artwork.
 * Uses the real painted portrait asset (public/face-artwork.jpg),
 * kept in motion with ambient drift + a breathing backdrop, exactly
 * as the design system's "the artwork is never static" rule requires.
 *
 * stage:
 *   'hero'     full presence, centered, ambient drift + breathing
 *   'receding' pushed up and faded to ~20% opacity (register screen)
 *
 * visits: total visit count — unlocks small accent strokes layered
 * over the portrait at 5 / 10 / 20 visits (the reward system).
 */
export default function AbstractFace({ stage = 'hero', visits = 0 }) {
  const isReceding = stage === 'receding'

  const unlockedAt5 = visits >= 5
  const unlockedAt10 = visits >= 10
  const unlockedAt20 = visits >= 20

  return (
    <motion.div
      className="abstract-face"
      animate={{
        y: isReceding ? -56 : 0,
        opacity: isReceding ? 0.2 : 1,
        scale: isReceding ? 0.94 : 1,
      }}
      transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      style={{ width: '100%', maxWidth: 320, margin: '0 auto' }}
    >
      {/* breathing backdrop */}
      <motion.div
        className="ambient-motion"
        animate={{ scale: [1, 1.035, 1], opacity: [0.55, 0.85, 0.55] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          position: 'absolute',
          inset: '-8%',
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(227,162,61,0.18), rgba(244,234,217,0) 70%)',
          zIndex: 0,
        }}
      />

      {/* slow ambient drift on the portrait itself */}
      <motion.div
        className="ambient-motion"
        animate={{
          x: [0, 3, -2.5, 0],
          y: [0, -2.5, 2, 0],
          rotate: [0, 0.3, -0.25, 0],
        }}
        transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
        style={{ position: 'relative', zIndex: 1 }}
      >
        <img
          src="/face-artwork.jpg"
          alt="Painted abstract portrait, the StagePass mark of attendance"
          style={{ width: '100%', display: 'block' }}
        />

        {/* ---- reward evolution accents (unlock with visits) ---- */}
        {unlockedAt5 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
            style={{
              position: 'absolute',
              top: '6%',
              right: '8%',
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: 'var(--orange)',
            }}
          />
        )}
        {unlockedAt10 && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 0.95, x: 0 }}
            transition={{ duration: 0.8 }}
            style={{
              position: 'absolute',
              bottom: '14%',
              left: '2%',
              width: 30,
              height: 8,
              borderRadius: 6,
              background: 'var(--denim)',
              transform: 'rotate(-8deg)',
            }}
          />
        )}
        {unlockedAt20 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 0.95, scale: 1 }}
            transition={{ duration: 0.8 }}
            style={{
              position: 'absolute',
              top: '2%',
              left: '4%',
              width: 20,
              height: 20,
              borderRadius: '50%',
              border: '2px solid var(--coral)',
            }}
          />
        )}

        {/* occasional faint extra mark — "the artwork is never static" */}
        <motion.div
          animate={{ opacity: [0, 0, 0.6, 0.6, 0] }}
          transition={{
            duration: 22,
            repeat: Infinity,
            times: [0, 0.55, 0.65, 0.85, 1],
            ease: 'easeInOut',
          }}
          style={{
            position: 'absolute',
            top: '34%',
            left: '4%',
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: 'var(--orange)',
          }}
        />
      </motion.div>
    </motion.div>
  )
}
