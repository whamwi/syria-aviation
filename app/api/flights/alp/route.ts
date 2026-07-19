import { NextResponse } from 'next/server'
import { normalizeFlight } from '@/lib/normalize'
import { getStatusOverrides, applyStatusOverride } from '@/lib/flightStatus'

export const revalidate = 60

function depCloseMin(dest: string): number {
  switch (dest) {
    case 'BEY': case 'AMM': return 90
    case 'CAI': case 'TLV': return 120
    case 'IST': case 'SAW': return 180
    case 'AUH': case 'DXB': case 'SHJ': return 240
    case 'KWI': case 'DOH': case 'BAH': return 240
    case 'RUH': case 'JED': return 270
    default:    return 240
  }
}

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

      // Time-based status inference — airport API always returns 'scheduled', never self-updates,
      // and its date field is stale/wrong so we only compare HH:MM against Syria clock.
      if (flight.status === 'departed') {
        const [hh, mm] = flight.time.split(':').map(Number)
        const minPast = nowMin - (hh * 60 + mm)
        // Arrival ≥30 min past scheduled → infer landed
        if (flight.direction === 'arrival' && minPast >= 30) flight.status = 'landed'
        // Departure past estimated flight time + 30 min buffer → landed at destination
        if (flight.direction === 'departure' && minPast >= depCloseMin(flight.destination)) flight.status = 'landed'
      }

      return flight
    })
    return NextResponse.json({ ok: true, airport: 'ALP', flights })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err), flights: [] }, { status: 502 })
  }
}
