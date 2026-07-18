// Normalize flight records from both airport APIs into a unified shape

export type FlightDirection = 'arrival' | 'departure'

export type FlightStatus = 'on-time' | 'scheduled' | 'delayed' | 'cancelled' | 'landed' | 'boarding' | 'unknown'

export interface Flight {
  id: string
  flightNumber: string          // normalized, no spaces
  rawFlightNumber: string       // original from API
  airline: string               // English name
  airlineAr: string             // Arabic name (DAM only, else empty)
  direction: FlightDirection
  origin: string                // IATA
  destination: string           // IATA
  date: string                  // YYYY-MM-DD
  time: string                  // HH:MM
  gate: string
  status: FlightStatus
  airport: 'ALP' | 'DAM'       // which Syrian airport
  trackerUrl: string
}

// Maps Arabic airline names from DAM API → English canonical name
const ARABIC_TO_ENGLISH: Record<string, string> = {
  'طيران العربية':    'Air Arabia',
  'طيران الجزيرة':   'Jazeera Airways',
  'فلاي ناس':        'Flynas',
  'فلاي دبي':        'Fly Dubai',
  'الخطوط الكويتية': 'Kuwait Airways',
  'فلاي شام':        'Fly CHAM',
  'الخطوط التركية':  'Turkish Airlines',
  'السورية للطيران': 'Syrian Arab Airlines',
  'الملكية الأردنية':'Royal Jordanian',
  'أناضول جت':       'Ajet',
  'فلاي إديل':       'Edelweiss Air',
  'الخطوط القطرية':  'Qatar Airways',
  'الاتحاد':         'Etihad Airways',
  'دان أير':         'DAN Air',
  'الأمم المتحدة':   'United Nations (WFP)',
  'الخطوط الجوية السورية': 'Syrian Arab Airlines',
}

function normalizeStatus(raw: string): FlightStatus {
  const s = raw?.toLowerCase() ?? ''
  if (s === 'on-time' || s === 'on time') return 'on-time'
  if (s === 'scheduled')  return 'scheduled'
  if (s === 'delayed')    return 'delayed'
  if (s === 'cancelled' || s === 'canceled') return 'cancelled'
  if (s === 'landed')     return 'landed'
  if (s === 'boarding')   return 'boarding'
  return 'unknown'
}

function normalizeFlightNum(fn: string): string {
  const s = fn?.trim() ?? ''
  // Fly CHAM raw formats from ALP API:
  // "FYC (XH526)", "FYC(XH725)", "FYC XH762", "FYC XH 761", "FYC (XH762 )"
  // → all normalize to the inner XH code e.g. "XH526"
  if (s.startsWith('FYC')) {
    const m = s.match(/([A-Z]{2,3})\s*(\d+)/)
    // m[1] might be FYC itself if no inner code follows — skip
    if (m && m[1] !== 'FYC') return (m[1] + m[2]).toUpperCase()
    // Try second occurrence: "FYC XH762" → second alpha block
    const m2 = s.match(/FYC\s*[( ]*([A-Z]{2,3})\s*(\d+)/)
    if (m2) return (m2[1] + m2[2]).toUpperCase()
  }
  // Standard: strip all spaces (handles "G9 433" → "G9433", "TK 848" → "TK848")
  return s.replace(/\s+/g, '').toUpperCase()
}

function trackerUrl(fn: string): string {
  return `https://www.flightradar24.com/data/flights/${fn.toLowerCase()}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeFlight(raw: any, airport: 'ALP' | 'DAM'): Flight {
  const fn = normalizeFlightNum(raw.flightNumber ?? '')
  const isArabic = /[؀-ۿ]/.test(raw.airline ?? '')
  const airlineEn = isArabic
    ? (ARABIC_TO_ENGLISH[raw.airline] ?? raw.airline)
    : (raw.airline ?? '')

  return {
    id:              raw.id ?? `${airport}-${fn}-${raw.date}-${raw.time}`,
    flightNumber:    fn,
    rawFlightNumber: raw.flightNumber ?? '',
    airline:         airlineEn,
    airlineAr:       isArabic ? (raw.airline ?? '') : '',
    direction:       raw.direction as FlightDirection,
    origin:          raw.origin?.toUpperCase() ?? '',
    destination:     raw.destination?.toUpperCase() ?? '',
    date:            raw.date ?? '',
    time:            raw.time ?? '',
    gate:            raw.gate ?? '',
    status:          normalizeStatus(raw.status),
    airport,
    trackerUrl:      trackerUrl(fn),
  }
}
