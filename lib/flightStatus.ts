// Fetches ADS-B-derived statuses from Supabase for today's flights.
// Returns a map of icao_callsign → status so the flights API can override
// the stale "scheduled" status the airport APIs always return.

import { supabase } from '@/lib/supabase'
import type { FlightStatus } from '@/lib/normalize'

const OVERRIDE_STATUSES = new Set(['departed', 'landed'])

// Priority order for status merging — higher wins.
// Use applyStatusOverride() instead of a blind assignment so airport-API
// 'landed' is never clobbered by our DB 'departed'.
const STATUS_RANK: Record<string, number> = {
  unknown: -1, scheduled: 0, 'on-time': 1, delayed: 1,
  departed: 2, boarding: 3, landed: 3, cancelled: 4,
}

export function applyStatusOverride(current: FlightStatus, override: FlightStatus): FlightStatus {
  return (STATUS_RANK[override] ?? 0) > (STATUS_RANK[current] ?? 0) ? override : current
}

export async function getStatusOverrides(date: string): Promise<Map<string, FlightStatus>> {
  const { data } = await supabase
    .from('flights')
    .select('icao_callsign, flight_number, status')
    .eq('scheduled_date', date)
    .in('status', ['departed', 'landed'])

  const map = new Map<string, FlightStatus>()
  for (const row of data ?? []) {
    const s = row.status as FlightStatus
    if (!OVERRIDE_STATUSES.has(s)) continue
    if (row.icao_callsign) map.set(row.icao_callsign.toUpperCase(), s)
    if (row.flight_number)  map.set(row.flight_number.toUpperCase().replace(/\s+/g, ''), s)
  }
  return map
}
