import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { adminCatalogAction } from '../lib/adminCatalogActions'
import { uploadVendorImage } from '../lib/upload'
import { useDismissable } from '../lib/useDismissable'
import { useSheets } from './ActionSheets'
import BasicInfoCard from './menuItemEditor/BasicInfoCard'
import OptionRowsCard from './menuItemEditor/OptionRowsCard'
import AddonsCard from './menuItemEditor/AddonsCard'
import DangerZoneCard from './menuItemEditor/DangerZoneCard'
import DiscountManager from './DiscountManager'
import type { MenuItem, MenuItemAddon, MenuItemAddonGroup, MenuItemCombo, MenuItemSize, VendorAddonLibraryItem } from '../lib/types'

export default function MenuItemEditor({ item, onClose, onSaved, onDeleted, canManageDiscounts = true, restaurantName }: {
  item: MenuItem
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
  /** Discounts move margin, so they stay admin-only -- a catalog user gets the
   *  rest of the editor without a section whose writes RLS would reject. */
  canManageDiscounts?: boolean
  /** The catalog role manages multiple restaurants and switches between them
   *  without being on-site; the list screen names the restaurant but nothing
   *  inside this editor did, so after switching restaurants the only cue you
   *  were now editing a different one's menu was a header line already
   *  scrolled past. A wrong price save here is silent to the person making
   *  it -- it only surfaces to a customer later as the wrong charge. */
  restaurantName?: string
}) {
  const overlayRef = useDismissable(onClose)
  const { confirmSheet, sheetElement } = useSheets()
  const [name, setName] = useState(item.name)
  const [description, setDescription] = useState(item.description ?? '')
  const [category, setCategory] = useState(item.category)
  const [price, setPrice] = useState(String(item.price))
  const [available, setAvailable] = useState(item.available)
  const [hasWindow, setHasWindow] = useState(!!(item.available_from && item.available_until))
  const [availFrom, setAvailFrom] = useState(item.available_from?.slice(0, 5) ?? '09:00')
  const [availUntil, setAvailUntil] = useState(item.available_until?.slice(0, 5) ?? '11:00')
  const [imageUrl, setImageUrl] = useState(item.image_url)
  const [uploading, setUploading] = useState(false)
  const [imageError, setImageError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteBlockedReason, setDeleteBlockedReason] = useState('')
  // Every write below used to be `await supabase.from(...).update(...)` with no
  // error destructured, then onSaved()/loadOptions() regardless. A failed save
  // closed the sheet, or repainted the list with the OLD value, and said
  // nothing -- indistinguishable from a save that worked. This is the only
  // screen the catalog role has, and place_order charges exactly what these
  // tables say, so a silently-dropped price edit bills the old price forever.
  const [writeError, setWriteError] = useState('')
  // A failed READ, distinct from a failed write. An empty editor after a failed
  // fetch invites re-adding options that already exist -- see load().
  const [loadError, setLoadError] = useState('')
  // Which optional section is open. Six cards used to render at once whether the
  // item needed them or not, so an item with no sizes still read a paragraph
  // about sizes and the save button sat below all of it.
  const [openSection, setOpenSection] = useState<'sizes' | 'combo' | 'addons' | 'discount' | null>(null)

  async function write(q: PromiseLike<{ error: { message?: string } | null }>, what: string): Promise<boolean> {
    const { error } = await q
    if (error) { setWriteError(`${what} — ${error.message ?? 'الحفظ فشل'}`); return false }
    setWriteError('')
    return true
  }

  const [sizes, setSizes] = useState<MenuItemSize[]>([])
  const [combos, setCombos] = useState<MenuItemCombo[]>([])
  const [library, setLibrary] = useState<VendorAddonLibraryItem[]>([])
  const [groups, setGroups] = useState<MenuItemAddonGroup[]>([])
  const [addons, setAddons] = useState<MenuItemAddon[]>([])
  const [newGroup, setNewGroup] = useState<{ name: string; kind: 'multi' | 'swap'; required: boolean; maxSelect: string }>(
    { name: '', kind: 'multi', required: false, maxSelect: '' }
  )
  const [newAddon, setNewAddon] = useState<Record<number, { name: string; price: string; imageUrl: string | null; uploading: boolean }>>({})

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    loadOptions()
    return () => { document.body.style.overflow = '' }
  }, [])

  /**
   * Other items on this vendor's menu, offered as ready-made options.
   *
   * Asked for directly: "sometimes i have many sandwiches with some related
   * items wanna choose or select to add them as options". Typing بطاطس وسط and
   * 35 and uploading its photo again -- for the fifth sandwich -- is work the
   * menu already did.
   *
   * The price is COPIED at the moment you tick it, not linked. That matches the
   * add-on library beside it, and it means fries can be 35 with one sandwich and
   * 40 with another; a link would make every sandwich move when the menu moves.
   */
  const [menuOptions, setMenuOptions] = useState<{ id: number; name: string; price: number; image_url: string | null }[]>([])

  async function addAddonFromMenuItem(groupId: number, mi: { name: string; price: number; image_url: string | null }) {
    if (addons.some(a => a.group_id === groupId && a.name === mi.name)) return
    if (!await write(supabase.from('menu_item_addons').insert({
      group_id: groupId, name: mi.name, price: mi.price, image_url: mi.image_url,
      display_order: addons.filter(a => a.group_id === groupId).length
    }), 'إضافة من المنيو')) return
    loadOptions()
  }

  async function loadOptions() {
    supabase.from('menu_items')
      .select('id, name, price, image_url')
      .eq('restaurant_id', item.restaurant_id)
      .eq('available', true)
      .neq('id', item.id)                       // an item cannot be its own add-on
      .order('name')
      .then(({ data }) => setMenuOptions((data ?? []).filter(m => Number(m.price) > 0) as typeof menuOptions))
    supabase.from('vendor_addon_library').select('*').eq('restaurant_id', item.restaurant_id).order('name')
      .then(({ data }) => setLibrary((data as VendorAddonLibraryItem[]) ?? []))
    // These four reads decide what the editor SHOWS as already configured. A
    // failed read used to render as "this item has no sizes / no combos / no
    // add-ons", which is the same screen you get for an item that genuinely has
    // none -- so the natural next action is to add them again. That writes
    // duplicates against rows that were there all along, on the live menu, and
    // then place_order has two «وسط» to choose between.
    const { data: sz, error: szErr } = await supabase.from('menu_item_sizes').select('*').eq('menu_item_id', item.id).order('display_order').order('id')
    const { data: cb, error: cbErr } = await supabase.from('menu_item_combos').select('*').eq('menu_item_id', item.id).order('display_order').order('id')
    const { data: gr, error: grErr } = await supabase.from('menu_item_addon_groups').select('*').eq('menu_item_id', item.id).order('display_order').order('id')
    if (szErr || cbErr || grErr) { setLoadError('مش قادرين نجيب الأحجام والإضافات — ماتضيفش حاجة قبل ما تحدّث، عشان ما تتكررش'); return }

    setSizes(sz ?? [])
    setCombos((cb as MenuItemCombo[]) ?? [])
    setGroups(gr ?? [])
    const groupIds = (gr ?? []).map(g => g.id)
    if (groupIds.length) {
      const { data: ad, error: adErr } = await supabase.from('menu_item_addons').select('*').in('group_id', groupIds).order('display_order').order('id')
      if (adErr) { setLoadError('مش قادرين نجيب الإضافات — ماتضيفش حاجة قبل ما تحدّث، عشان ما تتكررش'); return }
      setAddons(ad ?? [])
    } else {
      setAddons([])
    }
    setLoadError('')
  }

  async function upload(file: File) {
    setUploading(true); setImageError('')
    const { url, error } = await uploadVendorImage(file, `menu-items/${item.restaurant_id}/${item.id}/image`)
    setUploading(false)
    if (error) { setImageError(error); return }
    setImageUrl(url)
  }

  async function save() {
    if (!name.trim() || !price) return
    setSaving(true)
    const ok = await write(supabase.from('menu_items').update({
      name: name.trim(), description: description.trim(), category: category.trim(), price: Number(price), available,
      image_url: imageUrl,
      available_from: hasWindow ? availFrom : null,
      available_until: hasWindow ? availUntil : null
    }).eq('id', item.id), 'حفظ الصنف')
    setSaving(false)
    // Only close on success. Closing regardless is what made a failed price
    // edit look like a stale list.
    if (ok) onSaved()
  }

  async function deleteItem() {
    if (!(await confirmSheet({ title: `حذف «${item.name}» نهائيًا؟`, body: 'الإجراء ده مينفعش يتراجع فيه.', danger: true, confirmLabel: 'احذف' }))) return
    setDeleting(true); setDeleteBlockedReason('')
    const res = await adminCatalogAction('deleteMenuItem', { itemId: item.id })
    setDeleting(false)
    if (!res.ok) {
      setDeleteBlockedReason(
        res.code === 'item_has_order_history'
          ? 'الصنف ده اتطلب قبل كده فمينفعش يتمسح خالص — علّمه "غير متاح" بدل كده عشان محدش يقدر يطلبه تاني.'
          : 'حصل خطأ، جرب تاني'
      )
      return
    }
    onDeleted()
  }

  async function addSizeNamed(name: string, priceValue: string) {
    if (!name.trim() || !priceValue) return
    if (!await write(supabase.from('menu_item_sizes').insert({
      menu_item_id: item.id, name: name.trim(), price: Number(priceValue),
      is_default: sizes.length === 0, display_order: sizes.length
    }), 'إضافة حجم')) return
    loadOptions()
  }
  async function removeSize(id: number) {
    if (!(await confirmSheet({ title: 'حذف الحجم ده؟', danger: true, confirmLabel: 'احذف' }))) return
    if (!await write(supabase.from('menu_item_sizes').delete().eq('id', id), 'حذف حجم')) return
    loadOptions()
  }

  /**
   * One tap for the shapes that come up constantly -- "عادي / دوبل" on a
   * sandwich, "وسط / كبير" on a pizza.
   *
   * Every row is seeded at the item's own base price rather than at a guessed
   * multiple. A guessed price would be wrong silently; an identical price is
   * wrong loudly, and SizesCard says so until it is edited. Editing is now
   * inline, so fixing it is one tap and a number, not delete-and-re-add.
   */
  async function applySizePreset(names: string[]) {
    const base = Number(price) || 0
    const existing = new Set(sizes.map(s => s.name))
    const rows = names.filter(n => !existing.has(n)).map((n, i) => ({
      menu_item_id: item.id, name: n, price: base,
      is_default: sizes.length === 0 && i === 0, display_order: sizes.length + i
    }))
    if (!rows.length) return
    if (!await write(supabase.from('menu_item_sizes').insert(rows), 'إضافة الأحجام')) return
    loadOptions()
  }

  // A preset names these rows for you; renaming one should not mean deleting it
  // and losing its price. The add-on group beside them has always been
  // renameable -- sizes and combos were simply missed.
  async function updateSizeName(id: number, value: string) {
    const n = value.trim()
    if (!n) return
    if (!await write(supabase.from('menu_item_sizes').update({ name: n }).eq('id', id), 'اسم الحجم')) return
    loadOptions()
  }
  async function updateComboName(id: number, value: string) {
    const n = value.trim()
    if (!n) return
    if (!await write(supabase.from('menu_item_combos').update({ name: n }).eq('id', id), 'اسم الكومبو')) return
    loadOptions()
  }

  async function updateSizePrice(id: number, value: string) {
    const n = Number(value)
    if (!value.trim() || Number.isNaN(n) || n < 0) return
    if (!await write(supabase.from('menu_item_sizes').update({ price: n }).eq('id', id), 'سعر الحجم')) return
    loadOptions()
  }

  async function addCombo(name: string, priceValue: string) {
    if (!name.trim() || !priceValue) return
    if (!await write(supabase.from('menu_item_combos').insert({
      menu_item_id: item.id, name: name.trim(), price: Number(priceValue), display_order: combos.length
    }), 'إضافة كومبو')) return
    loadOptions()
  }
  async function removeCombo(id: number) {
    if (!(await confirmSheet({ title: 'حذف الكومبو ده؟', danger: true, confirmLabel: 'احذف' }))) return
    if (!await write(supabase.from('menu_item_combos').delete().eq('id', id), 'حذف كومبو')) return
    loadOptions()
  }
  async function updateComboPrice(id: number, value: string) {
    const n = Number(value)
    if (!value.trim() || Number.isNaN(n) || n < 0) return
    if (!await write(supabase.from('menu_item_combos').update({ price: n }).eq('id', id), 'سعر الكومبو')) return
    loadOptions()
  }
  // Seeded at the item's own price, same reasoning as the size preset: a
  // guessed markup is silently wrong, an identical price is loudly wrong and
  // CombosCard says so until it is fixed.
  async function applyComboPreset(names: string[]) {
    const existing = new Set(combos.map(c => c.name))
    const rows = names.filter(n => !existing.has(n)).map((n, i) => ({
      menu_item_id: item.id, name: n, price: Number(price) || 0, display_order: combos.length + i
    }))
    if (!rows.length) return
    if (!await write(supabase.from('menu_item_combos').insert(rows), 'إضافة الكومبو')) return
    loadOptions()
  }

  async function addGroup() {
    if (!newGroup.name.trim()) return
    if (!await write(supabase.from('menu_item_addon_groups').insert({
      menu_item_id: item.id, name: newGroup.name.trim(),
      min_select: newGroup.required ? 1 : 0,
      max_select: newGroup.kind === 'swap' ? 1 : (newGroup.maxSelect ? Number(newGroup.maxSelect) : null)
    }), 'إضافة مجموعة')) return
    setNewGroup({ name: '', kind: 'multi', required: false, maxSelect: '' })
    loadOptions()
  }
  /**
   * The combo case, in one tap: a group the customer MUST answer and can only
   * answer once ("اختار الساندوتش", three options, pick one).
   *
   * This was always possible -- type a name, pick "تبديل", tick "مطلوب" -- but
   * it took three decisions to express one intent, and the two kinds were
   * distinguished by a max_select of 1 that is never shown as a number
   * anywhere. Now the intent is the button.
   */
  async function applyGroupPreset(kind: 'required-one' | 'extras') {
    const { data, error: groupErr } = await supabase.from('menu_item_addon_groups').insert({
      menu_item_id: item.id,
      name: kind === 'required-one' ? 'اختار نوع الساندوتش' : 'إضافات',
      min_select: kind === 'required-one' ? 1 : 0,
      max_select: kind === 'required-one' ? 1 : null,
      display_order: groups.length
    }).select('id').single()
    if (groupErr) { setWriteError(`إضافة مجموعة — ${groupErr.message}`); return }
    setWriteError('')
    await loadOptions()
    // Drop the cursor straight into the group that was just made, so the next
    // action is typing an option name rather than hunting for where it went.
    if (data?.id) setNewAddon(prev => ({ ...prev, [data.id]: { name: '', price: '', imageUrl: null, uploading: false } }))
  }

  async function renameGroup(id: number, name: string) {
    if (!name.trim()) return
    if (!await write(supabase.from('menu_item_addon_groups').update({ name: name.trim() }).eq('id', id), 'اسم المجموعة')) return
    loadOptions()
  }

  async function updateAddonPrice(id: number, value: string) {
    const n = Number(value)
    if (!value.trim() || Number.isNaN(n) || n < 0) return
    if (!await write(supabase.from('menu_item_addons').update({ price: n }).eq('id', id), 'سعر الإضافة')) return
    loadOptions()
  }

  async function removeGroup(id: number) {
    if (!(await confirmSheet({ title: 'حذف المجموعة دي؟', body: 'هيحذف كل الخيارات اللي جواها.', danger: true, confirmLabel: 'احذف' }))) return
    if (!await write(supabase.from('menu_item_addon_groups').delete().eq('id', id), 'حذف المجموعة')) return
    loadOptions()
  }

  async function addAddonTo(groupId: number) {
    const draft = newAddon[groupId]
    if (!draft?.name.trim()) return
    if (!await write(supabase.from('menu_item_addons').insert({
      group_id: groupId, name: draft.name.trim(), price: Number(draft.price) || 0, image_url: draft.imageUrl
    }), 'إضافة خيار')) return
    setNewAddon(prev => ({ ...prev, [groupId]: { name: '', price: '', imageUrl: null, uploading: false } }))
    loadOptions()
  }
  // Copies the library entry in, rather than pointing at it. Same rule as the
  // bulk apply: the price is meant to differ per item, so this is a starting
  // value that the inline editor next to it can change without touching the
  // library or any other item.
  async function addAddonFromLibrary(groupId: number, entry: VendorAddonLibraryItem) {
    if (addons.some(a => a.group_id === groupId && a.name === entry.name)) return
    if (!await write(supabase.from('menu_item_addons').insert({
      group_id: groupId, name: entry.name, price: entry.price, image_url: entry.image_url,
      display_order: addons.filter(a => a.group_id === groupId).length
    }), 'إضافة من المكتبة')) return
    loadOptions()
  }

  async function removeAddon(id: number) {
    if (!await write(supabase.from('menu_item_addons').delete().eq('id', id), 'حذف الخيار')) return
    loadOptions()
  }

  // Direct inset positioning on the sheet itself -- see the note in
  // ProductDetailSheet.
  return (
    <div ref={overlayRef} role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/60" onClick={onClose}>
      <div className="fixed inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 w-full sm:w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-shellup rounded-t-2xl sm:rounded-2xl p-4" onClick={e => e.stopPropagation()}>
        {sheetElement}
        {writeError && (
          <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-3" role="alert">
            ما اتحفظش: {writeError}
          </p>
        )}
        {loadError && (
          <div className="border border-sand/60 bg-sand/10 rounded-xl p-3 mb-3 flex items-center justify-between gap-3" role="alert">
            <p className="text-sm text-sandink font-semibold">📡 {loadError}</p>
            <button className="btn-ghost !py-1.5 !px-3 text-xs shrink-0" onClick={loadOptions}>حدّث</button>
          </div>
        )}
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="min-w-0">
            <h2 className="font-bold text-lg text-foam">تعديل الصنف</h2>
            {restaurantName && <p className="text-xs text-mist truncate">🏪 {restaurantName}</p>}
          </div>
          <button className="text-mist text-sm bg-shell rounded-full px-3 py-1 shrink-0" onClick={onClose}>✗ إغلاق</button>
        </div>

        <BasicInfoCard
          name={name} setName={setName}
          description={description} setDescription={setDescription}
          category={category} setCategory={setCategory}
          price={price} setPrice={setPrice}
          available={available} setAvailable={setAvailable}
          imageUrl={imageUrl} uploading={uploading} imageError={imageError} onUpload={upload}
          hasWindow={hasWindow} setHasWindow={setHasWindow}
          availFrom={availFrom} setAvailFrom={setAvailFrom}
          availUntil={availUntil} setAvailUntil={setAvailUntil}
        />

        {/* One row instead of four cards. Each chip carries the count of what is
            already configured, so "does this item have sizes" is answerable
            without opening anything -- and an item that needs none of them shows
            four dashed outlines and nothing else. */}
        <p className="text-xs text-mist mb-1.5 px-1">زوّد على الصنف</p>
        <div className="flex gap-1.5 flex-wrap mb-3">
          {([
            { key: 'sizes' as const, label: 'الأحجام', n: sizes.length },
            { key: 'combo' as const, label: 'الكومبو', n: combos.length },
            { key: 'addons' as const, label: 'الإضافات', n: groups.length },
            ...(canManageDiscounts ? [{ key: 'discount' as const, label: 'خصم', n: 0 }] : []),
          ]).map(c => {
            const on = openSection === c.key
            return (
              <button key={c.key}
                className={`rounded-xl px-3 py-2 text-xs font-bold border-2 transition-colors ${
                  on ? 'border-sea bg-sea/10 text-sea'
                    : c.n > 0 ? 'border-line bg-shell text-foam'
                    : 'border-dashed border-line bg-shell text-mist'}`}
                onClick={() => setOpenSection(on ? null : c.key)}>
                {c.n > 0 ? c.label : `+ ${c.label}`}
                {c.n > 0 && <span className="mr-1.5 bg-sea text-white rounded-full px-1.5 text-[10px]">{c.n}</span>}
              </button>
            )
          })}
        </div>

        {openSection === 'discount' && canManageDiscounts && (
          <div className="card p-4 mb-3">
            <p className="font-semibold text-sm mb-2">الخصم على الصنف ده</p>
            <DiscountManager restaurantId={item.restaurant_id} scope="item" menuItemId={item.id} />
          </div>
        )}

        {/* Sizes first, then the combo underneath it -- the same order the
            customer meets them. A combo is an upgrade on top of the sandwich
            you have already chosen, so it reads second in both places. */}
        {openSection === 'sizes' && <OptionRowsCard
          title="الأحجام"
          hint="السعر هنا بدل سعر الصنف، مش زيادة عليه."
          rows={sizes.map(s => ({ id: s.id, name: s.name, price: Number(s.price), note: s.is_default ? '(افتراضي)' : undefined }))}
          presets={[
            { label: 'عادي / دوبل', names: ['عادي', 'دوبل'] },
            { label: 'وسط / كبير', names: ['وسط', 'كبير'] },
            { label: 'صغير / وسط / كبير', names: ['صغير', 'وسط', 'كبير'] },
          ]}
          // A preset seeds every row at the item's own price, which is right for
          // the smallest and wrong for the rest. Guessing a multiple would be
          // silently wrong; identical prices are loudly wrong until fixed.
          warning={sizes.length > 1 && new Set(sizes.map(s => Number(s.price))).size < sizes.length
            ? 'فيه حجمين بنفس السعر — عدّلهم.' : null}
          addPlaceholder="حجم تاني"
          onApplyPreset={applySizePreset} onAdd={addSizeNamed}
          onRemove={removeSize} onPriceChange={updateSizePrice} onNameChange={updateSizeName}
        />}

        {openSection === 'combo' && <OptionRowsCard
          title="الكومبو"
          hint="سعر الكومبو كامل (شامل البطاطس والمشروب). العميل يختار ساندوتش لوحده أو كومبو — مش الاتنين."
          rows={combos.map(c => ({ id: c.id, name: c.name, price: Number(c.price) }))}
          // The name is the fries-and-cola size, not the sandwich's.
          presets={[{ label: 'ابدأ بـ وسط / كبير', names: ['وسط', 'كبير'] }]}
          // A combo at or below the item's own price hands over fries and a
          // drink for free, on every order, and nothing else would notice:
          // place_order charges exactly what this table says.
          warning={(() => {
            const base = Number(price) || 0
            const cheap = combos.filter(c => Number(c.price) <= base)
            return cheap.length ? `${cheap.map(c => c.name).join('، ')} — السعر مش أعلى من ${base} ج.م، يعني الكومبو ببلاش.` : null
          })()}
          addPlaceholder="حجم تاني"
          onApplyPreset={applyComboPreset} onAdd={addCombo}
          onRemove={removeCombo} onPriceChange={updateComboPrice} onNameChange={updateComboName}
        />}

        {openSection === 'addons' && <AddonsCard
          restaurantId={item.restaurant_id}
          groups={groups} addons={addons}
          newGroup={newGroup} setNewGroup={setNewGroup}
          newAddon={newAddon} setNewAddon={setNewAddon}
          onAddGroup={addGroup} onRemoveGroup={removeGroup}
          onAddAddon={addAddonTo} onRemoveAddon={removeAddon}
          onApplyPreset={applyGroupPreset} onRenameGroup={renameGroup}
          onAddonPriceChange={updateAddonPrice}
          library={library} onAddFromLibrary={addAddonFromLibrary}
          menuOptions={menuOptions} onAddFromMenu={addAddonFromMenuItem}
        />}

        <button className="btn-sea w-full !py-3 mb-3" disabled={saving || !name.trim() || !category.trim() || !price} onClick={save}>
          {saving ? 'جاري الحفظ…' : 'حفظ'}
        </button>

        <DangerZoneCard deleting={deleting} deleteBlockedReason={deleteBlockedReason} onDelete={deleteItem} />
      </div>
    </div>
  )
}
