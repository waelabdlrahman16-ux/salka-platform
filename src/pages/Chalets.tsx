import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Chalet } from '../lib/types'

export default function Chalets() {
  const [chalets, setChalets] = useState<Chalet[]>([])
  const [selected, setSelected] = useState<Chalet | null>(null)
  const [name, setName] = useState(''); const [phone, setPhone] = useState('')
  const [checkIn, setCheckIn] = useState(''); const [checkOut, setCheckOut] = useState('')
  const [guests, setGuests] = useState(2)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    supabase.from('chalets').select('*').eq('available', true)
      .then(({ data }) => setChalets(data ?? []))
  }, [])

  const nights = checkIn && checkOut
    ? Math.max(0, Math.round((+new Date(checkOut) - +new Date(checkIn)) / 86400000)) : 0
  const total = selected ? nights * selected.price_per_night : 0
  const valid = name.trim() && phone.trim() && nights > 0

  async function book() {
    if (!selected || !valid) return
    setSaving(true)
    await supabase.from('bookings').insert({
      chalet_id: selected.id, customer_name: name.trim(), customer_phone: phone.trim(),
      check_in: checkIn, check_out: checkOut, guests, total
    })
    setSaving(false); setDone(true)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-5">🏖️ الشاليهات والفلل</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {chalets.map(c => (
          <div key={c.id} className="card p-4">
            <div className="flex items-start justify-between">
              <h2 className="font-bold">{c.name}</h2>
              <span className="text-sea font-bold">{c.price_per_night} ج.م<span className="text-mist text-xs font-normal"> / ليلة</span></span>
            </div>
            <p className="text-sm text-mist mt-1.5">{c.description}</p>
            <div className="flex items-center gap-3 mt-3 text-sm text-mist">
              <span>🛏 {c.bedrooms} غرف</span><span>👥 حتى {c.guests} أفراد</span><span>{c.property_type}</span>
            </div>
            <button className="btn-sea w-full mt-4" onClick={() => { setSelected(c); setDone(false) }}>احجز الآن</button>
          </div>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => setSelected(null)}>
          <div className="card w-full max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {done ? (
              <div className="text-center py-6">
                <div className="text-4xl mb-3">🎉</div>
                <h3 className="font-bold text-lg">تم إرسال طلب الحجز</h3>
                <p className="text-mist text-sm mt-2">هنتواصل معاك على {phone} لتأكيد حجز {selected.name}.</p>
                <button className="btn-ghost mt-5 w-full" onClick={() => setSelected(null)}>تمام</button>
              </div>
            ) : (
              <>
                <h3 className="font-bold text-lg mb-4">حجز {selected.name}</h3>
                <div className="space-y-3.5">
                  <div><label className="label">الاسم *</label>
                    <input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="الاسم بالكامل" /></div>
                  <div><label className="label">رقم الموبايل *</label>
                    <input className="field" dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01xxxxxxxxx" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="label">تاريخ الوصول *</label>
                      <input type="date" className="field" value={checkIn} onChange={e => setCheckIn(e.target.value)} /></div>
                    <div><label className="label">تاريخ المغادرة *</label>
                      <input type="date" className="field" value={checkOut} onChange={e => setCheckOut(e.target.value)} /></div>
                  </div>
                  <div><label className="label">عدد الأفراد</label>
                    <input type="number" min={1} max={selected.guests} className="field" value={guests} onChange={e => setGuests(+e.target.value)} /></div>
                  {nights > 0 && (
                    <div className="flex justify-between bg-night rounded-xl border border-line px-4 py-3">
                      <span className="text-mist">{nights} ليلة × {selected.price_per_night} ج.م</span>
                      <span className="font-bold text-sea">{total} ج.م</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-3 mt-5">
                  <button className="btn-ghost flex-1" onClick={() => setSelected(null)}>إلغاء</button>
                  <button className="btn-sea flex-1" disabled={!valid || saving} onClick={book}>
                    {saving ? 'جاري الحجز…' : 'تأكيد الحجز'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
