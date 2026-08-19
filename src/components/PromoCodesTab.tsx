import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon'
import { supabase } from '../lib/supabase'
import type { Compound, Restaurant } from '../lib/types'
import { PROMO_SCOPES, PROMO_SCOPE_ADMIN_LABEL as SCOPE_LABEL, type PromoScope } from '../lib/promoScope'
import { isoToCairoLocalInput, cairoLocalInputToISO } from '../lib/cairoTime'

type Promo = { id: number; code: string; active: boolean; discount_type: 'percent' | 'fixed'; discount_value: number; max_discount_egp: number | null; minimum_subtotal_egp: number; applies_to: PromoScope; restaurant_id: number | null; compound_id: number | null; starts_at: string | null; ends_at: string | null; max_redemptions: number | null; max_redemptions_per_customer: number; redemption_count: number }
type Draft = { code: string; discount_type: 'percent' | 'fixed'; discount_value: string; max_discount_egp: string; minimum_subtotal_egp: string; applies_to: PromoScope; restaurant_id: string; compound_id: string; starts_at: string; ends_at: string; max_redemptions: string; max_redemptions_per_customer: string }
const emptyDraft = (): Draft => ({ code: '', discount_type: 'percent', discount_value: '', max_discount_egp: '', minimum_subtotal_egp: '0', applies_to: 'delivery', restaurant_id: '', compound_id: '', starts_at: '', ends_at: '', max_redemptions: '', max_redemptions_per_customer: '1' })
const asNumber = (value: string, optional = false) => value.trim() === '' && optional ? null : Number(value)

export default function PromoCodesTab({ restaurants, compounds }: { restaurants: Restaurant[]; compounds: Compound[] }) {
  const [codes, setCodes] = useState<Promo[]>([])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const canSave = useMemo(() => /^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(draft.code.trim().toUpperCase()) && Number(draft.discount_value) > 0, [draft])

  async function call(action: string, payload: Record<string, unknown> = {}) {
    const { data, error: invokeError } = await supabase.functions.invoke('admin-promo-codes', { body: { action, ...payload } })
    if (invokeError) throw new Error(invokeError.message)
    if (!data?.ok) throw new Error(data?.error || 'unknown_error')
    return data
  }
  async function refresh() {
    setLoading(true); setError('')
    try { const data = await call('list'); setCodes(data.codes ?? []) }
    catch { setError('مش قادرين نحمّل أكواد الخصم دلوقتي') }
    finally { setLoading(false) }
  }
  // refresh is redefined on every render, so listing it would re-run this effect
  // forever. The dependencies below are the values it actually reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh() }, [])
  function status(p: Promo) {
    const now = Date.now()
    if (!p.active) return 'موقوف'
    if (p.starts_at && new Date(p.starts_at).getTime() > now) return 'مجدول'
    if (p.ends_at && new Date(p.ends_at).getTime() <= now) return 'منتهي'
    if (p.max_redemptions && p.redemption_count >= p.max_redemptions) return 'اكتمل الحد'
    return 'شغّال'
  }
  function reset() { setDraft(emptyDraft()); setEditing(null); setError('') }
  function startEdit(p: Promo) {
    setEditing(p.id)
    setDraft({ code: p.code, discount_type: p.discount_type, discount_value: String(p.discount_value), max_discount_egp: p.max_discount_egp == null ? '' : String(p.max_discount_egp), minimum_subtotal_egp: String(p.minimum_subtotal_egp), applies_to: p.applies_to ?? 'delivery', restaurant_id: p.restaurant_id == null ? '' : String(p.restaurant_id), compound_id: p.compound_id == null ? '' : String(p.compound_id), starts_at: isoToCairoLocalInput(p.starts_at), ends_at: isoToCairoLocalInput(p.ends_at), max_redemptions: p.max_redemptions == null ? '' : String(p.max_redemptions), max_redemptions_per_customer: String(p.max_redemptions_per_customer) })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  async function save() {
    if (!canSave) { setError('اكتب كود صحيح وقيمة خصم أكبر من صفر'); return }
    setBusy(true); setError('')
    const payload = { id: editing, code: draft.code.trim().toUpperCase(), discount_type: draft.discount_type, discount_value: asNumber(draft.discount_value), max_discount_egp: asNumber(draft.max_discount_egp, true), minimum_subtotal_egp: asNumber(draft.minimum_subtotal_egp), applies_to: draft.applies_to, restaurant_id: asNumber(draft.restaurant_id, true), compound_id: asNumber(draft.compound_id, true), starts_at: cairoLocalInputToISO(draft.starts_at), ends_at: cairoLocalInputToISO(draft.ends_at), max_redemptions: asNumber(draft.max_redemptions, true), max_redemptions_per_customer: asNumber(draft.max_redemptions_per_customer) }
    try { await call(editing ? 'update' : 'create', payload); reset(); await refresh() }
    catch (e) { setError(e instanceof Error && e.message === 'duplicate_code' ? 'الكود مستخدم بالفعل' : 'مش قادرين نحفظ الكود، راجع البيانات وجرب تاني') }
    finally { setBusy(false) }
  }
  async function toggle(p: Promo) {
    setBusy(true); setError('')
    try { await call('set_active', { id: p.id, active: !p.active }); await refresh() }
    catch { setError('مش قادرين نغيّر حالة الكود دلوقتي') }
    finally { setBusy(false) }
  }
  const input = (key: keyof Draft, label: string, type = 'text', placeholder = '') => <label className="block text-xs text-mist"><span className="block mb-1">{label}</span><input className="field" type={type} placeholder={placeholder} value={draft[key]} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} /></label>

  return <div className="space-y-5">
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3 mb-4"><div><h2 className="font-bold"><Icon name="tag" size="sm" className="inline-block align-[-0.15em] me-1" />{editing ? 'تعديل كود خصم' : 'كود خصم جديد'}</h2><p className="text-xs text-mist mt-1">اختار الخصم يتحسب من إيه، ويظهر واضحًا للعميل في الدفع والفاتورة.</p></div>{editing && <button className="btn-ghost text-sm" onClick={reset}>إلغاء التعديل</button>}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {input('code', 'الكود', 'text', 'مثال: SOKHNA10')}
        <label className="block text-xs text-mist"><span className="block mb-1">نوع الخصم</span><select className="field" value={draft.discount_type} onChange={e => setDraft(d => ({ ...d, discount_type: e.target.value as Draft['discount_type'] }))}><option value="percent">نسبة مئوية</option><option value="fixed">مبلغ ثابت</option></select></label>
        <label className="block text-xs text-mist sm:col-span-2"><span className="block mb-1">الخصم يُطبَّق على</span><select className="field" value={draft.applies_to} onChange={e => setDraft(d => ({ ...d, applies_to: e.target.value as PromoScope }))}>{PROMO_SCOPES.map(s => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}</select>
          {draft.applies_to === 'vendor' && <span className="block mt-1 text-amber-700">تحذير: الخصم ده هيتخصم من قيمة أصناف المطعم.</span>}
          {draft.applies_to === 'platform' && <span className="block mt-1 text-mist">الخصم بياكل رسوم الخدمة الأول، وبعدين التوصيل، وأبدًا ما يوصل لقيمة أصناف المطعم.</span>}
          {draft.applies_to === 'all' && <span className="block mt-1 text-mist">الخصم بياكل رسوم الخدمة الأول، وبعدين التوصيل، وما يوصلش للأصناف غير لو أكبر منهم.</span>}
        </label>
        {input('discount_value', draft.discount_type === 'percent' ? 'النسبة (%)' : 'المبلغ (ج.م)', 'number')}
        {draft.discount_type === 'percent' && input('max_discount_egp', 'أقصى خصم (اختياري، ج.م)', 'number')}
        {input('minimum_subtotal_egp', 'أقل قيمة أصناف (ج.م)', 'number')}
        {input('max_redemptions', 'إجمالي مرات الاستخدام (اختياري)', 'number')}
        {input('max_redemptions_per_customer', 'مرات الاستخدام لكل عميل', 'number')}
        <label className="block text-xs text-mist"><span className="block mb-1">المطعم</span><select className="field" value={draft.restaurant_id} onChange={e => setDraft(d => ({ ...d, restaurant_id: e.target.value }))}><option value="">كل المطاعم</option>{restaurants.filter(r => !r.archived).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label className="block text-xs text-mist"><span className="block mb-1">المكان</span><select className="field" value={draft.compound_id} onChange={e => setDraft(d => ({ ...d, compound_id: e.target.value }))}><option value="">كل الأماكن</option>{compounds.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {input('starts_at', 'يبدأ (اختياري)', 'datetime-local')}
        {input('ends_at', 'ينتهي (اختياري)', 'datetime-local')}
      </div>
      {error && <p className="text-sm text-danger mt-3">{error}</p>}
      <button className="btn-sea w-full mt-4" disabled={busy || !canSave} onClick={save}>{busy ? 'جارٍ الحفظ…' : editing ? 'حفظ التعديل' : 'إنشاء كود الخصم'}</button>
    </div>
    <div className="space-y-3">
      <div className="flex items-center justify-between"><h2 className="font-bold">الأكواد الحالية</h2><button className="btn-ghost text-sm" onClick={refresh} disabled={loading}>تحديث</button></div>
      {loading ? <div className="card p-5 text-center text-mist">جارٍ التحميل…</div> : codes.length === 0 ? <div className="card p-5 text-center text-mist">مفيش أكواد خصم لسه</div> : codes.map(p => <div key={p.id} className="card p-4"><div className="flex justify-between gap-3"><div><p className="font-bold" dir="ltr">{p.code}</p><p className="text-xs text-mist mt-1">{p.discount_type === 'percent' ? String(p.discount_value) + '%' : String(p.discount_value) + ' ج.م'} · استُخدم {p.redemption_count}{p.max_redemptions ? ' من ' + p.max_redemptions : ''}</p><p className={p.applies_to === 'vendor' ? 'text-xs mt-1 text-amber-700 font-semibold' : 'text-xs text-mist mt-1'}>{SCOPE_LABEL[p.applies_to ?? 'delivery']}</p><p className="text-xs text-mist mt-1">{p.restaurant_id ? restaurants.find(r => r.id === p.restaurant_id)?.name : 'كل المطاعم'} · {p.compound_id ? compounds.find(c => c.id === p.compound_id)?.name : 'كل الأماكن'}</p></div><span className={status(p) === 'شغّال' ? 'badge-active' : 'badge-closed'}>{status(p)}</span></div><div className="flex gap-2 mt-3"><button className="btn-ghost flex-1 text-sm" disabled={busy} onClick={() => startEdit(p)}>تعديل</button><button className="btn-ghost flex-1 text-sm" disabled={busy} onClick={() => toggle(p)}>{p.active ? 'إيقاف' : 'تشغيل'}</button></div></div>)}
    </div>
  </div>
}
