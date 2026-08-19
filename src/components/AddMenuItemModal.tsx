import { useState } from 'react'
import Icon from './Icon'
import { supabase } from '../lib/supabase'
import { uploadVendorImage } from '../lib/upload'
import { useDismissable } from '../lib/useDismissable'
import { useSheets } from './ActionSheets'
import ImageCropPreview from './ImageCropPreview'
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
  kind?: 'standard' | 'ingredient'
}

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
  const { confirmSheet, sheetElement } = useSheets()
  // A backdrop tap or the Android Back gesture used to discard everything --
  // name, description, uploaded photo (now orphaned in storage), sizes,
  // combos, every addon group typed so far -- with no confirmation. One
  // mistaken tap while filling in a ten-field item lost all of it.
  function hasUnsavedContent() {
    return !!(form.name.trim() || form.description.trim() || form.category.trim()
      || form.price || form.imageUrl || sizes.length || combos.length || modifierGroups.length)
  }
  async function requestClose() {
    if (hasUnsavedContent() && !(await confirmSheet({
      title: 'تقفل من غير ما تحفظ؟', body: 'كل حاجة كتبتها هتتشال.', danger: true, confirmLabel: 'قفل من غير حفظ',
    }))) return
    onClose()
  }
  const overlayRef = useDismissable(requestClose)
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
  const [showAdvancedModifierSettings, setShowAdvancedModifierSettings] = useState(false)

  const addModifierTemplate = (kind: 'required' | 'optional') => {
    setModifierGroups(groups => [...groups, {
      name: kind === 'required' ? 'اختار النوع' : 'إضافات',
      required: kind === 'required',
      maxSelect: kind === 'required' ? '1' : '5',
      choices: [{ name: '', price: '' }]
    }])
  }

  const addIngredientCustomizer = () => {
    setModifierGroups(groups => [...groups, {
      name: '', required: true, maxSelect: '1', kind: 'ingredient',
      choices: [{ name: 'عادي', price: '0' }, { name: '', price: '0' }, { name: '', price: '0' }]
    }])
  }

  const setIngredientName = (groupIndex: number, name: string) => {
    setModifierGroups(groups => groups.map((group, index) => index === groupIndex ? {
      ...group, name,
      choices: [
        { name: 'عادي', price: '0' },
        { name: name ? `من غير ${name}` : '', price: '0' },
        { name: name ? `زيادة ${name}` : '', price: group.choices[2]?.price || '0' }
      ]
    } : group))
  }

  // Once an item has sizes, place_order REFUSES an order that does not name one
  // (`size_required`), so menu_items.price is never charged -- it just sits
  // there, free to disagree. That is exactly how «٦ وينجز» came to advertise
  // 190 while costing 300. Stop keeping two numbers: the base price follows the
  // cheapest size, and the input goes read-only.
  const lowestSize = sizes.length
    ? Math.min(...sizes.map(s => s.price).filter(p => p > 0))
    : null
  // Only lock once a size actually HAS a price. Sizes seeded at 0 (a preset
  // applied before typing a base price) used to lock the field immediately --
  // effectivePrice fell through to form.price, which was also empty, so the
  // read-only box showed «من » with nothing to type and no way to fix it
  // short of deleting the size rows.
  const priceLocked = sizes.length > 0 && Number.isFinite(lowestSize)
  const effectivePrice = priceLocked ? String(lowestSize) : form.price

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
    ? 'في حجمين بنفس السعر. راجعهم قبل ما تحفظ'
    : null
  // A combo at or below the item's own price hands over its fries and drink
  // for free, on every order, forever -- place_order uses the combo price as
  // a straight replacement for the base price. This used to only be a
  // dismissable warning; a vendor could close the sheet with it still
  // showing and start selling below cost immediately. Now it blocks save.
  const comboBlocking = combos.length > 0 && Number(effectivePrice) > 0
    && combos.some(c => c.price <= Number(effectivePrice))
  const comboWarning = comboBlocking
    ? 'في كومبو بسعر أقل من أو يساوي سعر الصنف، يبقى بتديه ببلاش. لازم تعدّل السعر قبل ما تحفظ.'
    : null

  const valid = form.name.trim() && form.category.trim() && effectivePrice && Number(effectivePrice) > 0
    && !comboBlocking

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
   *   'another'  -- clear the form, stay open (keeps the section)
   *   'close'    -- just close
   *   'addons'   -- hand the created row up so the options editor opens on it
   */
  async function save(after: 'another' | 'close' | 'addons') {
    if (!valid) return
    // Validated BEFORE anything is written. This used to run after the item,
    // its sizes and its combos were already inserted -- so a blank addon
    // choice failed validation on a row that had already landed live, the
    // error read like nothing had saved, and pressing حفظ again (the obvious
    // next move) inserted a second, duplicate item.
    for (const group of modifierGroups) {
      const name = group.name.trim()
      const hasChoice = group.choices.some(c => c.name.trim())
      if (!name || !hasChoice) {
        setFormError('اكتب اسم كل مجموعة واختيار واحد على الأقل، أو احذف المجموعة الفاضية.')
        return
      }
    }
    setSaving(true); setFormError('')
    const { data: created, error } = await supabase.from('menu_items').insert({
      restaurant_id: restaurant.id, name: form.name.trim(), description: form.description.trim(),
      category: form.category.trim(), price: Number(effectivePrice), requires_prescription: form.requiresRx,
      available: form.available, image_url: form.imageUrl,
      available_from: form.hasWindow ? form.availFrom : null,
      available_until: form.hasWindow ? form.availUntil : null
    }).select('*').single()
    if (error) { setSaving(false); setFormError(`الحفظ فشل: ${error.message}`); return }

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
        setFormError(`الصنف اتحفظ بس الأحجام فشلت. افتحه وظبّطها. (${sizeErr.message})`)
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
        setFormError(`الصنف والأحجام اتحفظوا بس الكومبو فشل. افتحه وظبّطه. (${comboErr.message})`)
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
        setFormError(`الصنف اتحفظ لكن مجموعة الاختيارات «${name}» ما اتحفظتش. افتحه وظبّطها. (${groupErr?.message || 'unknown error'})`)
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
        setFormError(`الصنف ومجموعة «${name}» اتحفظوا لكن الاختيارات فشلت. افتحه وظبّطها. (${choicesErr.message})`)
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

  // Direct inset positioning on the sheet itself -- see the note in
  // ProductDetailSheet.
  return (
    <div ref={overlayRef} role="dialog" aria-labelledby="add-menu-item-title" aria-modal="true" className="fixed inset-0 z-50 bg-black/60" onClick={requestClose}>
      <div className="fixed inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 w-full sm:w-full sm:max-w-md max-h-[90vh] overflow-y-auto bg-shellup rounded-t-2xl sm:rounded-2xl p-4" onClick={e => e.stopPropagation()}>
        {sheetElement}
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 id="add-menu-item-title" className="font-bold text-lg text-foam">إضافة صنف: {restaurant.name}</h2>
          <button className="text-mist text-sm bg-shell rounded-full px-3 py-1" onClick={requestClose}><Icon name="x" size="sm" className="inline-block align-[-0.15em] me-1" />إغلاق</button>
        </div>

        {formError && (
          <p className="text-sm text-red-600 bg-red-500/10 rounded-lg p-2.5 mb-3" role="alert">{formError}</p>
        )}
        {justSaved && (
          <p className="text-xs text-emerald-700 bg-emerald-500/10 rounded-lg p-2 mb-3"><Icon name="check" size="sm" className="inline-block align-[-0.15em] me-1" />اتضاف "{justSaved}"، كمّل اللي بعده</p>
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
              {uploading ? 'جاري الرفع…' : (form.imageUrl ? 'تغيير الصورة' : <><Icon name="image" size="sm" className="inline-block align-[-0.15em] me-1" />صورة (اختياري)</>)}
            </label>
          </div>
          {form.imageUrl && <ImageCropPreview url={form.imageUrl} />}

          <input className={inputCls} placeholder="اسم الصنف" value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })} />
          <textarea className={`${inputCls} !h-auto`} rows={2} placeholder="وصف (اختياري)" value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })} />
          <div className="flex gap-2">
            <input className={inputCls} placeholder="القسم (مشويات…)" value={form.category}
              onChange={e => setForm({ ...form, category: e.target.value })} />
            {priceLocked ? (
              <input className={`${inputCls} !w-28 !border-dashed bg-shellup text-mist`} readOnly
                value={`من ${effectivePrice}`} aria-label="السعر، محسوب من الأحجام" />
            ) : (
              <input className={`${inputCls} !w-24`} type="number" placeholder="السعر" value={form.price}
                onChange={e => setForm({ ...form, price: e.target.value })} />
            )}
          </div>
          {sizes.length > 0 && !priceLocked && (
            <p className="text-[11px] text-sandink">
              ⓘ الأحجام تحت لسه من غير سعر. اكتب سعر لأي حجم عشان سعر الصنف يتحسب منه.
            </p>
          )}
          {priceLocked && (
            <p className="text-[11px] text-mist">
              ⓘ السعر بقى بيتحسب من أقل حجم، العميل هيشوف «من {effectivePrice}».
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
            hint="الكومبو منتج تاني بسعره الكامل، بيلغي السعر والحجم مع بعض."
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
            <h3 className="font-bold text-sm text-foam">هل العميل محتاج يختار حاجة؟</h3>
            <p className="text-[11px] text-mist mt-1">اختار قالب سريع، وبعدها اكتب الاختيارات وأسعارها فقط.</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="btn-ghost !py-2.5 text-sm"
              onClick={() => addModifierTemplate('required')}
            ><Icon name="check" size="sm" className="inline-block align-[-0.15em] me-1" />اختيار مطلوب</button>
            <button
              type="button"
              className="btn-ghost !py-2.5 text-sm"
              onClick={() => addModifierTemplate('optional')}
            >＋ إضافات اختيارية</button>
            <button
              type="button"
              className="btn-ghost col-span-2 !py-2.5 text-sm"
              onClick={addIngredientCustomizer}
            >🥪 تعديل مكوّن ساندوتش (عادي / من غير / زيادة)</button>
          </div>

          {modifierGroups.length > 0 && (
            <div className="space-y-3 pt-1">
              {modifierGroups.map((group, groupIndex) => (
                <div key={groupIndex} className="rounded-xl border border-line p-3 space-y-2.5 bg-shellup">
                  <div className="flex items-center gap-2">
                    <input
                      className={inputCls}
                      placeholder={group.kind === 'ingredient' ? 'اسم المكوّن: طماطم' : (group.required ? 'مثلاً: اختار الصوص' : 'مثلاً: إضافات')}
                      value={group.name}
                      onChange={e => group.kind === 'ingredient'
                        ? setIngredientName(groupIndex, e.target.value)
                        : setModifierGroups(groups => groups.map((current, i) => i === groupIndex ? { ...current, name: e.target.value } : current))}
                    />
                    <button
                      type="button"
                      className="text-xs text-red-600 px-1 shrink-0"
                      onClick={() => setModifierGroups(groups => groups.filter((_, i) => i !== groupIndex))}
                    >حذف</button>
                  </div>

                  <p className="text-[11px] text-mist">
                    {group.kind === 'ingredient'
                      ? 'العميل يختار: عادي، من غير المكوّن، أو زيادة منه.'
                      : (group.required ? 'لازم العميل يختار اختيار واحد.' : 'العميل يقدر يضيف اللي يحبه.')}
                  </p>

                  <div className="space-y-2">
                    {group.choices.map((choice, choiceIndex) => (
                      <div key={choiceIndex} className="flex gap-2">
                        <input
                          className={inputCls}
                          placeholder="مثلاً: صوص باربكيو"
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
                        ><Icon name="x" size="sm" /></button>
                      </div>
                    ))}
                  </div>

                  {group.kind !== 'ingredient' && (
                    <button
                      type="button"
                      className="text-xs text-sea font-semibold"
                      onClick={() => setModifierGroups(groups => groups.map((current, i) => i === groupIndex ? {
                        ...current, choices: [...current.choices, { name: '', price: '' }]
                      } : current))}
                    >+ إضافة اختيار</button>
                  )}

                  {showAdvancedModifierSettings && group.kind !== 'ingredient' && (
                    <div className="rounded-lg bg-shell p-2.5 flex items-center gap-3 text-xs text-mist">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={group.required}
                          onChange={e => setModifierGroups(groups => groups.map((current, i) => i === groupIndex ? {
                            ...current, required: e.target.checked, maxSelect: e.target.checked ? '1' : current.maxSelect
                          } : current))}
                        />
                        مطلوب
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
                  )}
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            className="text-xs text-mist underline underline-offset-2"
            onClick={() => setShowAdvancedModifierSettings(open => !open)}
          >{showAdvancedModifierSettings ? 'إخفاء الإعدادات المتقدمة' : <><Icon name="gear" size="sm" className="inline-block align-[-0.15em] me-1" />إعدادات متقدمة</>}</button>
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
