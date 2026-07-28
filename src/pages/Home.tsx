import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { haversineKm } from '../lib/geo'
import type { Compound, Restaurant } from '../lib/types'

const STORAGE_KEY = 'salka_compound_id'

export default function Home() {
  const [compounds, setCompounds] = useState<Compound[]>([])
  const [compoundId, setCompoundId] = useState<number | null>(null)
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')
  const [nearby, setNearby] = useState<Compound[] | null>(null)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')

  useEffect(() => {
    supabase.from('compounds').select('*').eq('active', true).lte('distance_km', 30)
      .order('distance_km')
      .then(({ data }) => {
        setCompounds(data ?? [])
        const saved = sessionStorage.getItem(STORAGE_KEY)
        if (saved) setCompoundId(Number(saved))
        else setPicking(true)
      })
  }, [])

  useEffect(() => {
    if (!compoundId) { setLoading(false); return }
    setLoading(true)
    supabase.rpc('restaurants_for_compound', { p_compound_id: compoundId })
      .then(({ data }) => { setRestaurants((data as Restaurant[]) ?? []); setLoading(false) })
  }, [compoundId])

  function choose(id: number) {
    setCompoundId(id)
    sessionStorage.setItem(STORAGE_KEY, String(id))
    setPicking(false)
  }

  function useMyLocation() {
    if (!navigator.geolocation) { setLocationError('المتصفح ده مش بيدعم تحديد الموقع'); return }
    setLocating(true); setLocationError('')
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords
        const withCoords = compounds.filter(c => c.latitude != null && c.longitude != null)
        const ranked = [...withCoords].sort((a, b) =>
          haversineKm(latitude, longitude, a.latitude!, a.longitude!) -
          haversineKm(latitude, longitude, b.latitude!, b.longitude!))
        setNearby(ranked.slice(0, 3))
        setLocating(false)
      },
      () => {
        setLocationError('مش قادرين نوصل لموقعك — دوّر على اسم مكانك تحت')
        setLocating(false)
      },
      { timeout: 8000 }
    )
  }

  const selected = compounds.find(c => c.id === compoundId)
  const eta = (r: Restaurant) => selected ? r.prep_minutes + selected.est_travel_minutes : r.prep_minutes
  const catalogRestaurants = restaurants.filter(r =>
    r.order_mode !== 'custom_request' && r.vendor_type !== 'pharmacy' && r.vendor_type !== 'supermarket')
  const filtered = search.trim() ? compounds.filter(c => c.name.toLowerCase().includes(search.toLowerCase())) : []

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3">
        <h1 className="text-2xl font-bold shrink-0">🍽️ المطاعم</h1>
        <button className="btn-ghost text-sm shrink-0 max-w-[55%]" onClick={() => setPicking(true)}>
          <span className="flex items-center gap-1">
            <span className="shrink-0">📍</span>
            <span className="truncate">{selected ? selected.name : 'اختر مكانك'}</span>
          </span>
        </button>
      </div>

      {!picking && loading && <p className="text-mist">جاري التحميل…</p>}

      {!picking && !loading && compoundId && (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {catalogRestaurants.length === 0 && (
              <p className="text-mist col-span-full">لا يوجد مطاعم بتوصل لمكانك حاليًا</p>
            )}
            {catalogRestaurants.map(r => (
              <Link key={r.id} to={`/restaurant/${r.id}`} className="card p-4 hover:border-sea/50 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    {r.logo_url
                      ? <img src={r.logo_url} alt="" className="w-11 h-11 rounded-xl object-cover shrink-0 border border-line" />
                      : <div className="w-11 h-11 rounded-xl bg-shellup grid place-items-center shrink-0 text-lg font-bold text-mist">{r.name.charAt(0)}</div>}
                    <div className="min-w-0">
                      <h2 className="font-bold truncate">{r.name}</h2>
                      <p className="text-xs text-mist truncate">{r.category}</p>
                    </div>
                  </div>
                  <span className={r.is_open ? 'badge-open' : 'badge-closed'}>{r.is_open ? 'مفتوح' : 'مغلق'}</span>
                </div>
                <p className="text-sm text-mist mt-1.5 leading-relaxed">{r.description}</p>
                <div className="flex items-center gap-3 mt-3 text-sm text-mist">
                  <span className="text-sand">★ {r.rating}</span>
                  <span>{r.order_mode === 'pickup_request' ? '🛵 اطلب مندوب توصيل' : `⏱ ${eta(r)} دقيقة`}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {picking && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => selected && setPicking(false)}>
          <div className="card w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-1">فين مكانك؟</h3>
            <p className="text-sm text-mist mb-3">هنعرض بس المطاعم اللي بتوصل لمنطقتك</p>

            {locationError && <p className="text-xs text-sand mb-3 text-center">{locationError}</p>}

            {nearby && (
              <div className="mb-4">
                <p className="text-sm text-mist mb-2">أقرب الأماكن ليك</p>
                <div className="space-y-2">
                  {nearby.map(c => (
                    <button key={c.id} className={`w-full card !bg-night p-3 text-right border-sea/40 ${compoundId === c.id ? 'border-sea' : ''}`}
                      onClick={() => choose(c.id)}>
                      <span className="font-semibold block truncate">{c.name}</span>
                      <span className="text-mist text-xs block mt-0.5">~{c.est_travel_minutes} دقيقة توصيل</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 mb-4">
              <input className="field flex-1" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="🔍 دوّر على اسم المكان…" />
              <button className="btn-ghost !px-3.5 shrink-0" disabled={locating} onClick={useMyLocation}
                title="استخدم موقعي الحالي" aria-label="استخدم موقعي الحالي">
                {locating ? '…' : '📍'}
              </button>
            </div>

            {search.trim() && filtered.length === 0 && (
              <p className="text-sm text-mist text-center py-6">مفيش نتائج</p>
            )}

            <div className="space-y-2">
              {filtered.map(c => (
                <button key={c.id} className={`w-full card !bg-night p-3 text-right ${compoundId === c.id ? 'border-sea' : ''}`}
                  onClick={() => choose(c.id)}>
                  <span className="font-semibold block truncate">{c.name}</span>
                  <span className="text-mist text-xs block mt-0.5">~{c.est_travel_minutes} دقيقة توصيل</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
