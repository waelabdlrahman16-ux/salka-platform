import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useCatalogSync } from '../lib/useCatalogSync'
import { vendorOperation } from '../lib/vendorOperations'
import { uploadVendorImage } from '../lib/upload'
import AddMenuItemModal from './AddMenuItemModal'
import AddonLibrary from './AddonLibrary'
import MenuItemEditor from './MenuItemEditor'
import MenuItemsPanel from './MenuItemsPanel'
import type { MenuItem, Restaurant } from '../lib/types'

/**
 * The vendor-facing version of the catalog workspace.
 *
 * It never accepts a restaurant id from navigation or a picker: the parent
 * hands it the restaurant attached to the authenticated vendor profile. RLS
 * and the catalog Edge Function repeat that ownership check server-side.
 */
export default function VendorMenuManager({ restaurant, onClose }: {
  restaurant: Restaurant
  onClose: () => void
}) {
  const [items, setItems] = useState<MenuItem[]>([])
  const [editing, setEditing] = useState<MenuItem | null>(null)
  const [adding, setAdding] = useState(false)
  const [uploadingImage, setUploadingImage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    const { data, error: loadError } = await supabase.from('menu_items').select('*')
      .eq('restaurant_id', restaurant.id).order('category').order('name')
    if (loadError) {
      setError('مش قادرين نحمّل المنيو دلوقتي. جرب تاني')
      setLoading(false)
      return
    }
    setItems(data ?? [])
    setLoading(false)
  }, [restaurant.id])

  // load is redefined on every render, so listing it would re-run this effect
  // forever. The dependencies below are the values it actually reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [restaurant.id])
  useCatalogSync({ restaurantId: restaurant.id, refresh: load })

  async function updatePrice(item: MenuItem, price: number) {
    if (!Number.isFinite(price) || price <= 0) {
      setError('السعر لازم يكون رقم أكبر من صفر')
      return false
    }
    const { error: updateError } = await supabase.from('menu_items')
      .update({ price }).eq('id', item.id).eq('restaurant_id', restaurant.id)
      .select('id').single()
    if (updateError) {
      setError(`تعديل سعر «${item.name}» فشل: ${updateError.message}`)
      return false
    }
    setItems(current => current.map(row => row.id === item.id ? { ...row, price } : row))
    setError('')
    return true
  }

  async function toggleAvailable(item: MenuItem) {
    const result = await vendorOperation('setItemAvailability', {
      itemId: item.id,
      available: !item.available,
    })
    if (!result.ok) {
      setError(`تغيير إتاحة «${item.name}» فشل: ${result.error}`)
      return
    }
    setItems(current => current.map(row => row.id === item.id
      ? { ...row, available: !row.available }
      : row))
    setError('')
  }

  async function togglePrescription(item: MenuItem) {
    const { error: updateError } = await supabase.from('menu_items')
      .update({ requires_prescription: !item.requires_prescription })
      .eq('id', item.id).eq('restaurant_id', restaurant.id)
      .select('id').single()
    if (updateError) {
      setError(`تغيير الروشتة لـ «${item.name}» فشل: ${updateError.message}`)
      return
    }
    setItems(current => current.map(row => row.id === item.id
      ? { ...row, requires_prescription: !row.requires_prescription }
      : row))
    setError('')
  }

  async function uploadItemImage(item: MenuItem, file: File) {
    setUploadingImage(`i${item.id}`)
    setError('')
    const { url, error: uploadError } = await uploadVendorImage(
      file,
      `menu-items/${restaurant.id}/${item.id}`,
    )
    setUploadingImage(null)
    if (uploadError) { setError(uploadError); return }
    if (!url) return
    const { error: updateError } = await supabase.from('menu_items')
      .update({ image_url: url }).eq('id', item.id).eq('restaurant_id', restaurant.id)
      .select('id').single()
    if (updateError) {
      setError(`حفظ صورة «${item.name}» فشل: ${updateError.message}`)
      return
    }
    setItems(current => current.map(row => row.id === item.id ? { ...row, image_url: url } : row))
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">📋 إدارة المنيو</h1>
          <p className="text-xs text-mist mt-0.5 truncate">{restaurant.name} · {items.length} صنف</p>
        </div>
        <button className="btn-ghost !py-2 !px-3 text-sm shrink-0" onClick={onClose}>رجوع للطلبات</button>
      </div>

      {error && (
        <div className="card p-3 mb-3 border-red-400/50 bg-red-500/5 flex items-center justify-between gap-3" role="alert">
          <p className="text-sm text-red-700 font-semibold">{error}</p>
          <button className="btn-ghost !py-1.5 !px-3 text-xs shrink-0" onClick={load}>جرب تاني</button>
        </div>
      )}

      {loading ? (
        <p className="text-mist text-center py-10">جاري تحميل المنيو…</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 card p-3.5">
            <div>
              <p className="font-semibold text-sm">الأصناف والأسعار</p>
              <p className="text-xs text-mist mt-0.5">عدّل السعر، الصورة، الأقسام، الأحجام والإضافات</p>
            </div>
            <button className="btn-sea !py-2 !px-3 text-sm shrink-0" onClick={() => setAdding(true)}>+ صنف جديد</button>
          </div>

          <AddonLibrary restaurantId={restaurant.id} items={items} />

          <MenuItemsPanel
            restaurant={restaurant}
            items={items}
            uploadingImage={uploadingImage}
            onEdit={setEditing}
            onTogglePrice={updatePrice}
            onToggleAvailable={toggleAvailable}
            onToggleRx={togglePrescription}
            onUploadImage={uploadItemImage}
            onAddItem={() => setAdding(true)}
            onChanged={load}
          />
        </>
      )}

      {editing && (
        <MenuItemEditor
          item={editing}
          restaurantName={restaurant.name}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
          onDeleted={() => { setEditing(null); load() }}
        />
      )}

      {adding && (
        <AddMenuItemModal
          restaurant={restaurant}
          onClose={() => setAdding(false)}
          onSaved={created => {
            load()
            if (created) { setAdding(false); setEditing(created) }
          }}
        />
      )}
    </div>
  )
}
