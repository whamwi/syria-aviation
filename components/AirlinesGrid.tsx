'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { airlineByIata, extractIata } from '@/lib/airlines'
import type { Flight } from '@/lib/normalize'

interface AirlineEntry {
  iata: string
  name: string
  country: string
  airports: ('ALP' | 'DAM')[]
  flightCount: number
}

export default function AirlinesGrid() {
  const [airlines, setAirlines] = useState<AirlineEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [ar, dr] = await Promise.all([
        fetch('/api/flights/alp').then(r => r.json()),
        fetch('/api/flights/dam').then(r => r.json()),
      ])
      const map = new Map<string, AirlineEntry>()

      const process = (flights: Flight[], airport: 'ALP' | 'DAM') => {
        for (const f of flights) {
          const iata = extractIata(f.flightNumber)
          if (!iata) continue
          if (!map.has(iata)) {
            const info = airlineByIata(iata)
            map.set(iata, {
              iata,
              name: f.airline || info?.name || iata,
              country: info?.country ?? '',
              airports: [],
              flightCount: 0,
            })
          }
          const entry = map.get(iata)!
          if (!entry.airports.includes(airport)) entry.airports.push(airport)
          entry.flightCount++
        }
      }

      process(ar.flights ?? [], 'ALP')
      process(dr.flights ?? [], 'DAM')

      setAirlines(Array.from(map.values()).sort((a, b) => b.flightCount - a.flightCount))
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="flex-1 p-4 max-w-7xl mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--av-ink)' }}>Airlines Serving Syria</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--av-ink2)' }}>
          Click an airline to see all its flights across both Syrian airports
        </p>
      </div>

      {loading ? (
        <div className="text-center py-16" style={{ color: 'var(--av-ink3)' }}>Loading…</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {airlines.map(a => (
            <Link
              key={a.iata}
              href={`/airline/${a.iata}`}
              className="rounded-lg p-4 border hover:border-[var(--av-gold)] transition-all group"
              style={{ background: 'var(--av-panel)', borderColor: 'var(--av-line)' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="font-mono text-sm font-bold"
                  style={{ color: 'var(--av-gold)' }}
                >
                  {a.iata}
                </span>
                <div className="flex gap-1 ml-auto">
                  {a.airports.map(ap => (
                    <span
                      key={ap}
                      className="text-[9px] px-1.5 py-0.5 rounded"
                      style={{
                        background: 'var(--av-raised)',
                        color: 'var(--av-ink3)',
                        fontFamily: 'var(--av-font-mono)',
                      }}
                    >
                      {ap}
                    </span>
                  ))}
                </div>
              </div>
              <p className="text-sm font-medium leading-tight group-hover:text-[var(--av-gold)] transition-colors" style={{ color: 'var(--av-ink)' }}>
                {a.name}
              </p>
              <p className="text-[10px] mt-1" style={{ color: 'var(--av-ink3)' }}>
                {a.country} · {a.flightCount} flights
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
