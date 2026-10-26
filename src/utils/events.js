const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function getAdminToken() {
  try {
    return sessionStorage.getItem('stagepass.admin.token') || ''
  } catch {
    return ''
  }
}

async function responseError(res, fallback) {
  try {
    const data = await res.json()
    return data.error || data.message || fallback
  } catch {
    return fallback
  }
}

export async function adminLogin(password) {
  if (!API_BASE) throw new Error('API not configured')
  const res = await fetch(`${API_BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  })
  if (!res.ok) throw new Error(await responseError(res, 'Login failed'))
  return res.json()
}

export async function fetchEvents() {
  if (!API_BASE) return []
  const token = getAdminToken()
  const res = await fetch(`${API_BASE}/admin/events`, {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {}
  })
  if (!res.ok) throw new Error(await responseError(res, 'Failed to fetch events'))
  const data = await res.json()
  return data.events || []
}

export async function createEvent(event) {
  if (!API_BASE) throw new Error('API not configured')
  const token = getAdminToken()
  const res = await fetch(`${API_BASE}/admin/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    body: JSON.stringify(event)
  })
  if (!res.ok) throw new Error(await responseError(res, 'Failed to create event'))
  return res.json()
}

export async function updateEvent(eventId, updates) {
  if (!API_BASE) throw new Error('API not configured')
  const token = getAdminToken()
  const res = await fetch(`${API_BASE}/admin/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    body: JSON.stringify(updates)
  })
  if (!res.ok) throw new Error(await responseError(res, 'Failed to update event'))
  return res.json()
}

export async function generateEventQr(eventId) {
  if (!API_BASE) throw new Error('API not configured')
  const token = getAdminToken()
  const res = await fetch(`${API_BASE}/admin/events/${encodeURIComponent(eventId)}/qr`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {}
  })
  if (!res.ok) throw new Error(await responseError(res, 'Failed to generate QR'))
  return res.json()
}

export async function fetchEventPublic(eventId) {
  if (!API_BASE) throw new Error('API not configured')
  const res = await fetch(`${API_BASE}/events/${encodeURIComponent(eventId)}`)
  if (!res.ok) throw new Error(await responseError(res, 'Failed to fetch event'))
  return res.json()
}
