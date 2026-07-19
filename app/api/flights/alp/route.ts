import { NextResponse } from 'next/server'
import { normalizeFlight } from '@/lib/normalize'
import { getStatusOverrides, applyStatusOverride } from '@/lib/flightStatus'

export const revalidate = 60

export async function GET() {
  try {
    const syriaNow = new Date(Date.now() + 3 * 60 * 60 * 1000)
    const today    = syriaNow.toISOString().slice(0, 10)
    const nowMin   = syriaNow.getUTCHours() * 60 + syriaNow.getUTCMinutes()

    const [res, overrides] = await Promise.all([
      fetch('https://alpairport.gov.sy/api/flights.php', {
        next: { revalidate: 60 },
        headers: { 'User-Agent': 'SyriaAviationPortal/1.0' },
      }),
      getStatusOverrides(today),
    ])
    if (!res.ok) throw new Error(`ALP API ${res.status}`)
    const data = await res.json()
    const flights = (data.flights ?? []).map((f: unknown) => {
      const flight = normalizeFlight(f, 'ALP')
      const override = overrides.get(flight.flightNumber) ?? overrides.get(flight.flightNumber.replace(/\s+/g, ''))
      if (override) flight.status = applyStatusOverride(flight.status, override)

      // Time-based landing: arrival detected airborne (departed) but scheduled time
      // has passed by ≥30 min — airport API won't update, so we infer it landed.
      if (flight.direction === 'arrival' && flight.status === 'departed' && flight.date === today) {
        const [hh, mm] = flight.time.split(':').map(Number)
        if (nowMin - (hh * 60 + mm) >= 30) flight.status = 'landed'
      }

      return flight
    })
    return NextResponse.json({ ok: true, airport: 'ALP', flights })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err), flights: [] }, { status: 502 })
  }
}
