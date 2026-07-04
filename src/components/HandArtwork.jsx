import { motion } from 'framer-motion'
import svgContent from '../assets/updated-hand-artwork.svg?raw'

const cleanSvg = svgContent
  .replace(/^<\?xml[^>]*\?>/, '')
  .replace(/^<!DOCTYPE[^>]*>/, '')
  .replace(/width="[^"]*"/, '')
  .replace(/height="[^"]*"/, '')
  .trim()

export default function HandArtwork({
  stage = 'hero',
  visits = 0,
  isZoomed = false,
  onTap,
}) {
  const isReceding = stage === 'receding'

  return (
    <motion.div
      className="hand-artwork"
      style={{ transformOrigin: '38% 18%' }}
      animate={{
        scale: isZoomed ? 2.8 : isReceding ? 0.82 : 1,
        y: isZoomed ? '0%' : isReceding ? -96 : 0,
        opacity: isZoomed ? 1 : isReceding ? 0.2 : 1,
      }}
      transition={{
        duration: isZoomed ? 1.2 : 0.9,
        ease: isZoomed
          ? [0.32, 0.72, 0, 1]
          : [0.22, 1, 0.36, 1],
      }}
      onClick={onTap}
    >
      <div
        className="hand-artwork-svg"
        dangerouslySetInnerHTML={{ __html: cleanSvg }}
      />

      <div className="hand-artwork-shadow" />

      <div className="hand-region hand-region--palm" data-region="palm" />
      <div className="hand-region hand-region--fingers" data-region="fingers" />
      <div className="hand-region hand-region--wrist" data-region="wrist" />
    </motion.div>
  )
}
