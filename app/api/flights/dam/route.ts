import { NextResponse } from 'next/server'
import { normalizeFlight } from '@/lib/normalize'
import { getStatusOverrides, applyStatusOverride } from '@/lib/flightStatus'

export const revalidate = 60

export async function GET() {
  try {
    const today = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
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
      return flight
    })
    return NextResponse.json({ ok: true, airport: 'DAM', flights })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err), flights: [] }, { status: 502 })
  }
}
