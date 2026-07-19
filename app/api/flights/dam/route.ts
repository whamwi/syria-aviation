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
      fetch('https://damairport.gov.sy/api/flights.php', {
        next: { revalidate: 60 },
        headers: { 'User-Agent': 'SyriaAviationPortal/1.0' },
      }),
      getStatusOverrides(today),
    ])
    if (!res.ok) throw new Error(`DAM API ${res.status}`)
    const data = await res.json()
    const flights = (data.flights ?? []).map((f: unknown) => {
      const flight = normalizeFlight(f, 'DAM')
      const override = overrides.get(flight.flightNumber) ?? overrides.get(flight.flightNumber.replace(/\s+/g, ''))
      if (override) flight.status = applyStatusOverride(flight.status, override)

      // Time-based status inference — airport API always returns 'scheduled', never self-updates,
      // and its date field is stale/wrong so we only compare HH:MM against Syria clock.
      if (flight.status === 'departed') {
        const [hh, mm] = flight.time.split(':').map(Number)
        const minPast = nowMin - (hh * 60 + mm)
        // Arrival ≥30 min past scheduled → infer landed
        if (flight.direction === 'arrival' && minPast >= 30) flight.status = 'landed'
        // Departure ≥3h past scheduled → infer landed at destination (flight is done)
        if (flight.direction === 'departure' && minPast >= 180) flight.status = 'landed'
      }

      return flight
    })
    return NextResponse.json({ ok: true, airport: 'DAM', flights })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err), flights: [] }, { status: 502 })
  }
}
