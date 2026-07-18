import data from '@/data/airlines.json'

export interface Airline {
  iata: string
  icao: string
  name: string
  country: string
}

const db = data as { byIata: Record<string, Airline>; byIcao: Record<string, Airline> }

export function airlineByIata(code: string): Airline | null {
  return db.byIata[code?.toUpperCase()] ?? null
}

export function airlineByIcao(code: string): Airline | null {
  return db.byIcao[code?.toUpperCase()] ?? null
}

// Extract IATA prefix from a flight number like "TK848", "G9 433", "FYC (XH526)"
export function extractIata(flightNumber: string): string {
  const clean = flightNumber.trim()
  // Fly CHAM: all "FYC *" variants → "XH"
  if (clean.startsWith('FYC')) return 'XH'
  // UNO (UN World Food Programme) → map to "UNO" key
  if (clean.startsWith('UNO')) return 'UNO'
  // Try longer patterns first: 2–3 all-letter, then letter+digit, then digit+letter
  const m = clean.match(/^([A-Z]{2,3}|[A-Z]\d|\d[A-Z])/)
  return m ? m[1] : ''
}

// Resolve airline name from a flight number string
export function airlineFromFlight(flightNumber: string): string {
  const iata = extractIata(flightNumber)
  const a = airlineByIata(iata)
  return a?.name ?? iata
}

// Resolve from OpenSky callsign (uses ICAO 3-letter prefix)
export function airlineFromCallsign(callsign: string): Airline | null {
  const clean = callsign.trim().toUpperCase()
  // Try first 3 chars as ICAO
  const icao = db.byIcao[clean.slice(0, 3)]
  if (icao) return icao
  // Fallback: first 2 chars as IATA
  const iata = db.byIata[clean.slice(0, 2)]
  return iata ?? null
}

// Normalize flight number to no-space format for tracker links
export function normalizeFlightNumber(fn: string): string {
  // Remove spaces and extract the real code from parenthetical format
  const paren = fn.match(/\(([A-Z0-9 ]+)\)/)
  const base = paren ? paren[1] : fn
  return base.replace(/\s+/g, '').toUpperCase()
}
