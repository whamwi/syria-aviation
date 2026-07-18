'use client'

import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Marker, CircleMarker, Polyline, Tooltip } from 'react-leaflet'

// Top-down airplane silhouette pointing north (up) at 0°
// divIcon is required inside the function to avoid SSR/build-time Leaflet errors
function planeIcon(color: string, heading: number | null, overSyria: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { divIcon } = require('leaflet') as typeof import('leaflet')
  const rot = heading ?? 0
  const size = overSyria ? 30 : 24
  const svg = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <path fill="${color}" d="M16,2 C14.5,2 14,4.5 14,8 L14,13 L2,19 L2,22 L14,19.5 L14,26 L10,28 L10,30.5 L16,29 L22,30.5 L22,28 L18,26 L18,19.5 L30,22 L30,19 L18,13 L18,8 C18,4.5 17.5,2 16,2 Z"/>
  </svg>`
  return divIcon({
    html: `<div style="transform:rotate(${rot}deg);width:${size}px;height:${size}px">${svg}</div>`,
    className: '',
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [size / 2, 0],
  })
}

export interface Aircraft {
  icao24: string
  callsign: string
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

export interface RouteArc {
  from: string
  to: string
  arr: boolean
  ap: 'alp' | 'dam'
}

interface Props {
  aircraft: Aircraft[]
  routes: RouteArc[]
  apFilter: 'all' | 'alp' | 'dam'
  dirFilter: 'all' | 'arr' | 'dep'
}

const AIRPORTS: Record<string, { lat: number; lon: number; ar: string; color: string; labelDir: 'left' | 'right' }> = {
  ALP: { lat: 36.18, lon: 37.22, ar: 'حلب',  color: '#4A90E2', labelDir: 'right' },
  DAM: { lat: 33.41, lon: 36.52, ar: 'دمشق', color: '#18A866', labelDir: 'left'  },
}

// [lat, lon] — Leaflet order
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

function arcPoints(from: [number, number], to: [number, number]): [number, number][] {
  const pts: [number, number][] = []
  const midLat = (from[0] + to[0]) / 2
  const midLon = (from[1] + to[1]) / 2
  const dLat = to[0] - from[0]
  const dLon = to[1] - from[1]
  // Bulge the arc perpendicular to the line
  const ctrlLat = midLat - dLon * 0.2
  const ctrlLon = midLon + dLat * 0.2
  for (let i = 0; i <= 48; i++) {
    const t = i / 48
    pts.push([
      (1-t)*(1-t)*from[0] + 2*(1-t)*t*ctrlLat + t*t*to[0],
      (1-t)*(1-t)*from[1] + 2*(1-t)*t*ctrlLon + t*t*to[1],
    ])
  }
  return pts
}

export default function LiveMapInner({ aircraft, routes, apFilter, dirFilter }: Props) {
  const visibleRoutes = routes.filter(r => {
    const apOk = apFilter === 'all' || r.ap === apFilter
    const dirOk = dirFilter === 'all' || (dirFilter === 'arr' && r.arr) || (dirFilter === 'dep' && !r.arr)
    return apOk && dirOk
  })
  const dimmedRoutes = routes.filter(r => {
    const apOk = apFilter === 'all' || r.ap === apFilter
    const dirOk = dirFilter === 'all' || (dirFilter === 'arr' && r.arr) || (dirFilter === 'dep' && !r.arr)
    return !(apOk && dirOk)
  })

  return (
    <div style={{ height: 'calc(100vh - 230px)', minHeight: 420, width: '100%' }}>
      <MapContainer
        center={[35.2, 38.5]}
        zoom={6}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
        zoomControl
      >
        {/* CartoDB Dark Matter — free, no API key */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd"
          maxZoom={19}
        />

        {/* Dimmed inactive arcs */}
        {dimmedRoutes.map((r, i) => {
          const from = getLatLon(r.from), to = getLatLon(r.to)
          if (!from || !to) return null
          return (
            <Polyline key={`dim-${i}`} positions={arcPoints(from, to)}
              pathOptions={{ color: '#1B3251', weight: 0.8, opacity: 0.5, dashArray: '4 8' }} />
          )
        })}

        {/* Active route arcs */}
        {visibleRoutes.map((r, i) => {
          const from = getLatLon(r.from), to = getLatLon(r.to)
          if (!from || !to) return null
          return (
            <Polyline key={`arc-${i}`} positions={arcPoints(from, to)}
              pathOptions={{
                color: r.arr ? '#18A866' : '#6382A0',
                weight: 1.5, opacity: 0.6, dashArray: '5 7',
              }} />
          )
        })}

        {/* Airport markers */}
        {Object.entries(AIRPORTS).map(([code, ap]) => (
          <CircleMarker
            key={code}
            center={[ap.lat, ap.lon]}
            radius={7}
            pathOptions={{ color: ap.color, fillColor: ap.color, fillOpacity: 1, weight: 2.5 }}
          >
            <Tooltip
              permanent
              direction={ap.labelDir}
              offset={ap.labelDir === 'left' ? [-10, 0] : [10, 0]}
              className="av-ap-label"
            >
              <span style={{ color: ap.color }}>{ap.ar}</span>
            </Tooltip>
          </CircleMarker>
        ))}

        {/* Tether lines — Syrian flights to their home airport */}
        {aircraft
          .filter(a => a.inboundToSyria && a.syriaAirport && AIRPORTS[a.syriaAirport])
          .map(a => {
            const ap = AIRPORTS[a.syriaAirport!]
            const color = a.syriaAirport === 'DAM' ? '#18A866' : '#4A90E2'
            return (
              <Polyline
                key={`tether-${a.icao24}`}
                positions={[[ap.lat, ap.lon], [a.lat, a.lon]]}
                pathOptions={{ color, weight: 1, opacity: 0.35, dashArray: '4 7' }}
              />
            )
          })}

        {/* Aircraft — rotated plane icons */}
        {/* DAM = green, ALP = blue, non-Syrian overflight = gold, other = gray */}
        {aircraft.map(a => {
          const color = a.inboundToSyria
            ? (a.syriaAirport === 'DAM' ? '#18A866' : '#4A90E2')
            : (a.overSyria ? '#E8B820' : '#6B7F8E')
          return (
            <Marker
              key={a.icao24}
              position={[a.lat, a.lon]}
              icon={planeIcon(color, a.heading, a.overSyria)}
              eventHandlers={{ click: () => a.trackerUrl && window.open(a.trackerUrl, '_blank', 'noopener') }}
            >
              <Tooltip className="av-tooltip">
                <strong>{a.callsign || '—'}</strong>
                {a.airline  ? ` · ${a.airline}`                  : ''}
                {a.altFt    ? ` · ${a.altFt.toLocaleString()}ft` : ''}
                {a.speedKts ? ` · ${a.speedKts}kts`             : ''}
              </Tooltip>
            </Marker>
          )
        })}
      </MapContainer>
    </div>
  )
}
