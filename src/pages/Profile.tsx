import { useEffect, useState, useId } from 'react'
import CustomerLogin from '../components/CustomerLogin'
import EmptyState from '../components/EmptyState'
import Icon from '../components/Icon'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCustomerAuth, getSessionToken } from '../lib/customerAuth'
import { customerSessionAccess } from '../lib/customerSessionAccess'
import { customerAccount } from '../lib/customerAccounts'
import { homeFor, useAuth } from '../lib/auth'
import { orderStatusLabel } from '../lib/statusLabels'
import { useSheets } from '../components/ActionSheets'
import { describeError } from '../lib/rpc'
import { SUPPORT_WHATSAPP_URL } from '../lib/support'
import type { Compound } from '../lib/types'
import { displayEgyptPhone } from '../lib/validation'

interface Address {
  id: number; label: string; compound_id: number; compound_name: string
  unit_number: string; notes: string | null; is_default: boolean
}
interface OrderRow {
  id: number; public_token: string; total: number
  status: string; created_at: string; restaurant_name: string
  pricing_status?: 'n/a' | 'pending_quote' | 'confirmed'
}

export default function Profile() {
  const fid = useId()
  const nav = useNavigate()
  const { customer, logout, updateName } = useCustomerAuth()
  const { profile: staffProfile } = useAuth()
  const { confirmSheet, sheetElement } = useSheets()
  const [editingIdentity, setEditingIdentity] = useState(false)
  const [addresses, setAddresses] = useState<Address[]>([])
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [compounds, setCompounds] = useState<Compound[]>([])
  const [showLogin, setShowLogin] = useState(false)
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [editing, setEditing] = useState<Address | 'new' | null>(null)
  const [label, setLabel] = useState('')
  const [compoundId, setCompoundId] = useState<number | null>(null)
  const [unit, setUnit] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [addressError, setAddressError] = useState('')

  async function load() {
    const res = await customerAccount<Address[]>('myAddresses')
    // A failed read rendered as "you have no saved addresses", which is the
    // same screen as genuinely having none -- so the customer re-enters an
    // address they already saved, and now has it twice.
    if (!res.ok) { setAddressError('مش قادرين نجيب عناوينك دلوقتي. جرب تاني'); return }
    setAddressError('')
    setAddresses(res.data ?? [])
  }

  useEffect(() => {
    if (!customer) return
    load()
    customerAccount<OrderRow[]>('myOrders').then(res => setOrders(res.ok ? res.data ?? [] : []))
    supabase.from('compounds').select('*').eq('active', true).order('name').then(({ data }) => setCompounds(data ?? []))
    if (customer.phone) {
      // Pass the session token like checkout does. Without it the RPC falls
      // through to the anonymous path and burns the phone_lookup rate limit on
      // a customer who is already signed in.
      customerSessionAccess<number>('wallet', { phone: customer.phone, sessionToken: getSessionToken() })
        .then(result => { if (result.ok) setWalletBalance(Number(result.data) || 0) })
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
      ? await customerAccount('addAddress', {
          label, compoundId, unitNumber: unit, notes: notes || null, isDefault: false
        })
      : editing
        ? await customerAccount('updateAddress', {
            id: editing.id, label, compoundId, unitNumber: unit, notes: notes || null
          })
        : { ok: true as const, data: null }
    setSaving(false)
    if (!res.ok) { setAddressError(res.error); return }
    setEditing(null)
    load()
  }

  async function remove(a: Address) {
    if (!(await confirmSheet({ title: `حذف «${a.label}»؟`, danger: true, confirmLabel: 'احذف' }))) return
    setAddressError('')
    const res = await customerAccount('deleteAddress', { id: a.id })
    if (!res.ok) { setAddressError(res.error); return }
    load()
  }

  async function makeDefault(a: Address) {
    setAddressError('')
    const res = await customerAccount('setDefaultAddress', { id: a.id })
    if (!res.ok) { setAddressError(res.error); return }
    load()
  }

  if (!customer) {
    // The old screen said «سجّل دخولك الأول عشان تشوف حسابك» -- log in to see
    // your account, which is circular: it names the reward as the thing you
    // cannot see. Four real things sit behind this, so say them.
    //
    // These are NOT invented benefits. Each maps to something already built and
    // visible further down this same file once `customer` exists.
    const perks = [
      { icon: 'locationDot' as const, title: 'عناوينك محفوظة',
        body: 'اختار الشاليه مرة واحدة، وبعدها الطلب بيبقى أسرع' },
      { icon: 'receipt' as const, title: 'كل طلباتك في مكان واحد',
        body: 'ترجع لأي طلب قديم وتشوف تفاصيله، من أي جهاز' },
      { icon: 'coins' as const, title: 'رصيدك محفوظ',
        body: 'أي تعويض أو استرداد بيفضل في محفظتك لحد ما تستخدمه' },
      { icon: 'user' as const, title: 'مش هتكتب بياناتك تاني',
        body: 'اسمك ورقمك بيتحطوا لوحدهم في الأوردر' },
    ]
    return (
      <div className="max-w-sm mx-auto pb-8">
        {/* The same cream band as هنجبلك, bleeding to the screen edges and
            fading into the page. This screen has no photography either, so the
            surface carries it rather than a bigger typeface. */}
        <div className="-mx-4 -mt-6 mb-7 px-4 pt-8 pb-6 bg-gradient-to-b from-cream to-night text-center">
          <span className="w-14 h-14 rounded-2xl bg-white/70 text-[#6B4A18] grid place-items-center mx-auto mb-3">
            <Icon name="circleUser" size="xl" />
          </span>
          <h1 className="font-bold text-xl mb-1">اعمل حساب في ثانية</h1>
          <p className="text-mist text-sm">من غير كلمة سر — بإيميلك أو بحساب جوجل</p>
        </div>

        <ul className="space-y-3 mb-7">
          {perks.map(p => (
            <li key={p.title} className="card p-3.5 flex items-stretch gap-3">
              {/* The same pair as the pharmacy and supermarket tiles: cream with
                  #6B4A18 at 6.95:1. coral read as an error colour on a screen
                  that is selling something. */}
              {/* 42x42: the measured height of the title and subtitle stacked, so the
                  tile squares off against the text instead of floating at 36px.
                  Stated rather than derived -- `self-stretch` + `aspect-square`
                  collapses to 20x42, because a flex item cannot take its width
                  from a height it only gets by stretching. If the copy ever
                  wraps to a third line, re-measure. */}
              <span className="w-[42px] h-[42px] rounded-lg bg-cream text-[#6B4A18] grid place-items-center shrink-0">
                <Icon name={p.icon} size="md" />
              </span>
              <span className="min-w-0">
                <span className="block font-bold text-sm">{p.title}</span>
                <span className="block text-xs text-mist mt-0.5 leading-relaxed">{p.body}</span>
              </span>
            </li>
          ))}
        </ul>

        {/* Opens the login sheet HERE. This was a <Link to="/my-orders">, which
            navigates to a screen whose logged-out state is another «سجّل دخولك»
            heading and another button -- so the customer was asked twice for one
            intent, and the second screen threw away everything the first one had
            just explained. MyOrders opens the same sheet the same way.

            PRIMARY, unlike an empty state: this screen is a task with a clear
            next step, not a dead end, so under-weighting the button would be the
            wrong restraint. */}
        <button className="btn-sea w-full" onClick={() => setShowLogin(true)}>تسجيل الدخول</button>
        {showLogin && (
          <CustomerLogin onDone={() => setShowLogin(false)} onSkip={() => setShowLogin(false)} />
        )}
      </div>
    )
  }

  return (
    <div className="max-w-sm mx-auto space-y-4 pb-6">
      {sheetElement}
      {/* Names can be corrected directly. Phone changes are hidden below,
          not deleted -- see the note above VerifiedPhoneEditor's old spot. */}
      <div className="card p-4">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-sea/10 text-sea grid place-items-center text-xl font-bold shrink-0">
            {(customer.name || 'ح').trim().charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            {editingIdentity ? (
              <IdentityEditor
                initialName={customer.name ?? ''}
                onSaveName={updateName}
                onClose={() => setEditingIdentity(false)}
              />
            ) : (
              <>
                <p className="font-bold text-lg truncate">{customer.name || 'حسابك'}</p>
                {customer.email && <p className="text-xs text-mist mt-0.5 truncate" dir="ltr">{customer.email}</p>}
                {customer.phone
                  ? <p className="text-xs text-mist mt-0.5" dir="ltr">{displayEgyptPhone(customer.phone)}</p>
                  : <p className="text-xs text-coral-700 mt-0.5">لسه ما ضفتش رقم موبايل</p>}
              </>
            )}
          </div>
        </div>
        {!editingIdentity && (
          <div className="flex gap-2 mt-3 pt-3 border-t border-line">
            <button className="btn-ghost flex-1 !py-2 text-sm" onClick={() => setEditingIdentity(true)}>تعديل</button>
            <button className="btn-ghost flex-1 !py-2 text-sm" onClick={async () => { await logout(); nav('/') }}>خروج</button>
          </div>
        )}
      </div>

      {/* Hidden for now, at Wael's call, 2026-08-15 -- SMS Misr isn't live, so
          this card was a full section (heading, explanation, form shell) that
          existed only to say "not available yet" twice over. Not deleted:
          VerifiedPhoneEditor still backs PhonePrompt.tsx elsewhere, and this
          section comes back the moment smsEnabled flips true. */}

      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="font-bold">عناويني المحفوظة</h2>
          {addresses.length < 10 && (
            <button className="text-sea text-sm font-semibold" onClick={() => startEdit('new')}>+ إضافة عنوان</button>
          )}
        </div>

        {/* remove()/makeDefault() failures happen outside the edit card */}
        {addressError && !editing && (
          <p className="text-sm text-danger bg-dangerbg rounded-xl p-3 mb-3">{addressError}</p>
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
            {addressError && <p className="text-sm text-danger bg-dangerbg rounded-xl p-3">{addressError}</p>}
            <div className="flex gap-2">
              <button className="btn-ghost flex-1 text-sm" onClick={() => setEditing(null)}>إلغاء</button>
              <button className="btn-sea flex-1 text-sm" disabled={!compoundId || !unit.trim() || saving} onClick={save}>
                {saving ? 'جاري الحفظ…' : 'حفظ'}
              </button>
            </div>
          </div>
        )}

        {addresses.length === 0 && !editing && (
          <EmptyState compact icon="locationDot" title="لسه مفيش عناوين محفوظة" />
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
                  <p className="text-sm text-mist mt-0.5">{a.compound_name}، {a.unit_number}</p>
                  {a.notes && <p className="text-xs text-mist mt-0.5">{a.notes}</p>}
                </div>
              </div>
              <div className="flex gap-2 mt-2.5">
                <button className="btn-ghost flex-1 !py-1.5 text-xs" onClick={() => startEdit(a)}>تعديل</button>
                {!a.is_default && (
                  <button className="btn-ghost flex-1 !py-1.5 text-xs" onClick={() => makeDefault(a)}>خليه الافتراضي</button>
                )}
                <button className="btn-ghost !py-1.5 !px-3 text-xs !text-danger" onClick={() => remove(a)}>حذف</button>
              </div>
            </div>
          ))}
        </div>
      </div>

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
                  <p className="font-semibold text-sm truncate">#{o.id} • {o.restaurant_name}</p>
                  <p className="text-xs text-mist mt-0.5">{orderStatusLabel(o.status)}</p>
                </div>
                <span className="text-sea font-bold text-sm shrink-0">
                  {o.pricing_status === 'pending_quote' ? 'قيد التسعير' : `${o.total} ج.م`}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <a href={SUPPORT_WHATSAPP_URL} target="_blank" rel="noreferrer"
        className="card p-4 flex items-center gap-3 hover:border-sea/50 transition-colors">
        <span className="w-11 h-11 rounded-xl grid place-items-center text-xl shrink-0 bg-successbg"><Icon name="chatCircle" size="md" className="text-success" /></span>
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
          <span className="w-11 h-11 rounded-xl grid place-items-center text-xl shrink-0 bg-sea/10"><Icon name="moped" size="md" className="text-sea" /></span>
          <div>
            <p className="font-bold">شاشة الشغل</p>
            <p className="text-xs text-mist mt-0.5">ارجع لشاشة {staffProfile.role === 'vendor' ? 'المطعم' : 'المندوب'}</p>
          </div>
        </Link>
      ) : (
        /* This must be a document navigation. The Supabase client chooses its
           isolated auth namespace before React starts; an SPA transition would
           keep the customer client alive on the staff login screen. */
        <a href="/login" className="block text-center text-xs text-mist hover:text-foam py-3 min-h-[44px]">
          دخول فريق سالكة
        </a>
      )}
    </div>
  )
}

/**
 * The display name is editable immediately. Phone ownership is a separate OTP
 * flow below the card, so typing a number can never grant access to its orders.
 */
function IdentityEditor({
  initialName, onSaveName, onClose
}: {
  initialName: string
  onSaveName: (name: string) => Promise<{ ok: boolean; error?: string }>
  onClose: () => void
}) {
  const fid = useId()
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const nameChanged = name.trim() !== initialName.trim()
  const nameValid = name.trim().length >= 2
  const canSave = nameChanged && nameValid && !saving

  async function save() {
    setSaving(true); setError('')
    if (nameChanged) {
      const res = await onSaveName(name.trim())
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
        {name.trim() && !nameValid && <p className="text-xs text-danger mt-1">الاسم قصير أوي</p>}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-ghost flex-1 text-sm" onClick={onClose} disabled={saving}>إلغاء</button>
        <button className="btn-sea flex-1 text-sm" disabled={!canSave} onClick={save}>
          {saving ? 'جاري الحفظ…' : 'حفظ'}
        </button>
      </div>
    </div>
  )
}
