import { useState } from 'react'
import { uploadVendorImage } from '../../lib/upload'
import type { MenuItemAddon, MenuItemAddonGroup, VendorAddonLibraryItem } from '../../lib/types'

type NewAddonDraft = { name: string; price: string; imageUrl: string | null; uploading: boolean }

export default function AddonsCard({
  groups, addons, newGroup, setNewGroup, newAddon, setNewAddon,
  onAddGroup, onRemoveGroup, onAddAddon, onRemoveAddon,
  onApplyPreset, onRenameGroup, onAddonPriceChange,
  library, onAddFromLibrary
}: {
  /** The vendor's saved add-ons, offered as one-tap chips. */
  library: VendorAddonLibraryItem[]
  onAddFromLibrary: (groupId: number, entry: VendorAddonLibraryItem) => void
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
  // The two preset buttons cover every group anyone has actually needed. The
  // full form stays for the rare case, one tap away, instead of being the first
  // thing on screen.
  const [advanced, setAdvanced] = useState(false)

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
      <p className="font-semibold text-sm mb-3">الإضافات</p>

      {/* Two buttons instead of a paragraph. The old copy explained the two
          kinds of group in prose, then asked for the same distinction again as
          a dropdown -- the button labels carry it now. */}
      {groups.length === 0 && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button className="text-xs py-2.5 px-2 rounded-lg border-2 border-line hover:border-sea text-right"
            onClick={() => onApplyPreset('extras')}>
            <span className="block font-bold">➕ إضافات</span>
            <span className="block text-mist mt-0.5">يختار قد ما يحب</span>
          </button>
          <button className="text-xs py-2.5 px-2 rounded-lg border-2 border-line hover:border-sea text-right"
            onClick={() => onApplyPreset('required-one')}>
            <span className="block font-bold">🔁 اختيار مطلوب</span>
            <span className="block text-mist mt-0.5">واحد بس، ولازم يختار</span>
          </button>
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

            {/* One tap instead of a name, a price and a photo upload. The
                library already holds all three, and the vendor typing "طماطم"
                by hand for the fortieth time is how a menu ends up with طماطم
                and طماطة as two different options.

                Chips already in this group are filtered out, so the row shows
                only what tapping would actually do. */}
            {library.filter(l => !addons.some(a => a.group_id === g.id && a.name === l.name)).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {library
                  .filter(l => !addons.some(a => a.group_id === g.id && a.name === l.name))
                  .map(l => (
                    <button key={l.id}
                      className="flex items-center gap-1.5 text-xs py-1 pr-1 pl-2.5 rounded-full border-2 border-line hover:border-sea"
                      onClick={() => onAddFromLibrary(g.id, l)}>
                      {l.image_url
                        ? <img src={l.image_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                        : <span className="w-5 h-5 rounded-full bg-shellup grid place-items-center text-[10px]">+</span>}
                      <span>{l.name}</span>
                      {Number(l.price) > 0 && <span className="text-mist">{l.price}</span>}
                    </button>
                  ))}
              </div>
            )}

            <div className="bg-shellup/60 rounded-lg p-2.5">
              <div className="flex items-center gap-2 mb-2">
                {draft.imageUrl
                  ? <img src={draft.imageUrl} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />
                  : <div className="w-9 h-9 rounded-lg bg-shell border border-line shrink-0" />}
                <label className="text-xs text-sea cursor-pointer">
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      e.target.value = ''   // so the same photo can be picked again
                      if (f) uploadOptionImage(g.id, f)
                    }} />
                  {draft.uploading ? 'جاري الرفع…' : (draft.imageUrl ? 'تغيير الصورة' : '🖼️ صورة (اختياري)')}
                </label>
              </div>
              <div className="flex gap-2">
                <input className="field !py-1.5 text-sm" placeholder="اسم الخيار الجديد" value={draft.name}
                  onChange={e => setNewAddon({ ...newAddon, [g.id]: { ...draft, name: e.target.value } })} />
                <input className="field !py-1.5 !w-20 text-sm" type="number" placeholder="السعر" value={draft.price}
                  onChange={e => setNewAddon({ ...newAddon, [g.id]: { ...draft, price: e.target.value } })} />
                <button className="btn-ghost !py-1.5 !px-3 text-sm shrink-0" onClick={() => onAddAddon(g.id)}>إضافة</button>
              </div>
            </div>
          </div>
        )
      })}

      {!advanced ? (
        <button className="text-xs text-sea font-semibold" onClick={() => setAdvanced(true)}>
          + مجموعة بإعدادات متقدمة
        </button>
      ) : (
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
      )}
    </div>
  )
}
