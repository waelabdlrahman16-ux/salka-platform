import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCustomerAuth } from '../lib/customerAuth'
import type { Compound } from '../lib/types'

interface Address {
  id: number; label: string; compound_id: number; compound_name: string
  unit_number: string; notes: string | null; is_default: boolean
}

export default function Profile() {
  const nav = useNavigate()
  const { customer, logout, updatePhone } = useCustomerAuth()
  const [addresses, setAddresses] = useState<Address[]>([])
  const [compounds, setCompounds] = useState<Compound[]>([])
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [editing, setEditing] = useState<Address | 'new' | null>(null)
  const [label, setLabel] = useState('')
  const [compoundId, setCompoundId] = useState<number | null>(null)
  const [unit, setUnit] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    const { data } = await supabase.rpc('my_customer_addresses')
    setAddresses((data as Address[]) ?? [])
  }

  useEffect(() => {
    if (!customer) return
    load()
    supabase.from('compounds').select('*').eq('active', true).order('name').then(({ data }) => setCompounds(data ?? []))
    if (customer.phone) {
      supabase.rpc('wallet_balance_for_phone', { p_phone: customer.phone }).then(({ data }) => setWalletBalance(Number(data) || 0))
    }
  }, [customer])

  function startEdit(a: Address | 'new') {
    if (a === 'new') {
      setLabel(''); setCompoundId(null); setUnit(''); setNotes('')
    } else {
      setLabel(a.label); setCompoundId(a.compound_id); setUnit(a.unit_number); setNotes(a.notes ?? '')
    }
    setEditing(a)
  }

  async function save() {
    if (!compoundId || !unit.trim()) return
    setSaving(true)
    if (editing === 'new') {
      await supabase.rpc('add_customer_address', {
        p_label: label, p_compound_id: compoundId, p_unit_number: unit, p_notes: notes || null
      })
    } else if (editing) {
      await supabase.rpc('update_customer_address', {
        p_id: editing.id, p_label: label, p_compound_id: compoundId, p_unit_number: unit, p_notes: notes || null
      })
    }
    setSaving(false)
    setEditing(null)
    load()
  }

  async function remove(a: Address) {
    if (!confirm(`حذف "${a.label}"؟`)) return
    await supabase.rpc('delete_customer_address', { p_id: a.id })
    load()
  }

  async function makeDefault(a: Address) {
    await supabase.rpc('set_default_address', { p_id: a.id })
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
      <div className="card p-4 flex items-center justify-between">
        <div>
          <p className="font-bold">{customer.name || 'حسابك'}</p>
          {customer.email && <p className="text-xs text-mist mt-0.5" dir="ltr">{customer.email}</p>}
          {customer.phone && <p className="text-xs text-mist mt-0.5" dir="ltr">{customer.phone}</p>}
        </div>
        <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={async () => { await logout(); nav('/') }}>خروج</button>
      </div>

      {!customer.phone && (
        <div className="card p-4 bg-sand/10">
          <p className="text-sm font-semibold mb-2">محتاجين رقم موبايلك عشان نقدر نوصلك</p>
          <PhoneInline onSave={updatePhone} />
        </div>
      )}

      <div className="card p-4">
        <p className="text-sm text-mist">رصيدك في المحفظة</p>
        <p className="text-2xl font-bold text-sea mt-1">{walletBalance ?? '—'} ج.م</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="font-bold">عناويني المحفوظة</h2>
          {addresses.length < 10 && (
            <button className="text-sea text-sm font-semibold" onClick={() => startEdit('new')}>+ إضافة عنوان</button>
          )}
        </div>

        {editing && (
          <div className="card p-4 mb-3 space-y-3">
            <div><label className="label">اسم العنوان</label>
              <input className="field" value={label} onChange={e => setLabel(e.target.value)} placeholder="المنزل / الشغل" /></div>
            <div><label className="label">المكان *</label>
              <select className="field" value={compoundId ?? ''} onChange={e => setCompoundId(Number(e.target.value) || null)}>
                <option value="">اختر مكانك…</option>
                {compounds.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div><label className="label">رقم الشاليه / الفيلا *</label>
              <input className="field" value={unit} onChange={e => setUnit(e.target.value)} placeholder="مثال: B4 - 204" /></div>
            <div><label className="label">علامة مميزة (اختياري)</label>
              <input className="field" value={notes} onChange={e => setNotes(e.target.value)} placeholder="مثال: بجوار حمام السباحة" /></div>
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
    </div>
  )
}

function PhoneInline({ onSave }: { onSave: (phone: string) => Promise<{ ok: boolean; error?: string }> }) {
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  async function save() {
    if (!phone.trim()) return
    setSaving(true)
    await onSave(phone)
    setSaving(false)
  }
  return (
    <div className="flex gap-2">
      <input className="field" dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01xxxxxxxxx" maxLength={13} />
      <button className="btn-sea shrink-0 !px-4" disabled={saving} onClick={save}>{saving ? '...' : 'حفظ'}</button>
    </div>
  )
}
