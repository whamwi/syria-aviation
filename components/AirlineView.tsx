'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { airlineByIata } from '@/lib/airlines'
import { airportCity } from '@/lib/airports'
import type { Flight } from '@/lib/normalize'

export default function AirlineView({ iata }: { iata: string }) {
  const [flights, setFlights] = useState<Flight[]>([])
  const [loading, setLoading] = useState(true)
  const info = airlineByIata(iata)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const r = await fetch(`/api/airline/${iata}`)
      const d = await r.json()
      setFlights(d.flights ?? [])
      setLoading(false)
    }
    load()
  }, [iata])

  const alp = flights.filter(f => f.airport === 'ALP')
  const dam = flights.filter(f => f.airport === 'DAM')

  return (
    <div className="flex-1 p-4 max-w-7xl mx-auto w-full">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-baseline gap-3 mb-1">
            <span className="text-3xl font-bold tracking-wider" style={{ color: 'var(--av-gold)', fontFamily: 'var(--av-font-mono)' }}>
              {iata}
            </span>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--av-ink)' }}>
              {info?.name ?? iata}
            </h1>
          </div>
          {info?.country && (
            <p className="text-sm" style={{ color: 'var(--av-ink2)' }}>{info.country}</p>
          )}
        </div>
        <div className="flex gap-3 text-sm" style={{ color: 'var(--av-ink3)' }}>
          <span className="px-3 py-1 rounded-full border" style={{ borderColor: 'var(--av-line)' }}>
            <span style={{ color: 'var(--av-gold)', fontFamily: 'var(--av-font-mono)' }}>{alp.length}</span> at Aleppo
          </span>
          <span className="px-3 py-1 rounded-full border" style={{ borderColor: 'var(--av-line)' }}>
            <span style={{ color: 'var(--av-gold)', fontFamily: 'var(--av-font-mono)' }}>{dam.length}</span> at Damascus
          </span>
        </div>
      </div>

      {/* Notice */}
      <div className="text-xs mb-4 px-3 py-2 rounded-lg" style={{ background: 'var(--av-gold10)', color: 'var(--av-ink2)', border: '1px solid var(--av-line)' }}>
        Showing all {info?.name ?? iata} flights across both Syrian airports — Aleppo (ALP) and Damascus (DAM)
      </div>

      {/* Table */}
      <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--av-line)' }}>
        <div
          className="grid text-[10px] uppercase tracking-widest px-4 py-2"
          style={{
            background: 'var(--av-raised)', color: 'var(--av-ink3)',
            gridTemplateColumns: '90px 80px 1fr 80px 80px 100px 90px',
          }}
        >
          <span>Flight</span>
          <span>Airport</span>
          <span>Route</span>
          <span>Date</span>
          <span>Time</span>
          <span>Status</span>
          <span>Track</span>
        </div>

        {loading ? (
          <div className="text-center py-16" style={{ color: 'var(--av-ink3)' }}>Loading…</div>
        ) : flights.length === 0 ? (
          <div className="text-center py-16" style={{ color: 'var(--av-ink3)' }}>No flights found for {iata}</div>
        ) : (
          flights.map((f, i) => (
            <div
              key={f.id}
              className="grid px-4 py-3 text-sm hover:bg-[var(--av-raised)] transition-colors"
              style={{
                gridTemplateColumns: '90px 80px 1fr 80px 80px 100px 90px',
                borderTop: i > 0 ? '1px solid var(--av-line)' : 'none',
                color: 'var(--av-ink)',
              }}
            >
              <span className="flight-code">{f.flightNumber}</span>
              <Link
                href={`/airport/${f.airport.toLowerCase()}`}
                className="font-mono text-xs px-2 py-1 rounded self-center hover:text-[var(--av-gold)] transition-colors"
                style={{ background: 'var(--av-raised)', color: 'var(--av-ink2)', width: 'fit-content' }}
              >
                {f.airport}
              </Link>
              <span style={{ color: 'var(--av-ink2)' }}>
                {airportCity(f.origin) || f.origin} → {airportCity(f.destination) || f.destination}
              </span>
              <span style={{ color: 'var(--av-ink2)', fontFamily: 'var(--av-font-mono)', fontSize: 12 }}>{f.date}</span>
              <span style={{ fontFamily: 'var(--av-font-mono)', color: 'var(--av-gold)' }}>{f.time}</span>
              <span>
                <span className={`badge ${f.status === 'on-time' || f.status === 'scheduled' ? 'badge-go' : f.status === 'delayed' ? 'badge-warn' : 'badge-dim'}`}>
                  {f.status}
                </span>
              </span>
              <a
                href={f.trackerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs hover:text-[var(--av-gold)] transition-colors"
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
