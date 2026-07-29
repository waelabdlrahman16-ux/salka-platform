import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Assignment, Compound, Complaint, Driver, DeliverySlotRow, Earning, MenuItem, Order, OrderRating, Reliability, Restaurant, Setting, SettlementRequest, Shift, VendorCoverage } from '../lib/types'
import { ping, askNotificationPermission } from '../lib/notify'
import { uploadVendorImage } from '../lib/upload'
import { orderStatusLabel, assignmentStatusLabel, driverStatusLabel } from '../lib/statusLabels'
import Icon from '../components/Icon'
import MenuItemEditor from '../components/MenuItemEditor'

function StarRow({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 align-middle">
      {[1,2,3,4,5].map(i => <Icon key={i} name="star" className={`w-3 h-3 ${i <= n ? 'text-sand' : 'text-line'}`} />)}
    </span>
  )
}

function AccountActionsMenu({ busy, onChangeEmail, onResetPassword, onCustomPassword, onRemove }: {
  busy: boolean
  onChangeEmail: () => void
  onResetPassword: () => void
  onCustomPassword: () => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  function pick(fn: () => void) {
    setOpen(false)
    fn()
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button className="btn-ghost !py-1.5 !px-2.5 text-xs inline-flex items-center gap-1" disabled={busy} onClick={() => setOpen(v => !v)}>
        <Icon name="penToSquare" className="w-3 h-3" /> الحساب
      </button>
      {open && (
        <div className="absolute left-0 mt-1 z-20 bg-shell border border-line rounded-xl shadow-lg py-1.5 min-w-[160px]">
          <button className="w-full text-right text-xs px-3 py-2 hover:bg-night" onClick={() => pick(onChangeEmail)}>تغيير الإيميل</button>
          <button className="w-full text-right text-xs px-3 py-2 hover:bg-night" onClick={() => pick(onResetPassword)}>تغيير كلمة السر</button>
          <button className="w-full text-right text-xs px-3 py-2 hover:bg-night" onClick={() => pick(onCustomPassword)}>كلمة سر مخصصة</button>
          <button className="w-full text-right text-xs px-3 py-2 hover:bg-night text-red-500" onClick={() => pick(onRemove)}>إلغاء الحساب</button>
        </div>
      )}
    </div>
  )
}

type Tab = 'unassigned' | 'active' | 'drivers' | 'menu' | 'orders' | 'earnings' | 'settings' | 'shifts' | 'payouts' | 'complaints' | 'coverage' | 'accounts' | 'wallet'
const TABS: { key: Tab; label: string }[] = [
  { key: 'unassigned', label: 'طلبات غير معيّنة' },
  { key: 'active', label: 'توصيلات جارية' },
  { key: 'drivers', label: 'إدارة المندوبين' },
  { key: 'menu', label: 'المطاعم والمنيو' },
  { key: 'orders', label: 'كل الطلبات' },
  { key: 'earnings', label: 'الأرباح' },
  { key: 'settings', label: 'الإعدادات' },
  { key: 'shifts', label: 'الورديات' },
  { key: 'payouts', label: 'مدفوعات المندوبين' },
  { key: 'wallet', label: 'محفظة العميل' },
  { key: 'complaints', label: 'الشكاوى' },
  { key: 'coverage', label: 'تغطية المطاعم' },
  { key: 'accounts', label: 'حسابات الدخول' },
]

export default function Admin() {
  const [tab, setTab] = useState<Tab>('unassigned')
  const [orders, setOrders] = useState<Order[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [earnings, setEarnings] = useState<Earning[]>([])
  const [assigning, setAssigning] = useState<Order | null>(null)
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [openRest, setOpenRest] = useState<number | null>(null)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
  const [newItem, setNewItem] = useState({ name: '', category: '', price: '', requiresRx: false })
  const [settings, setSettings] = useState<Setting[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [escalations, setEscalations] = useState<any[]>([])
  const [newShift, setNewShift] = useState({ driver_id: '', shift_date: '', start_time: '', end_time: '' })
  const [slots, setSlots] = useState<DeliverySlotRow[]>([])
  const [newSlot, setNewSlot] = useState({ start_time: '', end_time: '', capacity: '6' })
  const [reassignFor, setReassignFor] = useState<number | null>(null)
  const [bulkDrivers, setBulkDrivers] = useState('')
  const [bulkResult, setBulkResult] = useState<string | null>(null)
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [settlementRequests, setSettlementRequests] = useState<SettlementRequest[]>([])
  const [compounds, setCompounds] = useState<Compound[]>([])
  const [coverage, setCoverage] = useState<VendorCoverage[]>([])
  const [lowRatings, setLowRatings] = useState<OrderRating[]>([])
  const [coverageFor, setCoverageFor] = useState<number | null>(null)
  const [reliability, setReliability] = useState<Record<number, Reliability>>({})
  const [walletPhone, setWalletPhone] = useState('')
  const [walletAmount, setWalletAmount] = useState('')
  const [walletReason, setWalletReason] = useState('')
  const [walletResult, setWalletResult] = useState<string | null>(null)
  const [walletOrderId, setWalletOrderId] = useState<number | null>(null)
  const [compensatedOrderIds, setCompensatedOrderIds] = useState<Set<number>>(new Set())
  const [showResolvedComplaints, setShowResolvedComplaints] = useState(false)
  const [openHistory, setOpenHistory] = useState<number | null>(null)
  const [vendorAccounts, setVendorAccounts] = useState<{ profile_id: string; restaurant_id: number; email: string }[]>([])
  const [driverAccounts, setDriverAccounts] = useState<{ profile_id: string; driver_id: number; email: string }[]>([])
  const [accountBusy, setAccountBusy] = useState<string | null>(null)
  const [newCreds, setNewCreds] = useState<{ email: string; password: string } | null>(null)
  const [newRestaurant, setNewRestaurant] = useState({ name: '', description: '', category: '', vendor_type: 'restaurant', prep_minutes: '20' })
  const [uploadingImage, setUploadingImage] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)

  async function load() {
    const [o, a, d, e, r, m, st, sh, esc, sl, comp, sr, cpd, cov, lr, wt] = await Promise.all([
      supabase.from('orders').select('*, restaurants(name)').order('id', { ascending: false }),
      supabase.from('delivery_assignments').select('*, orders(*, restaurants(name)), drivers(*)').order('id', { ascending: false }),
      supabase.from('drivers').select('*').order('id'),
      supabase.from('driver_earnings').select('*, drivers(name)').order('id', { ascending: false }),
      supabase.from('restaurants').select('*').order('id'),
      supabase.from('menu_items').select('*').order('id'),
      supabase.from('settings').select('*').order('key'),
      supabase.from('shifts').select('*').order('shift_date', { ascending: false }).limit(40),
      supabase.from('shift_swap_requests').select('*, shifts(*), requester:drivers!shift_swap_requests_requested_by_fkey(name)')
        .eq('status', 'escalated').order('escalated_at', { ascending: false }),
      supabase.from('delivery_slots').select('*').order('restaurant_id').order('start_time'),
      supabase.from('complaints').select('*, orders(customer_name, customer_phone, restaurants(name))').order('id', { ascending: false }),
      supabase.from('settlement_requests').select('*, drivers(name)').eq('status', 'pending').order('id', { ascending: false }),
      supabase.from('compounds').select('*').eq('active', true).order('direction').order('distance_km'),
      supabase.from('vendor_coverage').select('*'),
      supabase.from('order_ratings').select('*, orders(customer_name, customer_phone, restaurants(name))')
        .or('driver_rating.lte.2,restaurant_rating.lte.2').order('id', { ascending: false }).limit(30),
      supabase.from('wallet_transactions').select('order_id').not('order_id', 'is', null).ilike('reason', 'تعويض%'),
    ])
    setOrders(o.data ?? []); setAssignments(a.data ?? []); setDrivers(d.data ?? [])
    setEarnings(e.data ?? [])
    setRestaurants(r.data ?? []); setMenu(m.data ?? []); setSettings(st.data ?? [])
    setShifts(sh.data ?? []); setEscalations(esc.data ?? [])
    setSlots(sl.data ?? [])
    setComplaints(comp.data ?? []); setSettlementRequests(sr.data ?? [])
    setCompounds(cpd.data ?? []); setCoverage(cov.data ?? [])
    setLowRatings(lr.data ?? [])
    setCompensatedOrderIds(new Set((wt.data ?? []).map((t: any) => t.order_id)))
    const { data: accounts } = await supabase.rpc('admin_list_accounts')
    setVendorAccounts(accounts?.vendors ?? []); setDriverAccounts(accounts?.drivers ?? [])
    ping('escalated_shifts', (esc.data ?? []).length, 'مندوب محتاج بديل', 'في وردية اتصعّدت للإدارة')
    ping('complaints', (comp.data ?? []).filter((c: Complaint) => c.status === 'open').length, 'شكوى جديدة', 'في عميل بلّغ عن مشكلة')
    ping('settlement_requests', (sr.data ?? []).length, 'طلب تسوية مبكرة', 'مندوب طالب تسوية قبل ميعاده')

    const rel: Record<number, Reliability> = {}
    for (const rest of (r.data ?? [])) {
      const { data } = await supabase.rpc('restaurant_reliability', { p_restaurant_id: rest.id })
      rel[rest.id] = data as Reliability
    }
    setReliability(rel)
  }

  useEffect(() => {
    askNotificationPermission()
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  const escalateAfter = Number(settings.find(s => s.key === 'escalate_after_minutes')?.value ?? 15)
  const isLate = (o: Order) => {
    const from = o.dispatch_at ? +new Date(o.dispatch_at) : +new Date(o.created_at)
    return (Date.now() - from) / 60000 > escalateAfter
  }
  const isCooking = (o: Order) => !!o.dispatch_at && +new Date(o.dispatch_at) > Date.now()
  const minsUntilDispatch = (o: Order) =>
    o.dispatch_at ? Math.max(0, Math.round((+new Date(o.dispatch_at) - Date.now()) / 60000)) : 0

  const activeStatuses = ['Offered', 'Accepted', 'Picked_Up', 'Out_for_Delivery']
  const assignedOrderIds = new Set(assignments.filter(a => activeStatuses.includes(a.status) || a.status === 'Delivered').map(a => a.order_id))
  const unassigned = orders
    .filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled' && !assignedOrderIds.has(o.id))
    .sort((a, b) => Number(isCooking(a)) - Number(isCooking(b)))
  const active = assignments.filter(a => activeStatuses.includes(a.status))
  const availableDrivers = drivers.filter(d => d.active && d.available)
  const vanRequiredSubtotal = Number(settings.find(s => s.key === 'van_required_subtotal_egp')?.value ?? 300)
  const assigningNeedsVan = assigning
    ? (() => {
        const r = restaurants.find(r => r.id === assigning.restaurant_id)
        if (r?.vendor_type !== 'supermarket') return false
        return assigning.pricing_status === 'pending_quote' || assigning.subtotal >= vanRequiredSubtotal
      })()
    : false
  const assignableDrivers = assigningNeedsVan
    ? availableDrivers.filter(d => d.vehicle_type === 'van')
    : availableDrivers
  useEffect(() => { ping('unassigned', unassigned.length, 'طلب غير معيّن', 'في طلب محدش استلمه') },
    [unassigned.length])

  async function assign(order: Order, driver: Driver) {
    const { error } = await supabase.rpc('admin_assign_order', { p_order_id: order.id, p_driver_id: driver.id })
    if (error) {
      alert(error.message.includes('dispatch_rule_blocked')
        ? 'المندوب ده وصل للحد الأقصى (٣ طلبات) أو شغال في اتجاه مختلف'
        : 'حصل خطأ، جرب تاني')
      return
    }
    setAssigning(null); load()
  }

  async function toggleDriver(d: Driver, field: 'active' | 'available') {
    const patch: Record<string, unknown> = { [field]: !d[field] }
    if (field === 'active' && d.active) patch.status = 'Suspended'
    if (field === 'active' && !d.active) patch.status = 'Available'
    await supabase.from('drivers').update(patch).eq('id', d.id)
    load()
  }

  async function updatePrice(it: MenuItem, price: number) {
    if (!price || price === it.price) return
    await supabase.from('menu_items').update({ price }).eq('id', it.id)
    load()
  }

  async function toggleItem(it: MenuItem) {
    await supabase.from('menu_items').update({ available: !it.available }).eq('id', it.id)
    load()
  }

  async function toggleRestaurant(r: Restaurant) {
    await supabase.from('restaurants').update({ is_open: !r.is_open }).eq('id', r.id)
    load()
  }

  async function reassignShift(shiftId: number, driverId: number, requestId: number) {
    await supabase.from('shifts').update({ driver_id: driverId, status: 'swapped' }).eq('id', shiftId)
    await supabase.from('shift_swap_requests').update({ status: 'accepted', accepted_by: driverId, accepted_at: new Date().toISOString() }).eq('id', requestId)
    setReassignFor(null)
    load()
  }

  async function addSlot(restaurantId: number) {
    await supabase.from('delivery_slots').insert({
      restaurant_id: restaurantId, start_time: newSlot.start_time,
      end_time: newSlot.end_time, capacity: Number(newSlot.capacity)
    })
    setNewSlot({ start_time: '', end_time: '', capacity: '6' })
    load()
  }

  async function toggleSlot(slot: DeliverySlotRow) {
    await supabase.from('delivery_slots').update({ active: !slot.active }).eq('id', slot.id)
    load()
  }

  async function importDrivers() {
    const lines = bulkDrivers.split('\n').map(l => l.trim()).filter(Boolean)
    const rows = lines.map(line => {
      const [name, phone, type] = line.split(',').map(s => s.trim())
      const vehicle_type = /van|فان/i.test(type || '') ? 'van' : 'motorcycle'
      return { name, phone, vehicle_type }
    }).filter(r => r.name && r.phone)

    if (rows.length === 0) { setBulkResult('مفيش سطور صحيحة — لازم اسم,رقم موبايل على الأقل'); return }

    const { error } = await supabase.from('drivers').insert(rows)
    setBulkResult(error ? 'حصل خطأ، جرب تاني' : `تمت إضافة ${rows.length} مندوب`)
    if (!error) setBulkDrivers('')
    load()
  }

  async function addShift() {
    await supabase.from('shifts').insert({
      driver_id: Number(newShift.driver_id), shift_date: newShift.shift_date,
      start_time: newShift.start_time, end_time: newShift.end_time
    })
    setNewShift({ driver_id: '', shift_date: '', start_time: '', end_time: '' })
    load()
  }

  async function updateRestaurant(r: Restaurant, patch: Record<string, unknown>) {
    await supabase.from('restaurants').update(patch).eq('id', r.id)
    load()
  }

  async function callAccountsFn(body: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke('admin-accounts', { body })
    if (error) {
      // supabase-js's error.message for a non-2xx response is always the
      // same generic wrapper text ("Edge Function returned a non-2xx
      // status code"), regardless of what actually went wrong -- the real
      // reason is in the response body, which needs to be read separately.
      let reason = error.message
      try {
        const body = await (error as any).context?.json?.()
        if (body?.error) reason = body.error
      } catch { /* body wasn't JSON or already consumed -- fall back to generic message */ }
      return { error: accountsErrorLabel(reason) }
    }
    return data
  }

  function accountsErrorLabel(code: string): string {
    const labels: Record<string, string> = {
      admin_only: 'الحساب ده مش أدمن',
      missing_auth: 'محتاج تسجل دخول تاني',
      invalid_session: 'الجلسة انتهت، سجل دخول تاني',
      login_already_exists: 'في حساب دخول موجود بالفعل لده',
      restaurant_not_found: 'المطعم/المتجر ده مش موجود',
      driver_not_found: 'المندوب ده مش موجود',
      create_user_failed: 'حصل خطأ في إنشاء الحساب، جرب تاني',
      profile_insert_failed: 'حصل خطأ في حفظ البيانات، جرب تاني',
      delete_failed: 'حصل خطأ في إلغاء الحساب، جرب تاني',
      reset_failed: 'حصل خطأ في تغيير كلمة السر، جرب تاني',
      profile_id_and_email_required: 'محتاج تحدد الحساب والإيميل الجديد',
      invalid_email: 'الإيميل ده مش شكله صح',
      email_update_failed: 'حصل خطأ في تغيير الإيميل، جرب تاني',
      unknown_action: 'حصل خطأ غير متوقع',
    }
    return labels[code] ?? code
  }

  async function createVendorLogin(restaurantId: number) {
    setAccountBusy(`vendor-${restaurantId}`)
    const result = await callAccountsFn({ action: 'create_vendor_login', restaurant_id: restaurantId })
    setAccountBusy(null)
    if (result.error) { alert('حصل خطأ: ' + result.error); return }
    setNewCreds({ email: result.email, password: result.password })
    load()
  }

  async function createDriverLogin(driverId: number) {
    setAccountBusy(`driver-${driverId}`)
    const result = await callAccountsFn({ action: 'create_driver_login', driver_id: driverId })
    setAccountBusy(null)
    if (result.error) { alert('حصل خطأ: ' + result.error); return }
    setNewCreds({ email: result.email, password: result.password })
    load()
  }

  async function removeLogin(profileId: string) {
    if (!confirm('تأكيد إلغاء الحساب؟ مش هيقدر يدخل تاني.')) return
    setAccountBusy(profileId)
    const result = await callAccountsFn({ action: 'remove_login', profile_id: profileId })
    setAccountBusy(null)
    if (result.error) { alert('حصل خطأ: ' + result.error); return }
    load()
  }

  async function resetPassword(profileId: string) {
    setAccountBusy(profileId)
    const result = await callAccountsFn({ action: 'reset_password', profile_id: profileId })
    setAccountBusy(null)
    if (result.error) { alert('حصل خطأ: ' + result.error); return }
    setNewCreds({ email: '(نفس الإيميل)', password: result.password })
  }

  async function setCustomPassword(profileId: string) {
    const pw = prompt('اكتب كلمة السر الجديدة (8 أحرف على الأقل):')
    if (!pw) return
    if (pw.length < 8) { alert('كلمة السر لازم تكون 8 أحرف على الأقل'); return }
    setAccountBusy(profileId)
    const result = await callAccountsFn({ action: 'reset_password', profile_id: profileId, custom_password: pw })
    setAccountBusy(null)
    if (result.error) { alert('حصل خطأ: ' + result.error); return }
    alert('تم تغيير كلمة السر')
  }

  async function changeEmail(profileId: string, currentEmail: string) {
    const newEmail = prompt('اكتب الإيميل الجديد:', currentEmail)
    if (!newEmail || newEmail.trim() === currentEmail) return
    setAccountBusy(profileId)
    const result = await callAccountsFn({ action: 'update_email', profile_id: profileId, new_email: newEmail.trim() })
    setAccountBusy(null)
    if (result.error) { alert('حصل خطأ: ' + result.error); return }
    alert('تم تغيير الإيميل')
    load()
  }

  async function uploadLogo(r: Restaurant, file: File) {
    setUploadingImage(`r${r.id}`); setImageError(null)
    const { url, error } = await uploadVendorImage(file, `restaurants/${r.id}/logo`)
    setUploadingImage(null)
    if (error) { setImageError(error); return }
    await supabase.from('restaurants').update({ logo_url: url }).eq('id', r.id)
    load()
  }

  async function uploadItemImage(it: MenuItem, file: File) {
    setUploadingImage(`i${it.id}`); setImageError(null)
    const { url, error } = await uploadVendorImage(file, `menu-items/${it.id}/image`)
    setUploadingImage(null)
    if (error) { setImageError(error); return }
    await supabase.from('menu_items').update({ image_url: url }).eq('id', it.id)
    load()
  }

  async function addRestaurant() {
    if (!newRestaurant.name.trim()) return
    await supabase.from('restaurants').insert({
      name: newRestaurant.name.trim(),
      description: newRestaurant.description.trim(),
      category: newRestaurant.category.trim() || 'أصناف',
      vendor_type: newRestaurant.vendor_type,
      prep_minutes: Number(newRestaurant.prep_minutes) || 20,
      rating: 5, is_open: true, order_mode: 'catalog'
    })
    setNewRestaurant({ name: '', description: '', category: '', vendor_type: 'restaurant', prep_minutes: '20' })
    load()
  }

  async function archiveRestaurant(r: Restaurant, archived: boolean) {
    if (archived && !confirm(`تأكيد إخفاء ${r.name}؟ هيختفي من التطبيق للعملاء بس بياناته وطلباته القديمة هتفضل موجودة.`)) return
    await supabase.from('restaurants').update({ archived }).eq('id', r.id)
    load()
  }

  async function confirmCustomOrderPrice(orderId: number, subtotal: number) {
    if (!subtotal || subtotal <= 0) return
    await supabase.rpc('confirm_custom_order_price', { p_order_id: orderId, p_subtotal: subtotal })
    load()
  }

  async function updateSetting(st: Setting, value: string) {
    if (value === st.value) return
    await supabase.from('settings').update({ value }).eq('key', st.key)
    load()
  }

  async function addItem(restaurantId: number) {
    await supabase.from('menu_items').insert({
      restaurant_id: restaurantId, name: newItem.name.trim(),
      category: newItem.category.trim() || 'أصناف', price: Number(newItem.price),
      requires_prescription: newItem.requiresRx
    })
    setNewItem({ name: '', category: '', price: '', requiresRx: false })
    load()
  }

  async function settleCash(driverId: number) { await supabase.rpc('settle_driver_cash', { p_driver_id: driverId }); load() }
  async function settleEarnings(driverId: number) { await supabase.rpc('settle_driver_earnings', { p_driver_id: driverId }); load() }
  async function updatePayoutSchedule(d: Driver, schedule: string) {
    await supabase.from('drivers').update({ payout_schedule: schedule }).eq('id', d.id); load()
  }
  async function updateComplaintStatus(c: Complaint, status: string) {
    await supabase.from('complaints').update({ status }).eq('id', c.id); load()
  }
  function compensateFromComplaint(c: Complaint) {
    setWalletPhone(c.orders?.customer_phone ?? '')
    setWalletReason(`تعويض شكوى طلب #${c.order_id}`)
    setWalletOrderId(c.order_id)
    setTab('wallet')
  }
  function compensateFromRating(rt: OrderRating) {
    setWalletPhone(rt.orders?.customer_phone ?? '')
    setWalletReason(`تعويض تقييم منخفض طلب #${rt.order_id}`)
    setWalletOrderId(rt.order_id)
    setTab('wallet')
  }
  async function markRefunded(orderId: number) {
    if (!confirm('تأكيد إنك حوّلت المبلغ فعلاً للعميل؟')) return
    const { error } = await supabase.rpc('mark_refunded', { p_order_id: orderId })
    if (error) { alert('حصل خطأ: ' + error.message); return }
    load()
  }
  async function toggleCoverage(restaurantId: number, compoundId: number) {
    const existing = coverage.find(c => c.restaurant_id === restaurantId && c.compound_id === compoundId)
    if (existing) await supabase.from('vendor_coverage').delete().eq('id', existing.id)
    else await supabase.from('vendor_coverage').insert({ restaurant_id: restaurantId, compound_id: compoundId })
    load()
  }
  async function sendWalletCredit() {
    if (!walletPhone.trim() || !walletAmount) return
    const { error } = await supabase.rpc('credit_wallet', {
      p_phone: walletPhone.trim(), p_amount: Number(walletAmount), p_reason: walletReason.trim() || 'admin credit',
      p_order_id: walletOrderId
    })
    setWalletResult(error ? 'حصل خطأ، جرب تاني' : `تمت إضافة ${walletAmount} ج.م لمحفظة ${walletPhone}`)
    if (!error) {
      setWalletPhone(''); setWalletAmount(''); setWalletReason('')
      if (walletOrderId != null) setCompensatedOrderIds(prev => new Set(prev).add(walletOrderId))
      setWalletOrderId(null)
    }
  }

  async function toggleRx(it: MenuItem) {
    await supabase.from('menu_items').update({ requires_prescription: !it.requires_prescription }).eq('id', it.id)
    load()
  }

  const vehicleLabel = (v: string) => v === 'van' ? '🚐 فان' : '🏍️ موتوسيكل'
  const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleString('ar-EG', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : null

  const pendingInstapay = orders.filter(o => o.payment_method === 'instapay' && o.status === 'awaiting_payment')

  async function confirmInstapayPayment(orderId: number) {
    setAccountBusy(`instapay-${orderId}`)
    const { error } = await supabase.rpc('admin_confirm_instapay_payment', { p_order_id: orderId })
    setAccountBusy(null)
    if (error) { alert('حصل خطأ، جرب تاني'); return }
    load()
  }

  const totalDriver = earnings.reduce((s, e) => s + Number(e.driver_earning), 0)
  const totalAdmin = earnings.reduce((s, e) => s + Number(e.admin_amount), 0)

  const addr = (o: Order) => `${o.zone} — وحدة ${o.unit_number}${o.address_notes ? ` — ${o.address_notes}` : ''}`
  const customer = (o: Order) => (
    <div className="mt-2.5 bg-night border border-line rounded-xl p-3 text-sm space-y-1">
      <p>👤 {o.customer_name} · <a className="text-sea" dir="ltr" href={`tel:${o.customer_phone}`}>{o.customer_phone}</a></p>
      <p>📍 {addr(o)}</p>
    </div>
  )

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">لوحة التحكم</h1>

      {pendingInstapay.length > 0 && (
        <div className="card p-4 mb-4 border-sand/50 bg-sand/5">
          <p className="font-bold mb-3">📲 تحويلات InstaPay بانتظار التأكيد ({pendingInstapay.length})</p>
          <div className="space-y-2.5">
            {pendingInstapay.map(o => (
              <div key={o.id} className="bg-night border border-line rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-sm">#{o.id} — {o.restaurants?.name} — {o.total} ج.م</p>
                  <p className="text-xs text-mist" dir="ltr">{o.customer_phone}</p>
                  <p className="text-xs mt-0.5">
                    {o.instapay_claimed_at
                      ? <span className="text-emerald-700">✓ العميل قال إنه حوّل</span>
                      : <span className="text-mist">لسه ماقالش إنه حوّل</span>}
                  </p>
                </div>
                <button className="btn-sea !py-1.5 !px-3.5 text-sm shrink-0" disabled={accountBusy === `instapay-${o.id}`}
                  onClick={() => confirmInstapayPayment(o.id)}>
                  {accountBusy === `instapay-${o.id}` ? '...' : 'تأكيد الاستلام'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-4 -mx-4 px-4">
        {TABS.map(t => (
          <button key={t.key} className={`tab ${tab === t.key ? 'tab-active' : ''}`} onClick={() => { if (t.key !== 'wallet') setWalletOrderId(null); setTab(t.key) }}>{t.label}</button>
        ))}
      </div>

      {tab === 'unassigned' && (
        <div className="space-y-3">
          {unassigned.length === 0 && <div className="card p-6 text-center text-mist">لا توجد طلبات غير معيّنة</div>}
          {unassigned.map(o => (
            <div key={o.id} className={`card p-4 ${isLate(o) ? 'border-red-400/60' : ''}`}>
              <div className="flex items-start justify-between">
                <h2 className="font-bold">#{o.id} — {o.restaurants?.name}</h2>
                <span className="font-bold text-sea">
                  {o.pricing_status === 'pending_quote' ? 'قيد التسعير' : `${o.total} ج.م`}
                </span>
              </div>
              {o.order_type === 'custom_request' && (
                <p className="text-sand text-sm mt-1.5">🧾 طلب خاص{o.pricing_status === 'pending_quote' ? ' — لسه محتاج تسعير من تبويب الطلبات' : ''}</p>
              )}
              {o.order_type === 'pickup_request' && (
                <p className="text-sm mt-1.5">🛵 طلب مندوب بس{o.payment_mode === 'driver_pays' ? ` — المندوب يدفع ${o.collect_amount} ج.م` : ''}</p>
              )}
              {isCooking(o) && (
                <p className="text-mist text-sm mt-1.5">👨‍🍳 لسه بيتحضر — متاح للمندوبين خلال {minsUntilDispatch(o)} دقيقة</p>
              )}
              {isLate(o) && <p className="text-red-600 text-sm mt-1.5">⚠️ محدش استلم الطلب</p>}
              {(() => {
                const priorAttempts = assignments.filter(a => a.order_id === o.id && a.status !== 'Offered')
                return priorAttempts.length > 0 ? (
                  <p className="text-xs text-sand mt-1.5">
                    ⚠️ اتعرض قبل كده على {priorAttempts.length} مندوب ({priorAttempts.map(a => a.drivers?.name).filter(Boolean).join('، ')})
                  </p>
                ) : null
              })()}
              {customer(o)}
              <button className="btn-sea w-full mt-3" onClick={() => setAssigning(o)}>
                {isCooking(o) ? 'تعيين مندوب الآن (تجاوز وقت التحضير)' : 'تعيين مندوب'}
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === 'active' && (
        <div className="space-y-6">
          {active.length === 0 && <div className="card p-6 text-center text-mist">لا توجد توصيلات جارية</div>}
          {(['Offered', 'Accepted', 'Picked_Up', 'Out_for_Delivery'] as const).map(statusGroup => {
            const group = active.filter(a => a.status === statusGroup)
            if (group.length === 0) return null
            return (
              <div key={statusGroup}>
                <h3 className="font-bold text-mist text-sm mb-2.5">{assignmentStatusLabel(statusGroup)} ({group.length})</h3>
                <div className="space-y-3">
                  {group.map(a => (
                    <div key={a.id} className="card p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h2 className="font-bold">#{a.order_id} — {a.orders?.restaurants?.name}</h2>
                          <p className="text-sm text-mist mt-0.5">🛵 {a.drivers?.name} · محاولة {a.attempt_number}</p>
                        </div>
                        <span className="text-xs font-semibold bg-shellup rounded-full px-2.5 py-1">{assignmentStatusLabel(a.status)}</span>
                      </div>
                      {a.orders && customer(a.orders)}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'drivers' && (
        <div className="space-y-3">
          <div className="card p-4">
            <p className="font-semibold mb-1">إضافة مندوبين بالجملة</p>
            <p className="text-xs text-mist mb-2">سطر لكل مندوب: الاسم, رقم الموبايل, النوع (اكتب فان لو فان، سيبها فاضية أو اكتب موتوسيكل)</p>
            <textarea className="field h-28 resize-none" placeholder={"أحمد علي, 01012345678, موتوسيكل\nمحمد سعيد, 01098765432, فان"}
              value={bulkDrivers} onChange={e => setBulkDrivers(e.target.value)} />
            <button className="btn-sea w-full mt-2" disabled={!bulkDrivers.trim()} onClick={importDrivers}>
              استيراد
            </button>
            {bulkResult && <p className="text-sm text-mist mt-2">{bulkResult}</p>}
          </div>

          {drivers.map(d => (
            <div key={d.id} className="card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-bold">{d.name}</h2>
                  <p className="text-sm text-mist mt-0.5">★ {d.rating} · {d.total_deliveries} توصيلة · {vehicleLabel(d.vehicle_type)} · {d.vehicle_plate}</p>
                  <p className="text-sm text-mist mt-0.5" dir="ltr">{d.phone}</p>
                </div>
                <span className={d.active ? 'badge-open' : 'badge-closed'}>{driverStatusLabel(d.status)}</span>
              </div>
              <div className="flex gap-2.5 mt-3">
                <button className="btn-ghost text-sm flex-1" onClick={() => toggleDriver(d, 'available')}>{d.available ? 'إيقاف مؤقت' : 'إتاحة'}</button>
                <button className={`text-sm flex-1 ${d.active ? 'btn-danger' : 'btn-sea'}`} onClick={() => toggleDriver(d, 'active')}>{d.active ? 'إيقاف الحساب' : 'تفعيل الحساب'}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'orders' && (
        <div className="space-y-6">
          {(() => {
            const groups: { label: string; items: typeof orders }[] = []
            for (const o of orders) {
              const label = new Date(o.created_at).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })
              const last = groups[groups.length - 1]
              if (last && last.label === label) last.items.push(o)
              else groups.push({ label, items: [o] })
            }
            return groups.map(group => (
              <div key={group.label}>
                <h3 className="font-bold text-mist text-sm mb-2.5">{group.label} ({group.items.length})</h3>
                <div className="space-y-3">
                  {group.items.map(o => (
            <div key={o.id} className="card p-4">
              <div className="flex items-start justify-between">
                <h2 className="font-bold">#{o.id} — {o.restaurants?.name}</h2>
                <div className="text-left">
                  <span className="font-bold text-sea block">
                    {o.pricing_status === 'pending_quote' ? 'قيد التسعير' : `${o.total} ج.م`}
                  </span>
                  <span className="text-xs text-mist">{orderStatusLabel(o.status)}</span>
                </div>
              </div>

              {o.order_type === 'custom_request' && (
                <div className="mt-2.5 bg-sand/10 border border-sand/30 rounded-xl p-3 text-sm space-y-1">
                  <p className="font-semibold">🧾 طلب خاص</p>
                  {(o.request_items ?? []).map((it, i) => <p key={i}>• {it.name} × {it.qty}</p>)}
                  {o.request_notes && <p className="italic">"{o.request_notes}"</p>}
                </div>
              )}

              {o.order_type === 'pickup_request' && (
                <div className="mt-2.5 bg-shellup/60 rounded-xl p-3 text-sm space-y-1">
                  <p className="font-semibold">🛵 طلب مندوب بس</p>
                  <p>{o.payment_mode === 'driver_pays' ? `المندوب يدفع ${o.collect_amount} ج.م ويحصلها كاش` : 'الأوردر متدفوع بالفعل'}</p>
                  {o.request_notes && <p className="italic">"{o.request_notes}"</p>}
                </div>
              )}

              {customer(o)}

              {o.order_type === 'custom_request' && o.pricing_status === 'pending_quote' && (
                <div className="flex items-center gap-2 mt-3">
                  <input type="number" inputMode="decimal" placeholder="السعر بعد المكالمة"
                    className="field !py-1.5 text-sm" id={`quote-${o.id}`} />
                  <button className="btn-sea shrink-0 !py-1.5 text-sm" onClick={() => {
                    const el = document.getElementById(`quote-${o.id}`) as HTMLInputElement
                    confirmCustomOrderPrice(o.id, Number(el.value))
                  }}>تأكيد السعر</button>
                </div>
              )}

              <button className="text-xs text-sea font-semibold mt-3" onClick={() => setOpenHistory(openHistory === o.id ? null : o.id)}>
                {openHistory === o.id ? 'إخفاء السجل الزمني ▲' : 'عرض السجل الزمني ▼'}
              </button>
              {openHistory === o.id && (
                <div className="mt-2 bg-night border border-line rounded-xl p-3 text-xs space-y-1.5">
                  <p>🕐 الطلب اتعمل: {fmtTime(o.created_at)}</p>
                  {assignments.filter(a => a.order_id === o.id).map(a => (
                    <div key={a.id} className="border-t border-line pt-1.5 mt-1.5 first:border-t-0 first:pt-0 first:mt-0">
                      <p className="font-semibold">محاولة {a.attempt_number} — {a.drivers?.name} ({assignmentStatusLabel(a.status)})</p>
                      {a.offered_at && <p>عُرض عليه: {fmtTime(a.offered_at)}</p>}
                      {a.responded_at && <p>رد: {fmtTime(a.responded_at)}</p>}
                      {a.picked_up_at && <p>استلم من المطعم: {fmtTime(a.picked_up_at)}</p>}
                      {a.delivered_at && <p>سلّم: {fmtTime(a.delivered_at)}</p>}
                      {a.rejection_reason && <p className="text-sand">سبب: {a.rejection_reason}</p>}
                    </div>
                  ))}
                  {assignments.filter(a => a.order_id === o.id).length === 0 && (
                    <p className="text-mist">محدش اتعين على الطلب ده لسه</p>
                  )}
                </div>
              )}
            </div>
                  ))}
                </div>
              </div>
            ))
          })()}
        </div>
      )}


      {tab === 'earnings' && (
        <div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="card p-4 text-center"><p className="text-sm text-mist">إجمالي التوصيلات</p><p className="text-2xl font-bold mt-1">{earnings.length}</p></div>
            <div className="card p-4 text-center"><p className="text-sm text-mist">أرباح المندوبين</p><p className="text-2xl font-bold mt-1 text-sea">{totalDriver} ج.م</p></div>
            <div className="card p-4 text-center"><p className="text-sm text-mist">أرباح الإدارة</p><p className="text-2xl font-bold mt-1 text-sand">{totalAdmin} ج.م</p></div>
          </div>
          <div className="space-y-2.5">
            {earnings.map(e => (
              <div key={e.id} className="card p-3.5 flex items-center justify-between text-sm">
                <span className="font-semibold">{e.drivers?.name} — طلب #{e.order_id}</span>
                <span className="text-mist">رسوم: {e.delivery_fee} · <span className="text-sea">مندوب: {e.driver_earning}</span> · <span className="text-sand">إدارة: {e.admin_amount}</span></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'menu' && (
        <div className="space-y-3">
          {restaurants.map(r => {
            const its = menu.filter(m => m.restaurant_id === r.id)
            const expanded = openRest === r.id
            return (
              <div key={r.id} className={`card p-4 ${r.archived ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between">
                  <button className="text-right flex items-center gap-3 flex-1 min-w-0" onClick={() => setOpenRest(expanded ? null : r.id)}>
                    {r.logo_url
                      ? <img src={r.logo_url} alt="" className="w-11 h-11 rounded-xl object-cover shrink-0 border border-line" />
                      : <div className="w-11 h-11 rounded-xl bg-shellup grid place-items-center shrink-0 text-lg font-bold text-mist">{r.name.charAt(0)}</div>}
                    <div className="min-w-0">
                      <h2 className="font-bold truncate">{r.name}{r.archived ? ' (متوقف)' : ''}</h2>
                      <p className="text-sm text-mist mt-0.5">{its.length} صنف · اضغط للتعديل</p>
                    </div>
                    <span className="text-mist shrink-0 mr-1">{expanded ? '▲' : '▼'}</span>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <button className={r.is_open ? 'badge-open' : 'badge-closed'}
                      onClick={() => toggleRestaurant(r)}>{r.is_open ? 'مفتوح' : 'مغلق'}</button>
                    <button className={`text-xs font-semibold rounded-full px-2.5 py-1 ${r.archived ? 'bg-emerald-500/15 text-emerald-700' : 'bg-red-500/15 text-red-600'}`}
                      onClick={() => archiveRestaurant(r, !r.archived)}>{r.archived ? 'تفعيل' : 'إيقاف'}</button>
                  </div>
                </div>

                {expanded && (
                  <label className="flex items-center gap-2 mt-3 text-sm text-sea cursor-pointer w-fit">
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                      onChange={e => e.target.files?.[0] && uploadLogo(r, e.target.files[0])} />
                    {uploadingImage === `r${r.id}` ? 'جاري رفع الشعار…' : (r.logo_url ? '🖼️ تغيير شعار المطعم' : '🖼️ إضافة شعار للمطعم')}
                  </label>
                )}
                {imageError && expanded && <p className="text-xs text-sand mt-1">{imageError}</p>}

                {reliability[r.id] && reliability[r.id].total_orders > 0 && (
                  <p className="text-xs text-mist mt-2">
                    ⏱ متوسط وقت القبول: {reliability[r.id].avg_accept_minutes ?? '—'} د ·
                    {' '}<span className={reliability[r.id].slow_accepts > 2 ? 'text-red-600' : 'text-mist'}>
                      {reliability[r.id].slow_accepts} طلب اتأخر قبوله (٣٠ يوم)
                    </span>
                  </p>
                )}

                {expanded && (
                  <div className="flex items-center gap-2 mt-3 text-sm">
                    <span className="text-mist">وقت التحضير</span>
                    <input type="number" defaultValue={r.prep_minutes}
                      className="field !w-20 !py-1.5 text-center"
                      onBlur={e => updateRestaurant(r, { prep_minutes: Number(e.target.value) })} />
                    <span className="text-mist">دقيقة</span>
                    <select className="field !w-auto !py-1.5 text-sm mr-auto" value={r.vendor_type}
                      onChange={e => updateRestaurant(r, { vendor_type: e.target.value })}>
                      <option value="restaurant">🍽️ مطعم</option>
                      <option value="supermarket">🛒 سوبر ماركت</option>
                      <option value="pharmacy">💊 صيدلية</option>
                    </select>
                    <select className="field !w-auto !py-1.5 text-sm" value={r.order_mode}
                      onChange={e => updateRestaurant(r, { order_mode: e.target.value })}>
                      <option value="catalog">📋 طلب من القايمة</option>
                      <option value="custom_request">🧾 طلب خاص (نص حر)</option>
                      <option value="pickup_request">🛵 طلب مندوب بس (نظامهم الخاص)</option>
                    </select>
                  </div>
                )}

                {expanded && r.vendor_type === 'supermarket' && (
                  <div className="mt-4 border-t border-line pt-3">
                    <p className="text-sm text-mist mb-2">فترات التوصيل</p>
                    <div className="space-y-2">
                      {slots.filter(sl => sl.restaurant_id === r.id).map(sl => (
                        <div key={sl.id} className="flex items-center justify-between bg-night border border-line rounded-xl p-2.5 text-sm">
                          <span>{sl.start_time.slice(0,5)} – {sl.end_time.slice(0,5)} · سعة {sl.capacity}</span>
                          <button className={sl.active ? 'badge-open' : 'badge-closed'} onClick={() => toggleSlot(sl)}>
                            {sl.active ? 'فعّالة' : 'موقوفة'}
                          </button>
                        </div>
                      ))}
                      {slots.filter(sl => sl.restaurant_id === r.id).length === 0 && (
                        <p className="text-xs text-mist">لسه مفيش فترات — ضيف واحدة تحت</p>
                      )}
                    </div>
                    <div className="flex gap-2 mt-3">
                      <input type="time" className="field !py-1.5 text-sm" value={newSlot.start_time}
                        onChange={e => setNewSlot({ ...newSlot, start_time: e.target.value })} />
                      <input type="time" className="field !py-1.5 text-sm" value={newSlot.end_time}
                        onChange={e => setNewSlot({ ...newSlot, end_time: e.target.value })} />
                      <input type="number" className="field !py-1.5 !w-20 text-sm" placeholder="سعة" value={newSlot.capacity}
                        onChange={e => setNewSlot({ ...newSlot, capacity: e.target.value })} />
                    </div>
                    <button className="btn-sea w-full mt-2 text-sm"
                      disabled={!newSlot.start_time || !newSlot.end_time}
                      onClick={() => addSlot(r.id)}>إضافة فترة</button>
                    <p className="text-xs text-mist mt-2 leading-relaxed">
                      السعة = أقصى عدد طلبات في الفترة دي. اربطها بعدد المندوبين المتاحين وقتها مش بسرعة تجهيز السوبر ماركت.
                    </p>
                  </div>
                )}

                {expanded && (
                  <div className="mt-4 space-y-2.5">
                    {its.map(it => (
                      <div key={it.id} className="bg-night border border-line rounded-xl p-3">
                        <div className="flex items-center justify-between gap-3">
                          <button className="flex items-center gap-2.5 min-w-0 text-right" onClick={() => setEditingItem(it)}>
                            {it.image_url
                              ? <img src={it.image_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 border border-line" />
                              : <div className="w-10 h-10 rounded-lg bg-shellup shrink-0" />}
                            <div className="min-w-0">
                              <p className="font-semibold truncate">{it.name}</p>
                              <p className="text-xs text-mist">{it.category}</p>
                            </div>
                          </button>
                          <div className="flex items-center gap-2 shrink-0">
                            <button className="text-xs text-sea font-semibold" onClick={() => setEditingItem(it)}>✏️ تعديل</button>
                            <input type="number" defaultValue={it.price} className="field !w-24 !py-1.5 text-center"
                              onBlur={e => updatePrice(it, Number(e.target.value))} />
                            <span className="text-mist text-sm">ج.م</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          <button className={`text-sm ${it.available ? 'text-mist' : 'text-sand'}`}
                            onClick={() => toggleItem(it)}>
                            {it.available ? '✓ متاح' : '✗ غير متاح'}
                          </button>
                          {it.available_from && it.available_until && (
                            <span className="text-xs text-mist bg-shellup/60 rounded-full px-2 py-0.5">
                              ⏰ {it.available_from.slice(0, 5)}–{it.available_until.slice(0, 5)}
                            </span>
                          )}
                          {r.vendor_type === 'pharmacy' && (
                            <button className={`text-sm ${it.requires_prescription ? 'text-sand' : 'text-mist'}`}
                              onClick={() => toggleRx(it)}>
                              {it.requires_prescription ? '💊 يحتاج روشتة' : 'بدون روشتة'}
                            </button>
                          )}
                          <label className="text-sm text-sea cursor-pointer">
                            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                              onChange={e => e.target.files?.[0] && uploadItemImage(it, e.target.files[0])} />
                            {uploadingImage === `i${it.id}` ? 'جاري الرفع…' : (it.image_url ? '🖼️ تغيير الصورة' : '🖼️ إضافة صورة')}
                          </label>
                        </div>
                      </div>
                    ))}

                    <div className="border-t border-line pt-3 mt-3">
                      <p className="text-sm text-mist mb-2">إضافة صنف جديد</p>
                      <div className="space-y-2">
                        <input className="field" placeholder="اسم الصنف" value={newItem.name}
                          onChange={e => setNewItem({ ...newItem, name: e.target.value })} />
                        <div className="flex gap-2">
                          <input className="field" placeholder="القسم (مشويات…)" value={newItem.category}
                            onChange={e => setNewItem({ ...newItem, category: e.target.value })} />
                          <input className="field !w-28" type="number" placeholder="السعر" value={newItem.price}
                            onChange={e => setNewItem({ ...newItem, price: e.target.value })} />
                        </div>
                        {r.vendor_type === 'pharmacy' && (
                          <label className="flex items-center gap-2 text-sm text-mist">
                            <input type="checkbox" checked={newItem.requiresRx}
                              onChange={e => setNewItem({ ...newItem, requiresRx: e.target.checked })} />
                            يحتاج روشتة طبية
                          </label>
                        )}
                        <button className="btn-sea w-full" disabled={!newItem.name || !newItem.price}
                          onClick={() => addItem(r.id)}>إضافة</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'settings' && (
        <div className="space-y-3">
          {settings.map(st => (
            <div key={st.key} className="card p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-sm">{st.label || st.key}</p>
              </div>
              <input defaultValue={st.value} className="field !w-24 !py-1.5 text-center"
                onBlur={e => updateSetting(st, e.target.value)} />
            </div>
          ))}
          <p className="text-xs text-mist mt-4 leading-relaxed">
            وقت وصول المندوب بيتحسب قبل ما الأكل يجهز، عشان يوصل المطعم في الوقت المناسب
            من غير ما يستنى.
          </p>
        </div>
      )}

      {tab === 'shifts' && (
        <div>
          {escalations.length > 0 && (
            <div className="mb-5">
              <h2 className="font-bold text-red-600 mb-3">⚠️ محتاجين تدخل الإدارة</h2>
              <div className="space-y-3">
                {escalations.map((e: any) => (
                  <div key={e.id} className="card p-4 border-red-400/60">
                    <p className="font-semibold">{e.requester?.name}</p>
                    <p className="text-sm text-mist mt-0.5">
                      {e.shifts && new Date(e.shifts.shift_date).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'numeric' })}
                      {' '}· {e.shifts?.start_time?.slice(0,5)}–{e.shifts?.end_time?.slice(0,5)}
                    </p>
                    {e.reason && <p className="text-sm text-mist mt-1">"{e.reason}"</p>}
                    <p className="text-xs text-red-600 mt-2">محدش من المندوبين وافق يستلم الوردية</p>

                    {reassignFor === e.id ? (
                      <div className="mt-3 space-y-2">
                        {drivers.filter(d => d.active && d.id !== e.requested_by).map(d => (
                          <button key={d.id} className="w-full card !bg-night p-2.5 text-sm text-right"
                            onClick={() => reassignShift(e.shift_id, d.id, e.id)}>{d.name}</button>
                        ))}
                        <button className="btn-ghost w-full text-sm" onClick={() => setReassignFor(null)}>إلغاء</button>
                      </div>
                    ) : (
                      <button className="btn-sea w-full mt-3 text-sm" onClick={() => setReassignFor(e.id)}>
                        عيّن مندوب تاني للوردية
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <h2 className="font-bold text-mist mb-3">جدول الورديات</h2>
          <div className="card p-4 mb-4">
            <p className="text-sm text-mist mb-2">إضافة وردية جديدة</p>
            <div className="grid grid-cols-2 gap-2">
              <select className="field" value={newShift.driver_id}
                onChange={e => setNewShift({ ...newShift, driver_id: e.target.value })}>
                <option value="">اختر مندوب…</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <input type="date" className="field" value={newShift.shift_date}
                onChange={e => setNewShift({ ...newShift, shift_date: e.target.value })} />
              <input type="time" className="field" value={newShift.start_time}
                onChange={e => setNewShift({ ...newShift, start_time: e.target.value })} />
              <input type="time" className="field" value={newShift.end_time}
                onChange={e => setNewShift({ ...newShift, end_time: e.target.value })} />
            </div>
            <button className="btn-sea w-full mt-3"
              disabled={!newShift.driver_id || !newShift.shift_date || !newShift.start_time || !newShift.end_time}
              onClick={addShift}>إضافة</button>
          </div>

          <div className="space-y-2.5">
            {shifts.map(sh => {
              const d = drivers.find(x => x.id === sh.driver_id)
              return (
                <div key={sh.id} className="card p-3.5 flex items-center justify-between text-sm">
                  <div>
                    <span className="font-semibold">{d?.name}</span>
                    <span className="text-mist"> — {new Date(sh.shift_date).toLocaleDateString('ar-EG')} · {sh.start_time.slice(0,5)}–{sh.end_time.slice(0,5)}</span>
                  </div>
                  {sh.status === 'swapped' && <span className="badge-closed">اتبدلت</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'payouts' && (
        <div className="space-y-5">
          {settlementRequests.length > 0 && (
            <div>
              <h2 className="font-bold text-sand mb-3">⏳ طلبات تسوية مبكرة</h2>
              <div className="space-y-2.5">
                {settlementRequests.map(sr => (
                  <div key={sr.id} className="card p-3.5 flex items-center justify-between text-sm">
                    <span className="font-semibold">{sr.drivers?.name}</span>
                    <button className="btn-sea !py-1.5 text-sm" onClick={() => settleEarnings(sr.driver_id)}>ادفع دلوقتي</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h2 className="font-bold text-mist mb-3">كل المندوبين</h2>
          <div className="space-y-3">
            {drivers.map(d => {
              const unpaid = earnings.filter(e => e.driver_id === d.id && !e.paid).reduce((s, e) => s + Number(e.driver_earning), 0)
              return (
                <div key={d.id} className="card p-4">
                  <div className="flex items-start justify-between">
                    <h3 className="font-bold">{d.name}</h3>
                    <select className="field !w-auto !py-1 text-xs" value={d.payout_schedule}
                      onChange={e => updatePayoutSchedule(d, e.target.value)}>
                      <option value="daily">يومي</option>
                      <option value="weekly">أسبوعي</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div className="bg-night border border-line rounded-xl p-3">
                      <p className="text-xs text-mist">كاش معاه</p>
                      <p className="font-bold text-sand mt-0.5">{d.cash_held ?? 0} ج.م</p>
                      {(d.cash_held ?? 0) >= 3000 && <p className="text-xs text-red-600 mt-1">⚠️ تجاوز حد الأمان</p>}
                    </div>
                    <div className="bg-night border border-line rounded-xl p-3">
                      <p className="text-xs text-mist">أرباح مستحقة</p>
                      <p className="font-bold text-sea mt-0.5">{unpaid} ج.م</p>
                    </div>
                  </div>
                  <div className="flex gap-2.5 mt-3">
                    <button className="btn-ghost flex-1 text-sm" disabled={!(d.cash_held > 0)} onClick={() => settleCash(d.id)}>استلمت الكاش</button>
                    <button className="btn-sea flex-1 text-sm" disabled={unpaid === 0} onClick={() => settleEarnings(d.id)}>ادفع الأرباح</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'wallet' && (
        <div className="card p-4">
          <p className="font-semibold mb-2">💳 إضافة رصيد لمحفظة عميل</p>
          <p className="text-xs text-mist mb-3">مفيد لتعويض عميل بعد شكوى، أو أي حالة تانية محتاجة رصيد</p>
          <div className="space-y-2">
            <input className="field" dir="ltr" placeholder="رقم موبايل العميل" value={walletPhone} onChange={e => setWalletPhone(e.target.value)} />
            <div className="flex gap-2">
              <input className="field !w-28" type="number" placeholder="المبلغ" value={walletAmount} onChange={e => setWalletAmount(e.target.value)} />
              <input className="field" placeholder="السبب (اختياري)" value={walletReason} onChange={e => setWalletReason(e.target.value)} />
            </div>
            <button className="btn-sea w-full" disabled={!walletPhone.trim() || !walletAmount} onClick={sendWalletCredit}>إضافة الرصيد</button>
            {walletResult && <p className="text-sm text-mist">{walletResult}</p>}
          </div>
        </div>
      )}

      {tab === 'complaints' && (
        <div className="space-y-3">
          {orders.filter(o => o.refund_status === 'pending').length > 0 && (
            <div className="space-y-2 mb-1">
              <p className="text-sm font-semibold">💸 مبالغ محتاجة استرداد يدوي (InstaPay/أونلاين)</p>
              {orders.filter(o => o.refund_status === 'pending').map(o => (
                <div key={o.id} className="card p-3.5 flex items-center justify-between gap-2 border-sand/40">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">طلب #{o.id} — {o.restaurants?.name} — {o.total} ج.م</p>
                    <p className="text-xs text-mist truncate">{o.customer_name} · {o.customer_phone}</p>
                  </div>
                  <button className="btn-sea !py-1.5 !px-2.5 text-xs shrink-0" onClick={() => markRefunded(o.id)}>حوّلت المبلغ ✓</button>
                </div>
              ))}
            </div>
          )}
          {lowRatings.length > 0 && (
            <div className="space-y-2 mb-1">
              <p className="text-sm font-semibold">⭐ تقييمات منخفضة (نجمتين أو أقل)</p>
              {lowRatings.map(rt => (
                <div key={rt.id} className="card p-3.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">طلب #{rt.order_id} — {rt.orders?.restaurants?.name}</p>
                    <p className="text-xs text-mist truncate flex items-center gap-1 flex-wrap">
                      <span>{rt.orders?.customer_name} · {rt.orders?.customer_phone}</span>
                      {rt.driver_rating != null && <span className="flex items-center gap-1">· المندوب <StarRow n={rt.driver_rating} /></span>}
                      {rt.restaurant_rating != null && <span className="flex items-center gap-1">· المطعم <StarRow n={rt.restaurant_rating} /></span>}
                    </p>
                  </div>
                  {compensatedOrderIds.has(rt.order_id)
                    ? <span className="text-xs font-semibold text-emerald-700 shrink-0 px-2.5 py-1.5">✓ اتعوّض</span>
                    : <button className="btn-ghost !py-1.5 !px-2.5 text-xs shrink-0" onClick={() => compensateFromRating(rt)}>💳 تعويض العميل</button>}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between">
            <p className="text-sm text-mist">
              {showResolvedComplaints ? 'كل الشكاوى' : 'الشكاوى المفتوحة'}
            </p>
            <button className="text-sm text-sea font-semibold" onClick={() => setShowResolvedComplaints(v => !v)}>
              {showResolvedComplaints ? 'إخفاء المتحلة' : 'عرض كل الشكاوى (حتى المتحلة)'}
            </button>
          </div>

          {complaints.filter(c => showResolvedComplaints || c.status !== 'resolved').length === 0 && (
            <div className="card p-6 text-center text-mist">لا توجد شكاوى</div>
          )}
          {complaints.filter(c => showResolvedComplaints || c.status !== 'resolved').map(c => (
            <div key={c.id} className="card p-4">
              <div className="flex items-start justify-between">
                <h2 className="font-bold">طلب #{c.order_id} — {c.orders?.restaurants?.name}</h2>
                <span className={`text-xs font-semibold rounded-full px-2.5 py-1 ${c.status === 'open' ? 'bg-red-500/15 text-red-600' : c.status === 'reviewed' ? 'bg-sand/15 text-sand' : 'bg-emerald-500/15 text-emerald-700'}`}>
                  {c.status === 'open' ? 'جديدة' : c.status === 'reviewed' ? 'قيد المراجعة' : 'اتحلت'}
                </span>
              </div>
              <p className="text-sm mt-2">{c.description}</p>
              {c.orders && (
                <p className="text-sm text-mist mt-2">👤 {c.orders.customer_name} · <a className="text-sea" dir="ltr" href={`tel:${c.orders.customer_phone}`}>{c.orders.customer_phone}</a></p>
              )}
              <div className="flex gap-2.5 mt-3 flex-wrap">
                {c.status !== 'reviewed' && <button className="btn-ghost flex-1 text-sm" onClick={() => updateComplaintStatus(c, 'reviewed')}>قيد المراجعة</button>}
                {c.status !== 'resolved' && <button className="btn-sea flex-1 text-sm" onClick={() => updateComplaintStatus(c, 'resolved')}>اتحلت</button>}
                {compensatedOrderIds.has(c.order_id)
                  ? <span className="text-sm font-semibold text-emerald-700 flex-1 text-center py-2">✓ اتعوّض</span>
                  : <button className="btn-ghost flex-1 text-sm" onClick={() => compensateFromComplaint(c)}>💳 تعويض العميل</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'accounts' && (
        <div className="space-y-6">
          <div className="card p-4">
            <p className="font-semibold mb-3">إضافة مطعم/متجر جديد</p>
            <div className="space-y-2.5">
              <input className="field" placeholder="الاسم" value={newRestaurant.name}
                onChange={e => setNewRestaurant({ ...newRestaurant, name: e.target.value })} />
              <input className="field" placeholder="وصف قصير" value={newRestaurant.description}
                onChange={e => setNewRestaurant({ ...newRestaurant, description: e.target.value })} />
              <div className="flex gap-2">
                <input className="field" placeholder="التصنيف (مثال: فاست فود)" value={newRestaurant.category}
                  onChange={e => setNewRestaurant({ ...newRestaurant, category: e.target.value })} />
                <select className="field !w-auto" value={newRestaurant.vendor_type}
                  onChange={e => setNewRestaurant({ ...newRestaurant, vendor_type: e.target.value })}>
                  <option value="restaurant">🍽️ مطعم</option>
                  <option value="supermarket">🛒 سوبر ماركت</option>
                  <option value="pharmacy">💊 صيدلية</option>
                </select>
              </div>
              <button className="btn-sea w-full" disabled={!newRestaurant.name.trim()} onClick={addRestaurant}>
                إضافة
              </button>
              <p className="text-xs text-mist">تقدر بعد كده تظبط وقت التحضير ونوع الطلب (طلب من القايمة / طلب خاص / طلب مندوب بس) من تبويب "المطاعم والمنيو"</p>
            </div>
          </div>

          <div>
            <p className="font-semibold mb-3">حسابات المطاعم والمتاجر</p>
            <div className="space-y-2.5">
              {restaurants.map(r => {
                const acc = vendorAccounts.find(a => a.restaurant_id === r.id)
                return (
                  <div key={r.id} className="card p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{r.name}{r.archived ? ' (مخفي)' : ''}</p>
                        {acc ? <p className="text-xs text-mist truncate" dir="ltr">{acc.email}</p>
                          : <p className="text-xs text-mist">مفيش حساب دخول</p>}
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {acc ? (
                          <AccountActionsMenu
                            busy={accountBusy === acc.profile_id}
                            onChangeEmail={() => changeEmail(acc.profile_id, acc.email)}
                            onResetPassword={() => resetPassword(acc.profile_id)}
                            onCustomPassword={() => setCustomPassword(acc.profile_id)}
                            onRemove={() => removeLogin(acc.profile_id)}
                          />
                        ) : (
                          <button className="btn-sea !py-1.5 !px-3 text-xs" disabled={accountBusy === `vendor-${r.id}`}
                            onClick={() => createVendorLogin(r.id)}>إنشاء حساب</button>
                        )}
                        <button className={`!py-1.5 !px-2.5 text-xs ${r.archived ? 'btn-sea' : 'btn-ghost'}`}
                          onClick={() => archiveRestaurant(r, !r.archived)}>{r.archived ? 'إظهار' : 'إخفاء'}</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <p className="font-semibold mb-3">حسابات المندوبين</p>
            <div className="space-y-2.5">
              {drivers.map(d => {
                const acc = driverAccounts.find(a => a.driver_id === d.id)
                return (
                  <div key={d.id} className="card p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{d.name}</p>
                        {acc ? <p className="text-xs text-mist truncate" dir="ltr">{acc.email}</p>
                          : <p className="text-xs text-mist">مفيش حساب دخول (بيانات مؤقتة)</p>}
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {acc ? (
                          <AccountActionsMenu
                            busy={accountBusy === acc.profile_id}
                            onChangeEmail={() => changeEmail(acc.profile_id, acc.email)}
                            onResetPassword={() => resetPassword(acc.profile_id)}
                            onCustomPassword={() => setCustomPassword(acc.profile_id)}
                            onRemove={() => removeLogin(acc.profile_id)}
                          />
                        ) : (
                          <button className="btn-sea !py-1.5 !px-3 text-xs" disabled={accountBusy === `driver-${d.id}`}
                            onClick={() => createDriverLogin(d.id)}>إنشاء حساب</button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'coverage' && (
        <div className="space-y-2.5">
          <p className="text-sm text-mist bg-shellup/60 rounded-xl p-3">
            كل مطعم بيوصل لكل الأماكن افتراضيًا. تقدر تحدد له مسافة قصوى (كم)، أو لو عايز تحدد أماكن بعينها بالظبط دوس "أماكن محددة" — لو حددت أماكن، هتتجاهل المسافة القصوى وهيوصل بس للأماكن المختارة.
          </p>
          {restaurants.filter(r => !r.archived).map(r => {
            const explicit = coverage.filter(c => c.restaurant_id === r.id)
            const open = coverageFor === r.id
            return (
              <div key={r.id} className="card p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{r.name}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="number" min={1} placeholder="بلا حد أقصى"
                      className="field !h-9 !w-28 text-sm"
                      value={r.max_delivery_km ?? ''}
                      onChange={e => updateRestaurant(r, { max_delivery_km: e.target.value ? Number(e.target.value) : null })}
                    />
                    <span className="text-xs text-mist">كم</span>
                    <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => setCoverageFor(open ? null : r.id)}>
                      {explicit.length > 0 ? `أماكن محددة (${explicit.length})` : 'أماكن محددة'}
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="mt-3 pt-3 border-t border-line">
                    {explicit.length > 0 && (
                      <p className="text-xs text-sand mb-2">⚠️ المطعم ده حاليًا مقتصر بس على الأماكن المعلّمة تحت — لو عايزه يرجع يوصل بالمسافة القصوى بس، شيل كل التعليمات.</p>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-64 overflow-y-auto">
                      {compounds.map(c => {
                        const checked = explicit.some(e => e.compound_id === c.id)
                        return (
                          <label key={c.id} className={`flex items-center gap-1.5 text-xs rounded-lg px-2 py-1.5 cursor-pointer ${checked ? 'bg-sea/10 text-sea font-semibold' : 'bg-shellup/50'}`}>
                            <input type="checkbox" className="accent-sea" checked={checked} onChange={() => toggleCoverage(r.id, c.id)} />
                            <span className="truncate">{c.name}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {newCreds && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => setNewCreds(null)}>
          <div className="card w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-3">بيانات الدخول</h3>
            <p className="text-sm text-mist mb-1">الإيميل</p>
            <p className="font-mono text-sm bg-night border border-line rounded-lg p-2.5 mb-3" dir="ltr">{newCreds.email}</p>
            <p className="text-sm text-mist mb-1">كلمة السر</p>
            <p className="font-mono text-sm bg-night border border-line rounded-lg p-2.5 mb-4" dir="ltr">{newCreds.password}</p>
            <p className="text-xs text-sand mb-4">⚠️ ده ظاهر مرة واحدة بس — انسخه وابعته دلوقتي</p>
            <button className="btn-sea w-full" onClick={() => setNewCreds(null)}>تمام</button>
          </div>
        </div>
      )}

      {assigning && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => setAssigning(null)}>
          <div className="card w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-4">اختيار مندوب متاح — طلب #{assigning.id}</h3>
            {assigningNeedsVan && (
              <p className="text-sand text-sm mb-3">🚐 الطلب محتاج فان — لسه السعر متأكدش أو الطلب كبير</p>
            )}
            {assignableDrivers.length === 0 && (
              <p className="text-mist text-sm">
                {assigningNeedsVan ? 'لا يوجد فان متاح حالياً' : 'لا يوجد مندوبين متاحين حالياً'}
              </p>
            )}
            <div className="space-y-2.5">
              {assignableDrivers.map(d => {
                const driverActiveCount = active.filter(a => a.driver_id === d.id).length
                return (
                  <button key={d.id} className="w-full card !bg-night p-3.5 text-right hover:border-sea/50 transition-colors" onClick={() => assign(assigning, d)}>
                    <p className="font-semibold">{d.name}</p>
                    <p className="text-sm text-mist mt-0.5">★ {d.rating} · {d.total_deliveries} توصيلة · {vehicleLabel(d.vehicle_type)} · {d.vehicle_plate}</p>
                    {driverActiveCount > 0 && (
                      <p className="text-xs text-sand mt-1">شغال دلوقتي على {driverActiveCount} طلب</p>
                    )}
                  </button>
                )
              })}
            </div>
            <button className="btn-ghost w-full mt-4" onClick={() => setAssigning(null)}>إلغاء</button>
          </div>
        </div>
      )}

      {editingItem && (
        <MenuItemEditor
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={() => { setEditingItem(null); load() }}
        />
      )}
    </div>
  )
}
