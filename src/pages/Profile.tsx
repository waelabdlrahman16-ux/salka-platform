import { useEffect, useState, useId } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCustomerAuth, getSessionToken } from '../lib/customerAuth'
import { homeFor, useAuth } from '../lib/auth'
import { orderStatusLabel } from '../lib/statusLabels'
import { isValidEgyptPhone, PHONE_HINT } from '../lib/validation'
import { describeError, rpc } from '../lib/rpc'
import { SUPPORT_WHATSAPP_URL } from '../lib/support'
import type { Compound } from '../lib/types'

interface Address {
  id: number; label: string; compound_id: number; compound_name: string
  unit_number: string; notes: string | null; is_default: boolean
}
interface OrderRow {
  id: number; public_token: string; total: number
  status: string; created_at: string; restaurant_name: string
}

export default function Profile() {
  const fid = useId()
  const nav = useNavigate()
  const { customer, logout, updatePhone, updateName } = useCustomerAuth()
  const { profile: staffProfile } = useAuth()
  const [editingIdentity, setEditingIdentity] = useState(false)
  const [addresses, setAddresses] = useState<Address[]>([])
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [compounds, setCompounds] = useState<Compound[]>([])
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [editing, setEditing] = useState<Address | 'new' | null>(null)
  const [label, setLabel] = useState('')
  const [compoundId, setCompoundId] = useState<number | null>(null)
  const [unit, setUnit] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [addressError, setAddressError] = useState('')

  async function load() {
    const { data } = await supabase.rpc('my_customer_addresses')
    setAddresses((data as Address[]) ?? [])
  }

  useEffect(() => {
    if (!customer) return
    load()
    supabase.rpc('my_customer_orders').then(({ data }) => setOrders((data as OrderRow[]) ?? []))
    supabase.from('compounds').select('*').eq('active', true).order('name').then(({ data }) => setCompounds(data ?? []))
    if (customer.phone) {
      // Pass the session token like checkout does. Without it the RPC falls
      // through to the anonymous path and burns the phone_lookup rate limit on
      // a customer who is already signed in.
      supabase.rpc('wallet_balance_for_phone', { p_phone: customer.phone, p_session_token: getSessionToken() })
        .then(({ data, error }) => { if (!error) setWalletBalance(Number(data) || 0) })
    }
  }, [customer])

  function startEdit(a: Address | 'new') {
    // Otherwise a failure from remove()/makeDefault() reappears inside the edit
    // card as though it were about the form the user just opened.
    setAddressError('')
    if (a === 'new') {
      setLabel(''); setCompoundId(null); setUnit(''); setNotes('')
    } else {
      setLabel(a.label); setCompoundId(a.compound_id); setUnit(a.unit_number); setNotes(a.notes ?? '')
    }
    setEditing(a)
  }

  // All four of these discarded their error and called load(), so a rejected
  // write was repainted with server state and looked like it had succeeded.
  async function save() {
    if (!compoundId || !unit.trim()) return
    setSaving(true); setAddressError('')
    const res = editing === 'new'
      ? await rpc('add_customer_address', {
          p_label: label, p_compound_id: compoundId, p_unit_number: unit, p_notes: notes || null
        })
      : editing
        ? await rpc('update_customer_address', {
            p_id: editing.id, p_label: label, p_compound_id: compoundId, p_unit_number: unit, p_notes: notes || null
          })
        : { ok: true as const, data: null }
    setSaving(false)
    if (!res.ok) { setAddressError(res.error); return }
    setEditing(null)
    load()
  }

  async function remove(a: Address) {
    if (!confirm(`حذف "${a.label}"؟`)) return
    setAddressError('')
    const res = await rpc('delete_customer_address', { p_id: a.id })
    if (!res.ok) { setAddressError(res.error); return }
    load()
  }

  async function makeDefault(a: Address) {
    setAddressError('')
    const res = await rpc('set_default_address', { p_id: a.id })
    if (!res.ok) { setAddressError(res.error); return }
    load()
  }

  if (!customer) {
    return (
      <div className="max-w-sm mx-auto mt-8 text-center">
        <p className="text-mist mb-4">سجّل دخولك الأول عشان تشوف حسابك</p>
        <Link to="/my-orders" className="btn-sea">تسجيل الدخول</Link>
      </div>
    )
  }

  return (
    <div className="max-w-sm mx-auto space-y-4 pb-6">
      {/* Name and phone were display-only once set. There was no function to
          change a name at all, and the phone editor rendered only while the
          phone was MISSING -- so a typo at signup, or whatever display name
          Google supplied, was permanent. That name is what a driver reads at
          the door. Both are editable now, and stay editable. */}
      <div className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {editingIdentity ? (
              <IdentityEditor
                initialName={customer.name ?? ''}
                initialPhone={customer.phone ?? ''}
                onSaveName={updateName}
                onSavePhone={updatePhone}
                onClose={() => setEditingIdentity(false)}
              />
            ) : (
              <>
                <p className="font-bold">{customer.name || 'حسابك'}</p>
                {customer.email && <p className="text-xs text-mist mt-0.5" dir="ltr">{customer.email}</p>}
                {customer.phone
                  ? <p className="text-xs text-mist mt-0.5" dir="ltr">{customer.phone}</p>
                  : <p className="text-xs text-sandink mt-0.5">لسه ما ضفتش رقم موبايل</p>}
              </>
            )}
          </div>
          {!editingIdentity && (
            <div className="flex flex-col gap-2 shrink-0">
              <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={() => setEditingIdentity(true)}>تعديل</button>
              <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={async () => { await logout(); nav('/') }}>خروج</button>
            </div>
          )}
        </div>
      </div>

      {!customer.phone && !editingIdentity && (
        <div className="card p-4 bg-sand/10 mt-3">
          <p className="text-sm font-semibold mb-2">محتاجين رقم موبايلك عشان نقدر نوصلك</p>
          <PhoneInline onSave={updatePhone} />
        </div>
      )}

      <div className="card p-4">
        <p className="text-sm text-mist">رصيدك في المحفظة</p>
        <p className="text-2xl font-bold text-sea mt-1">{walletBalance ?? '—'} ج.م</p>
      </div>

      {orders.length > 0 && (
        <div>
          <h2 className="font-bold mb-2.5">طلباتي</h2>
          <div className="space-y-2">
            {orders.slice(0, 5).map(o => (
              <Link key={o.id} to={`/track/${o.public_token}`} className="card p-3.5 flex items-center justify-between hover:border-sea/50 transition-colors">
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">#{o.id} — {o.restaurant_name}</p>
                  <p className="text-xs text-mist mt-0.5">{orderStatusLabel(o.status)}</p>
                </div>
                <span className="text-sea font-bold text-sm shrink-0">{o.total} ج.م</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="font-bold">عناويني المحفوظة</h2>
          {addresses.length < 10 && (
            <button className="text-sea text-sm font-semibold" onClick={() => startEdit('new')}>+ إضافة عنوان</button>
          )}
        </div>

        {/* remove()/makeDefault() failures happen outside the edit card */}
        {addressError && !editing && (
          <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-3">{addressError}</p>
        )}

        {editing && (
          <div className="card p-4 mb-3 space-y-3">
            <div><label className="label" htmlFor={`${fid}-1`}>اسم العنوان</label>
              <input id={`${fid}-1`} className="field" value={label} onChange={e => setLabel(e.target.value)} placeholder="المنزل / الشغل" /></div>
            <div><label className="label" htmlFor={`${fid}-2`}>المكان *</label>
              <select id={`${fid}-2`} className="field" value={compoundId ?? ''} onChange={e => setCompoundId(Number(e.target.value) || null)}>
                <option value="">اختر مكانك…</option>
                {compounds.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div><label className="label" htmlFor={`${fid}-3`}>رقم الشاليه / الفيلا *</label>
              <input id={`${fid}-3`} className="field" value={unit} onChange={e => setUnit(e.target.value)} placeholder="مثال: B4 - 204" /></div>
            <div><label className="label" htmlFor={`${fid}-4`}>علامة مميزة (اختياري)</label>
              <input id={`${fid}-4`} className="field" value={notes} onChange={e => setNotes(e.target.value)} placeholder="مثال: بجوار حمام السباحة" /></div>
            {addressError && <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3">{addressError}</p>}
            <div className="flex gap-2">
              <button className="btn-ghost flex-1 text-sm" onClick={() => setEditing(null)}>إلغاء</button>
              <button className="btn-sea flex-1 text-sm" disabled={!compoundId || !unit.trim() || saving} onClick={save}>
                {saving ? 'جاري الحفظ…' : 'حفظ'}
              </button>
            </div>
          </div>
        )}

        {addresses.length === 0 && !editing && (
          <p className="text-mist text-sm text-center py-6">لسه مفيش عناوين محفوظة</p>
        )}

        <div className="space-y-2.5">
          {addresses.map(a => (
            <div key={a.id} className="card p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold flex items-center gap-1.5">
                    {a.label}
                    {a.is_default && <span className="text-xs font-bold bg-sea/10 text-sea rounded-full px-2 py-0.5">افتراضي</span>}
                  </p>
                  <p className="text-sm text-mist mt-0.5">{a.compound_name} — {a.unit_number}</p>
                  {a.notes && <p className="text-xs text-mist mt-0.5">{a.notes}</p>}
                </div>
              </div>
              <div className="flex gap-2 mt-2.5">
                <button className="btn-ghost flex-1 !py-1.5 text-xs" onClick={() => startEdit(a)}>تعديل</button>
                {!a.is_default && (
                  <button className="btn-ghost flex-1 !py-1.5 text-xs" onClick={() => makeDefault(a)}>خليه الافتراضي</button>
                )}
                <button className="btn-ghost !py-1.5 !px-3 text-xs !text-red-600" onClick={() => remove(a)}>حذف</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <a href={SUPPORT_WHATSAPP_URL} target="_blank" rel="noreferrer"
        className="card p-4 flex items-center gap-3 hover:border-sea/50 transition-colors">
        <span className="w-11 h-11 rounded-xl grid place-items-center text-xl shrink-0 bg-emerald-500/10">💬</span>
        <div>
          <p className="font-bold">تحتاج مساعدة؟</p>
          <p className="text-xs text-mist mt-0.5">كلّمنا على واتساب</p>
        </div>
      </a>

      {/* The only door to the staff workspaces from inside the installed app.
          The manifest is display:standalone, so there is no address bar -- which
          meant a driver who installed Salka could not reach /driver at all and
          had to keep using Chrome. There was no link to /login anywhere in the
          customer UI; in a browser you type the path, and in an app you cannot.
          Deliberately plain: a customer who taps it meets a staff login and
          leaves. */}
      {/* Signed-in staff get the way BACK, not another way in. Without it a
          driver browsing the customer app had no route to their own screen
          except the address bar, which the installed app does not have. */}
      {staffProfile ? (
        <Link to={homeFor(staffProfile.role)} className="card p-4 flex items-center gap-3 hover:border-sea/50 transition-colors">
          <span className="w-11 h-11 rounded-xl grid place-items-center text-xl shrink-0 bg-sea/10">🛵</span>
          <div>
            <p className="font-bold">شاشة الشغل</p>
            <p className="text-xs text-mist mt-0.5">ارجع لشاشة {staffProfile.role === 'vendor' ? 'المطعم' : 'المندوب'}</p>
          </div>
        </Link>
      ) : (
        <Link to="/login" className="block text-center text-xs text-mist hover:text-foam py-3 min-h-[44px]">
          دخول فريق سالكة
        </Link>
      )}
    </div>
  )
}

function PhoneInline({ onSave }: { onSave: (phone: string) => Promise<{ ok: boolean; error?: string }> }) {
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // The result of onSave was discarded entirely, so a rejected number just made
  // the spinner blink. It also skipped isValidEgyptPhone, which every other
  // phone field in the app enforces, so invalid input reached the RPC.
  async function save() {
    if (!isValidEgyptPhone(phone)) { setError(PHONE_HINT); return }
    setSaving(true); setError('')
    const res = await onSave(phone)
    setSaving(false)
    if (!res.ok) setError(describeError(res.error))
  }

  return (
    <div>
      <div className="flex gap-2">
        <input className={`field ${phone.trim() && !isValidEgyptPhone(phone) ? '!border-red-400' : ''}`}
          dir="ltr" value={phone} onChange={e => { setPhone(e.target.value); setError('') }}
          placeholder="01xxxxxxxxx" maxLength={13} />
        <button className="btn-sea shrink-0 !px-4" disabled={saving || !isValidEgyptPhone(phone)} onClick={save}>
          {saving ? '...' : 'حفظ'}
        </button>
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}

/**
 * Edit the name and phone together. Saved separately, because they are separate
 * RPCs with separate failure modes -- a phone can be rejected for already
 * belonging to another account, and that must not silently discard a perfectly
 * good name typed at the same time.
 */
function IdentityEditor({
  initialName, initialPhone, onSaveName, onSavePhone, onClose
}: {
  initialName: string
  initialPhone: string
  onSaveName: (name: string) => Promise<{ ok: boolean; error?: string }>
  onSavePhone: (phone: string) => Promise<{ ok: boolean; error?: string }>
  onClose: () => void
}) {
  const fid = useId()
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState(initialPhone)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const nameChanged = name.trim() !== initialName.trim()
  const phoneChanged = phone.trim() !== initialPhone.trim()
  const nameValid = name.trim().length >= 2
  const phoneValid = !phone.trim() || isValidEgyptPhone(phone)
  const canSave = (nameChanged || phoneChanged) && nameValid && phoneValid && !saving

  async function save() {
    setSaving(true); setError('')
    if (nameChanged) {
      const res = await onSaveName(name.trim())
      if (!res.ok) { setSaving(false); setError(describeError(res.error)); return }
    }
    if (phoneChanged && phone.trim()) {
      const res = await onSavePhone(phone.trim())
      // The name is already saved by now; say so, so nobody retypes it.
      if (!res.ok) { setSaving(false); setError(describeError(res.error)); return }
    }
    setSaving(false)
    onClose()
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor={`${fid}-name`}>الاسم</label>
        <input id={`${fid}-name`} className="field" value={name}
          onChange={e => { setName(e.target.value); setError('') }} placeholder="الاسم بالكامل" />
        {name.trim() && !nameValid && <p className="text-xs text-red-600 mt-1">الاسم قصير أوي</p>}
      </div>
      <div>
        <label className="label" htmlFor={`${fid}-phone`}>رقم الموبايل</label>
        <input id={`${fid}-phone`} className={`field ${phone.trim() && !phoneValid ? '!border-red-400' : ''}`}
          dir="ltr" value={phone} maxLength={13}
          onChange={e => { setPhone(e.target.value); setError('') }} placeholder="01xxxxxxxxx" />
        {phone.trim() && !phoneValid && <p className="text-xs text-red-600 mt-1">{PHONE_HINT}</p>}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-ghost flex-1 text-sm" onClick={onClose} disabled={saving}>إلغاء</button>
        <button className="btn-sea flex-1 text-sm" disabled={!canSave} onClick={save}>
          {saving ? 'جاري الحفظ…' : 'حفظ'}
        </button>
      </div>
    </div>
  )
}
