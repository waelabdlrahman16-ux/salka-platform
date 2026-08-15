import { useEffect, useId, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Restaurant } from '../lib/types'

interface PickItem { id: number; name: string; price: number; image_url: string | null; category: string }

/**
 * Fills a link field without making the admin type or copy a URL.
 *
 * Two steps -- restaurant, then item -- because a flat item list across every
 * menu in the catalogue would be a wall of near-duplicate names ("برجر
 * دجاج" appears on half the vendors). Items render as a grid of thumbnails
 * grouped by category rather than a plain <select>, because a native
 * <option> cannot carry an image and this is picking a DISH: the photo is
 * often the only way to tell "برجر تشيكن" from "برجر تشيكن سبايسي" apart at a
 * glance, the same way a customer would on the menu itself.
 *
 * "لينك المطعم بس" stays reachable for ads that should land on the menu, not
 * one dish -- picking an item is the common case, not the only one.
 */
export default function LinkItemPicker({ restaurants, onPick }: {
  restaurants: Restaurant[]
  onPick: (url: string) => void
}) {
  const fid = useId()
  const [restaurantId, setRestaurantId] = useState('')
  const [items, setItems] = useState<PickItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsFailed, setItemsFailed] = useState(false)

  useEffect(() => {
    if (!restaurantId) { setItems([]); return }
    setItemsLoading(true); setItemsFailed(false)
    supabase.from('menu_items').select('id, name, price, image_url, category')
      .eq('restaurant_id', Number(restaurantId)).eq('available', true)
      .order('category').order('name')
      .then(({ data, error }) => {
        setItemsLoading(false)
        if (error) { setItemsFailed(true); return }
        setItems((data as PickItem[]) ?? [])
      })
  }, [restaurantId])

  const categories = [...new Set(items.map(it => it.category))]

  return (
    <div className="space-y-2">
      <select id={`${fid}-r`} className="field" value={restaurantId}
        onChange={e => setRestaurantId(e.target.value)}>
        <option value="">اختار مطعم…</option>
        {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>

      {restaurantId && (
        <button type="button" className="text-xs text-sea font-semibold"
          onClick={() => onPick(`/restaurant/${restaurantId}`)}>
          لينك المطعم بس، من غير صنف معيّن
        </button>
      )}

      {itemsLoading && <p className="text-xs text-mist">جاري تحميل القايمة…</p>}
      {itemsFailed && <p className="text-xs text-red-600">مش قادرين نجيب قايمة الأصناف — جرب تاني</p>}

      {!itemsLoading && !itemsFailed && items.length > 0 && (
        <div className="max-h-72 overflow-y-auto border border-line rounded-lg p-2.5 space-y-3">
          {categories.map(cat => (
            <div key={cat}>
              <p className="text-xs font-bold text-mist mb-1.5">{cat}</p>
              <div className="grid grid-cols-3 gap-2">
                {items.filter(it => it.category === cat).map(it => (
                  <button key={it.id} type="button"
                    onClick={() => onPick(`/restaurant/${restaurantId}?item=${it.id}`)}
                    className="text-right">
                    <div className="aspect-square rounded-lg overflow-hidden bg-shellup mb-1 grid place-items-center text-lg">
                      {it.image_url
                        ? <img src={it.image_url} alt="" className="w-full h-full object-cover" />
                        : '🍽️'}
                    </div>
                    <p className="text-[11px] font-semibold line-clamp-2 leading-snug">{it.name}</p>
                    <p className="text-[10px] text-mist">{it.price} ج.م</p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
