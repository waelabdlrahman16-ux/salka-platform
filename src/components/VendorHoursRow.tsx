import { useEffect, useState } from 'react'
import Toggle from './Toggle'
import { supabase } from '../lib/supabase'
import { adminCatalogAction } from '../lib/adminCatalogActions'
import { WEEK, type DayHours } from '../lib/vendorHours'
import type { Restaurant } from '../lib/types'

// The admin's opening-hours editor for one vendor: seven days, Saturday first.
//
// Admin only. Vendors keep «اقفل دلوقتي» and nothing else, so a vendor cannot
// take themselves offline by mistyping 22:00 as 02:00.
//
// Loads its own rows rather than having Admin.tsx fetch hours for every vendor
// in the list -- this only renders for the one vendor that is expanded.
type Draft = { opens: string; closes: string; closed: boolean }
const BLANK: Draft = { opens: '', closes: '', closed: false }

export default function VendorHoursRow({ restaurant, onSaved }: {
  restaurant: Restaurant
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<Record<number, Draft>>(
    () => Object.fromEntries(WEEK.map(d => [d.dow, { ...BLANK }])))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true); setError('')
    const { data, error: err } = await supabase
      .from('vendor_hours').select('*').eq('restaurant_id', restaurant.id)
    setLoading(false)
    // Checked, not discarded: an empty editor after a failed read looks exactly
    // like a vendor with no hours, and saving from that state would wipe the
    // real ones.
    if (err) { setError('مش قادرين نجيب المواعيد، ماتحفظش قبل ما تحدّث'); return }
    const next = Object.fromEntries(WEEK.map(d => [d.dow, { ...BLANK }])) as Record<number, Draft>
    for (const r of (data as DayHours[]) ?? []) {
      next[r.day_of_week] = {
        opens: r.opens_at?.slice(0, 5) ?? '',
        closes: r.closes_at?.slice(0, 5) ?? '',
        closed: r.closed,
      }
    }
    setDraft(next)
  }

  useEffect(() => { load() }, [restaurant.id])

  function set(dow: number, patch: Partial<Draft>) {
    setDraft(d => ({ ...d, [dow]: { ...d[dow], ...patch } }))
    setError(''); setSaved(false)
  }

  /** Fill every other day from Saturday. Most vendors trade the same hours. */
  function copyFromFirst() {
    const src = draft[6]
    setDraft(Object.fromEntries(WEEK.map(d => [d.dow, { ...src }])) as Record<number, Draft>)
    setSaved(false)
  }

  async function save() {
    // A day with an opening but no closing (or the reverse) is not a window,
    // and the server would read it as a day with no hours -- silently closing
    // the vendor on that day.
    const half = WEEK.find(d => {
      const v = draft[d.dow]
      return !v.closed && (!!v.opens !== !!v.closes)
    })
    if (half) { setError(`${half.label}: لازم تحدد الفتح والقفل مع بعض`); return }

    setSaving(true); setError('')
    const payload = WEEK
      .filter(d => draft[d.dow].closed || draft[d.dow].opens)
      .map(d => ({
        day: d.dow,
        opens: draft[d.dow].closed ? null : draft[d.dow].opens,
        closes: draft[d.dow].closed ? null : draft[d.dow].closes,
        closed: draft[d.dow].closed,
      }))

    const res = await adminCatalogAction('setVendorHours', {
      restaurantId: restaurant.id, days: payload,
    })
    setSaving(false)
    if (!res.ok) {
      setError(res.code === 'hours_incomplete'
        ? 'لازم تحدد الفتح والقفل مع بعض'
        : 'الحفظ فشل. جرب تاني')
      return
    }
    setSaved(true); setTimeout(() => setSaved(false), 1600)
    onSaved()
  }

  const anySet = WEEK.some(d => draft[d.dow].closed || draft[d.dow].opens)

  return (
    // max-w: inside a full-width card on a laptop these seven rows stretched
    // edge to edge and read as acres of empty space. The rows are naturally
    // ~22rem wide; the box now hugs them. Phones unchanged (max-w never bites).
    <div className="mt-3 bg-shellup/60 border border-line rounded-xl p-3 max-w-md">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-sm font-bold">مواعيد الفتح</p>
        <button className="btn-ghost !py-1.5 !px-3 text-[11px]" onClick={copyFromFirst}>
          📋 طبّق السبت على الكل
        </button>
      </div>
      <p className="text-[11px] text-mist mb-2">كل المواعيد بتوقيت القاهرة</p>

      {loading && <p className="text-xs text-mist py-3 text-center">جاري التحميل…</p>}

      {!loading && WEEK.map(d => {
        const v = draft[d.dow]
        const overnight = !v.closed && v.opens && v.closes && v.closes < v.opens
        return (
          <div key={d.dow} className="flex items-center gap-1.5 py-1.5 border-t border-line first:border-t-0">
            <span className="text-[11.5px] font-semibold w-14 shrink-0">{d.label}</span>
            <input type="time" dir="ltr" aria-label={`فتح ${d.label}`} disabled={v.closed}
              className="field !h-9 !w-24 text-center !text-[11.5px] disabled:opacity-40"
              value={v.opens} onChange={e => set(d.dow, { opens: e.target.value })} />
            <span className="text-mist text-[11px]">—</span>
            <input type="time" dir="ltr" aria-label={`قفل ${d.label}`} disabled={v.closed}
              className="field !h-9 !w-24 text-center !text-[11.5px] disabled:opacity-40"
              value={v.closes} onChange={e => set(d.dow, { closes: e.target.value })} />
            {/* The unified switch (Wael's rule): ON = the day is open. The old
                red/green pill inverted aria-pressed (pressed = closed) and used
                the error red for an ordinary day off. */}
            <Toggle
              on={!v.closed}
              onChange={() => set(d.dow, { closed: !v.closed })}
              ariaLabel={`${d.label}، ${v.closed ? 'مقفول' : 'مفتوح'}`}
            />
            {v.closed && <span className="text-[10.5px] text-mist shrink-0">مقفول اليوم ده</span>}
            {overnight && <span className="text-[10px] text-sandink shrink-0" title="بيعدّي نص الليل">🌙</span>}
          </div>
        )
      })}

      {!loading && !anySet && (
        <p className="text-[11px] text-mist mt-2">
          مفيش مواعيد متحددة، المحل مفتوح على طول لحد ما تحدد مواعيد
        </p>
      )}

      {error && <p className="text-[11px] text-red-600 mt-2 font-semibold" role="alert">{error}</p>}

      <div className="flex gap-2 mt-3 pt-2.5 border-t border-line">
        <button className="btn-sea !py-2 !px-5 text-sm" disabled={saving || loading} onClick={save}>
          {saving ? '…' : saved ? '✓ اتحفظ' : 'حفظ المواعيد'}
        </button>
        <button className="btn-ghost !py-2 !px-3 text-xs" disabled={saving || loading} onClick={load}>
          رجّع الأصلي
        </button>
      </div>
      <p className="text-[10px] text-mist mt-2">
        🌙 يعني الميعاد بيعدّي نص الليل، المحل بيفضل مفتوح لبعد ١٢
      </p>
    </div>
  )
}
