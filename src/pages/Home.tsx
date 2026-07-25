import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Restaurant } from '../lib/types'

export default function Home() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('restaurants').select('*').order('rating', { ascending: false })
      .then(({ data }) => { setRestaurants(data ?? []); setLoading(false) })
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold mb-5">🍽️ توصيل المطاعم</h1>
      {loading && <p className="text-mist">جاري التحميل…</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {restaurants.map(r => (
          <Link key={r.id} to={`/restaurant/${r.id}`} className="card p-4 hover:border-sea/50 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-bold">{r.name}</h2>
              <span className={r.is_open ? 'badge-open' : 'badge-closed'}>{r.is_open ? 'مفتوح' : 'مغلق'}</span>
            </div>
            <p className="text-sm text-mist mt-1.5 leading-relaxed">{r.description}</p>
            <div className="flex items-center gap-3 mt-3 text-sm text-mist">
              <span className="text-sand">★ {r.rating}</span>
              <span>{r.vendor_type === 'supermarket' ? '🛒 فترات توصيل' : `⏱ ${r.prep_minutes} دقيقة`}</span>
              <span>{r.category}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
