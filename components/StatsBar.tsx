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
    const [airRes, alpRes, damRes] = await Promise.allSettled([
      fetch('/api/airspace').then(r => r.json()),
      fetch('/api/flights/alp').then(r => r.json()),
      fetch('/api/flights/dam').then(r => r.json()),
    ])

    const airData    = airRes.status === 'fulfilled' ? airRes.value : null
    const alpFlights = alpRes.status === 'fulfilled' ? (alpRes.value.flights ?? []) : []
    const damFlights = damRes.status === 'fulfilled' ? (damRes.value.flights ?? []) : []

    const alpToday = alpFlights.filter((f: { date: string }) => f.date === today).length
    const damToday = damFlights.filter((f: { date: string }) => f.date === today).length

    const allAirlines = new Set([
      ...alpFlights.map((f: { airline: string }) => f.airline),
      ...damFlights.map((f: { airline: string }) => f.airline),
    ])

    setStats(prev => ({
      // Only update live aircraft counts when the feed is healthy (ok: true).
      // Preserves the last known count during transient ADS-B outages.
      overSyria:      airData?.ok ? (airData.overSyria      ?? prev.overSyria)      : prev.overSyria,
      inboundToSyria: airData?.ok ? (airData.inboundToSyria ?? prev.inboundToSyria) : prev.inboundToSyria,
      dam:            damToday,
      alp:            alpToday,
      airlines:       allAirlines.size,
      loading:        false,
    }))
  }

  useEffect(() => {
    // Schedule data for airports + airlines (slow-changing, 2-min poll is fine)
    load()
    const id = setInterval(load, 120_000)

    // Live aircraft counts come from the SSE stream — same source as the map,
    // so they update every ~5s and never drift out of sync with what's on screen.
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

  const items = [
    { value: stats.inboundToSyria, label: 'Syrian flights',           icon: '✈️', pulse: true },
    { value: stats.overSyria,      label: 'aircraft over Syria',      icon: '✈'  },
    { value: stats.dam,            label: 'at Damascus today',        icon: '🏙' },
    { value: stats.alp,            label: 'at Aleppo today',          icon: '🌆' },
    { value: stats.airlines,       label: 'airlines serving Syria',   icon: '🛫' },
  ]

  return (
    <div
      style={{ background: 'var(--av-panel)', borderBottom: '1px solid var(--av-line)' }}
      className="flex flex-wrap"
    >
      {items.map((item, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-5 py-3"
          style={{ borderRight: i < items.length - 1 ? '1px solid var(--av-line)' : 'none' }}
        >
          <span className="text-base">{item.icon}</span>
          <span
            className="text-2xl font-semibold tabular-nums"
            style={{ color: 'var(--av-gold)', fontFamily: 'var(--av-font-mono)' }}
          >
            {stats.loading ? '—' : item.value}
          </span>
          <span className="text-xs" style={{ color: 'var(--av-ink2)' }}>
            {item.label}
            {item.pulse && !stats.loading && (
              <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-[var(--av-go)] animate-pulse" />
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
