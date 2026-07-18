import { airlineByIata, extractIata } from '@/lib/airlines'
import { normalizeFlight }            from '@/lib/normalize'

// Fly CHAM transponder broadcasts "FYC" but our airlines DB records ICAO as "CHC"
const ICAO_OVERRIDES: Record<string, string> = {
  CHC: 'FYC',
}

const TTL = 5 * 60_000

export interface InboundData {
  callsigns: Set<string>  // exact ICAO callsigns expected on ADS-B
  prefixes:  Set<string>  // 3-letter ICAO prefixes of airlines with Syria arrivals today
}

let cache: { data: InboundData; ts: number } | null = null

function iataToIcao(iata: string): string | null {
  const airline = airlineByIata(iata)
  if (!airline?.icao || airline.icao === 'N/A') return null
  return ICAO_OVERRIDES[airline.icao] ?? airline.icao
}

function flightNumToCallsign(flightNum: string): string | null {
  const iata = extractIata(flightNum)
  if (!iata) return null
  const icao = iataToIcao(iata)
  if (!icao) return null
  const suffix = flightNum.slice(iata.length).replace(/\s+/g, '')
  if (!suffix) return null
  return (icao + suffix).toUpperCase()
}

export async function getInboundData(): Promise<InboundData> {
  if (cache && Date.now() - cache.ts < TTL) return cache.data

  const today = new Date().toISOString().slice(0, 10)

  const [alpRes, damRes] = await Promise.allSettled([
    fetch('https://alpairport.gov.sy/api/flights.php', {
      headers: { 'User-Agent': 'SyriaAviationPortal/1.0' },
      cache: 'no-store',
    }).then(r => r.json()),
    fetch('https://damairport.gov.sy/api/flights.php', {
      headers: { 'User-Agent': 'SyriaAviationPortal/1.0' },
      cache: 'no-store',
    }).then(r => r.json()),
  ])

  const callsigns = new Set<string>()
  const prefixes  = new Set<string>()

  for (const [res, airport] of [[alpRes, 'ALP'], [damRes, 'DAM']] as const) {
    if (res.status !== 'fulfilled') continue
    const raw = res.value.flights ?? []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const f of raw.map((r: any) => normalizeFlight(r, airport as 'ALP' | 'DAM'))) {
      if (f.direction !== 'arrival' || f.date !== today) continue

      const iata = extractIata(f.flightNumber)
      if (!iata) continue
      const icao = iataToIcao(iata)
      if (!icao) continue

      prefixes.add(icao)

      const cs = flightNumToCallsign(f.flightNumber)
      if (cs) callsigns.add(cs)
    }
  }

  const data: InboundData = { callsigns, prefixes }
  cache = { data, ts: Date.now() }
  return data
}

// Backward-compat alias used by older compiled modules
export const getInboundCallsigns = getInboundData
