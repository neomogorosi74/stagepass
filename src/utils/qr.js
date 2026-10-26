import QRCode from 'qrcode'
import jsPDF from 'jspdf'

export async function generateQrDataUrl(text) {
  try {
    return await QRCode.toDataURL(text, { errorCorrectionLevel: 'H', margin: 1, width: 512 })
  } catch (e) {
    throw e
  }
}

export async function downloadQrPoster({ eventName, eventDate, venue, qrUrl, qrDataUrl }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = 210
  const margin = 20
  let y = margin

  doc.setFont('Helvetica', 'bold')
  doc.setFontSize(24)
  doc.text('STAGEPASS', margin, y)
  y += 12

  doc.setFontSize(16)
  doc.text(eventName || 'Event', margin, y)
  y += 8

  doc.setFont('Helvetica', 'normal')
  doc.setFontSize(11)
  if (eventDate) {
    doc.text(`Date: ${eventDate}`, margin, y)
    y += 6
  }
  if (venue) {
    doc.text(`Venue: ${venue}`, margin, y)
    y += 6
  }
  y += 10

  if (qrDataUrl) {
    doc.addImage(qrDataUrl, 'PNG', (pageW - 80) / 2, y, 80, 80)
    y += 90
  }

  doc.setFontSize(8)
  doc.setTextColor(120)
  if (qrUrl) {
    const short = qrUrl.length > 90 ? qrUrl.slice(0, 87) + '...' : qrUrl
    doc.text(short, margin, y)
  }
  doc.setTextColor(0)

  doc.save(`stagepass-${(eventName || 'event').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-qr.pdf`)
}
