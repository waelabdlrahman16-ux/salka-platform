import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon'
import { supabase } from '../lib/supabase'
import { adminCatalogAction } from '../lib/adminCatalogActions'
import DiscountManager from './DiscountManager'
import Toggle from './Toggle'
import { useSheets } from './ActionSheets'
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

/** Not a real category -- never sent to the server, never rename/delete-able,
 *  never a target for "add item here". Selecting it means "show me everything
 *  in one list, tagged by its real category" and nothing else. */
const ALL = '__ALL__'

export default function MenuItemsPanel({
  restaurant, items, uploadingImage,
  onEdit, onTogglePrice, onToggleAvailable, onToggleRx, onUploadImage, onAddItem, onChanged
}: {
  restaurant: Restaurant
  items: MenuItem[]
  uploadingImage: string | null
  onEdit: (it: MenuItem) => void
  onTogglePrice: (it: MenuItem, price: number) => Promise<boolean | void> | boolean | void
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
  const [savedNotice, setSavedNotice] = useState('')
  const [search, setSearch] = useState('')
  /** Categories other vendors already use, offered so «مقبلات» does not get
      retyped as «المقبلات» at the next restaurant. */
  const [otherCats, setOtherCats] = useState<string[]>([])
  /** Drag-to-reorder only touches real category tabs (never "الكل", which is
   *  never part of `tabs` and always rendered separately, pinned first). */
  const [reorderMode, setReorderMode] = useState(false)
  const [reorderBusy, setReorderBusy] = useState(false)
  const [dragCat, setDragCat] = useState<string | null>(null)
  const [dragOverCat, setDragOverCat] = useState<{ name: string; before: boolean } | null>(null)
  const { confirmSheet, promptSheet, sheetElement } = useSheets()

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
  // items.length, not items. The array is rebuilt on every parent render; only a
  // change in HOW MANY items exist should refetch their sizes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const current = active && (active === ALL || tabs.includes(active)) ? active : tabs[0] ?? null
  // A search spans EVERY category, not the open tab. Searching inside one tab
  // would answer "not here" for an item that is one tab over -- the same
  // confident-false-negative shape as filtering the loaded order window.
  const q = search.trim().toLowerCase()
  const shown = q
    ? items.filter(it => it.name.toLowerCase().includes(q) || (it.category ?? '').toLowerCase().includes(q))
    : current === ALL
      ? items
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
    const res = await adminCatalogAction('addMenuCategory',
      { restaurantId: restaurant.id, name: n },
      { category_exists: 'القسم ده موجود بالفعل', name_required: 'اكتب اسم القسم',
        not_authorized: 'مش من صلاحياتك' })
    setBusy(false)
    if (!res.ok) { setCatError(res.error); return }
    setNewCat(''); setAdding(false); setActive(n)
    await loadCats()
    onChanged()
  }

  async function renameCategory(oldName: string) {
    const next = await promptSheet({ title: 'الاسم الجديد للقسم', initial: oldName })
    if (!next || next.trim() === oldName) return
    const res = await adminCatalogAction('renameMenuCategory',
      { restaurantId: restaurant.id, oldName, newName: next.trim() },
      { category_exists: 'في قسم بالاسم ده بالفعل', not_authorized: 'مش من صلاحياتك' })
    if (!res.ok) { setCatError(res.error); return }
    setActive(next.trim())
    await loadCats()
    onChanged()
  }

  /** Sends the whole ordered name list every time, same shape the edge
   *  function already expects (admin_reorder_menu_categories(p_restaurant_id,
   *  p_names)) -- this action existed and was callable before today, just
   *  never had a UI in front of it. */
  async function commitReorder(next: Category[]) {
    if (reorderBusy) return
    setReorderBusy(true)
    setCats(next) // optimistic -- drag already showed this order, don't flicker back
    const res = await adminCatalogAction('reorderMenuCategories',
      { restaurantId: restaurant.id, names: next.map(c => c.name) },
      { not_authorized: 'مش من صلاحياتك' })
    if (!res.ok) { setCatError(res.error); await loadCats(); setReorderBusy(false); return }
    setReorderBusy(false)
    onChanged()
  }

  function moveCategory(name: string, direction: -1 | 1) {
    const from = cats.findIndex(c => c.name === name)
    const to = from + direction
    if (from < 0 || to < 0 || to >= cats.length) return
    const next = [...cats]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    void commitReorder(next)
  }

  function dropCategory(draggedName: string, targetName: string, before: boolean) {
    const from = cats.findIndex(c => c.name === draggedName)
    const to = cats.findIndex(c => c.name === targetName)
    if (from < 0 || to < 0 || draggedName === targetName) return
    const next = [...cats]
    const [moved] = next.splice(from, 1)
    const insertAt = next.findIndex(c => c.name === targetName)
    next.splice(before ? insertAt : insertAt + 1, 0, moved)
    commitReorder(next)
  }

  async function deleteCategory(name: string) {
    if (!await confirmSheet({ title: `حذف قسم «${name}»؟`, danger: true })) return
    const res = await adminCatalogAction('deleteMenuCategory',
      { restaurantId: restaurant.id, name },
      { not_authorized: 'مش من صلاحياتك' })
    // The server refuses while items still use it. It used to report exactly
    // how many, but that count no longer survives the trip through the edge
    // function's fixed error-code allowlist -- category_not_empty now carries
    // a generic Arabic message instead (see rpc.ts ERROR_AR).
    if (!res.ok) {
      setCatError(res.error)
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
          مش قادرين نحمّل الأقسام. جرب تاني.
        </p>
      )}
      {catError && (
        <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-2.5 mb-2" role="alert">{catError}</p>
      )}
      {savedNotice && (
        <p className="text-xs text-emerald-700 bg-emerald-500/10 rounded-xl p-2.5 mb-2" role="status">✓ {savedNotice}</p>
      )}

      <input className="field text-sm mb-2.5" value={search} onChange={e => setSearch(e.target.value)}
        placeholder="دوّر باسم الصنف أو القسم…" />

      {!q && (
        <div className="flex items-center justify-between mb-2">
          <span />
          <button onClick={() => setReorderMode(m => !m)}
            className={`text-xs font-semibold rounded-full px-3 py-1.5 flex items-center gap-1.5 ${
              reorderMode ? 'bg-ink text-white' : 'bg-shellup text-mist'}`}>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
              <circle cx="9" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" />
              <circle cx="15" cy="6" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="15" cy="18" r="1.6" />
            </svg>
            {reorderMode ? 'خلاص، تم' : 'ترتيب الأقسام'}
          </button>
        </div>
      )}
      {reorderMode && (
        <div className="rounded-xl border border-line bg-shellup p-2.5 mb-2">
          <p className="text-xs text-mist mb-2">غيّر الترتيب من الأسهم؛ السحب يفضل متاح على الكمبيوتر. «الكل» ثابت أول واحد.</p>
          <div className="flex flex-wrap gap-1.5">
            {cats.map((cat, index) => <div key={cat.id} className="flex items-center gap-1 rounded-lg bg-shell px-2 py-1 text-xs font-semibold">
              <button type="button" aria-label={`حرّك ${cat.name} يمين`} disabled={reorderBusy || index === 0} onClick={() => moveCategory(cat.name, -1)}>→</button>
              <span>{cat.name}</span>
              <button type="button" aria-label={`حرّك ${cat.name} شمال`} disabled={reorderBusy || index === cats.length - 1} onClick={() => moveCategory(cat.name, 1)}>←</button>
            </div>)}
          </div>
        </div>
      )}

      {/* Tabs. Horizontally scrollable rather than wrapped: a vendor with ten
          categories would otherwise push the first item three rows down.
          Dimmed while searching, because the results ignore them. */}
      <div className={`flex gap-1.5 overflow-x-auto pb-2.5 border-b border-line mb-3 -mx-1 px-1 ${q ? 'opacity-40' : ''}`}>
        {/* Not a real category: pinned first, never draggable, never part of
            `tabs`, so it can't collide with a real category name anyone types. */}
        <button onClick={() => !reorderMode && setActive(ALL)}
          className={`shrink-0 rounded-full border-2 px-3.5 min-h-[34px] text-xs font-semibold transition-colors ${
            current === ALL ? 'bg-ink border-ink text-white' : 'bg-shell border-ink text-foam'}`}>
          الكل
          <span className={`font-normal ${current === ALL ? 'text-white/70' : 'text-mist'}`}> {items.length}</span>
        </button>
        {tabs.map(c => {
          const isRealCat = cats.some(cat => cat.name === c)
          const draggable = reorderMode && isRealCat
          return (
            <button key={c} draggable={draggable}
              onClick={() => !reorderMode && setActive(c)}
              onDragStart={() => setDragCat(c)}
              onDragEnd={() => { setDragCat(null); setDragOverCat(null) }}
              onDragOver={e => {
                if (!draggable) return
                e.preventDefault()
                const rect = e.currentTarget.getBoundingClientRect()
                const before = e.clientX - rect.left > rect.width / 2 // RTL: right half = before
                setDragOverCat({ name: c, before })
              }}
              onDrop={e => {
                if (!draggable || !dragCat) return
                e.preventDefault()
                const rect = e.currentTarget.getBoundingClientRect()
                const before = e.clientX - rect.left > rect.width / 2
                dropCategory(dragCat, c, before)
                setDragCat(null); setDragOverCat(null)
              }}
              style={
                dragOverCat?.name === c
                  ? { boxShadow: `inset ${dragOverCat.before ? '3px' : '-3px'} 0 0 #0A5F5E` }
                  : undefined
              }
              className={`shrink-0 rounded-full border px-3.5 min-h-[34px] text-xs font-semibold transition-colors ${
                current === c ? 'bg-sea border-sea text-white' : 'bg-shell border-line text-foam'}
                ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}
                ${dragCat === c ? 'opacity-40' : ''}`}>
              {draggable && (
                <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" className="inline ml-1 opacity-50" aria-hidden="true">
                  <circle cx="9" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" />
                  <circle cx="15" cy="6" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="15" cy="18" r="1.6" />
                </svg>
              )}
              {c}
              <span className={`font-normal ${current === c ? 'text-white/70' : 'text-mist'}`}> {counts[c] ?? 0}</span>
            </button>
          )
        })}
        {!reorderMode && (
          <button onClick={() => { setAdding(true); setCatError('') }}
            className="shrink-0 rounded-full border border-dashed border-linestrong bg-shell px-3.5 min-h-[34px] text-xs font-semibold text-sea">
            ＋ قسم
          </button>
        )}
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
              <Icon name="warning" className="w-4 h-4 inline-block align-[-0.15em] me-1" />في قسم اسمه «{dupWarning}» عندك:{' '}
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

      {current && current !== ALL && (
        <div className="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
          <div className="flex items-center gap-2 text-xs">
            <button className="text-mist underline min-h-[44px] inline-flex items-center" onClick={() => renameCategory(current)}>تغيير الاسم</button>
            <button className="text-red-600 underline min-h-[44px] inline-flex items-center" onClick={() => deleteCategory(current)}>حذف القسم</button>
          </div>
          <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={onAddItem}>+ صنف هنا</button>
        </div>
      )}
      {current === ALL && (
        <p className="text-xs text-mist mb-2.5">افتح قسم بعينه عشان تضيف صنف فيه، «الكل» بس للعرض والتعديل</p>
      )}

      {/* The category discount belongs beside its category, not in a separate
          block that listed all seven with an empty «إضافة خصم» under each. */}
      {current && current !== ALL && (
        <div className="mb-3">
          <DiscountManager restaurantId={restaurant.id} scope="category" category={current} />
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-mist text-center text-sm py-6">
          {q ? 'مفيش أصناف بالبحث ده'
             : current === ALL ? 'المطعم ده لسه من غير أصناف'
             : current ? 'القسم ده لسه فاضي. ضيف أول صنف'
             : 'مفيش أصناف'}
        </p>
      ) : (
        <div className="space-y-2">
          {shown.map(it => {
            const sz = sizes[it.id]
            return (
              <div key={it.id} className="flex items-center gap-2.5 bg-night border border-line rounded-xl p-2.5 hover:border-sea/40 transition-colors">
                {/* Availability first: it is what changes most in a working day,
                    and as «✓ متاح» text nobody could tell it was a control.
                    Kept OUTSIDE the dimmed wrapper so an unavailable row still
                    shows, at full opacity, the control that re-enables it. */}
                <Toggle on={it.available} onChange={() => onToggleAvailable(it)} ariaLabel={it.name} />

                <div className={`flex items-center gap-2.5 flex-1 min-w-0 ${it.available ? '' : 'opacity-55'}`}>
                  {/* The photo is changed by tapping the photo. */}
                  <label className="relative shrink-0 cursor-pointer" aria-label="صورة الصنف">
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                      onChange={e => e.target.files?.[0] && onUploadImage(it, e.target.files[0])} />
                    {it.image_url
                      ? <img src={it.image_url} alt="" className="w-11 h-11 rounded-lg object-cover border border-line" />
                      : <span className="w-11 h-11 rounded-lg border border-dashed border-linestrong bg-shellup grid place-items-center text-mist text-lg">＋</span>}
                    <span className="absolute -bottom-1 -left-1 w-[18px] h-[18px] rounded-full bg-sea text-white grid place-items-center border-2 border-night">
                      {uploadingImage === `i${it.id}` ? <span className="text-[9px]">…</span> : (
                        <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                          <circle cx="12" cy="13" r="4" />
                        </svg>
                      )}
                    </span>
                  </label>

                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate" title={it.name}>{it.name}</p>
                    {(current === ALL || sz || !it.image_url || (it.available_from && it.available_until)) && (
                      <p className="text-[11px] text-mist truncate">
                        {/* The one thing "الكل" needs that a single-category view
                            doesn't: which real category this item actually lives in. */}
                        {current === ALL && (
                          <span className="bg-shellup rounded px-1 py-px font-semibold text-foam">{it.category}</span>
                        )}
                        {(current === ALL && (sz || !it.image_url)) ? ' · ' : ''}
                        {sz ? `${sz.count} أحجام` : !it.image_url ? 'من غير صورة' : ''}
                        {it.available_from && it.available_until && (
                          <>
                            {(current === ALL || sz || !it.image_url) ? ' · ' : ''}
                            {'⏰ '}
                            <bdi dir="ltr">{it.available_from.slice(0, 5)}–{it.available_until.slice(0, 5)}</bdi>
                          </>
                        )}
                      </p>
                    )}
                  </div>

                  {/* One w-24 cell for both pricing kinds, so prices line up in
                      a column whatever mix of flat and sized items a tab has. */}
                  {sz ? (
                    // No editable box: this number is not what the customer pays.
                    <button onClick={() => onEdit(it)}
                      className="w-24 shrink-0 text-center text-xs font-semibold text-sandink bg-sandink/10 rounded-xl py-2 whitespace-nowrap">
                      من {sz.min}
                    </button>
                  ) : (
                    <input type="number" inputMode="numeric" defaultValue={it.price}
                      aria-label={`سعر ${it.name} بالجنيه`}
                      className={`field !w-24 shrink-0 !py-2 !px-2 text-center text-sm ${savedPrice === it.id ? '!border-emerald-600 bg-emerald-50' : ''}`}
                      onBlur={async e => {
                        const v = Number(e.target.value)
                        if (v === Number(it.price)) return
                        const saved = await onTogglePrice(it, v)
                        if (saved === false) {
                          e.target.value = String(it.price)
                          return
                        }
                        setSavedPrice(it.id)
                        setSavedNotice(`اتحفظ سعر «${it.name}»`)
                        setTimeout(() => setSavedPrice(p => (p === it.id ? null : p)), 1800)
                        setTimeout(() => setSavedNotice(''), 1800)
                      }}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                  )}

                  {restaurant.vendor_type === 'pharmacy' && (
                    <button onClick={() => onToggleRx(it)} title="روشتة"
                      aria-pressed={it.requires_prescription} aria-label="محتاج وصفة"
                      className={`shrink-0 w-10 h-10 rounded-lg grid place-items-center transition-colors ${
                        it.requires_prescription ? 'bg-sandink/15 text-sandink' : 'bg-shellup text-mist'}`}>
                      <svg viewBox="0 0 24 24" className="w-[17px] h-[17px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M10.5 20.5a5 5 0 0 1-7-7l10-10a5 5 0 0 1 7 7l-10 10z" />
                        <path d="M8.5 8.5l7 7" />
                      </svg>
                    </button>
                  )}

                  <button onClick={() => onEdit(it)} aria-label="تعديل الصنف"
                    className="shrink-0 w-10 h-10 rounded-lg bg-shellup border border-line grid place-items-center">
                    <svg viewBox="0 0 24 24" className="w-[17px] h-[17px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {sheetElement}
    </div>
  )
}
