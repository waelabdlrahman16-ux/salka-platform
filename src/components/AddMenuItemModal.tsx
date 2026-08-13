import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { uploadVendorImage } from '../lib/upload'
import { useDismissable } from '../lib/useDismissable'
import OptionRowsCard, { type OptionRow } from './menuItemEditor/OptionRowsCard'
import type { MenuItem, Restaurant } from '../lib/types'

const EMPTY = {
  name: '', description: '', category: '', price: '', requiresRx: false,
  available: true, imageUrl: null as string | null,
  hasWindow: false, availFrom: '09:00', availUntil: '11:00'
}

const SIZE_PRESETS = [
  { label: 'عادي / دوبل', names: ['عادي', 'دوبل'] },
  { label: 'وسط / كبير', names: ['وسط', 'كبير'] },
  { label: 'صغير / وسط / كبير', names: ['صغير', 'وسط', 'كبير'] },
]
// The names must NOT carry the word «كومبو». CustomizeSheet renders the row as
// «كومبو {name}», so seeding «كومبو وسط» here shows the customer
// «كومبو كومبو وسط» -- and the same doubled string lands on the cart line and
// the order item. Matches MenuItemEditor's preset exactly.
const COMBO_PRESETS = [{ label: 'ابدأ بـ وسط / كبير', names: ['وسط', 'كبير'] }]

type DraftModifierGroup = {
  name: string
  required: boolean
  maxSelect: string
  choices: { name: string; price: string }[]
}

const emptyModifierGroup = (): DraftModifierGroup => ({
  name: '', required: false, maxSelect: '1', choices: [{ name: '', price: '' }]
})

/**
 * Sizes and combos are held here as drafts and written after the item exists --
 * they need its menu_item_id, so there is no way to insert them first.
 *
 * Negative ids: OptionRowsCard keys and addresses rows by a numeric id because
 * every other caller hands it saved rows. A counter going downwards can never
 * collide with a real serial, so the same component works unchanged for rows
 * that have never been near the database.
 */
let draftRowSeq = -1

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
  const [sizes, setSizes] = useState<OptionRow[]>([])
  const [combos, setCombos] = useState<OptionRow[]>([])
  const [modifierGroups, setModifierGroups] = useState<DraftModifierGroup[]>([])

  // Once an item has sizes, place_order REFUSES an order that does not name one
  // (`size_required`), so menu_items.price is never charged -- it just sits
  // there, free to disagree. That is exactly how «٦ وينجز» came to advertise
  // 190 while costing 300. Stop keeping two numbers: the base price follows the
  // cheapest size, and the input goes read-only.
  const lowestSize = sizes.length
    ? Math.min(...sizes.map(s => s.price).filter(p => p > 0))
    : null
  const effectivePrice = sizes.length && Number.isFinite(lowestSize) ? String(lowestSize) : form.price

  const valid = form.name.trim() && form.category.trim() && effectivePrice && Number(effectivePrice) > 0

  const addRow = (set: typeof setSizes) => (name: string, price: string) => {
    if (!name.trim()) return
    set(rs => [...rs, { id: draftRowSeq--, name: name.trim(), price: Number(price) || 0 }])
  }
  const applyPreset = (set: typeof setSizes) => (names: string[]) =>
    // Seeded at the item's own price rather than a guessed markup -- a guessed
    // price is silently wrong, an identical one is loudly wrong and trips the
    // warning below until someone fixes it. Same rule as the options editor.
    set(names.map(n => ({ id: draftRowSeq--, name: n, price: Number(form.price) || 0 })))

  const sizeWarning = sizes.length > 1 && new Set(sizes.map(s => s.price)).size < sizes.length
    ? 'في حجمين بنفس السعر — راجعهم قبل ما تحفظ'
    : null
  const comboWarning = combos.length > 0 && Number(effectivePrice) > 0
    && combos.some(c => c.price <= Number(effectivePrice))
    ? 'في كومبو بسعر أقل من أو يساوي سعر الصنف — يبقى بتديه ببلاش'
    : null

  async function upload(file: File) {
    setUploading(true); setFormError('')
    const { url, error } = await uploadVendorImage(file, `menu-items/${restaurant.id}/new/${Date.now()}`)
    setUploading(false)
    // uploadVendorImage already returns Arabic copy for the two things that
    // actually go wrong -- wrong file type and over 5MB -- and it was thrown away.
    if (error) { setFormError(error); return }
    if (url) setForm(f => ({ ...f, imageUrl: url }))
  }

  /**
   * `after` is what to do once it is saved:
   *   'another'  — clear the form, stay open (keeps the section)
   *   'close'    — just close
   *   'addons'   — hand the created row up so the options editor opens on it
   */
  async function save(after: 'another' | 'close' | 'addons') {
    if (!valid) return
    setSaving(true); setFormError('')
    const { data: created, error } = await supabase.from('menu_items').insert({
      restaurant_id: restaurant.id, name: form.name.trim(), description: form.description.trim(),
      category: form.category.trim(), price: Number(effectivePrice), requires_prescription: form.requiresRx,
      available: form.available, image_url: form.imageUrl,
      available_from: form.hasWindow ? form.availFrom : null,
      available_until: form.hasWindow ? form.availUntil : null
    }).select('*').single()
    if (error) { setSaving(false); setFormError(`الحفظ فشل — ${error.message}`); return }

    const itemId = (created as MenuItem).id
    // Sizes and combos can only be written now that the item has an id.
    //
    // If the item lands and these do not, say so and stay open. Closing on a
    // partial save would leave a sized item priced as if it had none -- the
    // customer would be charged the base price for a دوبل -- and report it as
    // success. That silent-success shape is the bug the menu editor carried in
    // nineteen places; it is not being reintroduced here.
    if (sizes.length) {
      // display_order and is_default match what MenuItemEditor writes. Both
      // default to 0/false in the table, so omitting them would leave every row
      // at order 0 -- «كبير» could render above «صغير» -- and no size marked
      // default, which the customize sheet uses to preselect one.
      const { error: sizeErr } = await supabase.from('menu_item_sizes').insert(
        sizes.map((s, i) => ({
          menu_item_id: itemId, name: s.name, price: s.price,
          is_default: i === 0, display_order: i, available: true
        })))
      if (sizeErr) {
        setSaving(false)
        setFormError(`الصنف اتحفظ بس الأحجام فشلت — افتحه وظبّطها. (${sizeErr.message})`)
        onSaved(); return
      }
    }
    if (combos.length) {
      const { error: comboErr } = await supabase.from('menu_item_combos').insert(
        combos.map((c, i) => ({
          menu_item_id: itemId, name: c.name, price: c.price,
          display_order: i, available: true
        })))
      if (comboErr) {
        setSaving(false)
        setFormError(`الصنف والأحجام اتحفظوا بس الكومبو فشل — افتحه وظبّطه. (${comboErr.message})`)
        onSaved(); return
      }
    }
    for (const [groupIndex, group] of modifierGroups.entries()) {
      const name = group.name.trim()
      const choices = group.choices
        .map(choice => ({ name: choice.name.trim(), price: Number(choice.price) || 0 }))
        .filter(choice => choice.name)

      if (!name || choices.length === 0) {
        setSaving(false)
        setFormError('اكتب اسم كل مجموعة واختيار واحد على الأقل، أو احذف المجموعة الفاضية.')
        return
      }

      const maxSelect = Math.max(group.required ? 1 : 0, Number(group.maxSelect) || 1)
      const { data: savedGroup, error: groupErr } = await supabase
        .from('menu_item_addon_groups')
        .insert({
          menu_item_id: itemId,
          name,
          min_select: group.required ? 1 : 0,
          max_select: maxSelect,
          display_order: groupIndex
        })
        .select('id')
        .single()

      if (groupErr || !savedGroup) {
        setSaving(false)
        setFormError(`الصنف اتحفظ لكن مجموعة الاختيارات «${name}» ما اتحفظتش — افتحه وظبّطها. (${groupErr?.message || 'unknown error'})`)
        onSaved()
        return
      }

      const { error: choicesErr } = await supabase.from('menu_item_addons').insert(
        choices.map((choice, choiceIndex) => ({
          group_id: savedGroup.id,
          name: choice.name,
          price: choice.price,
          available: true,
          display_order: choiceIndex
        }))
      )
      if (choicesErr) {
        setSaving(false)
        setFormError(`الصنف ومجموعة «${name}» اتحفظوا لكن الاختيارات فشلت — افتحه وظبّطها. (${choicesErr.message})`)
        onSaved()
        return
      }
    }
    setSaving(false)

    onSaved(after === 'addons' ? (created as MenuItem) : undefined)
    if (after === 'another') {
      setJustSaved(form.name.trim())
      setForm(f => ({ ...EMPTY, category: f.category })) // keep the section, clear the rest
      setSizes([]); setCombos([]); setModifierGroups([])
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
            {sizes.length ? (
              <input className={`${inputCls} !w-28 !border-dashed bg-shellup text-mist`} readOnly
                value={`من ${effectivePrice}`} aria-label="السعر — محسوب من الأحجام" />
            ) : (
              <input className={`${inputCls} !w-24`} type="number" placeholder="السعر" value={form.price}
                onChange={e => setForm({ ...form, price: e.target.value })} />
            )}
          </div>
          {sizes.length > 0 && (
            <p className="text-[11px] text-mist">
              ⓘ السعر بقى بيتحسب من أقل حجم — العميل هيشوف «من {effectivePrice}».
            </p>
          )}

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

        {/* Sizes and combos live in the form now, not behind a save. Same
            component as the options editor, so the presets, the price inputs
            and the two money-losing warnings cannot drift between the screen
            that creates an item and the screen that edits it. */}
        <div className="mt-3">
          <OptionRowsCard
            title="الأحجام"
            hint="لو الصنف ليه أكتر من حجم، السعر بيتحدد من الحجم مش من فوق."
            rows={sizes}
            presets={SIZE_PRESETS}
            warning={sizeWarning}
            addPlaceholder="اسم الحجم"
            onApplyPreset={applyPreset(setSizes)}
            onAdd={addRow(setSizes)}
            onRemove={id => setSizes(rs => rs.filter(r => r.id !== id))}
            onPriceChange={(id, price) => setSizes(rs => rs.map(r => r.id === id ? { ...r, price: Number(price) || 0 } : r))}
            onNameChange={(id, name) => setSizes(rs => rs.map(r => r.id === id ? { ...r, name } : r))}
          />
          <OptionRowsCard
            title="اعمله كومبو"
            hint="الكومبو منتج تاني بسعره الكامل — بيلغي السعر والحجم مع بعض."
            rows={combos}
            presets={COMBO_PRESETS}
            warning={comboWarning}
            addPlaceholder="اسم الكومبو"
            onApplyPreset={applyPreset(setCombos)}
            onAdd={addRow(setCombos)}
            onRemove={id => setCombos(rs => rs.filter(r => r.id !== id))}
            onPriceChange={(id, price) => setCombos(rs => rs.map(r => r.id === id ? { ...r, price: Number(price) || 0 } : r))}
            onNameChange={(id, name) => setCombos(rs => rs.map(r => r.id === id ? { ...r, name } : r))}
          />
        </div>

        <section className="card p-3.5 mt-3 space-y-3" aria-label="اختيارات العميل والإضافات">
          <div>
            <h3 className="font-bold text-sm text-foam">اختيارات العميل والإضافات</h3>
            <p className="text-[11px] text-mist mt-1">نفس منطق المطاعم الكبيرة: اختيارات مطلوبة أو اختيارية، بسعر لكل اختيار، وحد أقصى للاختيارات.</p>
          </div>

          {modifierGroups.map((group, groupIndex) => (
            <div key={groupIndex} className="rounded-xl border border-line p-3 space-y-2.5 bg-shellup">
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  placeholder="اسم المجموعة: اختار الصوص"
                  value={group.name}
                  onChange={e => setModifierGroups(groups => groups.map((current, i) => i === groupIndex ? { ...current, name: e.target.value } : current))}
                />
                <button
                  type="button"
                  className="text-xs text-red-600 px-1 shrink-0"
                  onClick={() => setModifierGroups(groups => groups.filter((_, i) => i !== groupIndex))}
                >حذف</button>
              </div>
              <div className="flex items-center gap-3 text-xs text-mist">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={group.required}
                    onChange={e => setModifierGroups(groups => groups.map((current, i) => i === groupIndex ? { ...current, required: e.target.checked } : current))}
                  />
                  اختيار مطلوب
                </label>
                <label className="flex items-center gap-1.5">
                  أقصى عدد
                  <input
                    className="field !h-8 !py-1 !w-14 text-center"
                    type="number"
                    min={group.required ? 1 : 0}
                    value={group.maxSelect}
                    onChange={e => setModifierGroups(groups => groups.map((current, i) => i === groupIndex ? { ...current, maxSelect: e.target.value } : current))}
                  />
                </label>
              </div>
              <div className="space-y-2">
                {group.choices.map((choice, choiceIndex) => (
                  <div key={choiceIndex} className="flex gap-2">
                    <input
                      className={inputCls}
                      placeholder="اسم الاختيار"
                      value={choice.name}
                      onChange={e => setModifierGroups(groups => groups.map((current, i) => i === groupIndex ? {
                        ...current,
                        choices: current.choices.map((option, j) => j === choiceIndex ? { ...option, name: e.target.value } : option)
                      } : current))}
                    />
                    <input
                      className={`${inputCls} !w-24`}
                      type="number"
                      min="0"
                      placeholder="+ سعر"
                      value={choice.price}
                      onChange={e => setModifierGroups(groups => groups.map((current, i) => i === groupIndex ? {
                        ...current,
                        choices: current.choices.map((option, j) => j === choiceIndex ? { ...option, price: e.target.value } : option)
                      } : current))}
                    />
                    <button
                      type="button"
                      className="text-xs text-mist px-1 shrink-0"
                      aria-label="حذف الاختيار"
                      onClick={() => setModifierGroups(groups => groups.map((current, i) => i === groupIndex ? {
                        ...current,
                        choices: current.choices.filter((_, j) => j !== choiceIndex)
                      } : current))}
                    >✕</button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="text-xs text-sea font-semibold"
                onClick={() => setModifierGroups(groups => groups.map((current, i) => i === groupIndex ? {
                  ...current, choices: [...current.choices, { name: '', price: '' }]
                } : current))}
              >+ إضافة اختيار</button>
            </div>
          ))}

          <button
            type="button"
            className="btn-ghost w-full !py-2 text-sm"
            onClick={() => setModifierGroups(groups => [...groups, emptyModifierGroup()])}
          >+ إضافة مجموعة اختيارات</button>
        </section>

        <div className="flex flex-wrap gap-2 mt-3">
          <button className="btn-ghost flex-1 !py-2.5 text-sm" disabled={saving || !valid} onClick={() => save('another')}>
            حفظ وإضافة صنف تاني
          </button>
          {/* The plain save. Sizes and combos are in the form now, so for most
              items there is nothing left to do afterwards and being taken to
              another screen is an interruption, not a flow. */}
          <button className="btn-sea flex-1 !py-2.5 text-sm" disabled={saving || !valid} onClick={() => save('close')}>
            {saving ? 'جاري الحفظ…' : 'حفظ'}
          </button>
          {/* Add-ons only. Groups, min/max and the vendor library are a bigger
              tree than a list of names and prices, and they are the least
              likely thing anyone sets while first creating an item. */}
          <button className="btn-ghost w-full !py-2.5 text-sm" disabled={saving || !valid} onClick={() => save('addons')}>
            حفظ وكمّل الإضافات (الجبنة الزيادة، الصوصات…)
          </button>
        </div>
      </div>
    </div>
  )
}
