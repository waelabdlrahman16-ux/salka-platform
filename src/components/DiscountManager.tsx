import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Discount } from '../lib/types'
import Toggle from './Toggle'
import { useSheets } from './ActionSheets'

export default function DiscountManager({ restaurantId, scope, menuItemId, category }: {
  restaurantId: number
  scope: 'item' | 'category'
  menuItemId?: number
  category?: string
}) {
  const [existing, setExisting] = useState<Discount | null>(null)
  const [editing, setEditing] = useState(false)
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent')
  const [value, setValue] = useState('')
  const [hasWindow, setHasWindow] = useState(false)
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [conflicts, setConflicts] = useState<Discount[] | null>(null)
  // All four writes here used to discard their error. remove() was the worst:
  // it cleared the panel unconditionally, so a failed write showed the discount
  // gone while it kept coming off every order.
  const [writeError, setWriteError] = useState('')
  const [saving, setSaving] = useState(false)
  const { confirmSheet, sheetElement } = useSheets()

  useEffect(() => { load() }, [scope, menuItemId, category])

  async function load() {
    let q = supabase.from('discounts').select('*').eq('restaurant_id', restaurantId).eq('scope', scope).eq('active', true)
    q = scope === 'item' ? q.eq('menu_item_id', menuItemId!) : q.eq('category', category!)
    const { data } = await q.limit(1).maybeSingle()
    setExisting(data)
    if (data) {
      setDiscountType(data.discount_type); setValue(String(data.value))
      setHasWindow(!!(data.starts_at || data.ends_at))
      setStartsAt(data.starts_at?.slice(0, 16) ?? ''); setEndsAt(data.ends_at?.slice(0, 16) ?? '')
    }
  }

  async function attemptSave() {
    if (!value || Number(value) <= 0) return
    const { data: conflictData } = await supabase.rpc('check_discount_conflict', {
      p_restaurant_id: restaurantId, p_scope: scope,
      p_menu_item_id: scope === 'item' ? menuItemId : null,
      p_category: scope === 'category' ? category : null,
      p_exclude_id: existing?.id ?? null
    })
    if (conflictData && conflictData.length > 0) {
      setConflicts(conflictData)
      return
    }
    await doSave()
  }

  async function doSave(deactivateIds: number[] = []) {
    setSaving(true)
    if (deactivateIds.length > 0) {
      const { error } = await supabase.from('discounts').update({ active: false }).in('id', deactivateIds)
      if (error) { setSaving(false); setWriteError(`إيقاف الخصم القديم فشل — ${error.message}`); return }
    }
    const payload = {
      restaurant_id: restaurantId, scope,
      menu_item_id: scope === 'item' ? menuItemId : null,
      category: scope === 'category' ? category : null,
      discount_type: discountType, value: Number(value), active: true,
      starts_at: hasWindow && startsAt ? new Date(startsAt).toISOString() : null,
      ends_at: hasWindow && endsAt ? new Date(endsAt).toISOString() : null
    }
    const { error } = existing
      ? await supabase.from('discounts').update(payload).eq('id', existing.id)
      : await supabase.from('discounts').insert(payload)
    setSaving(false)
    if (error) { setWriteError(`حفظ الخصم فشل — ${error.message}`); return }
    setWriteError('')
    setConflicts(null)
    setEditing(false)
    load()
  }

  async function remove() {
    if (!existing) return
    if (!await confirmSheet({ title: 'حذف الخصم ده؟', danger: true })) return
    // Was optimistic: it cleared the panel whether or not the row changed, so a
    // failed write showed the promotion gone while it kept applying to every
    // order. Margin is the one thing this file is careful about everywhere else.
    const { error } = await supabase.from('discounts').update({ active: false }).eq('id', existing.id)
    if (error) { setWriteError(`إلغاء الخصم فشل — ${error.message}`); return }
    setWriteError('')
    setExisting(null)
    setEditing(false)
    load()
  }

  if (!editing && existing) {
    return (
      <div>
        {writeError && (
          <p className="text-xs text-red-600 bg-red-500/10 rounded-lg p-2.5 mb-2" role="alert">{writeError}</p>
        )}
      <div className="flex items-center justify-between bg-sand/10 rounded-lg px-3 py-2 text-sm">
        <span>
          🏷️ خصم {existing.discount_type === 'percent' ? `${existing.value}%` : `${existing.value} ج.م`}
          {existing.ends_at && ` — لحد ${new Date(existing.ends_at).toLocaleDateString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo' })}`}
        </span>
        <div className="flex gap-2">
          <button className="text-sea text-xs font-semibold min-h-[44px] inline-flex items-center" onClick={() => setEditing(true)}>تعديل</button>
          <button className="text-red-600 text-xs font-semibold min-h-[44px] inline-flex items-center" onClick={remove}>حذف</button>
        </div>
      </div>
      {sheetElement}
      </div>
    )
  }

  if (!editing) {
    return <button className="text-xs text-sea font-semibold" onClick={() => setEditing(true)}>+ إضافة خصم</button>
  }

  return (
    <div className="bg-shellup/60 rounded-lg p-2.5 space-y-2">
      {writeError && (
        <p className="text-xs text-red-600 bg-red-500/10 rounded-lg p-2.5" role="alert">{writeError}</p>
      )}
      {conflicts && conflicts.length > 0 && (
        <div className="bg-sand/15 rounded-lg p-2.5 text-xs">
          <p className="font-semibold mb-1.5">
            ⚠️ في {scope === 'item' ? 'خصم على القسم ده' : 'أصناف ليها خصم خاص'} شغال دلوقتي وهيتعارض:
          </p>
          <ul className="list-disc pr-4 mb-2">
            {conflicts.map(c => (
              <li key={c.id}>خصم {c.discount_type === 'percent' ? `${c.value}%` : `${c.value} ج.م`}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button className="btn-ghost !px-2.5 !text-xs" onClick={() => setConflicts(null)}>إلغاء</button>
            <button className="btn-sea !px-2.5 !text-xs" onClick={() => doSave(conflicts.map(c => c.id))}>
              استخدم الخصم ده بدل التاني
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <select className="field !h-9 !py-1.5 text-sm !w-28" value={discountType} onChange={e => setDiscountType(e.target.value as 'percent' | 'fixed')}>
          <option value="percent">نسبة %</option>
          <option value="fixed">مبلغ ثابت</option>
        </select>
        <input className="field !h-9 !py-1.5 text-sm" type="number" placeholder={discountType === 'percent' ? 'مثال: 20' : 'مثال: 15'}
          value={value} onChange={e => setValue(e.target.value)} />
      </div>

      <div className="min-h-[44px] flex items-center">
        <Toggle on={hasWindow} onChange={() => setHasWindow(!hasWindow)}
          label="له تاريخ بداية/نهاية (عرض محدود)" />
      </div>
      {hasWindow && (
        <div className="flex gap-2">
          <input type="datetime-local" className="field !h-9 !py-1.5 !text-xs" value={startsAt} onChange={e => setStartsAt(e.target.value)} />
          <input type="datetime-local" className="field !h-9 !py-1.5 !text-xs" value={endsAt} onChange={e => setEndsAt(e.target.value)} />
        </div>
      )}

      <div className="flex gap-2">
        <button className="btn-ghost flex-1 text-xs" onClick={() => { setEditing(false); setConflicts(null) }}>إلغاء</button>
        <button className="btn-sea flex-1 text-xs" disabled={saving || !value} onClick={attemptSave}>
          {saving ? 'جاري الحفظ…' : 'حفظ الخصم'}
        </button>
      </div>
    </div>
  )
}
