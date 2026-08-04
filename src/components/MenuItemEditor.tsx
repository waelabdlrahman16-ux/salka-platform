import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { uploadVendorImage } from '../lib/upload'
import BasicInfoCard from './menuItemEditor/BasicInfoCard'
import SizesCard from './menuItemEditor/SizesCard'
import AddonsCard from './menuItemEditor/AddonsCard'
import DangerZoneCard from './menuItemEditor/DangerZoneCard'
import DiscountManager from './DiscountManager'
import type { MenuItem, MenuItemAddon, MenuItemAddonGroup, MenuItemSize } from '../lib/types'

export default function MenuItemEditor({ item, onClose, onSaved, onDeleted, canManageDiscounts = true }: {
  item: MenuItem
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
  /** Discounts move margin, so they stay admin-only -- a catalog user gets the
   *  rest of the editor without a section whose writes RLS would reject. */
  canManageDiscounts?: boolean
}) {
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
  const [newSize, setNewSize] = useState({ name: '', price: '' })
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
    const { data: sz } = await supabase.from('menu_item_sizes').select('*').eq('menu_item_id', item.id).order('display_order').order('id')
    setSizes(sz ?? [])
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

  async function addSize() {
    if (!newSize.name.trim() || !newSize.price) return
    await supabase.from('menu_item_sizes').insert({
      menu_item_id: item.id, name: newSize.name.trim(), price: Number(newSize.price),
      is_default: sizes.length === 0
    })
    setNewSize({ name: '', price: '' })
    loadOptions()
  }
  async function removeSize(id: number) {
    if (!confirm('حذف الحجم ده؟')) return
    await supabase.from('menu_item_sizes').delete().eq('id', id)
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
  async function removeAddon(id: number) {
    await supabase.from('menu_item_addons').delete().eq('id', id)
    loadOptions()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 grid place-items-end sm:place-items-center p-0 sm:p-4" onClick={onClose}>
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

        <SizesCard sizes={sizes} newSize={newSize} setNewSize={setNewSize} onAdd={addSize} onRemove={removeSize} />

        <AddonsCard
          groups={groups} addons={addons}
          newGroup={newGroup} setNewGroup={setNewGroup}
          newAddon={newAddon} setNewAddon={setNewAddon}
          onAddGroup={addGroup} onRemoveGroup={removeGroup}
          onAddAddon={addAddonTo} onRemoveAddon={removeAddon}
        />

        <button className="btn-sea w-full !py-3 mb-3" disabled={saving || !name.trim() || !category.trim() || !price} onClick={save}>
          {saving ? 'جاري الحفظ…' : 'حفظ'}
        </button>

        <DangerZoneCard deleting={deleting} deleteBlockedReason={deleteBlockedReason} onDelete={deleteItem} />
      </div>
    </div>
  )
}
