'use client'
import { useEffect, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import type { Aircraft, RouteArc } from './LiveMapInner'
import { airportByIata } from '@/lib/airports'

// Haversine great-circle distance in nautical miles
function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R  = 3440.065  // Earth radius in nautical miles
  const dL = ((lat2 - lat1) * Math.PI) / 180
  const dl = ((lon2 - lon1) * Math.PI) / 180
  const a  = Math.sin(dL / 2) ** 2 +
             Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dl / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

const LiveMapInner = dynamic(() => import('./LiveMapInner'), {
  ssr: false,
  loading: () => (
    <div style={{ height: '100%', background: '#07101F', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: '#3A5570', fontFamily: 'monospace', fontSize: 12 }}>Loading map…</span>
    </div>
  ),
})

const AIRPORT_NAMES: Record<string, string> = {
  DAM: 'Damascus', ALP: 'Aleppo', IST: 'Istanbul', SAW: 'Istanbul (Sabiha)',
  AMM: 'Amman', BEY: 'Beirut', KWI: 'Kuwait City', SHJ: 'Sharjah',
  DXB: 'Dubai', AUH: 'Abu Dhabi', DOH: 'Doha', CAI: 'Cairo',
  BGW: 'Baghdad', EBL: 'Erbil', JED: 'Jeddah', RUH: 'Riyadh',
  AMS: 'Amsterdam', MJI: 'Misrata', TLV: 'Tel Aviv', LCA: 'Larnaca',
  NIC: 'Nicosia', MSQ: 'Aleppo (Neyrab)',
}

function apName(code: string | null) {
  if (!code) return '—'
  return AIRPORT_NAMES[code] ? `${code} · ${AIRPORT_NAMES[code]}` : code
}

function PlanePanel({ a, onClose }: { a: Aircraft; onClose: () => void }) {
  const color = a.inboundToSyria
    ? (a.syriaAirport === 'DAM' ? '#18A866' : '#4A90E2')
    : (a.overSyria ? '#E8B820' : '#6B7F8E')

  const from = a.isArrival ? a.otherAirport : a.syriaAirport
  const to   = a.isArrival ? a.syriaAirport : a.otherAirport

  // Flight progress — computed from airport coordinates + current ADS-B position
  let flown = 0, remaining = 0, progress = 0, etaMins: number | null = null
  const fromAp = from ? airportByIata(from) : null
  const toAp   = to   ? airportByIata(to)   : null
  if (fromAp && toAp && a.lat && a.lon) {
    flown     = haversineNm(fromAp.lat, fromAp.lon, a.lat, a.lon)
    remaining = haversineNm(a.lat, a.lon, toAp.lat, toAp.lon)
    const total = flown + remaining
    progress  = total > 0 ? flown / total : 0
    if (a.speedKts && a.speedKts > 50) {
      etaMins = (remaining / a.speedKts) * 60
    }
  }
  const hasProgress = flown > 0 || remaining > 0

  return (
    <div
      style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 1000,
        background: 'var(--av-panel)', borderTop: `2px solid ${color}`,
        boxShadow: '0 -4px 24px rgba(0,0,0,.5)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2"
        style={{ borderBottom: '1px solid var(--av-line)' }}>
        <div className="flex items-center gap-2">
          <span className="text-base font-bold" style={{ color, fontFamily: 'var(--av-font-mono)' }}>
            {a.callsign || '—'}
          </span>
          {a.aircraftType && (
            <span className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: 'var(--av-line)', color: 'var(--av-ink2)', fontFamily: 'var(--av-font-mono)' }}>
              {a.aircraftType}
            </span>
          )}
          {a.inboundToSyria && (
            <span className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: color + '22', color }}>
              {a.isArrival ? 'Arriving' : 'Departing'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {a.trackerUrl && (
            <a href={a.trackerUrl} target="_blank" rel="noopener"
              className="text-[10px] hover:underline"
              style={{ color: 'var(--av-ink3)' }}>
              FR24 ↗
            </a>
          )}
          <button onClick={onClose} style={{ color: 'var(--av-ink3)', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
      </div>

      <div className="px-4 py-3 flex gap-6 flex-wrap">
        {/* Route */}
        {(from || to) && (
          <div className="flex items-center gap-3 min-w-0 shrink-0">
            <div className="text-center">
              <div className="text-lg font-bold" style={{ color: 'var(--av-ink1)', fontFamily: 'var(--av-font-mono)' }}>{from ?? '—'}</div>
              <div className="text-[10px]" style={{ color: 'var(--av-ink3)' }}>{AIRPORT_NAMES[from ?? ''] ?? fromAp?.city ?? ''}</div>
            </div>
            <svg width="32" height="16" style={{ flexShrink: 0 }}>
              <path fill={color} d="M8,2 C7.5,2 7,3.5 7,5 L7,7.5 L0,10.5 L0,12.5 L7,11 L7,14 L5,15 L5,16 L8,15.5 L11,16 L11,15 L9,14 L9,11 L16,12.5 L16,10.5 L9,7.5 L9,5 C9,3.5 8.5,2 8,2 Z" transform="rotate(90,8,9)"/>
            </svg>
            <div className="text-center">
              <div className="text-lg font-bold" style={{ color: 'var(--av-ink1)', fontFamily: 'var(--av-font-mono)' }}>{to ?? '—'}</div>
              <div className="text-[10px]" style={{ color: 'var(--av-ink3)' }}>{AIRPORT_NAMES[to ?? ''] ?? toAp?.city ?? ''}</div>
            </div>
          </div>
        )}

        {/* Divider */}
        {(from || to) && <div className="hidden sm:block" style={{ borderLeft: '1px solid var(--av-line)' }} />}

        {/* Flight data */}
        <div className="flex flex-col gap-1.5 text-[11px] min-w-0">
          {a.airline && (
            <div style={{ color: 'var(--av-ink1)' }}>{a.airline}</div>
          )}
          <div style={{ color: 'var(--av-ink2)', fontFamily: 'var(--av-font-mono)' }}>
            {[
              a.altFt    != null ? `${a.altFt.toLocaleString()} ft`                        : null,
              a.speedKts != null ? `${Math.round(a.speedKts)} kts`                         : null,
              a.heading  != null ? `${Math.round(a.heading).toString().padStart(3,'0')}°`  : null,
            ].filter(Boolean).join('  ·  ')}
          </div>
          {a.country && (
            <div style={{ color: 'var(--av-ink3)' }}>Reg: {a.country}</div>
          )}
        </div>
      </div>

      {/* Flight progress bar */}
      {hasProgress && (
        <div className="px-4 pb-3">
          {/* Bar */}
          <div className="relative h-1.5 rounded-full overflow-hidden mb-2"
            style={{ background: 'var(--av-line)' }}>
            <div className="absolute inset-y-0 left-0 rounded-full transition-all"
              style={{ width: `${(progress * 100).toFixed(1)}%`, background: color }} />
            {/* Plane marker */}
            <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
              style={{ left: `${(progress * 100).toFixed(1)}%` }}>
              <svg viewBox="0 0 32 32" width="10" height="10" style={{ transform: 'rotate(90deg)' }}>
                <path fill={color} d="M16,2 C14.5,2 14,4.5 14,8 L14,13 L2,19 L2,22 L14,19.5 L14,26 L10,28 L10,30.5 L16,29 L22,30.5 L22,28 L18,26 L18,19.5 L30,22 L30,19 L18,13 L18,8 C18,4.5 17.5,2 16,2 Z"/>
              </svg>
            </div>
          </div>
          {/* Labels */}
          <div className="flex justify-between text-[10px] tabular-nums" style={{ color: 'var(--av-ink3)' }}>
            <span>{Math.round(flown).toLocaleString()} nm flown</span>
            {etaMins !== null && (
              <span style={{ color }}>
                {etaMins < 60
                  ? `arriving in ${Math.round(etaMins)}m`
                  : `arriving in ${fmtDuration(etaMins)}`}
              </span>
            )}
            <span>{Math.round(remaining).toLocaleString()} nm to go</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function LiveMap() {
  const [aircraft, setAircraft]     = useState<Aircraft[]>([])
  const [routes, setRoutes]         = useState<RouteArc[]>([])
  const [apFilter,  setApFilter]    = useState<'all' | 'alp' | 'dam'>('all')
  const [dirFilter, setDirFilter]   = useState<'all' | 'arr' | 'dep'>('all')
  const [lastTs, setLastTs]         = useState<number>(0)
  const [secAgo, setSecAgo]         = useState<number | null>(null)
  const [selected, setSelected]     = useState<Aircraft | null>(null)
  const [mapReady, setMapReady]     = useState<boolean>(false)

  const fetchRoutes = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10)
    const CITIES_SET = new Set(['IST','SAW','AMM','BEY','KWI','SHJ','DXB','AUH','DOH','CAI','BGW','EBL','JED','RUH','AMS','MJI','TLV','MSQ'])
    try {
      const [ar, dr] = await Promise.all([
        fetch('/api/flights/alp').then(r => r.json()),
        fetch('/api/flights/dam').then(r => r.json()),
      ])
      const seen = new Set<string>()
      const arcs: RouteArc[] = []
      const add = (flights: Array<{ origin: string; destination: string; direction: string; date: string }>, ap: 'alp' | 'dam') => {
        for (const f of flights) {
          if (f.date !== today) continue
          const other = f.direction === 'arrival' ? f.origin : f.destination
          if (!CITIES_SET.has(other) && other !== 'ALP' && other !== 'DAM') continue
          const key = `${ap}-${other}-${f.direction}`
          if (seen.has(key)) continue
          seen.add(key)
          arcs.push({ from: f.direction === 'arrival' ? other : ap.toUpperCase(), to: f.direction === 'arrival' ? ap.toUpperCase() : other, arr: f.direction === 'arrival', ap })
        }
      }
      add(ar.flights ?? [], 'alp')
      add(dr.flights ?? [], 'dam')
      setRoutes(arcs)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    setMapReady(false)
    const es = new EventSource('/api/airspace/stream')
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        if (d.ok && Array.isArray(d.aircraft)) {
          setAircraft(d.aircraft.filter((a: Aircraft) => a.lat && a.lon))
          if (d.ts) setLastTs(d.ts)
          setMapReady(true)
        }
      } catch { /* ignore */ }
    }
    return () => es.close()
  }, [])

  useEffect(() => {
    fetchRoutes()
    const id = setInterval(fetchRoutes, 120_000)
    return () => clearInterval(id)
  }, [fetchRoutes])

  useEffect(() => {
    if (!lastTs) return
    setSecAgo(Math.round((Date.now() - lastTs) / 1000))
    const id = setInterval(() => setSecAgo(Math.round((Date.now() - lastTs) / 1000)), 1000)
    return () => clearInterval(id)
  }, [lastTs])

  // Keep selected aircraft in sync with live positions
  useEffect(() => {
    if (!selected) return
    const live = aircraft.find(a => a.icao24 === selected.icao24)
    if (live) setSelected(live)
  }, [aircraft, selected])

  const fb = (label: string, active: boolean, onClick: () => void, activeClass = '') => (
    <button onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-mono border transition-all ${active
        ? `border-[var(--av-gold)] text-[var(--av-gold)] bg-[var(--av-gold10)] ${activeClass}`
        : 'border-[var(--av-line)] text-[var(--av-ink3)] hover:border-[var(--av-gold)] hover:text-[var(--av-gold)]'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ background: 'var(--av-bg)' }}>

      {/* Map + controls — fills remaining space */}
      <div className="flex-1 flex flex-col min-h-0" style={{ borderBottom: '1px solid var(--av-line)', position: 'relative' }}>

        {/* Map — flex-1 fills the space */}
        <div className="flex-1 min-h-0" style={{ position: 'relative' }}>
          <LiveMapInner
            aircraft={aircraft}
            routes={routes}
            apFilter={apFilter}
            dirFilter={dirFilter}
            onSelect={setSelected}
          />
          {!mapReady && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 900,
              background: 'rgba(7,16,31,0.75)', backdropFilter: 'blur(2px)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
            }}>
              <svg width="36" height="36" viewBox="0 0 36 36" style={{ animation: 'spin 1s linear infinite' }}>
                <circle cx="18" cy="18" r="15" fill="none" stroke="#1a2e45" strokeWidth="3"/>
                <path d="M18 3 A15 15 0 0 1 33 18" fill="none" stroke="var(--av-gold)" strokeWidth="3" strokeLinecap="round"/>
              </svg>
              <span style={{ color: 'var(--av-ink3)', fontSize: 12, fontFamily: 'var(--av-font-mono)' }}>
                Connecting to live feed…
              </span>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}
          {selected && <PlanePanel a={selected} onClose={() => setSelected(null)} />}
        </div>

        {/* Legend — above filters */}
        <div className="flex items-center flex-wrap gap-x-5 gap-y-2 px-4 py-3 shrink-0 text-[12px]"
          style={{ borderTop: '1px solid var(--av-line)', background: 'var(--av-panel)', color: 'var(--av-ink2)' }}>
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: '#18A866' }}/>Damascus airport
          </span>
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: '#4A90E2' }}/>Aleppo airport
          </span>
          <span className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#E8B820' }}/>Overflight
          </span>
          <span style={{ borderLeft: '1px solid var(--av-line)', height: 14, alignSelf: 'center' }} />
          <span className="flex items-center gap-2">
            <svg viewBox="0 0 32 32" width="14" height="14" style={{ display: 'inline-block', transform: 'rotate(90deg)', flexShrink: 0 }}>
              <path fill="#18A866" d="M16,2 C14.5,2 14,4.5 14,8 L14,13 L2,19 L2,22 L14,19.5 L14,26 L10,28 L10,30.5 L16,29 L22,30.5 L22,28 L18,26 L18,19.5 L30,22 L30,19 L18,13 L18,8 C18,4.5 17.5,2 16,2 Z"/>
            </svg>
            DAM destination
          </span>
          <span className="flex items-center gap-2">
            <svg viewBox="0 0 32 32" width="14" height="14" style={{ display: 'inline-block', transform: 'rotate(90deg)', flexShrink: 0 }}>
              <path fill="#4A90E2" d="M16,2 C14.5,2 14,4.5 14,8 L14,13 L2,19 L2,22 L14,19.5 L14,26 L10,28 L10,30.5 L16,29 L22,30.5 L22,28 L18,26 L18,19.5 L30,22 L30,19 L18,13 L18,8 C18,4.5 17.5,2 16,2 Z"/>
            </svg>
            ALP destination
          </span>
          <span style={{ borderLeft: '1px solid var(--av-line)', height: 14, alignSelf: 'center' }} />
          <span className="flex items-center gap-2">
            <svg width="24" height="4" style={{ flexShrink: 0 }}><line x1="0" y1="2" x2="24" y2="2" stroke="#18A866" strokeWidth="1.5"/></svg>
            Covered
          </span>
          <span className="flex items-center gap-2">
            <svg width="24" height="4" style={{ flexShrink: 0 }}><line x1="0" y1="2" x2="24" y2="2" stroke="#18A866" strokeWidth="1.5" strokeDasharray="5 4"/></svg>
            Remaining
          </span>
          <span className="ml-auto flex gap-4 text-[11px]" style={{ color: 'var(--av-ink3)' }}>
            <Link href="/airport/dam" className="hover:text-[var(--av-gold)] transition-colors">→ DAM board</Link>
            <Link href="/airport/alp" className="hover:text-[var(--av-gold)] transition-colors">→ ALP board</Link>
          </span>
        </div>

        {/* Filters */}
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--av-line)', background: 'var(--av-panel)', flexShrink: 0 }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] uppercase tracking-widest w-14 shrink-0" style={{ color: 'var(--av-ink3)' }}>Airport</span>
            {fb('All airports',   apFilter === 'all', () => setApFilter('all'))}
            {fb('Damascus (DAM)', apFilter === 'dam', () => setApFilter('dam'))}
            {fb('Aleppo (ALP)',   apFilter === 'alp', () => setApFilter('alp'))}
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-1.5 pt-1.5" style={{ borderTop: '1px solid var(--av-line)' }}>
            <span className="text-[9px] uppercase tracking-widest w-14 shrink-0" style={{ color: 'var(--av-ink3)' }}>Direction</span>
            {fb('All',          dirFilter === 'all', () => setDirFilter('all'))}
            {fb('↓ Arrivals',   dirFilter === 'arr', () => setDirFilter('arr'),  'border-[var(--av-go)] text-[var(--av-go)] bg-[var(--av-go10)]')}
            {fb('↑ Departures', dirFilter === 'dep', () => setDirFilter('dep'),  'border-[var(--av-ink2)] text-[var(--av-ink2)] bg-[rgba(99,130,160,.10)]')}
          </div>
        </div>

        {/* Map stats row */}
        <div className="flex items-center" style={{ borderTop: '1px solid var(--av-line)', background: 'var(--av-panel)', flexShrink: 0 }}>
          {[
            { v: aircraft.filter(a => a.inboundToSyria && a.syriaAirport === 'DAM').length, l: 'DAM flights',      color: '#18A866' },
            { v: aircraft.filter(a => a.inboundToSyria && a.syriaAirport === 'ALP').length, l: 'ALP flights',      color: '#4A90E2' },
            { v: aircraft.filter(a => a.overSyria && !a.inboundToSyria).length,             l: 'overflights',      color: '#E8B820' },
            { v: routes.filter(r => apFilter === 'all' || r.ap === apFilter).length,        l: 'routes today',     color: 'var(--av-gold)' },
          ].map((s, i, arr) => (
            <div key={i} className="flex-1 px-3 py-1.5" style={{ borderRight: '1px solid var(--av-line)' }}>
              <span className="font-mono text-sm" style={{ color: s.color }}>{s.v}</span>
              <span className="text-[10px] ml-1.5" style={{ color: 'var(--av-ink3)' }}>{s.l}</span>
            </div>
          ))}
          <div className="px-3 py-1.5 text-[10px] tabular-nums" style={{ color: 'var(--av-ink3)', whiteSpace: 'nowrap' }}>
            {secAgo === null ? '—' : secAgo === 0 ? 'live' : `${secAgo}s ago`}
            <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full align-middle"
              style={{ background: secAgo !== null && secAgo < 10 ? '#18A866' : '#6B7F8E' }} />
          </div>
        </div>
      </div>

    </div>
  )
}
