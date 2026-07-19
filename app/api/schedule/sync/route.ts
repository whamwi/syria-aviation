// GET /api/schedule/sync  (Vercel Cron calls this daily at 00:00 UTC = 03:00 Syria)
// Fetches the full schedule from both airport APIs, upserts into Supabase,
// then prunes flights older than yesterday.

import { NextResponse } from 'next/server'
import { supabase }     from '@/lib/supabase'
import { normalizeFlight } from '@/lib/normalize'
import { extractIata, airlineByIata } from '@/lib/airlines'

const ICAO_OVERRIDES: Record<string, string> = {
  CHC: 'FYC',  // Fly Cham: airlines.json has CHC; adsb.lol uses FYC
  LND: 'TKJ',  // Ajet (VF): airlines.json has LND; adsb.lol broadcasts TKJ
  ACK: 'ABY',  // Air Arabia Abu Dhabi (3L): airlines.json has ACK; adsb.lol broadcasts ABY
  EDW: 'FAD',  // Flyadeal (F3): airlines.json maps F3→EDW (Edelweiss); adsb.lol broadcasts FAD
}

function toIcaoCallsign(flightNumber: string): string | null {
  const iata = extractIata(flightNumber)
  if (!iata) return null
  const airline = airlineByIata(iata)
  if (!airline?.icao || airline.icao === 'N/A') return null
  const icao   = ICAO_OVERRIDES[airline.icao] ?? airline.icao
  const suffix = flightNumber.slice(iata.length).replace(/\s+/g, '')
  return suffix ? (icao + suffix).toUpperCase() : null
}

async function fetchAirport(url: string, airport: 'ALP' | 'DAM') {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SyriaAviationPortal/1.0' },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`${airport} API ${res.status}`)
  const json = await res.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (json.flights ?? []).map((r: any) => normalizeFlight(r, airport))
}

export async function GET() {
  try {
    const [alpFlights, damFlights] = await Promise.all([
      fetchAirport('https://alpairport.gov.sy/api/flights.php', 'ALP'),
      fetchAirport('https://damairport.gov.sy/api/flights.php', 'DAM'),
    ])

    const rows = [...alpFlights, ...damFlights].map(f => ({
      id:             f.id,
      airport:        f.airport,
      flight_number:  f.flightNumber,
      icao_callsign:  toIcaoCallsign(f.flightNumber),
      airline:        f.airline,
      direction:      f.direction,
      origin:         f.origin || null,
      destination:    f.destination || null,
      scheduled_date: f.date || null,
      scheduled_time: f.time ? f.time + ':00' : null,
      status:         f.status,
      gate:           f.gate || null,
      fetched_at:     new Date().toISOString(),
    })).filter(r => r.scheduled_date && r.scheduled_time)

    // Upsert all rows from the airport APIs
    const { error: upsertErr } = await supabase
      .from('flights')
      .upsert(rows, { onConflict: 'id' })
    if (upsertErr) throw upsertErr

    // Prune flights older than yesterday (keep rolling window going forward)
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const cutoff = yesterday.toISOString().slice(0, 10)

    const { count: pruned } = await supabase
      .from('flights')
      .delete({ count: 'exact' })
      .lt('scheduled_date', cutoff)

    return NextResponse.json({
      ok:       true,
      upserted: rows.length,
      pruned:   pruned ?? 0,
      dateRange: {
        min: rows.reduce((m, r) => r.scheduled_date < m ? r.scheduled_date : m, '9999'),
        max: rows.reduce((m, r) => r.scheduled_date > m ? r.scheduled_date : m, '0000'),
      },
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 })
  }
}

export const POST = GET
