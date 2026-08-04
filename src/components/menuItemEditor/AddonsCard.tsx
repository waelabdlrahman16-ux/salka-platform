import { useState } from 'react'
import { uploadVendorImage } from '../../lib/upload'
import type { MenuItemAddon, MenuItemAddonGroup } from '../../lib/types'

type NewAddonDraft = { name: string; price: string; imageUrl: string | null; uploading: boolean }

export default function AddonsCard({
  groups, addons, newGroup, setNewGroup, newAddon, setNewAddon,
  onAddGroup, onRemoveGroup, onAddAddon, onRemoveAddon,
  onApplyPreset, onRenameGroup, onAddonPriceChange
}: {
  groups: MenuItemAddonGroup[]
  addons: MenuItemAddon[]
  onApplyPreset: (kind: 'required-one' | 'extras') => void
  onRenameGroup: (id: number, name: string) => void
  onAddonPriceChange: (id: number, price: string) => void
  newGroup: { name: string; kind: 'multi' | 'swap'; required: boolean; maxSelect: string }
  setNewGroup: (v: { name: string; kind: 'multi' | 'swap'; required: boolean; maxSelect: string }) => void
  newAddon: Record<number, NewAddonDraft>
  setNewAddon: (v: Record<number, NewAddonDraft>) => void
  onAddGroup: () => void
  onRemoveGroup: (id: number) => void
  onAddAddon: (groupId: number) => void
  onRemoveAddon: (id: number) => void
}) {
  function draftFor(groupId: number): NewAddonDraft {
    return newAddon[groupId] ?? { name: '', price: '', imageUrl: null, uploading: false }
  }

  async function uploadOptionImage(groupId: number, file: File) {
    const draft = draftFor(groupId)
    setNewAddon({ ...newAddon, [groupId]: { ...draft, uploading: true } })
    const { url } = await uploadVendorImage(file, `menu-addon-options/${groupId}/${Date.now()}`)
    setNewAddon({ ...newAddon, [groupId]: { ...draft, uploading: false, imageUrl: url ?? draft.imageUrl } })
  }

  return (
    <div className="card p-4 mb-3">
      <p className="font-semibold text-sm mb-1">الإضافات ومجموعات الاختيار (اختياري)</p>
      <p className="text-xs text-mist mb-3">
        فيه نوعين: <b>إضافات عادية</b> زي "جبنة إضافية" (العميل يختار كذا واحدة)، أو <b>اختيار مطلوب</b> زي كومبو فيه ٣ ساندوتشات والعميل لازم يختار واحد منهم.
      </p>

      {/* The combo shape used to take three decisions to express one intent:
          type a name, pick "تبديل", tick "مطلوب". Two buttons now. */}
      {groups.length === 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold mb-1.5">ابدأ بضغطة واحدة</p>
          <div className="grid grid-cols-2 gap-2">
            <button className="text-xs py-2.5 px-2 rounded-lg border-2 border-line hover:border-sea text-right"
              onClick={() => onApplyPreset('required-one')}>
              <span className="block font-bold">🔁 اختيار مطلوب</span>
              <span className="block text-mist mt-0.5">كومبو — يختار واحد بس، ولازم يختار</span>
            </button>
            <button className="text-xs py-2.5 px-2 rounded-lg border-2 border-line hover:border-sea text-right"
              onClick={() => onApplyPreset('extras')}>
              <span className="block font-bold">➕ إضافات</span>
              <span className="block text-mist mt-0.5">اختياري — يختار قد ما يحب</span>
            </button>
          </div>
        </div>
      )}

      {groups.map(g => {
        const draft = draftFor(g.id)
        const isSwap = g.max_select === 1
        return (
          <div key={g.id} className="bg-night border border-line rounded-xl p-3 mb-3">
            <div className="flex items-center justify-between mb-3 gap-2">
              <div className="flex-1 min-w-0">
                {/* A preset names the group for you; renaming it should not mean
                    deleting it and losing every option inside. */}
                <input className="field !py-1 !text-sm font-semibold w-full"
                  defaultValue={g.name} aria-label="اسم المجموعة"
                  onBlur={e => { if (e.target.value.trim() !== g.name) onRenameGroup(g.id, e.target.value) }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                <p className="text-xs text-mist mt-0.5">
                  {isSwap ? '🔁 اختيار واحد بس' : '➕ إضافات — أكتر من واحدة'}
                  {g.min_select > 0 && <span className="text-sandink"> · مطلوب</span>}
                  {!isSwap && g.max_select != null && <span> · حد أقصى {g.max_select}</span>}
                </p>
              </div>
              <button className="text-red-500 text-xs shrink-0" onClick={() => onRemoveGroup(g.id)}>حذف المجموعة</button>
            </div>

            <div className="space-y-2 mb-3">
              {addons.filter(a => a.group_id === g.id).map(a => (
                <div key={a.id} className="flex items-center gap-2.5 text-sm px-2.5 py-2 bg-shell rounded-lg">
                  {a.image_url
                    ? <img src={a.image_url} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />
                    : <div className="w-9 h-9 rounded-lg bg-shellup shrink-0" />}
                  <span className="flex-1 min-w-0 truncate">{a.name}</span>
                  <input className="field !py-1 !w-16 !text-sm text-center" type="number" inputMode="numeric"
                    defaultValue={String(a.price)} aria-label={`سعر ${a.name}`}
                    onBlur={e => { if (Number(e.target.value) !== Number(a.price)) onAddonPriceChange(a.id, e.target.value) }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                  <span className="text-xs text-mist shrink-0">{Number(a.price) > 0 ? 'ج.م' : 'مجانًا'}</span>
                  <button className="text-red-500 text-xs shrink-0" onClick={() => onRemoveAddon(a.id)}>حذف</button>
                </div>
              ))}
              {addons.filter(a => a.group_id === g.id).length === 0 && (
                <p className="text-xs text-mist">لسه مفيش خيارات — ضيف واحد تحت</p>
              )}
            </div>

            <div className="bg-shellup/60 rounded-lg p-2.5">
              <p className="text-xs font-semibold mb-2">إضافة خيار للمجموعة دي</p>
              <div className="flex items-center gap-2 mb-2">
                {draft.imageUrl
                  ? <img src={draft.imageUrl} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />
                  : <div className="w-9 h-9 rounded-lg bg-shell border border-line shrink-0" />}
                <label className="text-xs text-sea cursor-pointer">
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                    onChange={e => e.target.files?.[0] && uploadOptionImage(g.id, e.target.files[0])} />
                  {draft.uploading ? 'جاري الرفع…' : (draft.imageUrl ? 'تغيير الصورة' : '🖼️ صورة (اختياري)')}
                </label>
              </div>
              <div className="flex gap-2">
                <input className="field !py-1.5 text-sm" placeholder="اسم الخيار" value={draft.name}
                  onChange={e => setNewAddon({ ...newAddon, [g.id]: { ...draft, name: e.target.value } })} />
                <input className="field !py-1.5 !w-20 text-sm" type="number" placeholder="السعر" value={draft.price}
                  onChange={e => setNewAddon({ ...newAddon, [g.id]: { ...draft, price: e.target.value } })} />
                <button className="btn-ghost !py-1.5 !px-3 text-sm shrink-0" onClick={() => onAddAddon(g.id)}>إضافة</button>
              </div>
            </div>
          </div>
        )
      })}

      <div className="bg-shellup/60 rounded-xl p-3">
        <p className="text-xs font-semibold mb-2">مجموعة جديدة</p>
        <input className="field !py-1.5 text-sm mb-3" placeholder="اسم المجموعة (مثلاً: إضافات، اختار الساندوتش الأول)" value={newGroup.name}
          onChange={e => setNewGroup({ ...newGroup, name: e.target.value })} />

        <p className="text-xs font-semibold mb-1.5">نوع المجموعة</p>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button className={`text-xs py-2 rounded-lg border-2 ${newGroup.kind === 'multi' ? 'border-sea bg-sea/5' : 'border-line'}`}
            onClick={() => setNewGroup({ ...newGroup, kind: 'multi' })}>
            ➕ إضافات (أكتر من واحدة)
          </button>
          <button className={`text-xs py-2 rounded-lg border-2 ${newGroup.kind === 'swap' ? 'border-sea bg-sea/5' : 'border-line'}`}
            onClick={() => setNewGroup({ ...newGroup, kind: 'swap' })}>
            🔁 تبديل (اختيار واحد بس)
          </button>
        </div>

        <div className="flex items-center gap-4 mb-3 text-xs">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={newGroup.required} onChange={e => setNewGroup({ ...newGroup, required: e.target.checked })} />
            مطلوب (العميل لازم يختار)
          </label>
          {newGroup.kind === 'multi' && (
            <label className="flex items-center gap-1.5">
              حد أقصى:
              <input className="field !py-1 !w-16 !text-xs" type="number" placeholder="بلا حد" value={newGroup.maxSelect}
                onChange={e => setNewGroup({ ...newGroup, maxSelect: e.target.value })} />
            </label>
          )}
        </div>

        <button className="btn-ghost w-full !py-1.5 text-sm" onClick={onAddGroup}>إضافة مجموعة</button>
      </div>
    </div>
  )
}
