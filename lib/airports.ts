import data from '@/data/airports.json'

export interface Airport {
  iata: string
  name: string
  city: string
  country: string
  lat: number
  lon: number
}

const db = data as Record<string, Airport>

export function airportByIata(code: string): Airport | null {
  return db[code?.toUpperCase()] ?? null
}

export function airportCity(code: string): string {
  return db[code?.toUpperCase()]?.city ?? code
}

export function airportName(code: string): string {
  return db[code?.toUpperCase()]?.name ?? code
}
