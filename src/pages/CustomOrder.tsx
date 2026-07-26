import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, DELIVERY_FEE } from '../lib/supabase'
import { artFor } from '../lib/categoryArt'
import type { Compound, MenuItem, Restaurant } from '../lib/types'

export default function CustomOrder() {
  const nav = useNavigate()
  const [vendors, setVendors] = useState<Restaurant[]>([])
  const [vendor, setVendor] = useState<Restaurant | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [list, setList] = useState('')

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
      .then(({ data }) => {
        const items = (data as MenuItem[]) ?? []
        const seen = new Set<string>()
        const cats: string[] = []
        for (const it of items) if (!seen.has(it.category)) { seen.add(it.category); cats.push(it.category) }
        setCategories(cats)
      })
  }, [vendor])

  function addLine(text: string) {
    setList(l => l.trim() ? `${l.trim()}\n${text}` : text)
  }

  const selectedCompound = compounds.find(c => c.id === compoundId)
  const valid = vendor && name.trim() && phone.trim() && compoundId && unit.trim() && list.trim()

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
      p_request_items: [],
      p_request_notes: list.trim()
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

  // Step 2 — one simple list, no fake matching
  return (
    <div className="pb-6">
      <button className="text-sm text-mist hover:text-foam mb-3" onClick={() => setVendor(null)}>← رجوع</button>
      <h1 className="text-2xl font-bold mb-1">{vendor.name}</h1>
      <p className="text-mist text-sm mb-5">اكتب اللي محتاجه، وهنقولك السعر النهائي بمكالمة قبل ما نجهز الطلب</p>

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

      <div className="mb-5">
        <label className="label">قايمة طلبك *</label>
        <textarea className="field min-h-[160px]" value={list} onChange={e => setList(e.target.value)}
          placeholder={'اكتب كل حاجة عايزها، سطر لكل صنف\nمثال:\nبنادول اكسترا\nشامبو أطفال\nخبز توست'} />
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
