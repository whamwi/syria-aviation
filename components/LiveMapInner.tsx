'use client'

import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Marker, CircleMarker, Polyline, Tooltip } from 'react-leaflet'
import { useRef, useEffect, useState } from 'react'

// ─── Motion engine ────────────────────────────────────────────────────────────
//
// Dead-reckon forward from a "display position" that is gently corrected toward
// the real GPS fix on each update.
//
// Why DR + gentle correction beats pure lerp or pure DR:
//  • Pure DR: overshoots slightly → backward snap at each fix
//  • Pure lerp: plane appears stationary between fixes at small zoom levels
//  • DR + 30% correction: plane moves continuously forward; correction is tiny
//    (≤30% of any overshoot, which is sub-pixel at Syria zoom)
//
// The displayed position is ALWAYS moving forward via DR.
// The backward component of the correction is at most 0.3 × overshoot.
// At 500 kts over 5 s, overshoot from a 5° turn ≈ 110 m → correction ≈ 33 m
// ≈ 0.05 pixels at zoom 6.  Visually imperceptible.

function deadReckon(
  lat: number, lon: number,
  headingDeg: number, speedKts: number,
  dtSec: number,
): [number, number] {
  if (speedKts < 5 || dtSec <= 0 || dtSec > 8) return [lat, lon]
  const hr   = (headingDeg * Math.PI) / 180
  const dist = speedKts * 0.5144 * dtSec
  const dLat = (dist * Math.cos(hr)) / 111_320
  const dLon = (dist * Math.sin(hr)) / (111_320 * Math.cos((lat * Math.PI) / 180))
  return [lat + dLat, lon + dLon]
}

interface Anchor {
  dispLat:  number; dispLon:  number   // corrected display position
  heading:  number | null
  speedKts: number | null
  ts:       number                      // ms when this anchor was set
}

const CORR  = 0.30   // fraction to nudge toward real GPS on each fix
const ANIM_FPS = 20

function interpPos(anchor: Anchor, now: number): [number, number] {
  const dtSec = Math.min((now - anchor.ts) / 1000, 8)
  return deadReckon(anchor.dispLat, anchor.dispLon, anchor.heading ?? 0, anchor.speedKts ?? 0, dtSec)
}

// ─── Plane icon ───────────────────────────────────────────────────────────────
function planeIcon(color: string, heading: number | null, overSyria: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { divIcon } = require('leaflet') as typeof import('leaflet')
  const rot  = heading ?? 0
  const size = overSyria ? 30 : 24
  const svg  = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <path fill="${color}" d="M16,2 C14.5,2 14,4.5 14,8 L14,13 L2,19 L2,22 L14,19.5 L14,26 L10,28 L10,30.5 L16,29 L22,30.5 L22,28 L18,26 L18,19.5 L30,22 L30,19 L18,13 L18,8 C18,4.5 17.5,2 16,2 Z"/>
  </svg>`
  return divIcon({
    html:         `<div style="transform:rotate(${rot}deg);width:${size}px;height:${size}px">${svg}</div>`,
    className:    '',
    iconSize:     [size, size],
    iconAnchor:   [size / 2, size / 2],
    tooltipAnchor:[size / 2, 0],
  })
}

// ─── Public types ─────────────────────────────────────────────────────────────
export interface Aircraft {
  icao24:      string
  callsign:    string
  airline:     string | null
  lat:         number
  lon:         number
  altFt:       number | null
  speedKts:    number | null
  heading:     number | null
  overSyria:   boolean
  inboundToSyria: boolean
  country:     string
  aircraftType: string | null
  syriaAirport: 'DAM' | 'ALP' | null
  isArrival:   boolean
  otherAirport: string | null
  trackerUrl:  string
}

export interface RouteArc {
  from: string; to: string; arr: boolean; ap: 'alp' | 'dam'
}

interface Props {
  aircraft:  Aircraft[]
  routes:    RouteArc[]
  apFilter:  'all' | 'alp' | 'dam'
  dirFilter: 'all' | 'arr' | 'dep'
  onSelect:  (a: Aircraft) => void
}

// ─── Static data ──────────────────────────────────────────────────────────────
const AIRPORTS: Record<string, { lat: number; lon: number; ar: string; color: string; labelDir: 'left' | 'right' }> = {
  ALP: { lat: 36.18, lon: 37.22, ar: 'حلب',  color: '#4A90E2', labelDir: 'right' },
  DAM: { lat: 33.41, lon: 36.52, ar: 'دمشق', color: '#18A866', labelDir: 'left'  },
}

const CITIES: Record<string, [number, number]> = {
  IST: [41.0,  28.72], SAW: [40.9,  29.3 ], AMM: [31.72, 36.0 ],
  BEY: [33.82, 35.49], KWI: [29.23, 47.97], SHJ: [25.33, 55.52],
  DXB: [25.25, 55.37], AUH: [24.43, 54.65], DOH: [25.27, 51.57],
  CAI: [30.11, 31.41], BGW: [33.26, 44.23], EBL: [36.23, 43.96],
  JED: [21.68, 39.16], RUH: [24.96, 46.70], AMS: [52.31,  4.76],
  MJI: [32.89, 13.28], TLV: [32.00, 34.88], MSQ: [36.2,  37.02],
}

function getLatLon(code: string): [number, number] | null {
  const ap = AIRPORTS[code]
  if (ap) return [ap.lat, ap.lon]
  return CITIES[code] ?? null
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function LiveMapInner({ aircraft, routes, apFilter, dirFilter, onSelect }: Props) {
  // Anchor store: last real GPS fix + the position we were showing when it arrived
  const anchorsRef = useRef<Map<string, Anchor>>(new Map())

  // Current interpolated positions (updated at ANIM_FPS)
  const [positions, setPositions] = useState<Map<string, [number, number]>>(new Map())

  // When new ADS-B data arrives: DR forward from last display position,
  // then nudge 30% toward the real GPS fix to correct any accumulated error.
  useEffect(() => {
    const now = Date.now()
    const incoming = new Set(aircraft.map(a => a.icao24))

    for (const a of aircraft) {
      const prev = anchorsRef.current.get(a.icao24)
      const [drLat, drLon] = prev ? interpPos(prev, now) : [a.lat, a.lon]
      // Gentle correction: 30% toward real position.
      // If real is ahead → moves forward. If real is slightly behind due to DR
      // overshoot → moves back at most 30% of the error (sub-pixel at zoom 6).
      const dispLat = drLat + (a.lat - drLat) * CORR
      const dispLon = drLon + (a.lon - drLon) * CORR
      anchorsRef.current.set(a.icao24, {
        dispLat, dispLon,
        heading: a.heading, speedKts: a.speedKts,
        ts: now,
      })
    }
    for (const id of anchorsRef.current.keys()) {
      if (!incoming.has(id)) anchorsRef.current.delete(id)
    }
  }, [aircraft])

  // Animation loop — recomputes interpolated positions at ANIM_FPS
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      const next = new Map<string, [number, number]>()
      for (const [icao24, anchor] of anchorsRef.current.entries()) {
        next.set(icao24, interpPos(anchor, now))
      }
      setPositions(next)
    }, 1000 / ANIM_FPS)
    return () => clearInterval(id)
  }, [])

  // Helper: get the live interpolated position for rendering
  function pos(a: Aircraft): [number, number] {
    return positions.get(a.icao24) ?? [a.lat, a.lon]
  }

  return (
    <div style={{ height: '100%', minHeight: 0, width: '100%' }}>
      <MapContainer
        center={[35.2, 38.5]}
        zoom={6}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
        zoomControl
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd"
          maxZoom={19}
        />

        {/* Airport markers */}
        {Object.entries(AIRPORTS).map(([code, ap]) => (
          <CircleMarker
            key={code}
            center={[ap.lat, ap.lon]}
            radius={7}
            pathOptions={{ color: ap.color, fillColor: ap.color, fillOpacity: 1, weight: 2.5 }}
          >
            <Tooltip permanent direction={ap.labelDir} offset={ap.labelDir === 'left' ? [-10, 0] : [10, 0]} className="av-ap-label">
              <span style={{ color: ap.color }}>{ap.ar}</span>
            </Tooltip>
          </CircleMarker>
        ))}

        {/* Tether lines — solid = covered, dotted = remaining */}
        {aircraft
          .filter(a => a.inboundToSyria && a.syriaAirport && AIRPORTS[a.syriaAirport])
          .flatMap(a => {
            const ap       = AIRPORTS[a.syriaAirport!]
            const color    = a.syriaAirport === 'DAM' ? '#18A866' : '#4A90E2'
            const apPos: [number, number]    = [ap.lat, ap.lon]
            const planePos: [number, number] = pos(a)
            const otherPos = a.otherAirport ? getLatLon(a.otherAirport) : null
            const solid  = { color, weight: 1.5, opacity: 0.75 }
            const dotted = { color, weight: 1.5, opacity: 0.5, dashArray: '6 6' }

            if (a.isArrival) {
              const lines = []
              if (otherPos) lines.push(<Polyline key={`cov-${a.icao24}`} positions={[otherPos, planePos]} pathOptions={solid}  />)
              lines.push(              <Polyline key={`rem-${a.icao24}`} positions={[planePos, apPos]}    pathOptions={dotted} />)
              return lines
            }
            const lines = [<Polyline key={`cov-${a.icao24}`} positions={[apPos, planePos]}    pathOptions={solid}  />]
            if (otherPos) lines.push(<Polyline key={`rem-${a.icao24}`} positions={[planePos, otherPos]} pathOptions={dotted} />)
            return lines
          })}

        {/* Aircraft markers — positioned at interpolated (dead-reckoned) location */}
        {aircraft.map(a => {
          const color = a.inboundToSyria
            ? (a.syriaAirport === 'DAM' ? '#18A866' : '#4A90E2')
            : (a.overSyria ? '#E8B820' : '#6B7F8E')
          const [lat, lon] = pos(a)
          const altFt   = a.altFt    != null ? `${a.altFt.toLocaleString()} ft`                          : null
          const speedKts = a.speedKts != null ? `${Math.round(a.speedKts)} kts`                          : null
          const heading  = a.heading  != null ? `${Math.round(a.heading).toString().padStart(3, '0')}°`  : null
          return (
            <Marker
              key={a.icao24}
              position={[lat, lon]}
              icon={planeIcon(color, a.heading, a.overSyria)}
              eventHandlers={{ click: () => onSelect(a) }}
            >
              <Tooltip className="av-tooltip">
                <div style={{ lineHeight: 1.6, minWidth: 160 }}>
                  <div><strong>{a.callsign || '—'}</strong>{a.airline ? ` · ${a.airline}` : ''}</div>
                  {(a.otherAirport || a.syriaAirport) && (
                    <div style={{ opacity: 0.75, fontSize: '0.9em' }}>
                      {a.isArrival
                        ? `${a.otherAirport ?? '?'} → ${a.syriaAirport ?? '?'}`
                        : `${a.syriaAirport ?? '?'} → ${a.otherAirport ?? '?'}`}
                    </div>
                  )}
                  <div style={{ opacity: 0.75, fontSize: '0.9em' }}>
                    {[altFt, speedKts, heading].filter(Boolean).join(' · ')}
                  </div>
                  {a.country && <div style={{ opacity: 0.5, fontSize: '0.85em' }}>{a.country}</div>}
                </div>
              </Tooltip>
            </Marker>
          )
        })}
      </MapContainer>
    </div>
  )
}
