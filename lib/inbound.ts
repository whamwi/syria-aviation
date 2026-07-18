// Queries Supabase for arrivals that are likely airborne right now:
// scheduled today, not yet landed/cancelled, arriving within the next 3 hours.
// Falls back to empty sets if DB is unavailable.

import { supabase } from '@/lib/supabase'

const TTL = 2 * 60_000  // re-query every 2 min (window shifts as time passes)

export interface InboundData {
  callsigns: Set<string>  // exact ICAO callsigns, e.g. "QTR410"
  prefixes:  Set<string>  // 3-letter ICAO prefixes of airborne inbound airlines
}

let cache: { data: InboundData; ts: number } | null = null

export async function getInboundData(): Promise<InboundData> {
  if (cache && Date.now() - cache.ts < TTL) return cache.data

  try {
    // Syria is UTC+3. We query flights arriving in the next 3 hours
    // and flights that departed recently (up to 30 min ago — already over Syria).
    const now = new Date()
    const syriaNow = new Date(now.getTime() + 3 * 60 * 60 * 1000) // UTC → UTC+3

    const todayDate = syriaNow.toISOString().slice(0, 10)
    const pad = (n: number) => String(n).padStart(2, '0')
    const windowStart = new Date(syriaNow.getTime() - 30  * 60 * 1000)
    const windowEnd   = new Date(syriaNow.getTime() + 3 * 60 * 60 * 1000)
    const startTime   = `${pad(windowStart.getUTCHours())}:${pad(windowStart.getUTCMinutes())}:00`
    const endTime     = `${pad(windowEnd.getUTCHours())}:${pad(windowEnd.getUTCMinutes())}:00`

    const { data, error } = await supabase
      .from('flights')
      .select('icao_callsign, flight_number')
      .eq('direction', 'arrival')
      .eq('scheduled_date', todayDate)
      .not('status', 'in', '("landed","cancelled")')
      .gte('scheduled_time', startTime)
      .lte('scheduled_time', endTime)

    if (error) throw error

    const callsigns = new Set<string>()
    const prefixes  = new Set<string>()

    for (const row of data ?? []) {
      if (row.icao_callsign) {
        callsigns.add(row.icao_callsign.toUpperCase())
        prefixes.add(row.icao_callsign.slice(0, 3).toUpperCase())
      }
    }

    const result: InboundData = { callsigns, prefixes }
    cache = { data: result, ts: Date.now() }
    return result
  } catch (err) {
    console.error('[inbound] DB query failed:', err)
    // Return empty — aircraft will still show as overSyria (gold) if they're there
    return { callsigns: new Set(), prefixes: new Set() }
  }
}

// Backward-compat alias used by older compiled modules
export const getInboundCallsigns = getInboundData
