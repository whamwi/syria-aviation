import { airlineFromCallsign } from '@/lib/airlines'
import { getInboundData, type InboundData } from '@/lib/inbound'
import { supabase } from '@/lib/supabase'

// adsb.lol — community ADS-B feed, no API key, no hard rate limit
// Radius 350 nm centred on central Syria (35.3°N 38.4°E) covers the whole region
const FEED_URL = 'https://api.adsb.lol/v2/lat/35.3/lon/38.4/dist/350'

// Syria border polygon — ~25-point approximation, [lat, lon] pairs, clockwise from NW coast.
// Replaces the old bounding box which falsely captured Lebanon, Jordan, and the Med.
const SYRIA_POLYGON: [number, number][] = [
  [36.63, 36.16], // NW coast (Latakia)
  [36.88, 36.20], // coast toward Turkey border
  [37.07, 36.65], // Turkey border west
  [37.22, 37.05],
  [37.30, 37.57],
  [37.13, 38.20],
  [37.10, 38.86],
  [37.24, 39.35],
  [37.42, 40.05],
  [37.46, 40.53],
  [37.10, 41.13],
  [37.07, 42.38], // NE corner (Turkey / Iraq / Syria)
  [36.83, 42.38], // Iraq border — going south
  [35.89, 41.36],
  [34.21, 40.79],
  [33.45, 40.69],
  [32.80, 39.78],
  [32.54, 38.77], // SE corner (Iraq / Jordan)
  [32.74, 38.35], // Jordan border — going west
  [32.81, 37.40],
  [33.39, 36.64],
  [33.30, 36.36], // near Daraa
  [33.25, 35.93], // SW corner (Golan / Israel)
  [33.52, 35.56], // Lebanon border — going north
  [33.88, 35.88],
  [34.42, 36.04],
  [34.82, 36.04],
  [35.26, 35.99],
  [35.78, 35.97],
  [36.63, 36.16], // close polygon
]

// Ray-casting point-in-polygon — O(n) per call, fast enough for per-aircraft checks
function overSyriaPolygon(lat: number, lon: number): boolean {
  let inside = false
  const n = SYRIA_POLYGON.length
  let j = n - 1
  for (let i = 0; i < n; i++) {
    const [yi, xi] = SYRIA_POLYGON[i]
    const [yj, xj] = SYRIA_POLYGON[j]
    if ((yi > lat) !== (yj > lat) &&
        lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside
    }
    j = i
  }
  return inside
}

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
  aircraftType: string | null
  syriaAirport: 'DAM' | 'ALP' | null
  isArrival: boolean
  otherAirport: string | null
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
function buildAircraftState(a: any, inboundToSyria: boolean, syriaAirport: 'DAM' | 'ALP' | null = null, isArrival = false, otherAirport: string | null = null): AircraftState {
  const callsign = (a.flight ?? a.hex ?? '').trim()
  const airline  = airlineFromCallsign(callsign)
  const lat      = a.lat as number
  const lon      = a.lon as number
  const overSyria = overSyriaPolygon(lat, lon)
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
    aircraftType: (a.t as string | undefined) ?? null,
    overSyria,
    inboundToSyria,
    syriaAirport,
    isArrival,
    otherAirport,
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
      const overSyria = overSyriaPolygon(lat, lon)
      const exactMatch = inbound.callsigns.has(cs)
      const airport    = exactMatch ? (inbound.airportByCallsign.get(cs)       ?? null)  : null
      const isArrival  = exactMatch ? (inbound.directionByCallsign.get(cs)     === 'arr') : false
      const other      = exactMatch ? (inbound.otherEndpointByCallsign.get(cs) ?? null)  : null
      return buildAircraftState(a, exactMatch, airport, isArrival, other)
    })
    .filter((a: AircraftState) => a.overSyria || a.inboundToSyria)
}

// Last-known regional aircraft — served when the regional feed is temporarily down.
// Prevents overflights from blinking to 0 during transient 429/502 errors.
let lastRegional: AircraftState[] = []

// Tracks which ICAO callsigns we have already written a status for today,
// so we fire at most one DB write per flight per day (not every 5s cycle).
const statusWritten = new Map<string, string>()  // icao → yyyy-mm-dd written for

function syriaDate(): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function writeStatusOnce(icaoCallsign: string, status: 'departed' | 'landed') {
  const date = syriaDate()
  const key  = `${icaoCallsign}:${date}`
  if (status !== 'landed' && statusWritten.get(key) === status) return
  statusWritten.set(key, status)
  supabase.from('flights').update({ status })
    .eq('icao_callsign', icaoCallsign)
    .eq('scheduled_date', date)
    .then(() => {})
}

// Last-known position cache for per-callsign tracked flights.
// Empty feed response = coverage gap → hold last airborne position up to 30 min.
// Confirmed ground (ac.ground === true) = actually landed → evict immediately.
const trackedCache = new Map<string, { state: AircraftState; ts: number }>()
const TRACKED_STALE_MS = 30 * 60_000  // hold through coverage gaps (up to 30 min)

// Fetch a specific callsign globally — used for Syrian flights outside the regional radius
async function fetchByCallsign(cs: string, airport: 'DAM' | 'ALP' | null, isArrival = false, otherAirport: string | null = null): Promise<AircraftState | null> {
  try {
    const res = await fetch(`https://api.adsb.lol/v2/callsign/${cs}`, {
      headers: { 'User-Agent': 'SyriaAviationPortal/1.0' },
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    })
    if (res.ok) {
      const data = await res.json()
      const ac   = (data.ac ?? [])[0]
      if (ac) {
        if (ac.ground) {
          trackedCache.delete(cs)
          writeStatusOnce(cs, 'landed')
          return null
        }
        // Fill in lat/lon from lastPosition when direct GPS is in a coverage gap
        // (seen_pos = seconds since last position fix; accept up to 5 min stale)
        if (ac.lat == null && ac.lastPosition && ((ac.lastPosition.seen_pos ?? ac.seen_pos ?? Infinity) < 300)) {
          ac.lat = ac.lastPosition.lat
          ac.lon = ac.lastPosition.lon
        }
        if (ac.lat != null && ac.lon != null) {
          const state = buildAircraftState(ac, true, airport, isArrival, otherAirport)
          trackedCache.set(cs, { state, ts: Date.now() })
          return state
        }
      }
      // No usable position — fall through to stale cache
    }
  } catch { /* network error — fall through to stale cache */ }

  // No live data: serve last known airborne position if within the stale window
  const cached = trackedCache.get(cs)
  if (cached && Date.now() - cached.ts < TRACKED_STALE_MS) return cached.state
  return null
}

async function fetchFromFeed(): Promise<AirspaceSnapshot> {
  // Regional feed and inbound DB query run concurrently.
  // Regional feed failure (429, 502, network error) is non-fatal — per-callsign
  // lookups for scheduled Syrian flights always run regardless.
  const [res, inbound] = await Promise.all([
    fetch(FEED_URL, {
      headers: { 'User-Agent': 'SyriaAviationPortal/1.0' },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    }).catch(() => null),
    getInboundData(),
  ])

  let regional: AircraftState[] = []
  if (res?.ok) {
    const data = await res.json()
    const raw  = data.ac ?? data.aircraft ?? []

    // Detect landings BEFORE filtering: if an inbound Syrian-route flight appears
    // grounded in the regional feed, it has just arrived — write 'landed' immediately.
    // This catches arrivals at DAM/ALP whose transponder will go silent shortly after.
    for (const a of raw) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(a as any).ground) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cs = ((a as any).flight ?? '').trim().replace(/\s+/g, '').toUpperCase()
      if (cs && inbound.callsigns.has(cs)) {
        const icao = inbound.primaryCallsign.get(cs) ?? cs
        writeStatusOnce(icao, 'landed')
      }
    }

    regional     = parseRegionalFeed(raw, inbound)
    lastRegional = regional  // persist for use during transient feed failures
  } else {
    regional = lastRegional  // serve last known — prevents overflights blinking to 0
  }

  // Per-callsign lookups for scheduled Syrian flights — always attempt even when
  // the regional feed is down (they may be outside the 350nm radius or the feed
  // is temporarily unavailable). trackedCache bridges any coverage gaps.
  //
  // Dedup: if both ICAO and IATA alias are in the missing list for the same
  // physical flight, only query adsb.lol once with the ICAO code. We resolve each
  // missing callsign to its primary ICAO (falling back to itself if it is already
  // ICAO), then deduplicate the set of queries.
  const foundCallsigns = new Set(regional.map(a => a.callsign.toUpperCase()))
  const missingRaw = [...inbound.callsigns].filter(cs => !foundCallsigns.has(cs))
  // Map each missing cs → the ICAO code we'll actually query
  const queryMap = new Map<string, string>()  // ICAO → one of its matching callsigns (for metadata lookup)
  for (const cs of missingRaw) {
    const icao = inbound.primaryCallsign.get(cs) ?? cs  // if it's an alias, resolve to ICAO
    if (!queryMap.has(icao)) queryMap.set(icao, cs)     // first alias wins; ICAO maps to itself
  }
  const tracked = (await Promise.all(
    [...queryMap.keys()].map(icao => {
      const cs = queryMap.get(icao)!  // metadata stored under the matching callsign
      return fetchByCallsign(
        icao,
        inbound.airportByCallsign.get(cs)       ?? null,
        inbound.directionByCallsign.get(cs)     === 'arr',
        inbound.otherEndpointByCallsign.get(cs) ?? null,
      )
    })
  )).filter(Boolean) as AircraftState[]

  // Deduplicate by icao24 — regional result takes priority over per-callsign
  const seenIcao = new Set<string>()
  const aircraft = [...regional, ...tracked].filter(a => {
    if (seenIcao.has(a.icao24)) return false
    seenIcao.add(a.icao24)
    return true
  })

  // Write 'departed' for every Syrian-route flight we see airborne — covers both
  // regional feed (SYR444 near DAM) and per-callsign (FYC485 near SAW).
  // writeStatusOnce throttles to one DB write per ICAO per day.
  for (const a of aircraft) {
    if (!a.inboundToSyria) continue
    // a.callsign is the ICAO code as broadcast by adsb.lol (SYR444, FYC485, etc.)
    writeStatusOnce(a.callsign.toUpperCase(), 'departed')
  }

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
