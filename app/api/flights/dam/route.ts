import { NextResponse } from 'next/server'
import { normalizeFlight } from '@/lib/normalize'

export const revalidate = 60

export async function GET() {
  try {
    const res = await fetch('https://damairport.gov.sy/api/flights.php', {
      next: { revalidate: 60 },
      headers: { 'User-Agent': 'SyriaAviationPortal/1.0' },
    })
    if (!res.ok) throw new Error(`DAM API ${res.status}`)
    const data = await res.json()
    const flights = (data.flights ?? []).map((f: unknown) => normalizeFlight(f, 'DAM'))
    return NextResponse.json({ ok: true, airport: 'DAM', flights })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err), flights: [] }, { status: 502 })
  }
}
