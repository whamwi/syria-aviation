import { NextResponse } from 'next/server'
import { normalizeFlight } from '@/lib/normalize'
import { extractIata } from '@/lib/airlines'

// Returns all flights for a given IATA airline code across both ALP and DAM
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const iata = code.toUpperCase()

  const [alpRes, damRes] = await Promise.all([
    fetch('https://alpairport.gov.sy/api/flights.php', {
      next: { revalidate: 60 },
      headers: { 'User-Agent': 'SyriaAviationPortal/1.0' },
    }),
    fetch('https://damairport.gov.sy/api/flights.php', {
      next: { revalidate: 60 },
      headers: { 'User-Agent': 'SyriaAviationPortal/1.0' },
    }),
  ])

  const [alpData, damData] = await Promise.all([
    alpRes.ok ? alpRes.json() : { flights: [] },
    damRes.ok ? damRes.json() : { flights: [] },
  ])

  const matchesIata = (fn: string) => extractIata(fn).toUpperCase() === iata

  const flights = [
    ...(alpData.flights ?? [])
      .filter((f: { flightNumber: string }) => matchesIata(f.flightNumber))
      .map((f: unknown) => normalizeFlight(f, 'ALP')),
    ...(damData.flights ?? [])
      .filter((f: { flightNumber: string }) => matchesIata(f.flightNumber))
      .map((f: unknown) => normalizeFlight(f, 'DAM')),
  ].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))

  return NextResponse.json({ ok: true, airline: iata, count: flights.length, flights })
}
