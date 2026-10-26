import { useState, useEffect } from 'react'
import { fetchEvents, createEvent, updateEvent, generateEventQr } from '../utils/events'
import { generateQrDataUrl, downloadQrPoster } from '../utils/qr'
import { toJohannesburgIso, toJohannesburgLocalInput } from '../utils/datetime'
import '../pages/StagePassAdmin.css'

const EMPTY_FORM = {
  eventName: '',
  eventDate: '',
  venue: '',
  validFrom: '',
  validTo: '',
  status: 'draft'
}

export default function EventManager() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState('')
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [qrResult, setQrResult] = useState(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchEvents()
      setEvents(data)
    } catch (e) {
      setError(e.message || 'Failed to load events')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const resetForm = () => {
    setForm({ ...EMPTY_FORM })
    setEditingId('')
  }

  const startEdit = (ev) => {
    setEditingId(ev.eventId)
    setForm({
      eventName: ev.eventName || '',
      eventDate: ev.eventDate || '',
      venue: ev.venue || '',
      validFrom: toJohannesburgLocalInput(ev.validFrom),
      validTo: toJohannesburgLocalInput(ev.validTo),
      status: ev.status || 'draft'
    })
    setQrResult(null)
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const payload = {
        ...form,
        validFrom: toJohannesburgIso(form.validFrom),
        validTo: toJohannesburgIso(form.validTo)
      }
      if (editingId) {
        await updateEvent(editingId, payload)
      } else {
        await createEvent(payload)
      }
      resetForm()
      setQrResult(null)
      await load()
    } catch (e) {
      setError(e.message || (editingId ? 'Failed to update event' : 'Failed to create event'))
    } finally {
      setSaving(false)
    }
  }

  const handleStatus = async (eventId, status) => {
    try {
      await updateEvent(eventId, { status })
      await load()
    } catch (e) {
      setError(e.message || 'Failed to update')
    }
  }

  const handleQr = async (ev) => {
    try {
      setError('')
      const res = await generateEventQr(ev.eventId)
      setQrResult(res)
      if (res.qrUrl) {
        const dataUrl = await generateQrDataUrl(res.qrUrl)
        await downloadQrPoster({
          eventName: res.eventName || ev.eventName,
          eventDate: ev.eventDate,
          venue: ev.venue,
          qrUrl: res.qrUrl,
          qrDataUrl: dataUrl
        })
      }
    } catch (e) {
      setError(e.message || 'Failed to generate QR')
    }
  }

  return (
    <section className="admin-panel">
      <h2 className="admin-panel-title">{editingId ? 'Edit Event' : 'Events'}</h2>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '8px', marginBottom: '12px' }}>
        <input className="admin-search-input" placeholder="Event name" value={form.eventName} onChange={e => setForm({ ...form, eventName: e.target.value })} required />
        <input className="admin-search-input" type="date" value={form.eventDate} onChange={e => setForm({ ...form, eventDate: e.target.value })} required />
        <input className="admin-search-input" placeholder="Venue" value={form.venue} onChange={e => setForm({ ...form, venue: e.target.value })} />
        <input className="admin-search-input" type="datetime-local" value={form.validFrom} onChange={e => setForm({ ...form, validFrom: e.target.value })} required />
        <input className="admin-search-input" type="datetime-local" value={form.validTo} onChange={e => setForm({ ...form, validTo: e.target.value })} required />
        <select className="admin-search-input" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
          <option value="draft">draft</option>
          <option value="open">open</option>
          <option value="closed">closed</option>
          <option value="cancelled">cancelled</option>
        </select>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="admin-download-btn" type="submit" disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Event'}
          </button>
          {editingId && (
            <button className="admin-download-btn" type="button" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>
      {error && <p style={{ color: '#EC1E68', fontSize: '12px' }}>{error}</p>}
      {loading && <p style={{ fontSize: '12px' }}>Loading...</p>}
      <table className="admin-table">
        <thead>
          <tr>
            <th className="admin-th-name">Name</th>
            <th className="admin-th-time">Date</th>
            <th className="admin-th-tier">Status</th>
            <th className="admin-th-tier">Actions</th>
          </tr>
        </thead>
        <tbody>
          {events.map(ev => (
            <tr key={ev.eventId}>
              <td className="admin-td-name">{ev.eventName}</td>
              <td className="admin-td-time">{ev.eventDate || ''}</td>
              <td className="admin-td-tier">{ev.status}</td>
              <td className="admin-td-tier">
                <button onClick={() => startEdit(ev)}>Edit</button>
                <button onClick={() => handleStatus(ev.eventId, ev.status === 'open' ? 'closed' : 'open')}>Toggle Open/Close</button>
                <button onClick={() => handleQr(ev)}>Generate/Replace QR & Download</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {qrResult && (
        <div style={{ marginTop: '10px', fontSize: '11px' }}>
          <div>QR generated for {qrResult.eventName || qrResult.eventId}</div>
        </div>
      )}
    </section>
  )
}
