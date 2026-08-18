import { useEffect, useId, useState } from 'react'
import { supabase } from '../lib/supabase'
import { adminCompoundAction } from '../lib/adminCompoundActions'

/**
 * Compounds — the places Salka delivers to, and what delivery costs to each.
 *
 * Kept apart from the restaurants on purpose. A compound is a place; a
 * restaurant is a business; they were both living under "المطاعم" because that
 * is where the fee editor happened to be bolted on. Until now the admin could
 * only EDIT a fee: adding a new development, renaming one, moving its pin or
 * retiring it all required a developer.
 *
 * The fee is the reason this screen matters. place_order reads
 * compounds.delivery_fee and refuses an order to a compound without one, so a
 * compound created without a fee is a place a customer can pick and can never
 * order to. The server enforces that; this form just refuses earlier.
 */
type Region = { id: number; name: string }
type Row = {
  id: number; name: string; region_id: number; delivery_fee: number | null
  distance_km: number | null; direction: string | null
  latitude: number | null; longitude: number | null; active: boolean
}

const EMPTY = {
  id: null as number | null, name: '', region_id: '', delivery_fee: '',
  distance_km: '', direction: '', latitude: '', longitude: '', active: true,
}

export default function CompoundsTab() {
  const fid = useId()
  const [rows, setRows] = useState<Row[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [f, setF] = useState<typeof EMPTY>(EMPTY)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')

  async function load() {
    const [c, r] = await Promise.all([
      supabase.from('compounds').select('*').order('active', { ascending: false }).order('name'),
      supabase.from('regions').select('id, name').order('id'),
    ])
    if (!c.error) setRows((c.data ?? []) as Row[])
    if (!r.error) setRegions((r.data ?? []) as Region[])
  }
  useEffect(() => { load() }, [])

  function edit(row: Row) {
    setF({
      id: row.id, name: row.name, region_id: String(row.region_id),
      delivery_fee: String(row.delivery_fee ?? ''), distance_km: String(row.distance_km ?? ''),
      direction: row.direction ?? '', latitude: String(row.latitude ?? ''),
      longitude: String(row.longitude ?? ''), active: row.active,
    })
    setEditing(true); setError('')
  }

  async function save() {
    setBusy(true); setError('')
    const res = await adminCompoundAction('upsertCompound', {
      id: f.id,
      name: f.name.trim(),
      regionId: Number(f.region_id),
      deliveryFee: Number(f.delivery_fee),
      distanceKm: f.distance_km === '' ? null : Number(f.distance_km),
      direction: f.direction || null,
      latitude: f.latitude === '' ? null : Number(f.latitude),
      longitude: f.longitude === '' ? null : Number(f.longitude),
      active: f.active,
    }, {
      delivery_fee_required: 'لازم تحط سعر توصيل أكبر من صفر، من غيره العميل هيشوف المكان ومش هيقدر يطلب',
      name_required: 'اكتب اسم الكومباوند',
      region_not_found: 'اختار المنطقة',
      invalid_direction: 'الاتجاه لازم يكون شمال أو جنوب',
      compound_not_found: 'الكومباوند ده مش موجود. حدّث الصفحة',
      admin_only: 'مش من صلاحياتك',
    })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    setF(EMPTY); setEditing(false); load()
  }

  const valid = f.name.trim() && f.region_id && Number(f.delivery_fee) > 0
  const shown = rows.filter(r => !q.trim() || r.name.includes(q.trim()))
  const missingCoords = rows.filter(r => r.active && (r.latitude == null || r.longitude == null)).length

  return (
    <div className="space-y-3">
      {!editing ? (
        <button className="btn-sea w-full text-sm" onClick={() => { setF(EMPTY); setEditing(true); setError('') }}>
          ➕ إضافة كومباوند
        </button>
      ) : (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-bold text-sm">{f.id ? 'تعديل كومباوند' : 'كومباوند جديد'}</p>
            <button className="text-mist text-xs" onClick={() => { setEditing(false); setError('') }}>إغلاق ✕</button>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-3" role="alert">{error}</p>}

          <div className="grid grid-cols-2 gap-2.5">
            <div className="col-span-2">
              <label className="label" htmlFor={`${fid}-n`}>الاسم</label>
              <input id={`${fid}-n`} className="field !h-9 text-sm" value={f.name}
                onChange={e => setF({ ...f, name: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor={`${fid}-r`}>المنطقة</label>
              <select id={`${fid}-r`} className="field !h-9 text-sm" value={f.region_id}
                onChange={e => setF({ ...f, region_id: e.target.value })}>
                <option value="">اختار…</option>
                {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor={`${fid}-f`}>سعر التوصيل (ج.م)</label>
              <input id={`${fid}-f`} className="field !h-9 text-sm" type="number" inputMode="decimal"
                value={f.delivery_fee} onChange={e => setF({ ...f, delivery_fee: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor={`${fid}-d`}>المسافة (كم)</label>
              <input id={`${fid}-d`} className="field !h-9 text-sm" type="number" inputMode="decimal"
                value={f.distance_km} onChange={e => setF({ ...f, distance_km: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor={`${fid}-dir`}>الاتجاه</label>
              <select id={`${fid}-dir`} className="field !h-9 text-sm" value={f.direction}
                onChange={e => setF({ ...f, direction: e.target.value })}>
                <option value="">—</option>
                <option value="north">شمال</option>
                <option value="south">جنوب</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor={`${fid}-la`}>Latitude</label>
              <input id={`${fid}-la`} className="field !h-9 text-sm" dir="ltr" inputMode="decimal"
                value={f.latitude} onChange={e => setF({ ...f, latitude: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor={`${fid}-lo`}>Longitude</label>
              <input id={`${fid}-lo`} className="field !h-9 text-sm" dir="ltr" inputMode="decimal"
                value={f.longitude} onChange={e => setF({ ...f, longitude: e.target.value })} />
            </div>
          </div>

          {/* The map on the tracking page needs both. Without them a customer
              watching their driver gets a blank panel and no explanation. */}
          <p className="text-xs text-mist mt-2">
            المسافة بتحدد الوقت المتوقع، والإحداثيات بتخلي خريطة التتبع تشتغل. السعر هو اللي بيتحسب على العميل.
          </p>

          <label className="flex items-center gap-2 mt-3 min-h-[44px] cursor-pointer">
            <input type="checkbox" className="w-5 h-5 accent-sea" checked={f.active}
              onChange={e => setF({ ...f, active: e.target.checked })} />
            <span className="text-sm">شغّال، بيظهر للعملاء</span>
          </label>

          <button className="btn-sea w-full text-sm mt-2" disabled={busy || !valid} onClick={save}>
            {busy ? 'لحظة…' : (f.id ? 'حفظ التعديل' : 'إضافة الكومباوند')}
          </button>
        </div>
      )}

      {missingCoords > 0 && (
        <p className="text-xs text-sandink bg-sand/10 rounded-xl p-3">
          ⚠️ {missingCoords} كومباوند شغّال من غير إحداثيات، خريطة تتبع المندوب مش هتشتغل فيهم.
        </p>
      )}

      <input className="field text-sm" placeholder="دوّر باسم الكومباوند…" value={q} onChange={e => setQ(e.target.value)} />

      <p className="text-xs text-mist">{shown.length} من {rows.length}</p>
      <div className="space-y-2">
        {shown.map(r => (
          <div key={r.id} className={`card p-3 flex items-center gap-3 ${r.active ? '' : 'opacity-60'}`}>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm truncate">
                {r.name} {!r.active && <span className="text-xs text-red-600">(موقوف)</span>}
              </p>
              <p className="text-xs text-mist">
                {regions.find(g => g.id === r.region_id)?.name ?? '—'}
                {r.distance_km != null && ` · ${r.distance_km} كم`}
                {r.direction && ` · ${r.direction === 'north' ? 'شمال' : 'جنوب'}`}
                {(r.latitude == null || r.longitude == null) && ' · ⚠️ مفيش إحداثيات'}
              </p>
            </div>
            <span className="font-bold text-sea text-sm shrink-0">{r.delivery_fee} ج.م</span>
            <button className="btn-ghost !py-1.5 !px-3 text-xs shrink-0" onClick={() => edit(r)}>تعديل</button>
          </div>
        ))}
      </div>
    </div>
  )
}
