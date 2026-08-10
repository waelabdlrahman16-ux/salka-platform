import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { uploadVendorImage } from '../lib/upload'
import { catalogCheck } from '../lib/catalogChecks'
import type { MenuItem, VendorAddonLibraryItem } from '../lib/types'
import { useSheets } from './ActionSheets'

/**
 * Define an add-on once per vendor, then attach it to a whole category at once.
 *
 * "Tomato, this photo, 5 ج.م" is the same fact on forty sandwiches, and it was
 * being retyped forty times -- forty chances to upload a different photo, spell
 * it differently, or price it at 500 by dropping a zero.
 *
 * Attaching COPIES the entry onto each item. That is deliberate: the price is
 * meant to diverge (tomato costs less on a chicken sandwich than on a burger),
 * so the library is a starting value, not a live link. Editing a library price
 * later does not reach back into items already using it, and the UI says so --
 * a silent live link would re-price dozens of items from a screen that shows
 * none of them.
 */
export default function AddonLibrary({ restaurantId, items }: {
  restaurantId: number
  items: MenuItem[]
}) {
  const [lib, setLib] = useState<VendorAddonLibraryItem[]>([])
  const { confirmSheet, sheetElement } = useSheets()
  const [draft, setDraft] = useState({ name: '', price: '', imageUrl: null as string | null })
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [applying, setApplying] = useState<VendorAddonLibraryItem | null>(null)
  const [targetCat, setTargetCat] = useState('')
  const [groupName, setGroupName] = useState('إضافات')
  const [advanced, setAdvanced] = useState(false)

  const categories = Array.from(new Set(items.map(i => i.category).filter(Boolean)))

  async function load() {
    const { data, error: err } = await supabase.from('vendor_addon_library')
      .select('*').eq('restaurant_id', restaurantId).order('name')
    if (err) { setError('مش قادرين نحمّل المكتبة'); return }
    setLib((data as VendorAddonLibraryItem[]) ?? [])
  }
  useEffect(() => { load(); setApplying(null); setNotice('') /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [restaurantId])

  async function uploadImage(file: File) {
    setUploading(true)
    const { url } = await uploadVendorImage(file, `addon-library/${restaurantId}/${Date.now()}`)
    setUploading(false)
    if (url) setDraft(d => ({ ...d, imageUrl: url }))
  }

  async function add() {
    if (!draft.name.trim()) return
    setBusy(true); setError('')
    const { error: err } = await supabase.from('vendor_addon_library').insert({
      restaurant_id: restaurantId, name: draft.name.trim(),
      price: Number(draft.price) || 0, image_url: draft.imageUrl
    })
    setBusy(false)
    // The unique(restaurant_id, name) constraint is the point, not an accident:
    // two tomatoes in the library is how you end up with two tomatoes on a menu.
    if (err) { setError(err.message.includes('duplicate') ? 'الاسم ده موجود بالفعل في المكتبة' : 'حصل خطأ، جرب تاني'); return }
    setDraft({ name: '', price: '', imageUrl: null })
    load()
  }

  async function updatePrice(id: number, value: string) {
    const n = Number(value)
    if (!value.trim() || Number.isNaN(n) || n < 0) return
    await supabase.from('vendor_addon_library').update({ price: n }).eq('id', id)
    load()
  }

  async function remove(id: number) {
    if (!(await confirmSheet({ title: 'حذف من المكتبة؟', body: 'الأصناف اللي مستخدماها مش هتتأثر.', danger: true, confirmLabel: 'احذف' }))) return
    await supabase.from('vendor_addon_library').delete().eq('id', id)
    load()
  }

  async function applyToCategory() {
    if (!applying) return
    const targets = items.filter(i => !targetCat || i.category === targetCat)
    if (!targets.length) { setError('مفيش أصناف في القسم ده'); return }
    setBusy(true); setError(''); setNotice('')
    const res = await catalogCheck<number>('applyLibraryAddon', {
      libraryId: applying.id,
      itemIds: targets.map(i => i.id),
      groupName: groupName.trim() || 'إضافات'
    })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    const n = Number(res.data) || 0
    setNotice(n === 0
      ? `"${applying.name}" موجود بالفعل على كل الأصناف دي`
      : `تمام — "${applying.name}" اتضاف لـ ${n} صنف`)
    setApplying(null)
  }

  return (
    <div className="card p-4 mb-4">
      {sheetElement}
      <p className="font-bold text-sm mb-1">مكتبة الإضافات</p>
      <p className="text-xs text-mist mb-3">اكتبها مرة واحدة، وضيفها لقسم كامل بضغطة.</p>

      {lib.length > 0 && (
        <div className="space-y-2 mb-3">
          {lib.map(l => (
            <div key={l.id} className="flex items-center gap-2.5 bg-night border border-line rounded-lg p-2.5 text-sm">
              {l.image_url
                ? <img src={l.image_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                : <div className="w-10 h-10 rounded-lg bg-shellup shrink-0" />}
              <span className="flex-1 min-w-0 truncate">{l.name}</span>
              <input className="field !py-1 !w-16 !text-sm text-center" type="number" inputMode="numeric"
                defaultValue={String(l.price)} aria-label={`سعر ${l.name}`}
                onBlur={e => { if (Number(e.target.value) !== Number(l.price)) updatePrice(l.id, e.target.value) }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
              <button className="btn-ghost !py-1 !px-2.5 text-xs shrink-0" onClick={() => { setApplying(l); setTargetCat(categories[0] ?? '') }}>
                ضيفه لقسم
              </button>
              <button className="text-red-500 text-xs shrink-0" onClick={() => remove(l.id)}>حذف</button>
            </div>
          ))}
        </div>
      )}

      {applying && (
        <div className="bg-shellup/60 rounded-xl p-3 mb-3">
          <p className="text-xs font-semibold mb-2">ضيف "{applying.name}" لـ:</p>
          <select className="field !py-1.5 text-sm mb-2" value={targetCat} onChange={e => setTargetCat(e.target.value)}>
            <option value="">كل الأصناف ({items.length})</option>
            {categories.map(c => (
              <option key={c} value={c}>{c} ({items.filter(i => i.category === c).length} صنف)</option>
            ))}
          </select>
          {/* "إضافات" is right almost always. Asking for it every time is a
              question with a known answer standing between the vendor and the
              thing they came to do. */}
          {advanced ? (
            <div className="mb-2">
              <label className="label !text-xs">اسم المجموعة عند العميل</label>
              <input className="field !py-1.5 text-sm" value={groupName} onChange={e => setGroupName(e.target.value)}
                placeholder="إضافات" />
            </div>
          ) : (
            <button className="text-[11px] text-sea font-semibold mb-2 block" onClick={() => setAdvanced(true)}>
              تحت مجموعة "{groupName}" · غيّرها
            </button>
          )}
          <p className="text-[11px] text-mist mb-2">السعر هنا بداية بس — تعدّله على كل صنف لوحده بعدين.</p>
          <div className="flex gap-2">
            <button className="btn-sea !py-1.5 !px-4 text-sm" disabled={busy} onClick={applyToCategory}>
              {busy ? 'جاري الإضافة…' : 'ضيفه'}
            </button>
            <button className="btn-ghost !py-1.5 !px-4 text-sm" onClick={() => setApplying(null)}>إلغاء</button>
          </div>
        </div>
      )}

      <div className="bg-shellup/60 rounded-xl p-3">
        <p className="text-xs font-semibold mb-2">إضافة جديدة</p>
        <div className="flex items-center gap-2 mb-2">
          {draft.imageUrl
            ? <img src={draft.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
            : <div className="w-10 h-10 rounded-lg bg-shell border border-line shrink-0" />}
          <label className="text-xs text-sea cursor-pointer">
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
              onChange={e => e.target.files?.[0] && uploadImage(e.target.files[0])} />
            {uploading ? 'جاري الرفع…' : (draft.imageUrl ? 'تغيير الصورة' : '🖼️ صورة (اختياري)')}
          </label>
        </div>
        <div className="flex gap-2">
          <input className="field !py-1.5 text-sm" placeholder="اسم الإضافة (طماطم)" value={draft.name}
            onChange={e => setDraft({ ...draft, name: e.target.value })} />
          <input className="field !py-1.5 !w-20 text-sm" type="number" placeholder="السعر" value={draft.price}
            onChange={e => setDraft({ ...draft, price: e.target.value })} />
          <button className="btn-ghost !py-1.5 !px-3 text-sm shrink-0" disabled={busy || !draft.name.trim()} onClick={add}>
            إضافة
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      {notice && <p className="text-xs text-emerald-700 bg-emerald-500/10 rounded-lg p-2 mt-2">{notice}</p>}
    </div>
  )
}
