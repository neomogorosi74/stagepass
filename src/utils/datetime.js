const JOHANNESBURG_OFFSET = '+02:00'
const JOHANNESBURG_OFFSET_MS = 2 * 60 * 60 * 1000

export function toJohannesburgIso(value) {
  if (value === null || value === undefined) return ''
  const raw = String(value).trim()
  if (!raw) return ''

  let parsed
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw)) {
    parsed = new Date(raw)
  } else {
    const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ? `${raw}:00` : raw
    parsed = new Date(`${withSeconds}${JOHANNESBURG_OFFSET}`)
  }

  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid date/time')
  }
  return parsed.toISOString()
}

export function toJohannesburgLocalInput(value) {
  if (value === null || value === undefined) return ''
  const raw = String(value).trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return ''
  const shifted = new Date(parsed.getTime() + JOHANNESBURG_OFFSET_MS)
  return shifted.toISOString().slice(0, 16)
}
