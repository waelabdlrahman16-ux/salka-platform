import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Compound, Restaurant } from '../lib/types'

const STORAGE_KEY = 'talah_compound_id'

export default function Home() {
  const [compounds, setCompounds] = useState<Compound[]>([])
  const [compoundId, setCompoundId] = useState<number | null>(null)
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase.from('compounds').select('*').eq('active', true)
      .order('direction').order('distance_km')
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

  const selected = compounds.find(c => c.id === compoundId)
  const eta = (r: Restaurant) => selected ? r.prep_minutes + selected.est_travel_minutes : r.prep_minutes
  const catalogRestaurants = restaurants.filter(r =>
    r.order_mode !== 'custom_request' && r.vendor_type !== 'pharmacy' && r.vendor_type !== 'supermarket')
  const filtered = compounds.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
  const north = filtered.filter(c => c.direction === 'north')
  const south = filtered.filter(c => c.direction === 'south')

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3">
        <h1 className="text-2xl font-bold">🍽️ توصيل المطاعم</h1>
        <button className="btn-ghost text-sm shrink-0" onClick={() => setPicking(true)}>
          📍 {selected ? selected.name : 'اختر مكانك'}
        </button>
      </div>

      {!picking && loading && <p className="text-mist">جاري التحميل…</p>}

      {!picking && !loading && compoundId && (
        <div>
          <Link to="/custom-order"
            className="card p-4 mb-4 flex items-center gap-4 hover:border-sea/50 transition-colors">
            <span className="w-12 h-12 rounded-xl bg-sand/15 grid place-items-center text-2xl shrink-0">🧾</span>
            <div>
              <h2 className="font-bold">طلب خاص (صيدلية / سوبر ماركت)</h2>
              <p className="text-sm text-mist mt-0.5">اكتب اللي محتاجه، وهنقولك السعر بمكالمة</p>
            </div>
          </Link>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {catalogRestaurants.length === 0 && (
              <p className="text-mist col-span-full">لا يوجد مطاعم بتوصل لمكانك حاليًا</p>
            )}
            {catalogRestaurants.map(r => (
              <Link key={r.id} to={`/restaurant/${r.id}`} className="card p-4 hover:border-sea/50 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-bold">{r.name}</h2>
                  <span className={r.is_open ? 'badge-open' : 'badge-closed'}>{r.is_open ? 'مفتوح' : 'مغلق'}</span>
                </div>
                <p className="text-sm text-mist mt-1.5 leading-relaxed">{r.description}</p>
                <div className="flex items-center gap-3 mt-3 text-sm text-mist">
                  <span className="text-sand">★ {r.rating}</span>
                  <span>{r.order_mode === 'pickup_request' ? '🛵 اطلب مندوب توصيل' : `⏱ يوصلك خلال ${eta(r)} دقيقة`}</span>
                  <span>{r.category}</span>
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
            <input className="field mb-4" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="🔍 دوّر على اسم المكان…" autoFocus />

            {filtered.length === 0 && <p className="text-sm text-mist text-center py-6">مفيش نتائج</p>}

            {north.length > 0 && <p className="text-sm font-semibold text-mist mb-2">شمال (اتجاه القاهرة)</p>}
            <div className="space-y-2 mb-4">
              {north.map(c => (
                <button key={c.id} className={`w-full card !bg-night p-3 text-right ${compoundId === c.id ? 'border-sea' : ''}`}
                  onClick={() => choose(c.id)}>
                  <span className="font-semibold">{c.name}</span>
                  <span className="text-mist text-xs block mt-0.5">~{c.est_travel_minutes} دقيقة توصيل</span>
                </button>
              ))}
            </div>

            {south.length > 0 && <p className="text-sm font-semibold text-mist mb-2 mt-4">جنوب (اتجاه الزعفرانة)</p>}
            <div className="space-y-2">
              {south.map(c => (
                <button key={c.id} className={`w-full card !bg-night p-3 text-right ${compoundId === c.id ? 'border-sea' : ''}`}
                  onClick={() => choose(c.id)}>
                  <span className="font-semibold">{c.name}</span>
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
