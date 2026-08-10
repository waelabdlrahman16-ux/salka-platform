import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import MenuItemEditor from '../components/MenuItemEditor'
import AddMenuItemModal from '../components/AddMenuItemModal'
import AddonLibrary from '../components/AddonLibrary'
import MenuItemsPanel from '../components/MenuItemsPanel'
import Icon from '../components/Icon'
import { uploadVendorImage } from '../lib/upload'
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

  const [uploadingImage, setUploadingImage] = useState<string | null>(null)

  // Every one of these checks its error and surfaces it. The catalog role's
  // whole job is these numbers, and a save that fails silently means the price
  // on screen is not the price place_order will charge.
  async function updatePrice(it: MenuItem, price: number) {
    if (!Number.isFinite(price) || price < 0) return
    const { error } = await supabase.from('menu_items').update({ price }).eq('id', it.id)
    if (error) { setError(`تعديل سعر «${it.name}» فشل — ${error.message}`); return }
    setError('')
    load()
  }
  async function toggleItem(it: MenuItem) {
    const { error } = await supabase.from('menu_items').update({ available: !it.available }).eq('id', it.id)
    if (error) { setError(`تغيير إتاحة «${it.name}» فشل — ${error.message}`); return }
    setError('')
    load()
  }
  async function toggleRx(it: MenuItem) {
    const { error } = await supabase.from('menu_items')
      .update({ requires_prescription: !it.requires_prescription }).eq('id', it.id)
    if (error) { setError(`تغيير الروشتة فشل — ${error.message}`); return }
    setError('')
    load()
  }
  async function uploadItemImage(it: MenuItem, file: File) {
    setUploadingImage(`i${it.id}`); setError('')
    const { url, error } = await uploadVendorImage(file, `menu-items/${it.restaurant_id}/${it.id}`)
    setUploadingImage(null)
    if (error) { setError(error); return }
    if (!url) return
    const { error: upErr } = await supabase.from('menu_items').update({ image_url: url }).eq('id', it.id)
    if (upErr) { setError(`حفظ الصورة فشل — ${upErr.message}`); return }
    load()
  }

  const selected = restaurants.find(r => r.id === selectedId) ?? null
  const items = useMemo(
    () => menu.filter(i => i.restaurant_id === selectedId),
    [menu, selectedId]
  )
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
                onClick={() => setSelectedId(r.id)}>
                <div className="min-w-0">
                  <p className="font-bold truncate">{r.name}</p>
                  <p className="text-xs text-mist mt-0.5">
                    {r.vendor_type === 'pharmacy' ? 'صيدلية' : r.vendor_type === 'supermarket' ? 'سوبر ماركت' : 'مطعم'}
                    {' · '}{countFor(r.id)} صنف
                  </p>
                </div>
                {/* Same U+2039 bidi-mirroring bug as the chooser: the
                    character flips in an RTL paragraph and points backwards. */}
                <Icon name="chevronLeft" className="w-3 h-3 text-mist shrink-0" />
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
            <Icon name="chevronLeft" className="w-3 h-3 inline-block align-middle ml-1" />كل المطاعم
          </button>

          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-lg font-bold truncate">{selected.name}</h2>
            <button className="btn-sea !py-2 text-sm shrink-0" onClick={() => setAdding(selected)}>+ صنف جديد</button>
          </div>

          {/* Vendor-wide, so it sits above the item list rather than inside any
              one item's editor -- the whole point is that it is not per item. */}
          <AddonLibrary restaurantId={selected.id} items={items} />

          <MenuItemsPanel
            restaurant={selected}
            items={items}
            uploadingImage={uploadingImage}
            onEdit={setEditing}
            onTogglePrice={updatePrice}
            onToggleAvailable={toggleItem}
            onToggleRx={toggleRx}
            onUploadImage={uploadItemImage}
            onAddItem={() => setAdding(selected)}
            onChanged={load}
          />

        </>
      )}

      {editing && (
        <MenuItemEditor
          item={editing}
          canManageDiscounts={isAdmin}
          restaurantName={restaurants.find(r => r.id === editing.restaurant_id)?.name}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
          onDeleted={() => { setEditing(null); load() }}
        />
      )}

      {adding && (
        <AddMenuItemModal
          restaurant={adding}
          onClose={() => setAdding(null)}
          // The button says «حفظ وكمّل الخيارات», and AddMenuItemModal hands the
          // created row back so it can be honoured -- Admin does exactly this.
          // `onSaved={load}` dropped that argument, so on the catalog role's ONLY
          // screen the button saved, refetched, and went nowhere: back to
          // scrolling forty-six rows to find the item you just made and add its
          // sizes, which is the complaint the modal was rebuilt to answer.
          onSaved={(created) => {
            load()
            if (created) { setAdding(null); setEditing(created) }
          }}
        />
      )}
    </div>
  )
}
