import { useEffect, useId, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/rpc'
import { isoToCairoLocalInput, cairoLocalInputToISO } from '../lib/cairoTime'
import { useSheets } from './ActionSheets'
import type { Restaurant } from '../lib/types'

interface FeaturedRow {
  id: number
  menu_item_id: number
  active: boolean
  sort: number
  starts_at: string | null
  ends_at: string | null
  menu_items: { id: number; name: string; price: number; image_url: string | null; restaurant_id: number } | null
}

interface PickItem { id: number; name: string; price: number }

/**
 * Individual dishes promoted into their own strip between restaurant cards
 * on Home -- a cross-restaurant "featured" shelf, distinct from a single
 * vendor's own menu order and from either ad rail. Picking is two steps
 * (restaurant, then item) because menu_items has no useful search surface of
 * its own here and the catalogue is large enough that a flat item picker
 * would be a wall of near-duplicate names across forty menus.
 */
export default function FeaturedProductsAdmin({ restaurants }: { restaurants: Restaurant[] }) {
  const fid = useId()
  const [rows, setRows] = useState<FeaturedRow[]>([])
  const { confirmSheet, sheetElement } = useSheets()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [pickRestaurant, setPickRestaurant] = useState('')
  const [pickItems, setPickItems] = useState<PickItem[]>([])
  const [pickItemId, setPickItemId] = useState('')
  const [itemsLoading, setItemsLoading] = useState(false)

  const [editing, setEditing] = useState<FeaturedRow | null>(null)
  const [editForm, setEditForm] = useState({ starts_at: '', ends_at: '' })

  async function load() {
    const { data, error } = await supabase.from('featured_products')
      .select('*, menu_items(id,name,price,image_url,restaurant_id)')
      .order('sort').order('id')
    setLoading(false)
    if (error) { setError(describeError(error.message)); return }
    setRows((data as FeaturedRow[]) ?? [])
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    setPickItemId('')
    if (!pickRestaurant) { setPickItems([]); return }
    setItemsLoading(true)
    supabase.from('menu_items').select('id,name,price')
      .eq('restaurant_id', Number(pickRestaurant)).eq('available', true)
      .order('name')
      .then(({ data, error }) => {
        setItemsLoading(false)
        if (error) { setError(describeError(error.message)); return }
        setPickItems((data as PickItem[]) ?? [])
      })
  }, [pickRestaurant])

  async function add() {
    if (!pickItemId) return
    setSaving(true); setError('')
    const { error } = await supabase.from('featured_products')
      .insert({ menu_item_id: Number(pickItemId), sort: rows.length + 1 })
    setSaving(false)
    if (error) {
      setError(error.code === '23505' ? 'الصنف ده متضاف بالفعل' : describeError(error.message))
      return
    }
    setPickItemId('')
    load()
  }

  async function toggle(r: FeaturedRow) {
    setError('')
    const { error } = await supabase.from('featured_products').update({ active: !r.active }).eq('id', r.id)
    if (error) { setError(describeError(error.message)); return }
    load()
  }

  async function move(r: FeaturedRow, dir: -1 | 1) {
    const i = rows.findIndex(x => x.id === r.id)
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    setError('')
    const a = rows[i], b = rows[j]
    const r1 = await supabase.from('featured_products').update({ sort: b.sort }).eq('id', a.id)
    if (r1.error) { setError(describeError(r1.error.message)); return }
    const r2 = await supabase.from('featured_products').update({ sort: a.sort }).eq('id', b.id)
    if (r2.error) { setError(describeError(r2.error.message)); load(); return }
    load()
  }

  async function remove(r: FeaturedRow) {
    if (!(await confirmSheet({ title: `شيل «${r.menu_items?.name ?? 'الصنف'}» من المميزة؟`, danger: true, confirmLabel: 'شيل' }))) return
    setError('')
    const { error } = await supabase.from('featured_products').delete().eq('id', r.id)
    if (error) { setError(describeError(error.message)); return }
    load()
  }

  function startSchedule(r: FeaturedRow) {
    setError('')
    setEditForm({ starts_at: isoToCairoLocalInput(r.starts_at), ends_at: isoToCairoLocalInput(r.ends_at) })
    setEditing(r)
  }

  async function saveSchedule() {
    if (!editing) return
    setSaving(true); setError('')
    const { error } = await supabase.from('featured_products').update({
      starts_at: cairoLocalInputToISO(editForm.starts_at),
      ends_at: cairoLocalInputToISO(editForm.ends_at),
    }).eq('id', editing.id)
    setSaving(false)
    if (error) { setError(describeError(error.message)); return }
    setEditing(null)
    load()
  }

  const scheduled = (r: FeaturedRow) => {
    const now = Date.now()
    if (r.starts_at && +new Date(r.starts_at) > now) return `مجدول من ${r.starts_at.slice(0, 10)}`
    if (r.ends_at && +new Date(r.ends_at) <= now) return 'منتهي'
    return null
  }

  if (loading) return <p className="text-mist">جاري التحميل…</p>

  return (
    <div className="space-y-3">
      {sheetElement}
      <p className="text-sm text-mist">بتظهر في شريط بين المطاعم في الصفحة الرئيسية.</p>

      {error && <p className="text-sm text-danger bg-dangerbg rounded-xl p-3">{error}</p>}

      <div className="card p-4 space-y-3">
        <h3 className="font-bold">ضيف صنف</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div><label className="label" htmlFor={`${fid}-r`}>المطعم</label>
            <select id={`${fid}-r`} className="field" value={pickRestaurant}
              onChange={e => setPickRestaurant(e.target.value)}>
              <option value="">اختار مطعم</option>
              {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select></div>
          <div><label className="label" htmlFor={`${fid}-i`}>الصنف</label>
            <select id={`${fid}-i`} className="field" value={pickItemId} disabled={!pickRestaurant || itemsLoading}
              onChange={e => setPickItemId(e.target.value)}>
              <option value="">{itemsLoading ? 'جاري التحميل…' : 'اختار صنف'}</option>
              {pickItems.map(it => <option key={it.id} value={it.id}>{it.name} · {it.price} ج.م</option>)}
            </select></div>
        </div>
        <button className="btn-sea !py-2 text-sm" onClick={add} disabled={!pickItemId || saving}>
          {saving ? 'جاري الإضافة…' : '+ ضيف للمميزة'}
        </button>
      </div>

      {editing && (
        <div className="card p-4 space-y-3">
          <h3 className="font-bold">مواعيد «{editing.menu_items?.name}»</h3>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label" htmlFor={`${fid}-from`}>يبدأ</label>
              <input id={`${fid}-from`} type="datetime-local" className="field" value={editForm.starts_at}
                onChange={e => setEditForm(f => ({ ...f, starts_at: e.target.value }))} /></div>
            <div><label className="label" htmlFor={`${fid}-to`}>ينتهي</label>
              <input id={`${fid}-to`} type="datetime-local" className="field" value={editForm.ends_at}
                onChange={e => setEditForm(f => ({ ...f, ends_at: e.target.value }))} /></div>
          </div>
          <p className="text-xs text-mist -mt-1">سيبهم فاضيين عشان يفضل شغال على طول.</p>
          <div className="flex gap-2">
            <button className="btn-ghost flex-1 text-sm" onClick={() => setEditing(null)} disabled={saving}>إلغاء</button>
            <button className="btn-sea flex-1 text-sm" onClick={saveSchedule} disabled={saving}>
              {saving ? 'جاري الحفظ…' : 'حفظ'}
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 && (
        <div className="card p-6 text-center text-mist">مفيش أصناف مميزة لسه</div>
      )}

      {rows.map((r, i) => {
        const note = scheduled(r)
        const restaurantName = restaurants.find(res => res.id === r.menu_items?.restaurant_id)?.name
        return (
          <div key={r.id} className="card p-3 flex items-center gap-3">
            <div className="w-11 h-11 rounded-lg overflow-hidden shrink-0 bg-shellup grid place-items-center text-xl">
              {r.menu_items?.image_url ? <img src={r.menu_items.image_url} alt="" className="w-full h-full object-cover" /> : '🍽️'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">{r.menu_items?.name ?? 'صنف محذوف'}</p>
              <p className="text-xs text-mist truncate">
                {restaurantName ?? ''}{r.menu_items ? ` · ${r.menu_items.price} ج.م` : ''}{note ? ` · ${note}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => move(r, -1)} disabled={i === 0} aria-label="فوق">▲</button>
              <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => move(r, 1)} disabled={i === rows.length - 1} aria-label="تحت">▼</button>
              <button className={`btn-ghost !py-1.5 !px-3 text-xs ${r.active ? '!text-sea' : '!text-mist'}`}
                onClick={() => toggle(r)}>{r.active ? 'شغّال' : 'موقوف'}</button>
              <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => startSchedule(r)}>مواعيد</button>
              <button className="btn-ghost !py-1.5 !px-2.5 text-xs !text-danger" onClick={() => remove(r)}>شيل</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
