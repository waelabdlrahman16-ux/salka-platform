import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase, DELIVERY_FEE } from '../lib/supabase'
import type { Compound, Restaurant } from '../lib/types'

export default function RequestDriver() {
  const { id } = useParams()
  const nav = useNavigate()
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [compounds, setCompounds] = useState<Compound[]>([])

  const [name, setName] = useState(''); const [phone, setPhone] = useState('')
  const [unit, setUnit] = useState('')
  const [addrNotes, setAddrNotes] = useState('')
  const [compoundId, setCompoundId] = useState<number | null>(() => {
    const saved = sessionStorage.getItem('talah_compound_id')
    return saved ? Number(saved) : null
  })
  const [paymentMode, setPaymentMode] = useState<'prepaid' | 'driver_pays'>('prepaid')
  const [collectAmount, setCollectAmount] = useState('')
  const [orderNotes, setOrderNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('restaurants').select('*').eq('id', id).single().then(({ data }) => setRestaurant(data))
    supabase.from('compounds').select('*').eq('active', true).order('direction').order('distance_km')
      .then(({ data }) => setCompounds(data ?? []))
  }, [id])

  const selectedCompound = compounds.find(c => c.id === compoundId)
  const amount = Number(collectAmount) || 0
  const valid = name.trim() && phone.trim() && compoundId && unit.trim()
    && (paymentMode === 'prepaid' || amount > 0)

  async function submit() {
    if (!restaurant || !valid) return
    setSaving(true); setError('')
    const { data, error: err } = await supabase.rpc('request_pickup', {
      p_restaurant_id: restaurant.id,
      p_customer_name: name.trim(),
      p_customer_phone: phone.trim(),
      p_zone: selectedCompound?.name ?? '',
      p_unit_number: unit.trim(),
      p_address_notes: addrNotes.trim(),
      p_delivery_fee: DELIVERY_FEE,
      p_payment_mode: paymentMode,
      p_collect_amount: paymentMode === 'driver_pays' ? amount : null,
      p_request_notes: orderNotes.trim()
    })
    if (err || !data?.token) {
      setSaving(false)
      setError('حصل خطأ، جرب تاني')
      return
    }
    nav(`/track/${data.token}`)
  }

  if (!restaurant) return <p className="text-mist">جاري التحميل…</p>

  return (
    <div className="pb-6">
      <h1 className="text-2xl font-bold mb-1">اطلب مندوب من {restaurant.name}</h1>
      <p className="text-mist text-sm mb-5">
        استخدم ده لو طلبت أوردر على {restaurant.name} مباشرة، وعايز مندوب سالكة يجيبهولك
      </p>

      <div className="card p-4 mb-5">
        <h2 className="font-bold mb-3">هل دفعت للأوردر بالفعل؟</h2>
        <div className="space-y-2.5">
          <label className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-3 cursor-pointer ${paymentMode === 'prepaid' ? 'border-sea bg-sea/5' : 'border-line'}`}>
            <input type="radio" checked={paymentMode === 'prepaid'} onChange={() => setPaymentMode('prepaid')} className="accent-sea w-4 h-4" />
            <span className="font-semibold flex-1">أيوه، دفعت خلاص</span>
          </label>
          <label className={`flex items-center gap-3 rounded-xl border-2 px-3.5 py-3 cursor-pointer ${paymentMode === 'driver_pays' ? 'border-sea bg-sea/5' : 'border-line'}`}>
            <input type="radio" checked={paymentMode === 'driver_pays'} onChange={() => setPaymentMode('driver_pays')} className="accent-sea w-4 h-4" />
            <span className="font-semibold flex-1">لأ، عايز المندوب يدفع ويحصله مني كاش</span>
          </label>
        </div>
        {paymentMode === 'driver_pays' && (
          <div className="mt-3">
            <label className="label">قيمة الأوردر اللي المندوب هيدفعها *</label>
            <input className="field" type="number" inputMode="decimal" value={collectAmount}
              onChange={e => setCollectAmount(e.target.value)} placeholder="مثال: 250" />
          </div>
        )}
      </div>

      <div className="mb-5">
        <label className="label">تفاصيل الأوردر (رقمه، اسمك عندهم، أي حاجة تفيد المندوب)</label>
        <textarea className="field min-h-[80px]" value={orderNotes} onChange={e => setOrderNotes(e.target.value)}
          placeholder="مثال: أوردر رقم 1234 باسم وائل" />
      </div>

      <div className="card p-4 mb-5 space-y-3.5">
        <h2 className="font-bold">عنوان التوصيل</h2>
        <div><label className="label">الاسم *</label>
          <input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="الاسم بالكامل" /></div>
        <div><label className="label">رقم الموبايل *</label>
          <input className="field" dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01xxxxxxxxx" /></div>
        <div><label className="label">المكان *</label>
          <select className="field" value={compoundId ?? ''} onChange={e => setCompoundId(Number(e.target.value) || null)}>
            <option value="">اختر مكانك…</option>
            {compounds.map(c => <option key={c.id} value={c.id}>{c.name} (~{c.est_travel_minutes} د)</option>)}
          </select></div>
        <div><label className="label">رقم الشاليه / الفيلا *</label>
          <input className="field" value={unit} onChange={e => setUnit(e.target.value)} placeholder="مثال: B4 - 204" /></div>
        <div><label className="label">علامة مميزة (اختياري)</label>
          <input className="field" value={addrNotes} onChange={e => setAddrNotes(e.target.value)} placeholder="مثال: بجوار حمام السباحة" /></div>
      </div>

      <div className="card p-4 mb-5 space-y-2">
        <h2 className="font-bold mb-1">هتدفع</h2>
        <div className="flex justify-between text-sm"><span>توصيل</span><span>{DELIVERY_FEE} ج.م</span></div>
        {paymentMode === 'driver_pays' && (
          <div className="flex justify-between text-sm"><span>قيمة الأوردر (كاش للمندوب)</span><span>{amount || 0} ج.م</span></div>
        )}
        <div className="flex justify-between font-bold border-t border-line pt-2">
          <span>الإجمالي</span><span className="text-sea">{DELIVERY_FEE + (paymentMode === 'driver_pays' ? amount : 0)} ج.م</span>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">{error}</p>}

      <button className="btn-sea w-full !py-3.5" disabled={!valid || saving} onClick={submit}>
        {saving ? 'جاري الإرسال…' : 'اطلب المندوب'}
      </button>
    </div>
  )
}
