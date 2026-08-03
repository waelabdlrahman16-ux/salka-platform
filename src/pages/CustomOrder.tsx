import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useDeliveryQuote } from '../lib/deliveryQuote'
import { isValidEgyptPhone, PHONE_HINT } from '../lib/validation'
import { artFor } from '../lib/categoryArt'
import { getSessionToken } from '../lib/customerAuth'
import type { Compound, MenuItem, Restaurant, Slot } from '../lib/types'

export default function CustomOrder() {
  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  const typeFilter = searchParams.get('type') // 'pharmacy' | 'supermarket' | null -- deep-link from Home's category tiles
  const [vendors, setVendors] = useState<Restaurant[]>([])
  const [vendor, setVendor] = useState<Restaurant | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [list, setList] = useState('')
  const [slots, setSlots] = useState<Slot[]>([])
  const [slot, setSlot] = useState<Slot | null>(null)

  const [compounds, setCompounds] = useState<Compound[]>([])
  const [name, setName] = useState(''); const [phone, setPhone] = useState(() => localStorage.getItem('salka_phone') ?? '')
  const [unit, setUnit] = useState('')
  const [addrNotes, setAddrNotes] = useState('')
  const [compoundId, setCompoundId] = useState<number | null>(() => {
    const saved = sessionStorage.getItem('salka_compound_id')
    return saved ? Number(saved) : null
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [addressLoaded, setAddressLoaded] = useState(false)

  useEffect(() => {
    if (!isValidEgyptPhone(phone) || addressLoaded) return
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('last_address_for_phone', { p_phone: phone, p_session_token: getSessionToken() })
      if (data) {
        setAddressLoaded(true)
        if (!name.trim() && data.customer_name) setName(data.customer_name)
        if (!unit.trim() && data.unit_number) setUnit(data.unit_number)
        if (!addrNotes.trim() && data.address_notes) setAddrNotes(data.address_notes)
        if (!compoundId && data.compound_id) setCompoundId(data.compound_id)
      }
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone])

  useEffect(() => {
    supabase.from('restaurants').select('*').eq('order_mode', 'custom_request').eq('is_open', true).eq('archived', false)
      .then(({ data }) => {
        const list = (data as Restaurant[]) ?? []
        setVendors(list)
        if (typeFilter) {
          const matches = list.filter(v => v.vendor_type === typeFilter)
          if (matches.length === 1) setVendor(matches[0])
        }
      })
    supabase.from('compounds').select('*').eq('active', true).order('direction').order('distance_km')
      .then(({ data }) => setCompounds(data ?? []))
  }, [])

  useEffect(() => {
    if (!vendor) return
    supabase.from('menu_items').select('*').eq('restaurant_id', vendor.id).eq('available', true)
      .then(({ data }) => {
        const items = (data as MenuItem[]) ?? []
        const seen = new Set<string>()
        const cats: string[] = []
        for (const it of items) if (!seen.has(it.category)) { seen.add(it.category); cats.push(it.category) }
        setCategories(cats)
      })
    setSlot(null)
    if (vendor.vendor_type === 'supermarket') {
      supabase.rpc('open_slots', { p_restaurant_id: vendor.id }).then(({ data }) => setSlots((data as Slot[]) ?? []))
    } else {
      setSlots([])
    }
  }, [vendor])

  function addLine(text: string) {
    setList(l => l.trim() ? `${l.trim()}\n${text}` : text)
  }

  const selectedCompound = compounds.find(c => c.id === compoundId)
  const { fee: deliveryFee, quote, loading: feeLoading, failed: feeFailed, retry: retryFee } =
    useDeliveryQuote(compoundId)
  const scheduled = vendor?.vendor_type === 'supermarket'
  const valid = vendor && name.trim() && isValidEgyptPhone(phone) && compoundId && unit.trim()
    && list.trim() && deliveryFee !== null && (!scheduled || !!slot)

  async function submit() {
    if (!vendor || !valid) return
    setSaving(true); setError('')
    const { data, error: err } = await supabase.rpc('submit_custom_order', {
      p_restaurant_id: vendor.id,
      p_customer_name: name.trim(),
      p_customer_phone: phone.trim(),
      p_zone: selectedCompound?.name ?? '',
      p_unit_number: unit.trim(),
      p_address_notes: addrNotes.trim(),
      p_delivery_fee: deliveryFee ?? 0, // server recomputes and ignores this
      p_request_items: [],
      p_request_notes: list.trim(),
      p_compound_id: compoundId,
      p_session_token: getSessionToken(),
      p_slot_id: slot?.id ?? null,
      p_scheduled_date: slot?.scheduled_date ?? null
    })
    if (err || !data?.token) {
      setSaving(false)
      setError(err?.message.includes('slot_full') ? 'الفترة دي اتملت، اختار فترة تانية' : 'حصل خطأ، جرب تاني')
      return
    }
    localStorage.setItem('salka_phone', phone.trim())
    nav(`/track/${data.token}`)
  }

  // Step 1 — pick the vendor
  if (!vendor) {
    const shownVendors = typeFilter ? vendors.filter(v => v.vendor_type === typeFilter) : vendors
    return (
      <div>
        <h1 className="text-2xl font-bold mb-1">
          {typeFilter === 'pharmacy' ? 'الصيدلية' : typeFilter === 'supermarket' ? 'السوبر ماركت' : 'طلب خاص'}
        </h1>
        <p className="text-mist text-sm mb-4">قول لنا اللي محتاجه، وإحنا هنجهزه معاك — من غير ما تدور في قايمة طويلة</p>
        <div className="grid grid-cols-2 gap-4">
          {shownVendors.map(v => {
            const art = artFor(v.vendor_type === 'pharmacy' ? 'أدوية' : 'خضار وفاكهة')
            return (
              <button key={v.id} className="card p-4 text-right" onClick={() => setVendor(v)}>
                <div className="w-full aspect-square rounded-xl grid place-items-center text-4xl mb-3" style={{ background: art.tint }}>
                  {v.vendor_type === 'pharmacy' ? '💊' : '🛒'}
                </div>
                <h3 className="font-bold">{v.name}</h3>
                <p className="text-xs text-mist mt-0.5">{v.vendor_type === 'pharmacy' ? 'صيدلية' : 'سوبر ماركت'}</p>
              </button>
            )
          })}
          {shownVendors.length === 0 && <p className="text-mist col-span-full">مفيش خدمة متاحة حالياً</p>}
        </div>
      </div>
    )
  }

  // Step 2 — one simple list, no fake matching
  return (
    <div className="pb-6">
      <button className="text-sm text-mist hover:text-foam mb-3" onClick={() => setVendor(null)}>← رجوع</button>
      <h1 className="text-2xl font-bold mb-1">{vendor.name}</h1>
      <p className="text-mist text-sm mb-4">اكتب اللي محتاجه، وهنقولك السعر النهائي بمكالمة قبل ما نجهز الطلب</p>

      {categories.length > 0 && (
        <div className="mb-3">
          <p className="text-sm text-mist mb-2">من عندنا (اضغط عشان تضيفها لقايمتك)</p>
          <div className="flex flex-wrap gap-2">
            {categories.map(cat => (
              <button key={cat} className="tab bg-shellup/60" onClick={() => addLine(cat)}>+ {cat}</button>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4">
        <label className="label">قايمة طلبك *</label>
        <textarea className="field min-h-[160px]" value={list} onChange={e => setList(e.target.value)}
          placeholder={'اكتب كل حاجة عايزها، سطر لكل صنف\nمثال:\nبنادول اكسترا\nشامبو أطفال\nخبز توست'} />
      </div>

      {scheduled && (
        <div className="mb-4">
          <h2 className="font-bold mb-2">فترة التوصيل</h2>
          {slots.length === 0 && <p className="text-sm text-sand">لا توجد فترات متاحة حالياً</p>}
          <div className="grid grid-cols-2 gap-2">
            {slots.map(sl => {
              const on = slot?.id === sl.id && slot?.scheduled_date === sl.scheduled_date
              const today = sl.scheduled_date === new Date().toISOString().slice(0, 10)
              return (
                <button key={`${sl.id}-${sl.scheduled_date}`} className={`card p-3 text-right ${on ? 'border-sea' : ''}`} onClick={() => setSlot(sl)}>
                  <p className="text-sm font-semibold">{sl.start_time.slice(0, 5)} — {sl.end_time.slice(0, 5)}</p>
                  <p className="text-xs text-mist mt-0.5">{today ? 'النهاردة' : 'بكرة'} · باقي {sl.remaining}</p>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="card p-4 mb-4 space-y-3">
        <h2 className="font-bold">عنوان التوصيل</h2>
        <div><label className="label">الاسم *</label>
          <input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="الاسم بالكامل" /></div>
        <div><label className="label">رقم الموبايل *</label>
          <input className={`field ${phone.trim() && !isValidEgyptPhone(phone) ? '!border-red-400' : ''}`}
            dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01xxxxxxxxx" maxLength={13} />
          {phone.trim() && !isValidEgyptPhone(phone) && <p className="text-xs text-red-600 mt-1">{PHONE_HINT}</p>}</div>
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

      {/* Delivery is known up front even though the items aren't priced yet --
          the customer used to first see this charge on the tracking page. */}
      {compoundId && (
        <div className="card p-3.5 mb-3">
          <div className="flex justify-between text-sm">
            <span className="text-mist">رسوم التوصيل{quote ? ` (${quote.distance_km} كم)` : ''}</span>
            <span className="font-semibold">
              {deliveryFee !== null ? `${deliveryFee} ج.م`
                : feeLoading ? '…'
                : <button className="text-sea underline" onClick={retryFee}>إعادة المحاولة</button>}
            </span>
          </div>
        </div>
      )}

      <p className="text-sm text-mist bg-shellup/60 rounded-xl p-3 mb-4">
        💬 سعر الأصناف هيتحدد لما نتصل بيك نأكد الطلب — مفيش دفع دلوقتي
      </p>

      {feeFailed && compoundId && (
        <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">
          مش قادرين نحسب رسوم التوصيل دلوقتي.{' '}
          <button className="underline font-semibold" onClick={retryFee}>جرب تاني</button>
        </p>
      )}

      {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">{error}</p>}

      <button className="btn-sea w-full !py-3.5" disabled={!valid || saving} onClick={submit}>
        {saving ? 'جاري الإرسال…'
          : deliveryFee === null && compoundId ? 'بنحسب التوصيل…'
          : 'إرسال الطلب'}
      </button>
    </div>
  )
}
