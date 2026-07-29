import type { MenuItemAddon, MenuItemAddonGroup } from '../../lib/types'

export default function AddonsCard({
  groups, addons, newGroup, setNewGroup, newAddon, setNewAddon,
  onAddGroup, onRemoveGroup, onAddAddon, onRemoveAddon
}: {
  groups: MenuItemAddonGroup[]
  addons: MenuItemAddon[]
  newGroup: { name: string; required: boolean; singleChoice: boolean; maxSelect: string }
  setNewGroup: (v: { name: string; required: boolean; singleChoice: boolean; maxSelect: string }) => void
  newAddon: Record<number, { name: string; price: string }>
  setNewAddon: (v: Record<number, { name: string; price: string }>) => void
  onAddGroup: () => void
  onRemoveGroup: (id: number) => void
  onAddAddon: (groupId: number) => void
  onRemoveAddon: (id: number) => void
}) {
  return (
    <div className="card p-4 mb-3">
      <p className="font-semibold text-sm mb-2">الإضافات ومجموعات الاختيار (اختياري)</p>
      <p className="text-xs text-mist mb-3">استخدمها لإضافات زي "جبنة إضافية"، أو لتبديل صنف داخل بوكس (زي "اختار الساندوتش الأول") — خليها "اختيار واحد بس" في الحالة دي.</p>

      {groups.map(g => (
        <div key={g.id} className="bg-night border border-line rounded-xl p-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold text-sm">
              {g.name} {g.min_select > 0 && <span className="text-sand">*مطلوب</span>}
              {g.max_select === 1 && <span className="text-mist text-xs"> (اختيار واحد)</span>}
            </p>
            <button className="text-red-500 text-xs" onClick={() => onRemoveGroup(g.id)}>حذف المجموعة</button>
          </div>
          <div className="space-y-1.5 mb-2">
            {addons.filter(a => a.group_id === g.id).map(a => (
              <div key={a.id} className="flex items-center justify-between text-sm px-2.5 py-1.5 bg-shell rounded-lg">
                <span>{a.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-mist">{a.price > 0 ? `+${a.price} ج.م` : 'مجانًا'}</span>
                  <button className="text-red-500 text-xs" onClick={() => onRemoveAddon(a.id)}>حذف</button>
                </div>
              </div>
            ))}
            {addons.filter(a => a.group_id === g.id).length === 0 && (
              <p className="text-xs text-mist">لسه مفيش خيارات في المجموعة دي</p>
            )}
          </div>
          <div className="flex gap-2">
            <input className="field !py-1.5 text-sm" placeholder="اسم الخيار" value={newAddon[g.id]?.name ?? ''}
              onChange={e => setNewAddon({ ...newAddon, [g.id]: { name: e.target.value, price: newAddon[g.id]?.price ?? '' } })} />
            <input className="field !py-1.5 !w-20 text-sm" type="number" placeholder="السعر" value={newAddon[g.id]?.price ?? ''}
              onChange={e => setNewAddon({ ...newAddon, [g.id]: { name: newAddon[g.id]?.name ?? '', price: e.target.value } })} />
            <button className="btn-ghost !py-1.5 !px-3 text-sm shrink-0" onClick={() => onAddAddon(g.id)}>إضافة</button>
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
        <button className="btn-ghost w-full !py-1.5 text-sm" onClick={onAddGroup}>إضافة مجموعة</button>
      </div>
    </div>
  )
}
