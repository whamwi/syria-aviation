'use client'
import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { airportCity } from '@/lib/airports'
import type { Flight } from '@/lib/normalize'

const AIRPORT_NAMES: Record<string, { en: string; ar: string }> = {
  ALP: { en: 'Aleppo International Airport', ar: 'مطار حلب الدولي' },
  DAM: { en: 'Damascus International Airport', ar: 'مطار دمشق الدولي' },
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    'on-time':   'badge badge-go',
    'scheduled': 'badge badge-dim',
    'delayed':   'badge badge-warn',
    'cancelled': 'badge badge-err',
    'landed':    'badge badge-go',
    'departed':  'badge badge-go',
    'boarding':  'badge badge-go',
  }
  const labels: Record<string, string> = {
    'on-time': 'On Time', 'scheduled': 'Scheduled', 'delayed': 'Delayed',
    'cancelled': 'Cancelled', 'landed': 'Landed', 'departed': 'Departed', 'boarding': 'Boarding',
  }
  return <span className={map[status] ?? 'badge badge-dim'}>{labels[status] ?? status}</span>
}

// The DAM/ALP APIs only return "scheduled" or "delayed" — they never update to landed/departed.
// Derive a more accurate status client-side using Syria local time (UTC+3).
function deriveStatus(f: Flight): string {
  if (f.status === 'delayed' || f.status === 'cancelled') return f.status

  // Current time in Syria (UTC+3)
  const nowSyria = new Date(Date.now() + 3 * 60 * 60 * 1000)
  const syriaTodayStr = nowSyria.toISOString().slice(0, 10)
  if (f.date !== syriaTodayStr) return f.status

  const [hh, mm] = f.time.split(':').map(Number)
  if (isNaN(hh) || isNaN(mm)) return f.status

  const scheduled = hh * 60 + mm
  const current   = nowSyria.getUTCHours() * 60 + nowSyria.getUTCMinutes()
  // Handle midnight crossings (e.g. scheduled 23:30, now 00:15)
  const diff = current - scheduled < -720 ? current - scheduled + 1440 : current - scheduled

  if (diff >= 45) return f.direction === 'arrival' ? 'landed'   : 'departed'
  if (diff >= 0)  return f.direction === 'arrival' ? 'on-time'  : 'departed'
  if (diff >= -30 && f.direction === 'departure') return 'boarding'
  return f.status
}

export default function FlightBoard({ airport }: { airport: 'ALP' | 'DAM' }) {
  const [flights, setFlights] = useState<Flight[]>([])
  const [loading, setLoading] = useState(true)
  const [dir, setDir] = useState<'all' | 'arrival' | 'departure'>('all')
  const [dateFilter, setDateFilter] = useState<string>('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const code = airport.toLowerCase()
      const r = await fetch(`/api/flights/${code}`)
      const d = await r.json()
      setFlights(d.flights ?? [])
      setLoading(false)
    }
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [airport])

  const dates = useMemo(() => {
    const s = new Set(flights.map(f => f.date))
    return Array.from(s).sort()
  }, [flights])

  // Auto-select date on the client after data loads.
  // Use local date components (not toISOString which is UTC) so Syria UTC+3 users
  // get the correct local date after midnight.
  useEffect(() => {
    if (dates.length === 0) return
    const d = new Date()
    const localToday = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    if (!dateFilter || !dates.includes(dateFilter)) {
      setDateFilter(dates.includes(localToday) ? localToday : dates[dates.length - 1])
    }
  }, [dates]) // intentionally omit dateFilter — only re-run when data changes

  const filtered = useMemo(() => {
    return flights.filter(f => {
      if (dir !== 'all' && f.direction !== dir) return false
      if (f.date !== dateFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!f.flightNumber.toLowerCase().includes(q) &&
            !f.airline.toLowerCase().includes(q) &&
            !f.origin.toLowerCase().includes(q) &&
            !f.destination.toLowerCase().includes(q)) return false
      }
      return true
    }).sort((a, b) => a.time.localeCompare(b.time))
  }, [flights, dir, dateFilter, search])

  const info = AIRPORT_NAMES[airport]

  return (
    <div className="flex-1 p-4 max-w-7xl mx-auto w-full">
      {/* Header */}
      <div className="mb-5">
        <div className="flex items-baseline gap-3 mb-1">
          <span className="text-3xl font-bold tracking-wider" style={{ color: 'var(--av-gold)', fontFamily: 'var(--av-font-mono)' }}>
            {airport}
          </span>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--av-ink)' }}>{info.en}</h1>
        </div>
        <p className="font-ar text-sm" style={{ color: 'var(--av-ink2)' }}>{info.ar}</p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        {/* Direction tabs */}
        <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--av-line)' }}>
          {(['all', 'arrival', 'departure'] as const).map(d => (
            <button
              key={d}
              onClick={() => setDir(d)}
              className="px-4 py-1.5 text-sm font-medium transition-colors"
              style={{
                background: dir === d ? 'var(--av-raised)' : 'var(--av-panel)',
                color: dir === d ? 'var(--av-gold)' : 'var(--av-ink2)',
                borderRight: d !== 'departure' ? '1px solid var(--av-line)' : 'none',
              }}
            >
              {d === 'all' ? 'All' : d === 'arrival' ? '↓ Arrivals' : '↑ Departures'}
            </button>
          ))}
        </div>

        {/* Date selector */}
        <select
          value={dateFilter}
          onChange={e => setDateFilter(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border"
          style={{
            background: 'var(--av-panel)', color: 'var(--av-ink)',
            borderColor: 'var(--av-line)', outline: 'none',
          }}
        >
          {dates.map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        {/* Search */}
        <input
          type="text"
          placeholder="Search flight, airline, city…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border flex-1 min-w-40"
          style={{
            background: 'var(--av-panel)', color: 'var(--av-ink)',
            borderColor: 'var(--av-line)', outline: 'none',
          }}
        />

        <span className="text-xs ml-auto" style={{ color: 'var(--av-ink3)' }}>
          {loading ? 'Loading…' : `${filtered.length} flights`}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--av-line)' }}>
        <div
          className="grid text-[10px] uppercase tracking-widest px-4 py-2"
          style={{
            background: 'var(--av-raised)', color: 'var(--av-ink3)',
            gridTemplateColumns: '90px 1fr 1fr 80px 80px 110px 90px',
          }}
        >
          <span>Flight</span>
          <span>Airline</span>
          <span>Route</span>
          <span>Date</span>
          <span>Time</span>
          <span>Status</span>
          <span>Track</span>
        </div>

        {loading ? (
          <div className="text-center py-16" style={{ color: 'var(--av-ink3)' }}>Loading flights…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16" style={{ color: 'var(--av-ink3)' }}>No flights found</div>
        ) : (
          filtered.map((f, i) => (
            <div
              key={f.id}
              className="grid px-4 py-3 text-sm hover:bg-[var(--av-raised)] transition-colors"
              style={{
                gridTemplateColumns: '90px 1fr 1fr 80px 80px 110px 90px',
                borderTop: i > 0 ? '1px solid var(--av-line)' : 'none',
                color: 'var(--av-ink)',
              }}
            >
              <span className="flight-code">{f.flightNumber}</span>
              <Link
                href={`/airline/${f.flightNumber.match(/^([A-Z]{1,3}|[A-Z]\d|\d[A-Z])/)?.[0] ?? ''}`}
                className="hover:text-[var(--av-gold)] transition-colors"
              >
                {f.airline}
              </Link>
              <span style={{ color: 'var(--av-ink2)' }}>
                {airportCity(f.origin) || f.origin} → {airportCity(f.destination) || f.destination}
              </span>
              <span style={{ color: 'var(--av-ink2)', fontFamily: 'var(--av-font-mono)', fontSize: 12 }}>{f.date}</span>
              <span style={{ fontFamily: 'var(--av-font-mono)', color: 'var(--av-gold)' }}>{f.time}</span>
              <span>{statusBadge(deriveStatus(f))}</span>
              <a
                href={f.trackerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs hover:text-[var(--av-gold)] transition-colors"
                style={{ color: 'var(--av-ink3)' }}
              >
                ↗ Track
              </a>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
