import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Leaflet's default marker icon references image paths that Vite's bundler
// doesn't resolve correctly -- standard fix is pointing them at the CDN copy.
const driverIcon = L.divIcon({
  html: '<div style="font-size:28px;line-height:1;transform:translateY(-6px)">🛵</div>',
  className: '', iconSize: [28, 28], iconAnchor: [14, 20]
})
const destIcon = L.divIcon({
  html: '<div style="font-size:28px;line-height:1;transform:translateY(-6px)">📍</div>',
  className: '', iconSize: [28, 28], iconAnchor: [14, 28]
})

interface Props {
  driverLat: number; driverLng: number
  destLat: number; destLng: number
  driverUpdatedAt: string | null
  // Age of the fix as the SERVER measured it. Preferred over driverUpdatedAt
  // when available: the customer-facing Track page can only compare a timestamp
  // against the device clock, and a phone whose clock is a few minutes out
  // would either hide a genuinely stale pin or condemn a fresh one.
  ageSeconds?: number | null
  height?: number
}

export default function LiveMap({ driverLat, driverLng, destLat, destLng, driverUpdatedAt, ageSeconds, height = 240 }: Props) {
  const mapRef = useRef<L.Map | null>(null)
  const driverMarkerRef = useRef<L.Marker | null>(null)
  const destMarkerRef = useRef<L.Marker | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    mapRef.current = map
    destMarkerRef.current = L.marker([destLat, destLng], { icon: destIcon }).addTo(map)
    driverMarkerRef.current = L.marker([driverLat, driverLng], { icon: driverIcon }).addTo(map)
    map.fitBounds([[driverLat, driverLng], [destLat, destLng]], { padding: [30, 30] })
    return () => { map.remove(); mapRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!mapRef.current || !driverMarkerRef.current) return
    driverMarkerRef.current.setLatLng([driverLat, driverLng])
  }, [driverLat, driverLng])

  const stale = ageSeconds != null
    ? ageSeconds > 180
    : !!driverUpdatedAt && (Date.now() - new Date(driverUpdatedAt).getTime()) > 3 * 60 * 1000

  return (
    <div className="rounded-2xl overflow-hidden border border-line relative" style={{ height }}>
      <div ref={containerRef} className="w-full h-full" />
      {stale && (
        <div className="absolute top-2 inset-x-2 bg-shellup/95 text-xs text-center py-1.5 rounded-xl">
          آخر تحديث لموقع المندوب مضى عليه شوية
        </div>
      )}
    </div>
  )
}
