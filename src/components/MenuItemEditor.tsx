import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { uploadVendorImage } from '../lib/upload'
import type { MenuItem, MenuItemAddon, MenuItemAddonGroup, MenuItemSize } from '../lib/types'

export default function MenuItemEditor({ item, onClose, onSaved }: {
  item: MenuItem
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(item.name)
  const [description, setDescription] = useState(item.description ?? '')
  const [price, setPrice] = useState(String(item.price))
  const [available, setAvailable] = useState(item.available)
  const [hasWindow, setHasWindow] = useState(!!(item.available_from && item.available_until))
  const [availFrom, setAvailFrom] = useState(item.available_from?.slice(0, 5) ?? '09:00')
  const [availUntil, setAvailUntil] = useState(item.available_until?.slice(0, 5) ?? '11:00')
  const [imageUrl, setImageUrl] = useState(item.image_url)
  const [uploading, setUploading] = useState(false)
  const [imageError, setImageError] = useState('')
  const [saving, setSaving] = useState(false)

  const [sizes, setSizes] = useState<MenuItemSize[]>([])
  const [newSize, setNewSize] = useState({ name: '', price: '' })
  const [groups, setGroups] = useState<MenuItemAddonGroup[]>([])
  const [addons, setAddons] = useState<MenuItemAddon[]>([])
  const [newGroup, setNewGroup] = useState({ name: '', required: false, singleChoice: false, maxSelect: '' })
  const [newAddon, setNewAddon] = useState<Record<number, { name: string; price: string }>>({})

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
      name: name.trim(), description: description.trim(), price: Number(price), available,
      image_url: imageUrl,
      available_from: hasWindow ? availFrom : null,
      available_until: hasWindow ? availUntil : null
    }).eq('id', item.id)
    setSaving(false)
    onSaved()
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
      max_select: newGroup.singleChoice ? 1 : (newGroup.maxSelect ? Number(newGroup.maxSelect) : null)
    })
    setNewGroup({ name: '', required: false, singleChoice: false, maxSelect: '' })
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
      group_id: groupId, name: draft.name.trim(), price: Number(draft.price) || 0
    })
    setNewAddon(prev => ({ ...prev, [groupId]: { name: '', price: '' } }))
    loadOptions()
  }
  async function removeAddon(id: number) {
    await supabase.from('menu_item_addons').delete().eq('id', id)
    loadOptions()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 grid place-items-end sm:place-items-center p-0 sm:p-4" onClick={onClose}>
      <div className="card w-full sm:max-w-lg p-5 rounded-b-none sm:rounded-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg">تعديل الصنف</h2>
          <button className="text-mist text-sm" onClick={onClose}>✗ إغلاق</button>
        </div>

        <div className="flex items-center gap-3 mb-4">
          {imageUrl
            ? <img src={imageUrl} alt="" className="w-16 h-16 rounded-xl object-cover border border-line" />
            : <div className="w-16 h-16 rounded-xl bg-shellup grid place-items-center text-mist text-xs">لا صورة</div>}
          <label className="text-sm text-sea cursor-pointer">
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
              onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
            {uploading ? 'جاري الرفع…' : (imageUrl ? '🖼️ تغيير الصورة' : '🖼️ إضافة صورة')}
          </label>
        </div>
        {imageError && <p className="text-xs text-sand mb-3">{imageError}</p>}

        <div className="space-y-3 mb-4">
          <div>
            <label className="label">الاسم</label>
            <input className="field" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">الوصف</label>
            <textarea className="field" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="label">السعر</label>
            <input className="field" type="number" value={price} onChange={e => setPrice(e.target.value)} />
          </div>
          <button className={`w-full py-2.5 rounded-xl text-sm font-semibold border-2 ${available ? 'border-emerald-500/40 text-emerald-700 bg-emerald-500/5' : 'border-red-400/40 text-red-600 bg-red-500/5'}`}
            onClick={() => setAvailable(v => !v)}>
            {available ? '✓ متاح للطلب' : '✗ غير متاح (خلص)'}
          </button>
        </div>

        <div className="border-t border-line pt-3 mb-4">
          <label className="flex items-center gap-2 text-sm font-semibold mb-2">
            <input type="checkbox" checked={hasWindow} onChange={e => setHasWindow(e.target.checked)} className="accent-sea" />
            متاح في وقت محدد بس (مثلاً فطار 9-11)
          </label>
          {hasWindow && (
            <div className="flex items-center gap-2">
              <input type="time" className="field !py-1.5" value={availFrom} onChange={e => setAvailFrom(e.target.value)} />
              <span className="text-mist text-sm">لحد</span>
              <input type="time" className="field !py-1.5" value={availUntil} onChange={e => setAvailUntil(e.target.value)} />
            </div>
          )}
        </div>

        <div className="border-t border-line pt-3 mb-4">
          <p className="font-semibold text-sm mb-2">الأحجام (اختياري)</p>
          <p className="text-xs text-mist mb-2">لو ضفت حجم، العميل هيضطر يختار واحد قبل ما يضيف الصنف — والسعر هنا بيبقى بدل السعر الأساسي، مش زيادة عليه.</p>
          <div className="space-y-2 mb-2">
            {sizes.map(s => (
              <div key={s.id} className="flex items-center justify-between bg-night border border-line rounded-lg p-2.5 text-sm">
                <span>{s.name} {s.is_default && <span className="text-xs text-mist">(افتراضي)</span>}</span>
                <div className="flex items-center gap-2">
                  <span>{s.price} ج.م</span>
                  <button className="text-red-500 text-xs" onClick={() => removeSize(s.id)}>حذف</button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input className="field !py-1.5 text-sm" placeholder="اسم الحجم (وسط، كبير)" value={newSize.name}
              onChange={e => setNewSize({ ...newSize, name: e.target.value })} />
            <input className="field !py-1.5 !w-24 text-sm" type="number" placeholder="السعر" value={newSize.price}
              onChange={e => setNewSize({ ...newSize, price: e.target.value })} />
            <button className="btn-ghost !py-1.5 !px-3 text-sm shrink-0" onClick={addSize}>إضافة</button>
          </div>
        </div>

        <div className="border-t border-line pt-3 mb-2">
          <p className="font-semibold text-sm mb-2">الإضافات ومجموعات الاختيار (اختياري)</p>
          <p className="text-xs text-mist mb-3">استخدمها لإضافات زي "جبنة إضافية"، أو لتبديل صنف داخل بوكس (زي "اختار الساندوتش الأول") — خليها "اختيار واحد بس" في الحالة دي.</p>

          {groups.map(g => (
            <div key={g.id} className="bg-night border border-line rounded-xl p-3 mb-3">
              <div className="flex items-center justify-between mb-2">
                <p className="font-semibold text-sm">
                  {g.name} {g.min_select > 0 && <span className="text-sand">*مطلوب</span>}
                  {g.max_select === 1 && <span className="text-mist text-xs"> (اختيار واحد)</span>}
                </p>
                <button className="text-red-500 text-xs" onClick={() => removeGroup(g.id)}>حذف المجموعة</button>
              </div>
              <div className="space-y-1.5 mb-2">
                {addons.filter(a => a.group_id === g.id).map(a => (
                  <div key={a.id} className="flex items-center justify-between text-sm px-2.5 py-1.5 bg-shell rounded-lg">
                    <span>{a.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-mist">{a.price > 0 ? `+${a.price} ج.م` : 'مجانًا'}</span>
                      <button className="text-red-500 text-xs" onClick={() => removeAddon(a.id)}>حذف</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input className="field !py-1.5 text-sm" placeholder="اسم الخيار" value={newAddon[g.id]?.name ?? ''}
                  onChange={e => setNewAddon(prev => ({ ...prev, [g.id]: { name: e.target.value, price: prev[g.id]?.price ?? '' } }))} />
                <input className="field !py-1.5 !w-20 text-sm" type="number" placeholder="السعر" value={newAddon[g.id]?.price ?? ''}
                  onChange={e => setNewAddon(prev => ({ ...prev, [g.id]: { name: prev[g.id]?.name ?? '', price: e.target.value } }))} />
                <button className="btn-ghost !py-1.5 !px-3 text-sm shrink-0" onClick={() => addAddonTo(g.id)}>إضافة</button>
              </div>
            </div>
          ))}

          <div className="bg-shellup/60 rounded-xl p-3">
            <p className="text-xs font-semibold mb-2">مجموعة جديدة</p>
            <input className="field !py-1.5 text-sm mb-2" placeholder="اسم المجموعة (إضافات، اختار الساندوتش)" value={newGroup.name}
              onChange={e => setNewGroup({ ...newGroup, name: e.target.value })} />
            <div className="flex items-center gap-4 mb-2 text-xs">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={newGroup.required} onChange={e => setNewGroup({ ...newGroup, required: e.target.checked })} /> مطلوب</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={newGroup.singleChoice} onChange={e => setNewGroup({ ...newGroup, singleChoice: e.target.checked })} /> اختيار واحد بس (تبديل)</label>
              {!newGroup.singleChoice && (
                <input className="field !py-1 !w-20 !text-xs" type="number" placeholder="حد أقصى" value={newGroup.maxSelect}
                  onChange={e => setNewGroup({ ...newGroup, maxSelect: e.target.value })} />
              )}
            </div>
            <button className="btn-ghost w-full !py-1.5 text-sm" onClick={addGroup}>إضافة مجموعة</button>
          </div>
        </div>

        <button className="btn-sea w-full !py-3 mt-2" disabled={saving || !name.trim() || !price} onClick={save}>
          {saving ? 'جاري الحفظ…' : 'حفظ'}
        </button>
      </div>
    </div>
  )
}
