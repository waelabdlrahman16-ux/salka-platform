import { useEffect, useId, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/rpc'

interface BannerRow {
  id: number
  title: string
  subtitle: string | null
  image_url: string | null
  bg_color: string
  link_url: string | null
  active: boolean
  sort: number
  starts_at: string | null
  ends_at: string | null
}

const BLANK = {
  title: '', subtitle: '', image_url: '', bg_color: '#0A5F5E',
  link_url: '', active: true, starts_at: '', ends_at: '',
}

// Matches the banners_link_shape check constraint. Duplicated here on purpose:
// the database is the one that decides, this only means the admin is told what
// is wrong while typing rather than by a raw Postgres error on save.
const LINK_OK = (v: string) => !v.trim() || /^\/[A-Za-z0-9/_?=&%.:-]*$/.test(v) || /^https?:\/\/\S+$/.test(v)

// 2 MB and this list are enforced on the bucket too. Checking here as well only
// saves the upload round trip; it is not the guard.
const MAX_BYTES = 2 * 1024 * 1024
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']

export default function BannersAdmin() {
  const fid = useId()
  const [rows, setRows] = useState<BannerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<BannerRow | 'new' | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    // No .eq('active', true) here: the admin policy returns everything,
    // including switched-off and scheduled banners, which is the point.
    const { data, error } = await supabase.from('banners').select('*').order('sort').order('id')
    setLoading(false)
    if (error) { setError(describeError(error.message)); return }
    setRows((data as BannerRow[]) ?? [])
  }

  useEffect(() => { load() }, [])

  function startEdit(r: BannerRow | 'new') {
    setError('')
    setForm(r === 'new' ? { ...BLANK } : {
      title: r.title, subtitle: r.subtitle ?? '', image_url: r.image_url ?? '',
      bg_color: r.bg_color, link_url: r.link_url ?? '', active: r.active,
      starts_at: r.starts_at ? r.starts_at.slice(0, 16) : '',
      ends_at: r.ends_at ? r.ends_at.slice(0, 16) : '',
    })
    setEditing(r)
  }

  async function upload(file: File) {
    setError('')
    if (!OK_TYPES.includes(file.type)) { setError('لازم تكون صورة JPG أو PNG أو WebP'); return }
    if (file.size > MAX_BYTES) { setError('الصورة أكبر من ٢ ميجا — صغّرها الأول'); return }
    setUploading(true)
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    // Date.now keeps a re-upload from being served from cache under the old name.
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: upErr } = await supabase.storage.from('banners').upload(path, file, { upsert: false })
    if (upErr) { setUploading(false); setError(describeError(upErr.message)); return }
    const { data } = supabase.storage.from('banners').getPublicUrl(path)
    setForm(f => ({ ...f, image_url: data.publicUrl }))
    setUploading(false)
  }

  async function save() {
    if (!form.title.trim()) { setError('العنوان مطلوب'); return }
    if (!LINK_OK(form.link_url)) { setError('اللينك لازم يبدأ بـ / أو https://'); return }
    setSaving(true); setError('')
    const payload = {
      title: form.title.trim(),
      subtitle: form.subtitle.trim() || null,
      image_url: form.image_url.trim() || null,
      bg_color: form.bg_color,
      link_url: form.link_url.trim() || null,
      active: form.active,
      starts_at: form.starts_at || null,
      ends_at: form.ends_at || null,
    }
    const res = editing === 'new'
      ? await supabase.from('banners').insert({ ...payload, sort: rows.length + 1 })
      : await supabase.from('banners').update(payload).eq('id', (editing as BannerRow).id)
    setSaving(false)
    if (res.error) { setError(describeError(res.error.message)); return }
    setEditing(null)
    load()
  }

  async function toggle(r: BannerRow) {
    setError('')
    const { error } = await supabase.from('banners').update({ active: !r.active }).eq('id', r.id)
    if (error) { setError(describeError(error.message)); return }
    load()
  }

  async function move(r: BannerRow, dir: -1 | 1) {
    const i = rows.findIndex(x => x.id === r.id)
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    setError('')
    // Swap the two sort values. Two writes rather than a reshuffle of the whole
    // list, so a failure leaves the order untouched rather than half-applied.
    const a = rows[i], b = rows[j]
    const r1 = await supabase.from('banners').update({ sort: b.sort }).eq('id', a.id)
    if (r1.error) { setError(describeError(r1.error.message)); return }
    const r2 = await supabase.from('banners').update({ sort: a.sort }).eq('id', b.id)
    if (r2.error) { setError(describeError(r2.error.message)); load(); return }
    load()
  }

  async function remove(r: BannerRow) {
    if (!confirm(`حذف "${r.title}"؟`)) return
    setError('')
    const { error } = await supabase.from('banners').delete().eq('id', r.id)
    if (error) { setError(describeError(error.message)); return }
    load()
  }

  const scheduled = (r: BannerRow) => {
    const now = Date.now()
    if (r.starts_at && +new Date(r.starts_at) > now) return `مجدول من ${r.starts_at.slice(0, 10)}`
    if (r.ends_at && +new Date(r.ends_at) <= now) return 'منتهي'
    return null
  }

  if (loading) return <p className="text-mist">جاري التحميل…</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-mist">بتظهر فوق الصفحة الرئيسية عند العميل. المقاس المفضّل ١٢٠٠×٤٠٠.</p>
        <button className="btn-sea !py-2 text-sm shrink-0" onClick={() => startEdit('new')}>+ إعلان جديد</button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3">{error}</p>}

      {editing && (
        <div className="card p-4 space-y-3">
          <h3 className="font-bold">{editing === 'new' ? 'إعلان جديد' : 'تعديل الإعلان'}</h3>

          <div
            className="relative h-[110px] rounded-xl overflow-hidden"
            style={{ background: form.bg_color }}>
            {form.image_url && <img src={form.image_url} alt="" className="absolute inset-0 w-full h-full object-cover" />}
            {form.image_url && <span className="absolute inset-0 bg-gradient-to-l from-black/70 via-black/25 to-transparent" />}
            <span className="relative flex flex-col justify-center h-full px-4">
              <span className="text-white font-bold text-base">{form.title || 'العنوان'}</span>
              {form.subtitle && <span className="text-white/90 text-xs mt-1">{form.subtitle}</span>}
            </span>
          </div>
          <p className="text-xs text-mist -mt-1">ده شكله عند العميل.</p>

          <div><label className="label" htmlFor={`${fid}-t`}>العنوان *</label>
            <input id={`${fid}-t`} className="field" maxLength={60} value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>

          <div><label className="label" htmlFor={`${fid}-s`}>سطر تحته</label>
            <input id={`${fid}-s`} className="field" maxLength={90} value={form.subtitle}
              onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} /></div>

          <div>
            <label className="label">الصورة</label>
            <div className="flex gap-2 items-center">
              <input type="file" accept={OK_TYPES.join(',')} disabled={uploading}
                onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }}
                className="text-sm flex-1" />
              {form.image_url && (
                <button className="btn-ghost !py-1.5 !px-3 text-xs shrink-0"
                  onClick={() => setForm(f => ({ ...f, image_url: '' }))}>شيل الصورة</button>
              )}
            </div>
            {uploading && <p className="text-xs text-mist mt-1">جاري الرفع…</p>}
            <p className="text-xs text-mist mt-1">من غير صورة، هيستخدم اللون تحت.</p>
          </div>

          <div><label className="label" htmlFor={`${fid}-c`}>لون الخلفية</label>
            <input id={`${fid}-c`} type="color" className="h-11 w-20 rounded-lg border border-line"
              value={form.bg_color} onChange={e => setForm(f => ({ ...f, bg_color: e.target.value }))} /></div>

          <div><label className="label" htmlFor={`${fid}-l`}>لما حد يضغط، يروح فين؟</label>
            <input id={`${fid}-l`} className={`field ${!LINK_OK(form.link_url) ? '!border-red-400' : ''}`}
              dir="ltr" placeholder="/restaurant/9  أو  https://..." value={form.link_url}
              onChange={e => setForm(f => ({ ...f, link_url: e.target.value }))} />
            {!LINK_OK(form.link_url)
              ? <p className="text-xs text-red-600 mt-1">لازم يبدأ بـ / (صفحة جوه التطبيق) أو https://</p>
              : <p className="text-xs text-mist mt-1">سيبه فاضي لو الإعلان للعرض بس.</p>}</div>

          <div className="grid grid-cols-2 gap-2">
            <div><label className="label" htmlFor={`${fid}-from`}>يبدأ</label>
              <input id={`${fid}-from`} type="datetime-local" className="field" value={form.starts_at}
                onChange={e => setForm(f => ({ ...f, starts_at: e.target.value }))} /></div>
            <div><label className="label" htmlFor={`${fid}-to`}>ينتهي</label>
              <input id={`${fid}-to`} type="datetime-local" className="field" value={form.ends_at}
                onChange={e => setForm(f => ({ ...f, ends_at: e.target.value }))} /></div>
          </div>
          <p className="text-xs text-mist -mt-1">سيبهم فاضيين عشان يفضل شغال على طول.</p>

          <label className="flex items-center gap-2.5 min-h-[44px] cursor-pointer">
            <input type="checkbox" className="w-5 h-5 accent-sea" checked={form.active}
              onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
            <span className="text-sm font-semibold">شغّال</span>
          </label>

          <div className="flex gap-2">
            <button className="btn-ghost flex-1 text-sm" onClick={() => setEditing(null)} disabled={saving}>إلغاء</button>
            <button className="btn-sea flex-1 text-sm" onClick={save} disabled={saving || uploading || !form.title.trim()}>
              {saving ? 'جاري الحفظ…' : 'حفظ'}
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 && !editing && (
        <div className="card p-6 text-center text-mist">مفيش إعلانات لسه</div>
      )}

      {rows.map((r, i) => {
        const note = scheduled(r)
        return (
          <div key={r.id} className="card p-3 flex items-center gap-3">
            <div className="w-16 h-11 rounded-lg overflow-hidden shrink-0 relative" style={{ background: r.bg_color }}>
              {r.image_url && <img src={r.image_url} alt="" className="absolute inset-0 w-full h-full object-cover" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">{r.title}</p>
              <p className="text-xs text-mist truncate">
                {r.link_url || 'من غير لينك'}{note ? ` · ${note}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => move(r, -1)} disabled={i === 0} aria-label="فوق">▲</button>
              <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => move(r, 1)} disabled={i === rows.length - 1} aria-label="تحت">▼</button>
              <button className={`btn-ghost !py-1.5 !px-3 text-xs ${r.active ? '!text-sea' : '!text-mist'}`}
                onClick={() => toggle(r)}>{r.active ? 'شغّال' : 'موقوف'}</button>
              <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => startEdit(r)}>تعديل</button>
              <button className="btn-ghost !py-1.5 !px-2.5 text-xs !text-red-600" onClick={() => remove(r)}>حذف</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
