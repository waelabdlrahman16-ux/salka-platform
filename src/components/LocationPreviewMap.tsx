import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const pinIcon = L.divIcon({
  html: '<div style="font-size:28px;line-height:1;transform:translateY(-8px)">📍</div>',
  className: '', iconSize: [28, 28], iconAnchor: [14, 28]
})

export default function LocationPreviewMap({ lat, lng }: { lat: number; lng: number }) {
  const mapRef = useRef<L.Map | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: false, attributionControl: false, dragging: false,
      scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    L.marker([lat, lng], { icon: pinIcon }).addTo(map)
    map.setView([lat, lng], 15)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    mapRef.current?.setView([lat, lng], 15)
  }, [lat, lng])

  return <div ref={containerRef} className="w-full h-32 rounded-xl overflow-hidden border border-line" />
}
