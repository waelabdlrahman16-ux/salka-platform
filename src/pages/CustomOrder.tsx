import { useEffect, useState, useId } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useDeliveryQuote } from '../lib/deliveryQuote'
import { isValidEgyptPhone, PHONE_HINT } from '../lib/validation'
import { artFor } from '../lib/categoryArt'
import { getSessionToken } from '../lib/customerAuth'
import type { Compound, MenuItem, Restaurant, Slot } from '../lib/types'

export default function CustomOrder() {
  const fid = useId()
  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  const typeFilter = searchParams.get('type') // 'pharmacy' | 'supermarket' | null -- deep-link from Home's category tiles
  const [vendors, setVendors] = useState<Restaurant[]>([])
  const [vendor, setVendor] = useState<Restaurant | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  // Structured lines, not a text blob.
  //
  // submit_custom_order has always ACCEPTED p_request_items, and the UI has
  // always sent `[]`, putting the whole order into the notes field instead. So
  // the pharmacist received one paragraph to read and interpret: no quantities
  // they could rely on, no way to tick an item off, no way to price line by
  // line. The server was ready; the screen never used it.
  const [lines, setLines] = useState<{ name: string; qty: number }[]>([])
  const [draft, setDraft] = useState('')
  const [notes, setNotes] = useState('')
  // Which sub-flow the customer picked. Tapping a category used to type the
  // category's NAME into the order -- so someone following the app's own
  // prompt asked the pharmacist for "أدوية بروشتة", which is a shelf label,
  // not a medicine.
  const [intent, setIntent] = useState<string | null>(null)
  const [rxPath, setRxPath] = useState<string | null>(null)
  const [rxPreview, setRxPreview] = useState<string | null>(null)
  const [rxUploading, setRxUploading] = useState(false)
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
      // Was set inside `if (data)`, so a first-time customer with no saved
      // address never latched the flag and this debounced RPC re-fired on every
      // subsequent keystroke in the phone field, forever.
      setAddressLoaded(true)
      if (data) {
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
      .then(({ data }) => setVendors((data as Restaurant[]) ?? []))
    supabase.from('compounds').select('*').eq('active', true).order('direction').order('distance_km')
      .then(({ data }) => setCompounds(data ?? []))
  }, [])

  // Re-resolve the vendor whenever the requested type changes -- not just once
  // on mount. صيدلية and ماركت are now two tabs in the bottom nav that both
  // render THIS component, so tapping from one to the other changes only the
  // query string: React keeps the component mounted and no fetch re-fires.
  // Resolved on mount alone, a customer who opened the pharmacy and then tapped
  // ماركت would still be sitting in the pharmacy's order form, under a heading
  // that said السوبر ماركت.
  //
  // Auto-select when the type has exactly one vendor, which today is both of
  // them: a chooser containing a single card is a tap that asks a question with
  // one answer.
  useEffect(() => {
    if (!vendors.length) return
    if (!typeFilter) { setVendor(null); return }
    const matches = vendors.filter(v => v.vendor_type === typeFilter)
    setVendor(matches.length === 1 ? matches[0] : null)
  }, [typeFilter, vendors])

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

  function addDraft() {
    const t = draft.trim()
    if (!t) return
    // Same item typed twice bumps the quantity rather than making a second row
    // the vendor has to notice and reconcile.
    setLines(ls => {
      const i = ls.findIndex(l => l.name.toLowerCase() === t.toLowerCase())
      if (i === -1) return [...ls, { name: t, qty: 1 }]
      const copy = [...ls]; copy[i] = { ...copy[i], qty: copy[i].qty + 1 }; return copy
    })
    setDraft('')
  }
  const setQty = (i: number, d: number) =>
    setLines(ls => ls.flatMap((l, j) => j !== i ? [l] : (l.qty + d <= 0 ? [] : [{ ...l, qty: l.qty + d }])))

  async function uploadRx(file: File) {
    setError('')
    if (!['image/jpeg','image/png','image/webp','image/avif'].includes(file.type)) {
      setError('لازم تكون صورة'); return
    }
    if (file.size > 5 * 1024 * 1024) { setError('الصورة أكبر من ٥ ميجا'); return }
    setRxUploading(true)
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    // Flat, unguessable, and matching the shape both the storage policy and
    // submit_custom_order enforce. Nothing here is derived from the customer.
    const path = `rx-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}.${ext === 'jpeg' ? 'jpg' : ext}`
    const { error: upErr } = await supabase.storage.from('prescriptions').upload(path, file, { upsert: false })
    setRxUploading(false)
    if (upErr) { setError('مش قادرين نرفع الصورة، جرب تاني'); return }
    setRxPath(path)
    // Local preview only. The bucket is private and has no public URL -- this
    // object URL never leaves the customer's own browser.
    setRxPreview(URL.createObjectURL(file))
  }

  const selectedCompound = compounds.find(c => c.id === compoundId)
  const { fee: deliveryFee, quote, loading: feeLoading, failed: feeFailed, retry: retryFee } =
    useDeliveryQuote(compoundId)
  const scheduled = vendor?.vendor_type === 'supermarket'
  const valid = vendor && name.trim() && isValidEgyptPhone(phone) && compoundId && unit.trim()
    && lines.length > 0 && deliveryFee !== null && (!scheduled || !!slot)

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
      p_request_items: lines,
      p_request_notes: notes.trim(),
      p_compound_id: compoundId,
      p_session_token: getSessionToken(),
      p_slot_id: slot?.id ?? null,
      p_scheduled_date: slot?.scheduled_date ?? null,
      p_prescription_path: rxPath
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
        {/* No "طلب خاص" any more. That name described the mechanism (a request
            rather than a catalogue order) instead of the errand, and it had its
            own home-screen card sitting beside the pharmacy and supermarket
            cards -- whose only job was to offer a choice between those same two
            places. The untyped screen is now reachable only by typing the URL,
            so it names what it actually lists. */}
        <h1 className="text-2xl font-bold mb-1">
          {typeFilter === 'pharmacy' ? 'الصيدلية' : typeFilter === 'supermarket' ? 'السوبر ماركت' : 'صيدلية وماركت'}
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
      {/* Only offer "back to the vendor list" when there IS a list to go back
          to. With one vendor of this type the customer was brought straight
          here, so clearing the selection would strand them on a chooser holding
          a single card -- a screen they never chose to leave. Then رجوع means
          what it says everywhere else: back where you came from. */}
      <button className="text-sm text-mist hover:text-foam mb-3" onClick={() => {
        const siblings = typeFilter ? vendors.filter(v => v.vendor_type === typeFilter) : vendors
        if (siblings.length > 1) setVendor(null); else nav(-1)
      }}>← رجوع</button>
      <h1 className="text-2xl font-bold mb-1">{vendor.name}</h1>
      <p className="text-mist text-sm mb-4">اكتب اللي محتاجه، وهنقولك السعر النهائي بمكالمة قبل ما نجهز الطلب</p>

      {/* Categories now STEER the screen. They used to write their own name
          into the customer's order, so tapping "أدوية بروشتة" put the words
          "أدوية بروشتة" on the list -- a shelf label, not a medicine, and
          nothing the pharmacist could actually fetch. */}
      {categories.length > 0 && (
        <div className="mb-4">
          <p className="text-sm text-mist mb-2">عايز إيه من {vendor.name}؟</p>
          <div className="flex flex-wrap gap-2">
            {categories.map(cat => (
              <button key={cat}
                className={`tab ${intent === cat ? 'tab-active' : 'bg-shellup/60'}`}
                onClick={() => setIntent(intent === cat ? null : cat)}>
                {artFor(cat).emoji} {cat}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Prescription upload, only where it means something: any pharmacy
          order, or a category that mentions a prescription. Optional -- plenty
          of pharmacy orders are shampoo. */}
      {(vendor.vendor_type === 'pharmacy' || (intent ?? '').includes('روشتة')) && (
        <div className="card p-4 mb-4 border-sea/40">
          <p className="font-bold text-sm">📷 عندك روشتة؟ صوّرها</p>
          <p className="text-xs text-mist mt-1 mb-3">
            هتوصل للصيدلي مع طلبك، فمش هيحتاج يتصل بيك عشان يشوفها. اختياري.
          </p>
          {rxPreview ? (
            <div className="flex items-center gap-3">
              <img src={rxPreview} alt="الروشتة" className="w-16 h-16 rounded-xl object-cover border border-line" />
              <span className="text-sm font-semibold text-emerald-700 flex-1">اترفعت ✓</span>
              <button className="btn-ghost !py-1.5 !px-3 text-xs"
                onClick={() => { setRxPath(null); setRxPreview(null) }}>شيلها</button>
            </div>
          ) : (
            <>
              <input type="file" accept="image/jpeg,image/png,image/webp,image/avif"
                capture="environment" disabled={rxUploading}
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadRx(f) }}
                className="text-sm" />
              {rxUploading && <p className="text-xs text-mist mt-1">جاري الرفع…</p>}
            </>
          )}
        </div>
      )}

      <div className="mb-4">
        <label className="label" htmlFor={`${fid}-1`}>قايمة طلبك *</label>

        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2 card p-2.5 mb-2">
            <span className="flex-1 text-sm min-w-0 truncate">{l.name}</span>
            <div className="flex items-center gap-1 bg-shellup rounded-lg p-1 shrink-0">
              <button className="w-8 h-8 rounded-md grid place-items-center" aria-label="تقليل"
                onClick={() => setQty(i, -1)}>−</button>
              <span className="font-bold text-sm w-6 text-center">{l.qty}</span>
              <button className="w-8 h-8 rounded-md grid place-items-center bg-sea text-white" aria-label="زيادة"
                onClick={() => setQty(i, +1)}>+</button>
            </div>
            <button className="w-9 h-9 grid place-items-center text-mist shrink-0" aria-label="حذف"
              onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}

        <div className="flex gap-2">
          <input id={`${fid}-1`} className="field flex-1" value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDraft() } }}
            placeholder={vendor.vendor_type === 'pharmacy' ? 'مثال: بنادول اكسترا' : 'مثال: خبز توست'} />
          <button className="btn-sea shrink-0 !px-5" onClick={addDraft} disabled={!draft.trim()}>إضافة</button>
        </div>
        {lines.length === 0 && (
          <p className="text-xs text-mist mt-1.5">اكتب كل صنف لوحده واضغط إضافة — كده الصيدلي يقدر يشطب صنف صنف.</p>
        )}
      </div>

      <div className="mb-4">
        <label className="label" htmlFor={`${fid}-notes`}>ملاحظات (اختياري)</label>
        <input id={`${fid}-notes`} className="field" value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="مثال: لو مش موجود، جيب أي بديل" />
      </div>

      {scheduled && (
        <div className="mb-4">
          <h2 className="font-bold mb-2">فترة التوصيل</h2>
          {slots.length === 0 && <p className="text-sm text-sandink">لا توجد فترات متاحة حالياً</p>}
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
        <div><label className="label" htmlFor={`${fid}-2`}>الاسم *</label>
          <input id={`${fid}-2`} className="field" value={name} onChange={e => setName(e.target.value)} placeholder="الاسم بالكامل" /></div>
        <div><label className="label" htmlFor={`${fid}-3`}>رقم الموبايل *</label>
          <input id={`${fid}-3`} className={`field ${phone.trim() && !isValidEgyptPhone(phone) ? '!border-red-400' : ''}`}
            dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01xxxxxxxxx" maxLength={13} />
          {phone.trim() && !isValidEgyptPhone(phone) && <p className="text-xs text-red-600 mt-1">{PHONE_HINT}</p>}</div>
        <div><label className="label" htmlFor={`${fid}-4`}>المكان *</label>
          <select id={`${fid}-4`} className="field" value={compoundId ?? ''} onChange={e => setCompoundId(Number(e.target.value) || null)}>
            <option value="">اختر مكانك…</option>
            {compounds.map(c => <option key={c.id} value={c.id}>{c.name} (~{c.est_travel_minutes} د)</option>)}
          </select></div>
        <div><label className="label" htmlFor={`${fid}-5`}>رقم الشاليه / الفيلا *</label>
          <input id={`${fid}-5`} className="field" value={unit} onChange={e => setUnit(e.target.value)} placeholder="مثال: B4 - 204" /></div>
        <div><label className="label" htmlFor={`${fid}-6`}>علامة مميزة (اختياري)</label>
          <input id={`${fid}-6`} className="field" value={addrNotes} onChange={e => setAddrNotes(e.target.value)} placeholder="مثال: بجوار حمام السباحة" /></div>
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
