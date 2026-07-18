import { airlineFromCallsign } from '@/lib/airlines'
import { getInboundData } from '@/lib/inbound'

// adsb.lol — community ADS-B feed, no API key, no hard rate limit
// Radius 350 nm centred on central Syria (35.3°N 38.4°E) covers the whole region
const FEED_URL = 'https://api.adsb.lol/v2/lat/35.3/lon/38.4/dist/350'

const SYRIA = { lamin: 32.5, lomin: 35.5, lamax: 37.5, lomax: 42.3 }

export interface AircraftState {
  icao24: string
  callsign: string
  country: string
  airline: string | null
  lat: number
  lon: number
  altFt: number | null
  speedKts: number | null
  heading: number | null
  overSyria: boolean
  inboundToSyria: boolean
  trackerUrl: string
}

export interface AirspaceSnapshot {
  ok: boolean
  aircraft: AircraftState[]
  overSyria: number
  inboundToSyria: number
  count: number
  ts: number
  error?: string
}

// Module-level cache — shared across all SSE connections + REST calls
const CACHE_TTL = 5_000
let cache: AirspaceSnapshot | null = null
let inflight: Promise<AirspaceSnapshot> | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseAircraft(raw: any[], inbound: { callsigns: Set<string>; prefixes: Set<string> }): AircraftState[] {
  return raw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((a: any) => a.lat != null && a.lon != null && !a.ground)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((a: any): AircraftState => {
      const callsign     = (a.flight ?? a.hex ?? '').trim()
      const airline      = airlineFromCallsign(callsign)
      const lat          = a.lat as number
      const lon          = a.lon as number
      const overSyria    = lat >= SYRIA.lamin && lat <= SYRIA.lamax &&
                           lon >= SYRIA.lomin && lon <= SYRIA.lomax
      const cs           = callsign.replace(/\s+/g, '').toUpperCase()
      // Exact match: e.g. "JZR177" from flight J9177
      const exactMatch   = inbound.callsigns.has(cs)
      // Prefix match: airline has a Syria arrival today and plane isn't over Syria yet
      const prefixMatch  = !overSyria && cs.length >= 3 && inbound.prefixes.has(cs.slice(0, 3))
      const inboundToSyria = exactMatch || prefixMatch
      return {
        icao24:          a.hex ?? '',
        callsign,
        country:         a.r ?? '',
        airline:         airline?.name ?? null,
        lat,
        lon,
        altFt:           a.alt_baro ?? a.alt_geom ?? null,  // already in feet
        speedKts:        a.gs       ?? null,                 // already in knots
        heading:         a.track    ?? null,
        overSyria,
        inboundToSyria,
        trackerUrl:      callsign
          ? `https://www.flightradar24.com/${callsign.toLowerCase().trim()}`
          : '',
      }
    })
    .filter((a: AircraftState) => a.overSyria || a.inboundToSyria)
}

async function fetchFromFeed(): Promise<AirspaceSnapshot> {
  const [res, inbound] = await Promise.all([
    fetch(FEED_URL, {
      headers: { 'User-Agent': 'SyriaAviationPortal/1.0' },
      cache: 'no-store',
    }),
    getInboundData(),
  ])
  if (!res.ok) throw new Error(`adsb.lol ${res.status}`)
  const data = await res.json()
  const raw  = data.ac ?? data.aircraft ?? []
  const aircraft = parseAircraft(raw, inbound)
  return {
    ok:             true,
    aircraft,
    overSyria:      aircraft.filter(a => a.overSyria).length,
    inboundToSyria: aircraft.filter(a => a.inboundToSyria).length,
    count:          aircraft.length,
    ts:             Date.now(),
  }
}

export async function getAirspace(): Promise<AirspaceSnapshot> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache
  if (inflight) return inflight

  inflight = fetchFromFeed()
    .then(snap => { cache = snap; return snap })
    .catch(err => ({
      ok: false, error: String(err),
      aircraft: [], overSyria: 0, inboundToSyria: 0, count: 0, ts: Date.now(),
    }))
    .finally(() => { inflight = null })

  return inflight
}

export { CACHE_TTL }
