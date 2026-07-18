import { NextResponse } from 'next/server'
import { normalizeFlight } from '@/lib/normalize'

export const revalidate = 60 // cache 60s

export async function GET() {
  try {
    const res = await fetch('https://alpairport.gov.sy/api/flights.php', {
      next: { revalidate: 60 },
      headers: { 'User-Agent': 'SyriaAviationPortal/1.0' },
    })
    if (!res.ok) throw new Error(`ALP API ${res.status}`)
    const data = await res.json()
    const flights = (data.flights ?? []).map((f: unknown) => normalizeFlight(f, 'ALP'))
    return NextResponse.json({ ok: true, airport: 'ALP', flights })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err), flights: [] }, { status: 502 })
  }
}
