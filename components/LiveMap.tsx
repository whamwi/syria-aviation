'use client'
import { useEffect, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import type { Aircraft, RouteArc } from './LiveMapInner'

const LiveMapInner = dynamic(() => import('./LiveMapInner'), {
  ssr: false,
  loading: () => (
    <div style={{ height: 440, background: '#07101F', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: '#3A5570', fontFamily: 'monospace', fontSize: 12 }}>Loading map…</span>
    </div>
  ),
})

export default function LiveMap() {
  const [aircraft, setAircraft] = useState<Aircraft[]>([])
  const [routes, setRoutes]     = useState<RouteArc[]>([])
  const [apFilter,  setApFilter]  = useState<'all' | 'alp' | 'dam'>('all')
  const [dirFilter, setDirFilter] = useState<'all' | 'arr' | 'dep'>('all')
  const [lastTs, setLastTs]     = useState<number>(0)
  const [secAgo, setSecAgo]     = useState<number | null>(null)

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
          arcs.push({
            from: f.direction === 'arrival' ? other : ap.toUpperCase(),
            to:   f.direction === 'arrival' ? ap.toUpperCase() : other,
            arr:  f.direction === 'arrival',
            ap,
          })
        }
      }
      add(ar.flights ?? [], 'alp')
      add(dr.flights ?? [], 'dam')
      setRoutes(arcs)
    } catch { /* ignore */ }
  }, [])

  // SSE stream — receives aircraft snapshots every ~25 s; auto-reconnects on drop
  useEffect(() => {
    const es = new EventSource('/api/airspace/stream')
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        if (d.ok && Array.isArray(d.aircraft)) {
          setAircraft(d.aircraft.filter((a: Aircraft) => a.lat && a.lon))
          if (d.ts) setLastTs(d.ts)
        }
      } catch { /* ignore parse errors */ }
    }
    return () => es.close()
  }, [])

  useEffect(() => {
    fetchRoutes()
    const routeId = setInterval(fetchRoutes, 120_000)
    return () => clearInterval(routeId)
  }, [fetchRoutes])

  // 1-second ticker for "updated Xs ago"
  useEffect(() => {
    if (!lastTs) return
    setSecAgo(Math.round((Date.now() - lastTs) / 1000))
    const id = setInterval(() => setSecAgo(Math.round((Date.now() - lastTs) / 1000)), 1000)
    return () => clearInterval(id)
  }, [lastTs])

  const fb = (label: string, active: boolean, onClick: () => void, activeClass = '') => (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-mono border transition-all ${active
        ? `border-[var(--av-gold)] text-[var(--av-gold)] bg-[var(--av-gold10)] ${activeClass}`
        : 'border-[var(--av-line)] text-[var(--av-ink3)] hover:border-[var(--av-gold)] hover:text-[var(--av-gold)]'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="flex-1 flex flex-col" style={{ background: 'var(--av-bg)' }}>
      <div style={{ overflow: 'hidden', borderBottom: '1px solid var(--av-line)' }}>
        {/* Live map */}
        <LiveMapInner
          aircraft={aircraft}
          routes={routes}
          apFilter={apFilter}
          dirFilter={dirFilter}
        />

        {/* Filters */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--av-line)', background: 'var(--av-panel)' }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] uppercase tracking-widest w-14 shrink-0" style={{ color: 'var(--av-ink3)' }}>Airport</span>
            {fb('All airports',      apFilter === 'all', () => setApFilter('all'))}
            {fb('Damascus (DAM)',    apFilter === 'dam', () => setApFilter('dam'))}
            {fb('Aleppo (ALP)',      apFilter === 'alp', () => setApFilter('alp'))}
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-2 pt-2" style={{ borderTop: '1px solid var(--av-line)' }}>
            <span className="text-[9px] uppercase tracking-widest w-14 shrink-0" style={{ color: 'var(--av-ink3)' }}>Direction</span>
            {fb('All',          dirFilter === 'all', () => setDirFilter('all'))}
            {fb('↓ Arrivals',   dirFilter === 'arr', () => setDirFilter('arr'),  'border-[var(--av-go)] text-[var(--av-go)] bg-[var(--av-go10)]')}
            {fb('↑ Departures', dirFilter === 'dep', () => setDirFilter('dep'),  'border-[var(--av-ink2)] text-[var(--av-ink2)] bg-[rgba(99,130,160,.10)]')}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center" style={{ borderTop: '1px solid var(--av-line)', background: 'var(--av-panel)' }}>
          {[
            { v: aircraft.filter(a => a.inboundToSyria && a.syriaAirport === 'DAM').length, l: 'DAM flights', color: '#18A866' },
            { v: aircraft.filter(a => a.inboundToSyria && a.syriaAirport === 'ALP').length, l: 'ALP flights', color: '#4A90E2' },
            { v: aircraft.filter(a => a.overSyria && !a.inboundToSyria).length,             l: 'other overflights', color: '#E8B820' },
            { v: routes.filter(r => apFilter === 'all' || r.ap === apFilter).length,        l: 'routes today', color: 'var(--av-gold)' },
          ].map((s, i, arr) => (
            <div key={i} className="flex-1 px-4 py-2" style={{ borderRight: '1px solid var(--av-line)' }}>
              <span className="font-mono text-sm" style={{ color: s.color }}>{s.v}</span>
              <span className="text-[10px] ml-1.5" style={{ color: 'var(--av-ink3)' }}>{s.l}</span>
            </div>
          ))}
          <div className="px-4 py-2 text-[10px] tabular-nums" style={{ color: 'var(--av-ink3)', whiteSpace: 'nowrap' }}>
            {secAgo === null ? '—' : secAgo === 0 ? 'live' : `updated ${secAgo}s ago`}
            <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full align-middle"
              style={{ background: secAgo !== null && secAgo < 10 ? '#18A866' : '#6B7F8E' }} />
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 px-5 py-3 text-[11px]" style={{ color: 'var(--av-ink3)' }}>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#18A866' }}/>
          Damascus flight
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#4A90E2' }}/>
          Aleppo flight
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#E8B820' }}/>
          Non-Syrian overflight
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-px inline-block" style={{ background: '#18A866' }}/>Arrivals
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-px inline-block" style={{ background: '#6382A0' }}/>Departures
        </span>
        <span>Click any dot to track on Flightradar24</span>
        <span className="ml-auto flex gap-3">
          <Link href="/airport/dam" className="hover:text-[var(--av-gold)] transition-colors">→ Damascus board</Link>
          <Link href="/airport/alp" className="hover:text-[var(--av-gold)] transition-colors">→ Aleppo board</Link>
        </span>
      </div>
    </div>
  )
}
