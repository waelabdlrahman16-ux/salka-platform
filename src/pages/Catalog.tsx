import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import MenuItemEditor from '../components/MenuItemEditor'
import AddMenuItemModal from '../components/AddMenuItemModal'
import type { MenuItem, Restaurant } from '../lib/types'

// Catalogue-only workspace for the `catalog` staff role.
//
// Deliberately narrow: menus, prices, sizes, add-ons and item images across all
// vendors, and nothing else. No orders, no drivers, no earnings, no settings, no
// logins -- a catalog user has no RLS policy granting any of those, so they are
// default-denied at the database rather than merely hidden here. Discounts are
// admin-only for the same reason: they move margin.
export default function Catalog() {
  const { profile, signOut } = useAuth()
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editing, setEditing] = useState<MenuItem | null>(null)
  const [adding, setAdding] = useState<Restaurant | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const isAdmin = profile?.role === 'admin'

  async function load() {
    setError('')
    const [r, m] = await Promise.all([
      supabase.from('restaurants').select('*').eq('archived', false).order('name'),
      supabase.from('menu_items').select('*').order('category').order('name'),
    ])
    if (r.error || m.error) { setError('مش قادرين نحمّل القايمة دلوقتي، جرب تاني'); setLoading(false); return }
    setRestaurants(r.data ?? [])
    setMenu(m.data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const selected = restaurants.find(r => r.id === selectedId) ?? null
  const items = useMemo(
    () => menu.filter(i => i.restaurant_id === selectedId),
    [menu, selectedId]
  )
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(i =>
      i.name.toLowerCase().includes(q) || (i.category ?? '').toLowerCase().includes(q))
  }, [items, search])

  const categories = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const i of filtered) if (!seen.has(i.category)) { seen.add(i.category); out.push(i.category) }
    return out
  }, [filtered])

  const countFor = (rid: number) => menu.filter(i => i.restaurant_id === rid).length

  if (loading) return <p className="text-mist text-center py-10">جاري التحميل…</p>

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold truncate">🗂️ إدارة القوايم</h1>
          <p className="text-sm text-mist mt-0.5">{profile?.name}</p>
        </div>
        <button className="btn-ghost !py-1.5 !px-3 text-sm shrink-0" onClick={signOut}>خروج</button>
      </div>

      {error && (
        <div className="card p-3 mb-4 border-red-400/50 bg-red-500/5 flex items-center justify-between gap-3">
          <p className="text-sm text-red-700 font-semibold">{error}</p>
          <button className="btn-ghost !py-1.5 !px-3 text-xs shrink-0" onClick={load}>جرب تاني</button>
        </div>
      )}

      {!selected && (
        <>
          <p className="text-mist text-sm mb-3">اختار المطعم اللي عايز تظبط قايمته</p>
          <div className="space-y-2.5">
            {restaurants.map(r => (
              <button key={r.id}
                className="w-full card p-4 text-right hover:border-sea/50 transition-colors flex items-center justify-between gap-3"
                onClick={() => { setSelectedId(r.id); setSearch('') }}>
                <div className="min-w-0">
                  <p className="font-bold truncate">{r.name}</p>
                  <p className="text-xs text-mist mt-0.5">
                    {r.vendor_type === 'pharmacy' ? 'صيدلية' : r.vendor_type === 'supermarket' ? 'سوبر ماركت' : 'مطعم'}
                    {' · '}{countFor(r.id)} صنف
                  </p>
                </div>
                <span className="text-mist shrink-0" aria-hidden="true">‹</span>
              </button>
            ))}
            {restaurants.length === 0 && (
              <div className="card p-6 text-center text-mist">مفيش مطاعم متاحة</div>
            )}
          </div>
        </>
      )}

      {selected && (
        <>
          <button className="text-sm text-mist hover:text-foam mb-3" onClick={() => setSelectedId(null)}>
            ← كل المطاعم
          </button>

          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-lg font-bold truncate">{selected.name}</h2>
            <button className="btn-sea !py-2 text-sm shrink-0" onClick={() => setAdding(selected)}>+ صنف جديد</button>
          </div>

          <input className="field mb-4" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="دوّر باسم الصنف أو القسم…" />

          {filtered.length === 0 && (
            <div className="card p-6 text-center text-mist">
              {items.length === 0 ? 'القايمة فاضية — ابدأ بإضافة صنف' : 'مفيش أصناف بالبحث ده'}
            </div>
          )}

          {categories.map(cat => (
            <div key={cat} className="mb-5">
              <h3 className="font-bold text-mist text-sm mb-2">{cat}</h3>
              <div className="card divide-y divide-line">
                {filtered.filter(i => i.category === cat).map(i => (
                  <button key={i.id}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-right hover:bg-shellup/40 transition-colors"
                    onClick={() => setEditing(i)}>
                    <div className="min-w-0 flex items-center gap-3">
                      {i.image_url
                        ? <img src={i.image_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 border border-line" />
                        : <div className="w-10 h-10 rounded-lg bg-shellup grid place-items-center shrink-0 text-mist text-xs">—</div>}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{i.name}</p>
                        {!i.available && <p className="text-xs text-sandink mt-0.5">مش متاح دلوقتي</p>}
                      </div>
                    </div>
                    <span className="text-sm text-mist shrink-0">{i.price} ج.م</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {editing && (
        <MenuItemEditor
          item={editing}
          canManageDiscounts={isAdmin}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
          onDeleted={() => { setEditing(null); load() }}
        />
      )}

      {adding && (
        <AddMenuItemModal
          restaurant={adding}
          onClose={() => setAdding(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}
