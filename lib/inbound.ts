// Queries Supabase for flights to/from Syria that are likely airborne right now.
// Arrivals: scheduled within next 4h. Departures: departed within last 4h.
// Falls back to empty sets if DB is unavailable.

import { supabase } from '@/lib/supabase'

const TTL = 2 * 60_000  // re-query every 2 min (window shifts as time passes)

export interface InboundData {
  callsigns: Set<string>  // exact ICAO callsigns, e.g. "QTR410"
  prefixes:  Set<string>  // 3-letter ICAO prefixes of airborne Syrian-route airlines
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
    const allRows: Array<{ icao_callsign: string | null; flight_number: string | null }> = []

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
        .select('icao_callsign, flight_number')
        .eq('scheduled_date', date)
        .not('status', 'in', '("landed","cancelled")')
        .gte('scheduled_time', dayStart)
        .lte('scheduled_time', dayEnd)

      if (error) throw error
      allRows.push(...(data ?? []))
    }

    const data = allRows

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
