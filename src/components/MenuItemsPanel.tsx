import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rpc } from '../lib/rpc'
import DiscountManager from './DiscountManager'
import type { MenuItem, Restaurant } from '../lib/types'

/**
 * The item list for one vendor.
 *
 * It was a flat scroll of every item, each two rows tall, with the category
 * repeated on all 76 of them and the two things anyone actually changes -- the
 * price and whether it is available -- rendered as text links among four other
 * text links. Finding one item meant reading past 151 lines you did not want.
 *
 * Now: categories are tabs, and an item is one row.
 */

type Category = { id: number; name: string; display_order: number }
/** How many available sizes an item has, and the cheapest of them. */
type SizeInfo = { count: number; min: number }

export default function MenuItemsPanel({
  restaurant, items, uploadingImage,
  onEdit, onTogglePrice, onToggleAvailable, onToggleRx, onUploadImage, onAddItem, onChanged
}: {
  restaurant: Restaurant
  items: MenuItem[]
  uploadingImage: string | null
  onEdit: (it: MenuItem) => void
  onTogglePrice: (it: MenuItem, price: number) => void
  onToggleAvailable: (it: MenuItem) => void
  onToggleRx: (it: MenuItem) => void
  onUploadImage: (it: MenuItem, f: File) => void
  onAddItem: () => void
  onChanged: () => void
}) {
  const [cats, setCats] = useState<Category[]>([])
  const [sizes, setSizes] = useState<Record<number, SizeInfo>>({})
  const [active, setActive] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [catError, setCatError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [savedPrice, setSavedPrice] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  /** Categories other vendors already use, offered so «مقبلات» does not get
      retyped as «المقبلات» at the next restaurant. */
  const [otherCats, setOtherCats] = useState<string[]>([])

  async function loadCats() {
    const [{ data, error }, { data: others }] = await Promise.all([
      supabase.from('menu_categories').select('*')
        .eq('restaurant_id', restaurant.id).order('display_order').order('id'),
      supabase.from('menu_categories').select('name').neq('restaurant_id', restaurant.id),
    ])
    // Say it failed rather than rendering an empty tab strip, which reads as
    // "this vendor has no categories" for a menu that plainly has items.
    if (error) { setLoadFailed(true); return }
    setLoadFailed(false)
    setCats((data ?? []) as Category[])
    setOtherCats([...new Set(((others ?? []) as { name: string }[]).map(o => o.name))])
  }

  useEffect(() => {
    loadCats()
    // Which items are priced by size. A sized item's menu_items.price is never
    // charged -- place_order raises size_required -- so showing an editable
    // price box for it invites someone to change a number that does nothing,
    // which is how «٦ وينجز» advertised 190 while costing 300.
    const ids = items.map(i => i.id)
    if (!ids.length) { setSizes({}); return }
    supabase.from('menu_item_sizes').select('menu_item_id, price')
      .in('menu_item_id', ids).eq('available', true)
      .then(({ data, error }) => {
        if (error) return
        const m: Record<number, SizeInfo> = {}
        for (const r of (data ?? []) as { menu_item_id: number; price: number }[]) {
          const cur = m[r.menu_item_id]
          m[r.menu_item_id] = cur
            ? { count: cur.count + 1, min: Math.min(cur.min, Number(r.price)) }
            : { count: 1, min: Number(r.price) }
        }
        setSizes(m)
      })
  }, [restaurant.id, items.length])

  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const it of items) m[it.category] = (m[it.category] ?? 0) + 1
    return m
  }, [items])

  // A category with no row yet (an item saved before the table existed) still
  // gets a tab, so nothing can become unreachable.
  const tabs = useMemo(() => {
    const named = cats.map(c => c.name)
    const strays = [...new Set(items.map(i => i.category))].filter(c => c && !named.some(n => n.trim().toLowerCase() === c.trim().toLowerCase()))
    return [...named, ...strays]
  }, [cats, items])

  const current = active && tabs.includes(active) ? active : tabs[0] ?? null
  // A search spans EVERY category, not the open tab. Searching inside one tab
  // would answer "not here" for an item that is one tab over -- the same
  // confident-false-negative shape as filtering the loaded order window.
  const q = search.trim().toLowerCase()
  const shown = q
    ? items.filter(it => it.name.toLowerCase().includes(q) || (it.category ?? '').toLowerCase().includes(q))
    : items.filter(it => it.category === current)

  const dupWarning = useMemo(() => {
    const q = newCat.trim().toLowerCase()
    if (q.length < 2) return null
    const near = tabs.find(t => {
      const n = t.trim().toLowerCase()
      return n !== q && (n.startsWith(q) || q.startsWith(n))
    })
    return near ?? null
  }, [newCat, tabs])

  async function addCategory(name: string) {
    const n = name.trim()
    if (!n) return
    setBusy(true); setCatError('')
    const res = await rpc('admin_add_menu_category',
      { p_restaurant_id: restaurant.id, p_name: n },
      { category_exists: 'القسم ده موجود بالفعل', name_required: 'اكتب اسم القسم',
        not_authorized: 'مش من صلاحياتك' })
    setBusy(false)
    if (!res.ok) { setCatError(res.error); return }
    setNewCat(''); setAdding(false); setActive(n)
    await loadCats()
    onChanged()
  }

  async function renameCategory(oldName: string) {
    const next = prompt('الاسم الجديد للقسم', oldName)
    if (!next || next.trim() === oldName) return
    const res = await rpc('admin_rename_menu_category',
      { p_restaurant_id: restaurant.id, p_old: oldName, p_new: next.trim() },
      { category_exists: 'في قسم بالاسم ده بالفعل', not_authorized: 'مش من صلاحياتك' })
    if (!res.ok) { setCatError(res.error); return }
    setActive(next.trim())
    await loadCats()
    onChanged()
  }

  async function deleteCategory(name: string) {
    if (!confirm(`حذف قسم «${name}»؟`)) return
    const res = await rpc('admin_delete_menu_category',
      { p_restaurant_id: restaurant.id, p_name: name },
      { not_authorized: 'مش من صلاحياتك' })
    // The server refuses while items still use it and says how many, rather
    // than orphaning them out of every tab.
    if (!res.ok) {
      const m = /category_not_empty:(\d+)/.exec(res.error)
      setCatError(m ? `فيه ${m[1]} صنف في القسم ده — انقلهم أو احذفهم الأول` : res.error)
      return
    }
    setActive(null)
    await loadCats()
    onChanged()
  }

  return (
    <div className="mt-4">
      {loadFailed && (
        <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-2.5 mb-2" role="alert">
          مش قادرين نحمّل الأقسام — جرب تاني.
        </p>
      )}
      {catError && (
        <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-2.5 mb-2" role="alert">{catError}</p>
      )}

      <input className="field text-sm mb-2.5" value={search} onChange={e => setSearch(e.target.value)}
        placeholder="دوّر باسم الصنف أو القسم…" />

      {/* Tabs. Horizontally scrollable rather than wrapped: a vendor with ten
          categories would otherwise push the first item three rows down.
          Dimmed while searching, because the results ignore them. */}
      <div className={`flex gap-1.5 overflow-x-auto pb-2.5 border-b border-line mb-3 -mx-1 px-1 ${q ? 'opacity-40' : ''}`}>
        {tabs.map(c => (
          <button key={c} onClick={() => setActive(c)}
            className={`shrink-0 rounded-full border px-3.5 min-h-[34px] text-xs font-semibold transition-colors ${
              current === c ? 'bg-sea border-sea text-white' : 'bg-shell border-line text-foam'}`}>
            {c}
            <span className={`font-normal ${current === c ? 'text-white/70' : 'text-mist'}`}> {counts[c] ?? 0}</span>
          </button>
        ))}
        <button onClick={() => { setAdding(true); setCatError('') }}
          className="shrink-0 rounded-full border border-dashed border-linestrong bg-shell px-3.5 min-h-[34px] text-xs font-semibold text-sea">
          ＋ قسم
        </button>
      </div>

      {adding && (
        <div className="card p-3.5 mb-3 space-y-2">
          <p className="font-semibold text-sm">قسم جديد</p>
          <input className="field text-sm" autoFocus placeholder="اسم القسم (مقبلات، حلويات…)"
            value={newCat} onChange={e => setNewCat(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addCategory(newCat) }} />
          {/* 61 categories exist across 11 vendors, several of them near-misses
              of each other. This is where that stops. */}
          {dupWarning && (
            <p className="text-xs text-sandink bg-sandink/10 rounded-lg p-2">
              ⚠️ في قسم اسمه «{dupWarning}» عندك —{' '}
              <button className="underline font-semibold" onClick={() => { setActive(dupWarning); setAdding(false); setNewCat('') }}>
                استخدمه
              </button>
            </p>
          )}
          {otherCats.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {otherCats.filter(c => !tabs.includes(c)).slice(0, 6).map(c => (
                <button key={c} className="text-xs border border-line rounded-lg px-2.5 py-1.5 bg-night"
                  onClick={() => addCategory(c)}>{c}</button>
              ))}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button className="btn-ghost flex-1 !py-2 text-sm" onClick={() => { setAdding(false); setNewCat(''); setCatError('') }}>إلغاء</button>
            <button className="btn-sea flex-1 !py-2 text-sm" disabled={busy || !newCat.trim()}
              onClick={() => addCategory(newCat)}>{busy ? 'لحظة…' : 'أضف القسم'}</button>
          </div>
        </div>
      )}

      {current && (
        <div className="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
          <div className="flex items-center gap-2 text-xs">
            <button className="text-mist underline" onClick={() => renameCategory(current)}>تغيير الاسم</button>
            <button className="text-mist underline" onClick={() => deleteCategory(current)}>حذف القسم</button>
          </div>
          <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={onAddItem}>+ صنف هنا</button>
        </div>
      )}

      {/* The category discount belongs beside its category, not in a separate
          block that listed all seven with an empty «إضافة خصم» under each. */}
      {current && (
        <div className="mb-3">
          <DiscountManager restaurantId={restaurant.id} scope="category" category={current} />
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-mist text-center text-sm py-6">
          {q ? 'مفيش أصناف بالبحث ده'
             : current ? 'القسم ده لسه فاضي — ضيف أول صنف'
             : 'مفيش أصناف'}
        </p>
      ) : (
        <div className="space-y-2">
          {shown.map(it => {
            const sz = sizes[it.id]
            return (
              <div key={it.id} className="flex items-center gap-2.5 bg-night border border-line rounded-xl p-2.5">
                {/* Availability first: it is what changes most in a working day,
                    and as «✓ متاح» text nobody could tell it was a control. */}
                <button onClick={() => onToggleAvailable(it)} aria-label={it.available ? 'إيقاف الصنف' : 'تفعيل الصنف'}
                  className={`relative w-10 h-6 rounded-full shrink-0 transition-colors ${it.available ? 'bg-emerald-600' : 'bg-line'}`}>
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${it.available ? 'left-1' : 'right-1'}`} />
                </button>

                {/* The photo is changed by tapping the photo. */}
                <label className="relative shrink-0 cursor-pointer">
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                    onChange={e => e.target.files?.[0] && onUploadImage(it, e.target.files[0])} />
                  {it.image_url
                    ? <img src={it.image_url} alt="" className="w-11 h-11 rounded-lg object-cover border border-line" />
                    : <span className="w-11 h-11 rounded-lg border border-dashed border-linestrong bg-shellup grid place-items-center text-mist text-lg">＋</span>}
                  <span className="absolute -bottom-1 -left-1 w-[18px] h-[18px] rounded-full bg-sea text-white grid place-items-center text-[9px] border-2 border-night">
                    {uploadingImage === `i${it.id}` ? '…' : '📷'}
                  </span>
                </label>

                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate">{it.name}</p>
                  {(sz || !it.image_url || (it.available_from && it.available_until)) && (
                    <p className="text-[11px] text-mist truncate">
                      {sz ? `${sz.count} أحجام` : !it.image_url ? 'من غير صورة' : ''}
                      {it.available_from && it.available_until
                        ? `${sz || !it.image_url ? ' · ' : ''}⏰ ${it.available_from.slice(0,5)}–${it.available_until.slice(0,5)}` : ''}
                    </p>
                  )}
                </div>

                {sz ? (
                  // No editable box: this number is not what the customer pays.
                  <button onClick={() => onEdit(it)}
                    className="shrink-0 text-xs font-semibold text-sandink bg-sandink/10 rounded-lg px-2.5 py-2 whitespace-nowrap">
                    من {sz.min}
                  </button>
                ) : (
                  <div className="flex items-center gap-1 shrink-0">
                    <input type="number" inputMode="numeric" defaultValue={it.price}
                      aria-label={`سعر ${it.name}`}
                      className={`field !w-[68px] !py-1.5 !px-2 text-center text-sm ${savedPrice === it.id ? '!border-emerald-600 bg-emerald-50' : ''}`}
                      onBlur={e => {
                        const v = Number(e.target.value)
                        if (v === Number(it.price)) return
                        onTogglePrice(it, v)
                        setSavedPrice(it.id)
                        setTimeout(() => setSavedPrice(p => (p === it.id ? null : p)), 1800)
                      }}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                    <span className="text-[10px] text-mist">ج.م</span>
                  </div>
                )}

                {restaurant.vendor_type === 'pharmacy' && (
                  <button onClick={() => onToggleRx(it)} title="روشتة"
                    className={`shrink-0 text-sm ${it.requires_prescription ? 'text-sandink' : 'text-line'}`}>💊</button>
                )}

                <button onClick={() => onEdit(it)} aria-label="تعديل الصنف"
                  className="shrink-0 w-8 h-8 rounded-lg bg-shellup border border-line grid place-items-center text-sm">
                  ✏️
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
