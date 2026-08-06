import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { uploadVendorImage } from '../lib/upload'
import { useDismissable } from '../lib/useDismissable'
import type { MenuItem, Restaurant } from '../lib/types'

const EMPTY = {
  name: '', description: '', category: '', price: '', requiresRx: false,
  available: true, imageUrl: null as string | null,
  hasWindow: false, availFrom: '09:00', availUntil: '11:00'
}

export default function AddMenuItemModal({ restaurant, onClose, onSaved }: {
  restaurant: Restaurant
  onClose: () => void
  /**
   * Called after a successful insert. `created` is the row that was just made,
   * so the caller can drop straight into its options.
   *
   * The complaint this answers: "sizes are not in adding a new item, i have to
   * scroll down to get the item and edit it". Adding a sandwich with three sizes
   * meant save, close, find it among forty-six, reopen, scroll. The item now
   * hands itself to the editor.
   */
  onSaved: (created?: MenuItem) => void
}) {
  const overlayRef = useDismissable(onClose)
  const [form, setForm] = useState(EMPTY)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState('')
  // upload() discarded uploadVendorImage's error and save() discarded the
  // insert's, so a rejected photo produced a spinner that stopped and nothing
  // else, and a failed insert showed the "added ✓" toast. MenuItemEditor
  // surfaces both correctly; this modal simply never did.
  const [formError, setFormError] = useState('')

  const valid = form.name.trim() && form.category.trim() && form.price

  async function upload(file: File) {
    setUploading(true); setFormError('')
    const { url, error } = await uploadVendorImage(file, `menu-items/new/${restaurant.id}/${Date.now()}`)
    setUploading(false)
    // uploadVendorImage already returns Arabic copy for the two things that
    // actually go wrong -- wrong file type and over 5MB -- and it was thrown away.
    if (error) { setFormError(error); return }
    if (url) setForm(f => ({ ...f, imageUrl: url }))
  }

  async function save(addAnother: boolean) {
    if (!valid) return
    setSaving(true); setFormError('')
    const { data: created, error } = await supabase.from('menu_items').insert({
      restaurant_id: restaurant.id, name: form.name.trim(), description: form.description.trim(),
      category: form.category.trim(), price: Number(form.price), requires_prescription: form.requiresRx,
      available: form.available, image_url: form.imageUrl,
      available_from: form.hasWindow ? form.availFrom : null,
      available_until: form.hasWindow ? form.availUntil : null
    }).select('*').single()
    setSaving(false)
    if (error) { setFormError(`الحفظ فشل — ${error.message}`); return }
    onSaved(addAnother ? undefined : (created as MenuItem))
    if (addAnother) {
      setJustSaved(form.name.trim())
      setForm(f => ({ ...EMPTY, category: f.category })) // keep the section, clear the rest
      setTimeout(() => setJustSaved(''), 2500)
    } else {
      onClose()
    }
  }

  const inputCls = 'field !h-9 !py-1.5 text-sm'

  return (
    <div ref={overlayRef} role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/60 grid place-items-end sm:place-items-center p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto bg-shellup rounded-t-2xl sm:rounded-2xl p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="font-bold text-lg text-foam">إضافة صنف — {restaurant.name}</h2>
          <button className="text-mist text-sm bg-shell rounded-full px-3 py-1" onClick={onClose}>✗ إغلاق</button>
        </div>

        {formError && (
          <p className="text-sm text-red-600 bg-red-500/10 rounded-lg p-2.5 mb-3" role="alert">{formError}</p>
        )}
        {justSaved && (
          <p className="text-xs text-emerald-700 bg-emerald-500/10 rounded-lg p-2 mb-3">✓ اتضاف "{justSaved}" — كمّل اللي بعده</p>
        )}

        <div className="card p-3.5 space-y-2.5">
          <div className="flex items-center gap-2.5">
            {form.imageUrl
              ? <img src={form.imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover border border-line" />
              : <div className="w-12 h-12 rounded-lg bg-night grid place-items-center text-mist text-[10px]">لا صورة</div>}
            <label className="text-xs text-sea cursor-pointer">
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]
                  // Reset the input BEFORE the await. A file input does not fire
                  // change when the chosen file is identical to the last one, so
                  // reusing the same photo on a second item silently did nothing.
                  e.target.value = ''
                  if (f) upload(f)
                }} />
              {uploading ? 'جاري الرفع…' : (form.imageUrl ? 'تغيير الصورة' : '🖼️ صورة (اختياري)')}
            </label>
          </div>

          <input className={inputCls} placeholder="اسم الصنف" value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })} />
          <textarea className={`${inputCls} !h-auto`} rows={2} placeholder="وصف (اختياري)" value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })} />
          <div className="flex gap-2">
            <input className={inputCls} placeholder="القسم (مشويات…)" value={form.category}
              onChange={e => setForm({ ...form, category: e.target.value })} />
            <input className={`${inputCls} !w-24`} type="number" placeholder="السعر" value={form.price}
              onChange={e => setForm({ ...form, price: e.target.value })} />
          </div>

          {restaurant.vendor_type === 'pharmacy' && (
            <label className="flex items-center gap-2 text-xs text-mist">
              <input type="checkbox" checked={form.requiresRx} onChange={e => setForm({ ...form, requiresRx: e.target.checked })} />
              يحتاج روشتة طبية
            </label>
          )}

          <label className="flex items-center gap-2 text-xs text-mist">
            <input type="checkbox" checked={form.hasWindow} onChange={e => setForm({ ...form, hasWindow: e.target.checked })} />
            متاح في وقت محدد بس (مثلاً فطار)
          </label>
          {form.hasWindow && (
            <div className="flex items-center gap-2">
              <input type="time" className={`${inputCls} !w-auto`} value={form.availFrom} onChange={e => setForm({ ...form, availFrom: e.target.value })} />
              <span className="text-mist text-xs">لحد</span>
              <input type="time" className={`${inputCls} !w-auto`} value={form.availUntil} onChange={e => setForm({ ...form, availUntil: e.target.value })} />
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-3">
          <button className="btn-ghost flex-1 !py-2.5 text-sm" disabled={saving || !valid} onClick={() => save(true)}>
            حفظ وإضافة صنف تاني
          </button>
          {/* Renamed from a bare حفظ: the sheet no longer just closes, it opens
              the item's options. Saying so on the button is the difference
              between a surprise and a flow. */}
          <button className="btn-sea flex-1 !py-2.5 text-sm" disabled={saving || !valid} onClick={() => save(false)}>
            
            {saving ? 'جاري الحفظ…' : 'حفظ وكمّل الخيارات'}
          </button>
        </div>
      </div>
    </div>
  )
}
