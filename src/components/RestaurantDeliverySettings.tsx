import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon'
import { supabase } from '../lib/supabase'
import type { Compound, Restaurant } from '../lib/types'
import Toggle from './Toggle'

type Kitchen = { id: number; restaurant_id: number; name: string; address: string | null; active: boolean; is_default: boolean }
type FeeRow = { kitchen_id: number; compound_id: number; delivery_fee: number | null }

export default function RestaurantDeliverySettings({ restaurant, compounds }: { restaurant: Restaurant; compounds: Compound[] }) {
  const [kitchens, setKitchens] = useState<Kitchen[]>([])
  const [fees, setFees] = useState<FeeRow[]>([])
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const activeDefault = useMemo(() => kitchens.find(k => k.active && k.is_default) ?? kitchens.find(k => k.active) ?? null, [kitchens])

  async function load() {
    const { data: ks, error: ke } = await supabase.from('restaurant_kitchens')
      .select('id,restaurant_id,name,address,active,is_default').eq('restaurant_id', restaurant.id).order('id')
    if (ke) { setError('مش قادرين نحمّل مواقع التحضير دلوقتي'); return }
    const next = (ks ?? []) as Kitchen[]
    setKitchens(next)
    if (!next.length) { setFees([]); return }
    const { data: fs, error: fe } = await supabase.from('kitchen_compound_fees')
      .select('kitchen_id,compound_id,delivery_fee').in('kitchen_id', next.map(k => k.id))
    if (fe) { setError('مش قادرين نحمّل رسوم المواقع دلوقتي'); return }
    setFees((fs ?? []) as FeeRow[])
  }

  // load is redefined on every render, so listing it would re-run this effect
  // forever. The dependencies below are the values it actually reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) void load() }, [open, restaurant.id])

  async function addKitchen() {
    if (!name.trim()) return
    setBusy(true); setError('')
    const { error } = await supabase.from('restaurant_kitchens').insert({
      restaurant_id: restaurant.id, name: name.trim(), address: address.trim() || null,
      active: true, is_default: kitchens.length === 0,
    })
    setBusy(false)
    if (error) { setError('مش قادرين نضيف الموقع. جرّب تاني'); return }
    setName(''); setAddress(''); await load()
  }

  async function updateKitchen(k: Kitchen, patch: Partial<Kitchen>) {
    setBusy(true); setError('')
    if (patch.is_default) await supabase.from('restaurant_kitchens').update({ is_default: false }).eq('restaurant_id', restaurant.id)
    const { error } = await supabase.from('restaurant_kitchens').update(patch).eq('id', k.id)
    setBusy(false)
    if (error) { setError('مش قادرين نحفظ التعديل'); return }
    await load()
  }

  async function setFee(compoundId: number, value: string) {
    if (!activeDefault) return
    setBusy(true); setError('')
    const fee = value.trim() === '' ? null : Number(value)
    if (fee !== null && (!Number.isFinite(fee) || fee < 0)) { setBusy(false); setError('اكتب رسوم توصيل صحيحة'); return }
    const { error } = await supabase.from('kitchen_compound_fees').upsert({
      kitchen_id: activeDefault.id, compound_id: compoundId, delivery_fee: fee,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'kitchen_id,compound_id' })
    setBusy(false)
    if (error) { setError('مش قادرين نحفظ الرسوم'); return }
    await load()
  }

  const feeFor = (compoundId: number) => fees.find(f => f.kitchen_id === activeDefault?.id && f.compound_id === compoundId)?.delivery_fee

  return (
    <section className="mt-3 pt-3 border-t border-line">
      <button className="w-full flex items-center justify-between text-right" onClick={() => setOpen(v => !v)}>
        <span className="font-semibold text-sm"><Icon name="locationDot" size="sm" className="inline-block align-[-0.15em] me-1" />مواقع التحضير ورسوم التوصيل</span>
        <span className="text-xs text-sea">{open ? 'إخفاء' : activeDefault ? 'تعديل' : 'إضافة موقع'}</span>
      </button>
      {open && <div className="mt-3 space-y-3">
        <p className="text-xs text-mist">الرسوم الأساسية من «الأماكن والتوصيل» تظل شغالة. اكتب رقمًا هنا فقط لو هذا المطعم له تكلفة مختلفة من موقعه الخاص.</p>
        {error && <p className="text-xs text-danger">{error}</p>}
        {kitchens.map(k => <div key={k.id} className="rounded-xl bg-shellup p-3 flex items-center gap-2">
          <div className="flex-1 min-w-0"><p className="text-sm font-semibold">{k.name} {k.is_default && <span className="text-[10px] text-sea">الموقع الأساسي</span>}</p><p className="text-xs text-mist truncate">{k.address || 'العنوان لم يُكتب بعد'}</p></div>
          {k.is_default ? <span className="text-[11px] text-mist">الموقع الأساسي لا يتوقف</span> : <Toggle on={k.active} onChange={() => updateKitchen(k, { active: !k.active })} label="شغال" labelOff="موقوف" />}
          {!k.is_default && <button className="btn-ghost !py-1.5 !px-2 text-xs" disabled={busy} onClick={() => updateKitchen(k, { is_default: true })}>اجعله الأساسي</button>}
        </div>)}
        <div className="rounded-xl border border-dashed border-line p-3 space-y-2">
          <input className="field !py-2 text-sm" placeholder="اسم موقع التحضير، مثال: مطبخ أوربت مول" value={name} onChange={e => setName(e.target.value)} />
          <input className="field !py-2 text-sm" placeholder="العنوان الحقيقي للمندوب" value={address} onChange={e => setAddress(e.target.value)} />
          <button className="btn-sea w-full !py-2 text-sm" disabled={busy || !name.trim()} onClick={addKitchen}>+ إضافة موقع تحضير</button>
        </div>
        {activeDefault && <div className="rounded-xl border border-line overflow-hidden">
          <div className="p-3 bg-night"><p className="text-sm font-semibold">رسوم {activeDefault.name}</p><p className="text-xs text-mist">فارغ = نفس رسوم المكان الأساسية</p></div>
          <div className="max-h-64 overflow-y-auto divide-y divide-line">
            {compounds.map(c => { const value = feeFor(c.id); return <div key={c.id} className="p-2.5 flex items-center gap-2">
              <div className="flex-1 text-sm"><p>{c.name}</p><p className="text-[11px] text-mist">الأساسي: {c.delivery_fee} ج.م</p></div>
              <input className="field !w-24 !h-9 text-center text-sm" inputMode="decimal" placeholder="الأساسي" defaultValue={value ?? ''} onBlur={e => { if (String(value ?? '') !== e.target.value) void setFee(c.id, e.target.value) }} />
              <span className="text-xs text-mist">ج.م</span>
            </div> })}
          </div>
        </div>}
      </div>}
    </section>
  )
}
