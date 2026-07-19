// Queries Supabase for flights to/from Syria that are likely airborne right now.
// Arrivals: scheduled within next 4h. Departures: departed within last 4h.
// Falls back to empty sets if DB is unavailable.

import { supabase } from '@/lib/supabase'

const TTL = 2 * 60_000  // re-query every 2 min (window shifts as time passes)

// IATA 2-letter → ICAO 3-letter prefix for Syrian carriers.
// adsb.lol only recognises ICAO codes; DB stores IATA codes in flight_number.
const IATA_PREFIX_TO_ICAO: Record<string, string> = {
  XH: 'FYC',  // Fly Cham
  RB: 'SYR',  // Syrian Arab Airlines
  VF: 'TKJ',  // Ajet (airlines.json maps VF→LND; adsb.lol broadcasts TKJ)
  '3L': 'ABY', // Air Arabia Abu Dhabi (airlines.json maps 3L→ACK; adsb.lol broadcasts ABY)
  F3: 'FAD',  // Flyadeal (airlines.json maps F3→EDW Edelweiss; adsb.lol broadcasts FAD)
}

function toIcaoCallsign(flightNumber: string): string {
  const prefix = flightNumber.slice(0, 2)
  const icaoPrefix = IATA_PREFIX_TO_ICAO[prefix]
  return icaoPrefix ? icaoPrefix + flightNumber.slice(2) : flightNumber
}

export interface InboundData {
  callsigns:            Set<string>                    // ICAO + IATA callsigns for all active Syrian-route flights
  prefixes:             Set<string>                    // 3-letter prefixes of those callsigns
  airportByCallsign:    Map<string, 'DAM' | 'ALP'>
  directionByCallsign:  Map<string, 'arr' | 'dep'>
  otherEndpointByCallsign: Map<string, string>
  // Maps any alias (IATA flight_number) → primary ICAO callsign so we query
  // adsb.lol with the right identifier even when the regional feed matched on IATA.
  primaryCallsign:      Map<string, string>
}

let cache: { data: InboundData; ts: number } | null = null

export async function getInboundData(): Promise<InboundData> {
  if (cache && Date.now() - cache.ts < TTL) return cache.data

  try {
    // Syria is UTC+3. Window: flights that departed up to 4h ago OR arrive within 4h.
    const now = new Date()
    const syriaNow = new Date(now.getTime() + 3 * 60 * 60 * 1000) // UTC → UTC+3

    const pad = (n: number) => String(n).padStart(2, '0')
    const windowStart = new Date(syriaNow.getTime() - 6 * 60 * 60 * 1000)  // 6h back covers long departures
    const windowEnd   = new Date(syriaNow.getTime() + 4 * 60 * 60 * 1000)

    // Collect the date(s) the window spans — may cross midnight
    const dateSet = new Set([
      windowStart.toISOString().slice(0, 10),
      syriaNow.toISOString().slice(0, 10),
      windowEnd.toISOString().slice(0, 10),
    ])
    const dates = [...dateSet]

    // For each date in the window, query separately with the right time bounds
    const allRows: Array<{ icao_callsign: string | null; flight_number: string | null; origin: string | null; destination: string | null }> = []

    for (const date of dates) {
      // Time bounds for this specific date
      const dayStart = date === windowStart.toISOString().slice(0, 10)
        ? `${pad(windowStart.getUTCHours())}:${pad(windowStart.getUTCMinutes())}:00`
        : '00:00:00'
      const dayEnd = date === windowEnd.toISOString().slice(0, 10)
        ? `${pad(windowEnd.getUTCHours())}:${pad(windowEnd.getUTCMinutes())}:00`
        : '23:59:59'

      const { data, error } = await supabase
        .from('flights')
        .select('icao_callsign, flight_number, origin, destination')
        .eq('scheduled_date', date)
        .not('status', 'in', '("landed","cancelled")')
        .gte('scheduled_time', dayStart)
        .lte('scheduled_time', dayEnd)

      if (error) throw error
      allRows.push(...(data ?? []))
    }

    const callsigns              = new Set<string>()
    const prefixes               = new Set<string>()
    const airportByCallsign      = new Map<string, 'DAM' | 'ALP'>()
    const directionByCallsign    = new Map<string, 'arr' | 'dep'>()
    const otherEndpointByCallsign = new Map<string, string>()
    const primaryCallsign        = new Map<string, string>()  // alias → ICAO
    const SYRIAN_AIRPORTS        = new Set(['DAM', 'ALP'])

    for (const row of allRows) {
      // Derive ICAO code: prefer explicit icao_callsign; fall back to translating
      // the IATA flight_number prefix (XH→FYC, RB→SYR) because adsb.lol only
      // understands ICAO 3-letter codes.
      const iata = row.flight_number?.toUpperCase().replace(/\s+/g, '')  ?? null
      const icao = (row.icao_callsign?.toUpperCase().replace(/\s+/g, '') ?? null)
               ?? (iata ? toIcaoCallsign(iata) : null)
      const codes = [...new Set([icao, iata].filter(Boolean) as string[])]
      if (!codes.length) continue

      const originSyrian = SYRIAN_AIRPORTS.has(row.origin ?? '')
      const destSyrian   = SYRIAN_AIRPORTS.has(row.destination ?? '')
      const ap = originSyrian
        ? (row.origin as 'DAM' | 'ALP')
        : destSyrian
          ? (row.destination as 'DAM' | 'ALP')
          : null
      const direction = originSyrian ? 'dep' : 'arr'
      const other     = originSyrian ? row.destination : row.origin

      for (const cs of codes) {
        callsigns.add(cs)
        prefixes.add(cs.slice(0, 3))
        if (ap) {
          airportByCallsign.set(cs, ap)
          directionByCallsign.set(cs, direction as 'arr' | 'dep')
          if (other) otherEndpointByCallsign.set(cs, other)
        }
        // Map every alias back to the ICAO code so fetchByCallsign uses the right identifier
        if (icao && cs !== icao) primaryCallsign.set(cs, icao)
      }
    }

    const result: InboundData = { callsigns, prefixes, airportByCallsign, directionByCallsign, otherEndpointByCallsign, primaryCallsign }
    cache = { data: result, ts: Date.now() }
    return result
  } catch (err) {
    console.error('[inbound] DB query failed:', err)
    // Return empty — aircraft will still show as overSyria (gold) if they're there
    return { callsigns: new Set(), prefixes: new Set(), airportByCallsign: new Map(), directionByCallsign: new Map(), otherEndpointByCallsign: new Map(), primaryCallsign: new Map() }
  }
}

