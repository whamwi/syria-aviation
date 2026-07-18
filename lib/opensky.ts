import { airlineFromCallsign } from '@/lib/airlines'
import { getInboundData, type InboundData } from '@/lib/inbound'

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
  syriaAirport: 'DAM' | 'ALP' | null
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
function buildAircraftState(a: any, inboundToSyria: boolean, syriaAirport: 'DAM' | 'ALP' | null = null): AircraftState {
  const callsign = (a.flight ?? a.hex ?? '').trim()
  const airline  = airlineFromCallsign(callsign)
  const lat      = a.lat as number
  const lon      = a.lon as number
  const overSyria = lat >= SYRIA.lamin && lat <= SYRIA.lamax &&
                    lon >= SYRIA.lomin && lon <= SYRIA.lomax
  return {
    icao24:      a.hex ?? '',
    callsign,
    country:     a.r ?? '',
    airline:     airline?.name ?? null,
    lat,
    lon,
    altFt:       a.alt_baro ?? a.alt_geom ?? null,
    speedKts:    a.gs       ?? null,
    heading:     a.track    ?? null,
    overSyria,
    inboundToSyria,
    syriaAirport,
    trackerUrl:  callsign
      ? `https://www.flightradar24.com/${callsign.toLowerCase().trim()}`
      : '',
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseRegionalFeed(raw: any[], inbound: InboundData): AircraftState[] {
  return raw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((a: any) => a.lat != null && a.lon != null && !a.ground)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((a: any): AircraftState => {
      const callsign = (a.flight ?? a.hex ?? '').trim()
      const cs       = callsign.replace(/\s+/g, '').toUpperCase()
      const lat      = a.lat as number
      const lon      = a.lon as number
      const overSyria = lat >= SYRIA.lamin && lat <= SYRIA.lamax &&
                        lon >= SYRIA.lomin && lon <= SYRIA.lomax
      const exactMatch  = inbound.callsigns.has(cs)
      const prefixMatch = !overSyria && cs.length >= 3 && inbound.prefixes.has(cs.slice(0, 3))
      const airport     = exactMatch ? (inbound.airportByCallsign.get(cs) ?? null) : null
      return buildAircraftState(a, exactMatch || prefixMatch, airport)
    })
    .filter((a: AircraftState) => a.overSyria || a.inboundToSyria)
}

// Last-known position cache for per-callsign tracked flights.
// Serves the stale position when adsb.lol returns nothing for a cycle,
// preventing the plane from flickering off the map during brief ADS-B gaps.
const trackedCache = new Map<string, { state: AircraftState; ts: number }>()
const TRACKED_STALE_MS = 60_000  // hold last position for up to 60 s

// Fetch a specific callsign globally — used for Syrian flights outside the regional radius
async function fetchByCallsign(cs: string, airport: 'DAM' | 'ALP' | null): Promise<AircraftState | null> {
  try {
    const res = await fetch(`https://api.adsb.lol/v2/callsign/${cs}`, {
      headers: { 'User-Agent': 'SyriaAviationPortal/1.0' },
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    })
    if (res.ok) {
      const data = await res.json()
      const ac   = (data.ac ?? [])[0]
      if (ac && ac.lat != null && ac.lon != null && !ac.ground) {
        const state = buildAircraftState(ac, true, airport)
        trackedCache.set(cs, { state, ts: Date.now() })
        return state
      }
    }
  } catch { /* fall through to stale cache */ }

  // Live fetch failed or returned nothing — serve last known position if recent
  const cached = trackedCache.get(cs)
  if (cached && Date.now() - cached.ts < TRACKED_STALE_MS) return cached.state
  return null
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
  const data     = await res.json()
  const raw      = data.ac ?? data.aircraft ?? []
  const regional = parseRegionalFeed(raw, inbound)

  // Find scheduled Syrian callsigns not yet visible in the regional feed
  const foundCallsigns = new Set(regional.map(a => a.callsign.toUpperCase()))
  const missing = [...inbound.callsigns].filter(cs => !foundCallsigns.has(cs))

  // Fetch each missing Syrian flight individually — they're outside the 350nm radius
  const tracked = (await Promise.all(missing.map(cs => fetchByCallsign(cs, inbound.airportByCallsign.get(cs) ?? null))))
    .filter(Boolean) as AircraftState[]

  const aircraft = [...regional, ...tracked]
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
