import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { uploadVendorImage } from '../lib/upload'
import { useDismissable } from '../lib/useDismissable'
import BasicInfoCard from './menuItemEditor/BasicInfoCard'
import OptionRowsCard from './menuItemEditor/OptionRowsCard'
import AddonsCard from './menuItemEditor/AddonsCard'
import DangerZoneCard from './menuItemEditor/DangerZoneCard'
import DiscountManager from './DiscountManager'
import type { MenuItem, MenuItemAddon, MenuItemAddonGroup, MenuItemCombo, MenuItemSize, VendorAddonLibraryItem } from '../lib/types'

export default function MenuItemEditor({ item, onClose, onSaved, onDeleted, canManageDiscounts = true }: {
  item: MenuItem
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
  /** Discounts move margin, so they stay admin-only -- a catalog user gets the
   *  rest of the editor without a section whose writes RLS would reject. */
  canManageDiscounts?: boolean
}) {
  const overlayRef = useDismissable(onClose)
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

  async function loadOptions() {
    supabase.from('vendor_addon_library').select('*').eq('restaurant_id', item.restaurant_id).order('name')
      .then(({ data }) => setLibrary((data as VendorAddonLibraryItem[]) ?? []))
    const { data: sz } = await supabase.from('menu_item_sizes').select('*').eq('menu_item_id', item.id).order('display_order').order('id')
    setSizes(sz ?? [])
    const { data: cb } = await supabase.from('menu_item_combos').select('*').eq('menu_item_id', item.id).order('display_order').order('id')
    setCombos((cb as MenuItemCombo[]) ?? [])
    const { data: gr } = await supabase.from('menu_item_addon_groups').select('*').eq('menu_item_id', item.id).order('display_order').order('id')
    setGroups(gr ?? [])
    const groupIds = (gr ?? []).map(g => g.id)
    if (groupIds.length) {
      const { data: ad } = await supabase.from('menu_item_addons').select('*').in('group_id', groupIds).order('display_order').order('id')
      setAddons(ad ?? [])
    } else {
      setAddons([])
    }
  }

  async function upload(file: File) {
    setUploading(true); setImageError('')
    const { url, error } = await uploadVendorImage(file, `menu-items/${item.id}/image`)
    setUploading(false)
    if (error) { setImageError(error); return }
    setImageUrl(url)
  }

  async function save() {
    if (!name.trim() || !price) return
    setSaving(true)
    await supabase.from('menu_items').update({
      name: name.trim(), description: description.trim(), category: category.trim(), price: Number(price), available,
      image_url: imageUrl,
      available_from: hasWindow ? availFrom : null,
      available_until: hasWindow ? availUntil : null
    }).eq('id', item.id)
    setSaving(false)
    onSaved()
  }

  async function deleteItem() {
    if (!confirm(`حذف "${item.name}" نهائيًا؟ الإجراء ده مينفعش يتراجع فيه.`)) return
    setDeleting(true); setDeleteBlockedReason('')
    const { error } = await supabase.rpc('admin_delete_menu_item', { p_item_id: item.id })
    setDeleting(false)
    if (error) {
      setDeleteBlockedReason(
        error.message.includes('item_has_order_history')
          ? 'الصنف ده اتطلب قبل كده فمينفعش يتمسح خالص — علّمه "غير متاح" بدل كده عشان محدش يقدر يطلبه تاني.'
          : 'حصل خطأ، جرب تاني'
      )
      return
    }
    onDeleted()
  }

  async function addSizeNamed(name: string, priceValue: string) {
    if (!name.trim() || !priceValue) return
    await supabase.from('menu_item_sizes').insert({
      menu_item_id: item.id, name: name.trim(), price: Number(priceValue),
      is_default: sizes.length === 0, display_order: sizes.length
    })
    loadOptions()
  }
  async function removeSize(id: number) {
    if (!confirm('حذف الحجم ده؟')) return
    await supabase.from('menu_item_sizes').delete().eq('id', id)
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
    await supabase.from('menu_item_sizes').insert(rows)
    loadOptions()
  }

  async function updateSizePrice(id: number, value: string) {
    const n = Number(value)
    if (!value.trim() || Number.isNaN(n) || n < 0) return
    await supabase.from('menu_item_sizes').update({ price: n }).eq('id', id)
    loadOptions()
  }

  async function addCombo(name: string, priceValue: string) {
    if (!name.trim() || !priceValue) return
    await supabase.from('menu_item_combos').insert({
      menu_item_id: item.id, name: name.trim(), price: Number(priceValue), display_order: combos.length
    })
    loadOptions()
  }
  async function removeCombo(id: number) {
    if (!confirm('حذف الكومبو ده؟')) return
    await supabase.from('menu_item_combos').delete().eq('id', id)
    loadOptions()
  }
  async function updateComboPrice(id: number, value: string) {
    const n = Number(value)
    if (!value.trim() || Number.isNaN(n) || n < 0) return
    await supabase.from('menu_item_combos').update({ price: n }).eq('id', id)
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
    await supabase.from('menu_item_combos').insert(rows)
    loadOptions()
  }

  async function addGroup() {
    if (!newGroup.name.trim()) return
    await supabase.from('menu_item_addon_groups').insert({
      menu_item_id: item.id, name: newGroup.name.trim(),
      min_select: newGroup.required ? 1 : 0,
      max_select: newGroup.kind === 'swap' ? 1 : (newGroup.maxSelect ? Number(newGroup.maxSelect) : null)
    })
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
    const { data } = await supabase.from('menu_item_addon_groups').insert({
      menu_item_id: item.id,
      name: kind === 'required-one' ? 'اختار نوع الساندوتش' : 'إضافات',
      min_select: kind === 'required-one' ? 1 : 0,
      max_select: kind === 'required-one' ? 1 : null,
      display_order: groups.length
    }).select('id').single()
    await loadOptions()
    // Drop the cursor straight into the group that was just made, so the next
    // action is typing an option name rather than hunting for where it went.
    if (data?.id) setNewAddon(prev => ({ ...prev, [data.id]: { name: '', price: '', imageUrl: null, uploading: false } }))
  }

  async function renameGroup(id: number, name: string) {
    if (!name.trim()) return
    await supabase.from('menu_item_addon_groups').update({ name: name.trim() }).eq('id', id)
    loadOptions()
  }

  async function updateAddonPrice(id: number, value: string) {
    const n = Number(value)
    if (!value.trim() || Number.isNaN(n) || n < 0) return
    await supabase.from('menu_item_addons').update({ price: n }).eq('id', id)
    loadOptions()
  }

  async function removeGroup(id: number) {
    if (!confirm('حذف المجموعة دي هيحذف كل الخيارات اللي جواها. متأكد؟')) return
    await supabase.from('menu_item_addon_groups').delete().eq('id', id)
    loadOptions()
  }

  async function addAddonTo(groupId: number) {
    const draft = newAddon[groupId]
    if (!draft?.name.trim()) return
    await supabase.from('menu_item_addons').insert({
      group_id: groupId, name: draft.name.trim(), price: Number(draft.price) || 0, image_url: draft.imageUrl
    })
    setNewAddon(prev => ({ ...prev, [groupId]: { name: '', price: '', imageUrl: null, uploading: false } }))
    loadOptions()
  }
  // Copies the library entry in, rather than pointing at it. Same rule as the
  // bulk apply: the price is meant to differ per item, so this is a starting
  // value that the inline editor next to it can change without touching the
  // library or any other item.
  async function addAddonFromLibrary(groupId: number, entry: VendorAddonLibraryItem) {
    if (addons.some(a => a.group_id === groupId && a.name === entry.name)) return
    await supabase.from('menu_item_addons').insert({
      group_id: groupId, name: entry.name, price: entry.price, image_url: entry.image_url,
      display_order: addons.filter(a => a.group_id === groupId).length
    })
    loadOptions()
  }

  async function removeAddon(id: number) {
    await supabase.from('menu_item_addons').delete().eq('id', id)
    loadOptions()
  }

  return (
    <div ref={overlayRef} role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/60 grid place-items-end sm:place-items-center p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-shellup rounded-t-2xl sm:rounded-2xl p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="font-bold text-lg text-foam">تعديل الصنف</h2>
          <button className="text-mist text-sm bg-shell rounded-full px-3 py-1" onClick={onClose}>✗ إغلاق</button>
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

        {canManageDiscounts && (
          <div className="card p-4 mb-3">
            <p className="font-semibold text-sm mb-2">الخصم على الصنف ده</p>
            <DiscountManager restaurantId={item.restaurant_id} scope="item" menuItemId={item.id} />
          </div>
        )}

        {/* Sizes first, then the combo underneath it -- the same order the
            customer meets them. A combo is an upgrade on top of the sandwich
            you have already chosen, so it reads second in both places. */}
        <OptionRowsCard
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
          onRemove={removeSize} onPriceChange={updateSizePrice}
        />

        <OptionRowsCard
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
          onRemove={removeCombo} onPriceChange={updateComboPrice}
        />

        <AddonsCard
          groups={groups} addons={addons}
          newGroup={newGroup} setNewGroup={setNewGroup}
          newAddon={newAddon} setNewAddon={setNewAddon}
          onAddGroup={addGroup} onRemoveGroup={removeGroup}
          onAddAddon={addAddonTo} onRemoveAddon={removeAddon}
          onApplyPreset={applyGroupPreset} onRenameGroup={renameGroup}
          onAddonPriceChange={updateAddonPrice}
          library={library} onAddFromLibrary={addAddonFromLibrary}
        />

        <button className="btn-sea w-full !py-3 mb-3" disabled={saving || !name.trim() || !category.trim() || !price} onClick={save}>
          {saving ? 'جاري الحفظ…' : 'حفظ'}
        </button>

        <DangerZoneCard deleting={deleting} deleteBlockedReason={deleteBlockedReason} onDelete={deleteItem} />
      </div>
    </div>
  )
}
