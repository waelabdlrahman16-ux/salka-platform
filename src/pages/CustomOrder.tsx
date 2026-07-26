import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, DELIVERY_FEE } from '../lib/supabase'
import { artFor } from '../lib/categoryArt'
import type { Compound, MenuItem, RequestItem, Restaurant } from '../lib/types'

export default function CustomOrder() {
  const nav = useNavigate()
  const [vendors, setVendors] = useState<Restaurant[]>([])
  const [vendor, setVendor] = useState<Restaurant | null>(null)
  const [catalog, setCatalog] = useState<MenuItem[]>([])
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<RequestItem[]>([])
  const [notes, setNotes] = useState('')

  const [compounds, setCompounds] = useState<Compound[]>([])
  const [name, setName] = useState(''); const [phone, setPhone] = useState('')
  const [unit, setUnit] = useState('')
  const [addrNotes, setAddrNotes] = useState('')
  const [compoundId, setCompoundId] = useState<number | null>(() => {
    const saved = sessionStorage.getItem('talah_compound_id')
    return saved ? Number(saved) : null
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('restaurants').select('*').eq('order_mode', 'custom_request').eq('is_open', true)
      .then(({ data }) => setVendors((data as Restaurant[]) ?? []))
    supabase.from('compounds').select('*').eq('active', true).order('direction').order('distance_km')
      .then(({ data }) => setCompounds(data ?? []))
  }, [])

  useEffect(() => {
    if (!vendor) return
    supabase.from('menu_items').select('*').eq('restaurant_id', vendor.id).eq('available', true)
      .then(({ data }) => setCatalog(data ?? []))
  }, [vendor])

  const suggestions = useMemo(() => {
    if (!search.trim()) return []
    const q = search.trim().toLowerCase()
    return catalog.filter(it => it.name.toLowerCase().includes(q) && !picked.some(p => p.name === it.name)).slice(0, 6)
  }, [search, catalog, picked])

  function addSuggestion(it: MenuItem) {
    setPicked(p => [...p, { name: it.name, qty: 1 }])
    setSearch('')
  }
  function addFreeText() {
    const q = search.trim()
    if (!q) return
    setPicked(p => [...p, { name: q, qty: 1 }])
    setSearch('')
  }
  function changeQty(i: number, delta: number) {
    setPicked(p => p.map((it, idx) => idx === i ? { ...it, qty: Math.max(1, it.qty + delta) } : it))
  }
  function removeItem(i: number) {
    setPicked(p => p.filter((_, idx) => idx !== i))
  }

  const selectedCompound = compounds.find(c => c.id === compoundId)
  const valid = vendor && name.trim() && phone.trim() && compoundId && unit.trim() && (picked.length > 0 || notes.trim())

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
      p_delivery_fee: DELIVERY_FEE,
      p_request_items: picked,
      p_request_notes: notes.trim()
    })
    if (err || !data?.token) {
      setSaving(false)
      setError('حصل خطأ، جرب تاني')
      return
    }
    nav(`/track/${data.token}`)
  }

  // Step 1 — pick the vendor
  if (!vendor) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-1">طلب خاص</h1>
        <p className="text-mist text-sm mb-5">قول لنا اللي محتاجه، وإحنا هنجهزه معاك — من غير ما تدور في قايمة طويلة</p>
        <div className="grid grid-cols-2 gap-4">
          {vendors.map(v => {
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
          {vendors.length === 0 && <p className="text-mist col-span-full">مفيش خدمة طلب خاص متاحة حالياً</p>}
        </div>
      </div>
    )
  }

  // Step 2 — build the request
  return (
    <div className="pb-6">
      <button className="text-sm text-mist hover:text-foam mb-3" onClick={() => setVendor(null)}>← رجوع</button>
      <h1 className="text-2xl font-bold mb-1">{vendor.name}</h1>
      <p className="text-mist text-sm mb-5">
        اكتب اللي محتاجه، وهنقولك السعر النهائي بمكالمة قبل ما نجهز الطلب
      </p>

      <div className="mb-5">
        <label className="label">دور على صنف (اختياري، بيساعدك تكتب صح)</label>
        <input className="field" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="مثال: بنادول، لبن، خبز…" />
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {suggestions.map(it => (
              <button key={it.id} className="tab bg-shellup/60" onClick={() => addSuggestion(it)}>+ {it.name}</button>
            ))}
          </div>
        )}
        {search.trim() && suggestions.length === 0 && (
          <button className="text-sm text-seadeep font-semibold mt-2" onClick={addFreeText}>
            + إضافة "{search.trim()}" كصنف مش في القايمة
          </button>
        )}
      </div>

      {picked.length > 0 && (
        <div className="space-y-2 mb-5">
          {picked.map((it, i) => (
            <div key={i} className="card p-3 flex items-center justify-between gap-3">
              <span className="font-semibold text-sm">{it.name}</span>
              <div className="flex items-center gap-2">
                <button className="btn-ghost !px-2 !py-1" onClick={() => removeItem(i)}>🗑</button>
                <div className="flex items-center gap-2 bg-shellup rounded-full px-1 py-1">
                  <button className="w-7 h-7 rounded-full grid place-items-center font-bold" onClick={() => changeQty(i, -1)}>−</button>
                  <span className="font-bold text-sm w-4 text-center">{it.qty}</span>
                  <button className="w-7 h-7 rounded-full grid place-items-center font-bold bg-sea text-white" onClick={() => changeQty(i, 1)}>+</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-5">
        <label className="label">أي ملاحظات تانية (اختياري)</label>
        <textarea className="field min-h-[80px]" value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="مثال: أي نوع متوفر من نفس الصنف، أو تفاصيل زيادة" />
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

      <p className="text-sm text-mist bg-shellup/60 rounded-xl p-3 mb-4">
        💬 السعر النهائي هيتحدد لما نتصل بيك نأكد الطلب — مفيش دفع دلوقتي
      </p>

      {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-4">{error}</p>}

      <button className="btn-sea w-full !py-3.5" disabled={!valid || saving} onClick={submit}>
        {saving ? 'جاري الإرسال…' : 'إرسال الطلب'}
      </button>
    </div>
  )
}
