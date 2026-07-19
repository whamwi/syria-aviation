'use client'
import { useEffect, useState } from 'react'

interface Stats {
  overSyria: number
  inboundToSyria: number
  dam: number
  alp: number
  airlines: number
  loading: boolean
}

export default function StatsBar() {
  const [stats, setStats] = useState<Stats>({
    overSyria: 0, inboundToSyria: 0, dam: 0, alp: 0, airlines: 0, loading: true,
  })

  async function load() {
    const today = new Date().toISOString().slice(0, 10)
    const [alpRes, damRes] = await Promise.allSettled([
      fetch('/api/flights/alp').then(r => r.json()),
      fetch('/api/flights/dam').then(r => r.json()),
    ])
    const alpFlights = alpRes.status === 'fulfilled' ? (alpRes.value.flights ?? []) : []
    const damFlights = damRes.status === 'fulfilled' ? (damRes.value.flights ?? []) : []
    const alpToday = alpFlights.filter((f: { date: string }) => f.date === today).length
    const damToday = damFlights.filter((f: { date: string }) => f.date === today).length
    const allAirlines = new Set([
      ...alpFlights.map((f: { airline: string }) => f.airline),
      ...damFlights.map((f: { airline: string }) => f.airline),
    ])
    setStats(prev => ({ ...prev, dam: damToday, alp: alpToday, airlines: allAirlines.size, loading: false }))
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 120_000)

    const es = new EventSource('/api/airspace/stream')
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        if (d.ok) {
          setStats(prev => ({
            ...prev,
            loading:        false,
            overSyria:      d.overSyria      ?? prev.overSyria,
            inboundToSyria: d.inboundToSyria ?? prev.inboundToSyria,
          }))
        }
      } catch { /* ignore */ }
    }

    return () => { clearInterval(id); es.close() }
  }, [])

  const v = (n: number) => stats.loading ? '—' : String(n)

  const items = [
    { value: v(stats.inboundToSyria), label: 'Syrian Flights',     sub: 'airborne right now', color: 'var(--av-gold)', pulse: true },
    { value: v(stats.overSyria),      label: 'Over Syria',          sub: 'transiting airspace', color: 'var(--av-gold)', pulse: false },
    { value: v(stats.dam),            label: 'Damascus Flights',    sub: 'scheduled today',    color: '#18A866', pulse: false },
    { value: v(stats.alp),            label: 'Aleppo Flights',      sub: 'scheduled today',    color: '#4A90E2', pulse: false },
    { value: v(stats.airlines),       label: 'Airlines',            sub: 'operating routes',   color: 'var(--av-gold)', pulse: false },
  ]

  return (
    <div
      className="flex items-stretch shrink-0"
      style={{ background: 'var(--av-panel)', borderBottom: '1px solid var(--av-line)' }}
    >
      {items.map((item, i) => (
        <div
          key={i}
          className="flex-1 flex flex-col justify-center px-5 py-3"
          style={{ borderRight: i < items.length - 1 ? '1px solid var(--av-line)' : 'none' }}
        >
          <div className="flex items-center gap-2">
            <span
              className="text-3xl font-bold tabular-nums leading-none"
              style={{ color: item.color, fontFamily: 'var(--av-font-mono)' }}
            >
              {item.value}
            </span>
            {item.pulse && !stats.loading && (
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--av-go)] animate-pulse" />
            )}
          </div>
          <div className="mt-1 text-[13px] font-medium leading-tight" style={{ color: 'var(--av-ink1)' }}>
            {item.label}
          </div>
          <div className="text-[11px] leading-tight" style={{ color: 'var(--av-ink3)' }}>
            {item.sub}
          </div>
        </div>
      ))}
    </div>
  )
}
