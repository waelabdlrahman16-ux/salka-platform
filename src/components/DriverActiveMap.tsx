import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const driverIcon = L.divIcon({
  html: '<div style="font-size:26px;line-height:1;transform:translateY(-6px)">🛵</div>',
  className: '', iconSize: [26, 26], iconAnchor: [13, 20]
})
const destIcon = L.divIcon({
  html: '<div style="font-size:26px;line-height:1;transform:translateY(-6px)">📍</div>',
  className: '', iconSize: [26, 26], iconAnchor: [13, 26]
})

interface Props {
  destLat: number | null
  destLng: number | null
  showRoute?: boolean
  heightPx?: number
}

export default function DriverActiveMap({ destLat, destLng, showRoute, heightPx = 180 }: Props) {
  const mapRef = useRef<L.Map | null>(null)
  const driverMarkerRef = useRef<L.Marker | null>(null)
  const destMarkerRef = useRef<L.Marker | null>(null)
  const lineRef = useRef<L.Polyline | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    if (!navigator.geolocation) return
    const watchId = navigator.geolocation.watchPosition(
      pos => setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* location unavailable -- map just won't show the driver dot yet */ },
      { enableHighAccuracy: true, maximumAge: 10000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !myPos) return

    if (!driverMarkerRef.current) driverMarkerRef.current = L.marker([myPos.lat, myPos.lng], { icon: driverIcon }).addTo(map)
    else driverMarkerRef.current.setLatLng([myPos.lat, myPos.lng])

    if (destLat != null && destLng != null) {
      if (!destMarkerRef.current) destMarkerRef.current = L.marker([destLat, destLng], { icon: destIcon }).addTo(map)
      if (showRoute) {
        if (lineRef.current) lineRef.current.remove()
        lineRef.current = L.polyline([[myPos.lat, myPos.lng], [destLat, destLng]], { color: '#0A5F5E', weight: 4 }).addTo(map)
      }
      map.fitBounds([[myPos.lat, myPos.lng], [destLat, destLng]], { padding: [30, 30] })
    } else {
      map.setView([myPos.lat, myPos.lng], 15)
    }
  }, [myPos, destLat, destLng, showRoute])

  function recenter() {
    const map = mapRef.current
    if (!map || !myPos) return
    if (destLat != null && destLng != null) map.fitBounds([[myPos.lat, myPos.lng], [destLat, destLng]], { padding: [30, 30] })
    else map.setView([myPos.lat, myPos.lng], 15)
  }

  return (
    <div className="relative rounded-2xl overflow-hidden border border-line" style={{ height: heightPx }}>
      <div ref={containerRef} className="w-full h-full" />
      {!myPos && (
        <div className="absolute inset-0 bg-shellup grid place-items-center text-sm text-mist">جاري تحديد موقعك…</div>
      )}
      <button onClick={recenter} className="absolute bottom-2.5 left-2.5 bg-white rounded-xl px-3 py-2 text-xs font-semibold text-sea shadow-sm">
        📍 رجّع للموقع
      </button>
    </div>
  )
}
