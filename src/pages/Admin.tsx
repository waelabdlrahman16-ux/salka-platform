import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useDismissable } from '../lib/useDismissable'
import type { Assignment, Compound, Complaint, Driver, DeliverySlotRow, Earning, LiveDelivery, MenuItem, Order, OrderRating, Reliability, Restaurant, Setting, SettlementRequest, Shift, VendorCoverage } from '../lib/types'
import { ping } from '../lib/notify'
import { registerPush, persistPushToken } from '../lib/push'
import { uploadVendorImage } from '../lib/upload'
import { SkeletonBlock, SkeletonOrderCard } from '../components/Skeleton'
import { orderStatusLabel, assignmentStatusLabel, driverStatusLabel,
         ORDER_STATUSES, CLOSED_ORDER_STATUSES, UNPAID_ORDER_STATUSES, type OrderStatus, isCancelled, cancelReasonLabel } from '../lib/statusLabels'
import { rpc, type RpcResult } from '../lib/rpc'
import { adminFinancialAction } from '../lib/adminFinancialActions'
import { adminAccountDriverAction } from '../lib/adminAccountDriverActions'
import { adminReport } from '../lib/adminReports'
import { adminCatalogAction } from '../lib/adminCatalogActions'
import { adminCompoundAction } from '../lib/adminCompoundActions'
import { catalogCheck } from '../lib/catalogChecks'
import { staffOperation } from '../lib/staffOperations'
import { dispatchOperation } from '../lib/dispatchOperations'
import { vendorOperation } from '../lib/vendorOperations'
import { isValidEgyptPhone, PHONE_HINT } from '../lib/validation'
import Icon from '../components/Icon'
import BannersAdmin from '../components/BannersAdmin'
import PrescriptionLink from '../components/PrescriptionLink'
import MenuItemEditor from '../components/MenuItemEditor'
import AddMenuItemModal from '../components/AddMenuItemModal'
import MenuItemsPanel from '../components/MenuItemsPanel'
import EnablePushButton from '../components/EnablePushButton'
import EnableSoundButton from '../components/EnableSoundButton'
import CustomersTab from '../components/CustomersTab'
import FunnelPanel from '../components/FunnelPanel'
import VendorHoursRow from '../components/VendorHoursRow'
import OrderAdjust from '../components/OrderAdjust'
import { openLabel } from '../lib/vendorHours'
import PhoneOrderForm from '../components/PhoneOrderForm'
import CompoundsTab from '../components/CompoundsTab'
import DriverForm, { driverToForm } from '../components/DriverForm'
import LiveDeliveryDetail from '../components/LiveDeliveryDetail'
import Toggle from '../components/Toggle'
import { useSheets } from '../components/ActionSheets'
import { useCatalogSync } from '../lib/useCatalogSync'

/**
 * The batch load below is a `Promise.all` of raw postgrest queries, each
 * settling to `{ data, error }`. The admin-panel reads that now go through
 * `admin-reports` settle to `RpcResult` (`{ ok, data, error }`) instead --
 * this adapts one to the other so every entry in that array can keep sharing
 * the same `withTimeout` / `if (!x.error)` shape.
 */
function toDataError<T>(p: Promise<RpcResult<T>>): Promise<{ data: T | null; error: Error | null }> {
  return p.then(res => res.ok ? { data: res.data, error: null } : { data: null, error: new Error(res.error) })
}

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

type Tab = 'daily' | 'unassigned' | 'active' | 'drivers' | 'menu' | 'orders' | 'earnings' | 'settings' | 'shifts' | 'payouts' | 'complaints' | 'coverage' | 'accounts' | 'wallet' | 'banners' | 'refunds' | 'customers' | 'compounds'

// What is actually owed back, decided by the server. A COD order only ever took
// the 50% deposit, so refunding `total` would be a gift -- and that is exactly
// what the old block inside the complaints tab displayed.
type PendingRefund = {
  id: number; customer_name: string; customer_phone: string
  total: number; payment_method: string; cod_deposit_amount: number | null
  status: string; cancel_reason: string | null; cancelled_at: string | null
  instapay_claimed_at: string | null; vendor_name: string | null
  refund_amount: number
}
/**
 * Sixteen tabs in one horizontally-scrolling row meant the answer to "where is
 * that?" was always "scroll and read all sixteen". They are not sixteen equal
 * things: four are what you do minute to minute, four are money, and the rest
 * are setup you touch once a week.
 *
 * Grouping hides things, and hiding an alert is worse than a long row -- so
 * every count that used to demand attention from the flat row is summed onto
 * its GROUP chip. A refund waiting is still visible from anywhere; you just do
 * not have to read fifteen other labels to notice it.
 */
// 'places' is separate from 'catalog' deliberately. A compound is a PLACE we
// deliver to; a restaurant is a business we deliver for. They were living under
// one heading only because the fee editor happened to be bolted onto the
// restaurants screen.
type TabGroup = 'now' | 'money' | 'catalog' | 'places' | 'people' | 'setup'

const GROUPS: { key: TabGroup; label: string }[] = [
  { key: 'now',     label: '🚦 التشغيل' },
  { key: 'money',   label: '💰 الفلوس' },
  { key: 'catalog', label: '🍽️ المطاعم' },
  { key: 'places',  label: '📍 الأماكن' },
  { key: 'people',  label: '👥 الناس' },
  { key: 'setup',   label: '⚙️ الإعدادات' },
]

const TABS: { key: Tab; label: string; group: TabGroup }[] = [
  { key: 'unassigned', label: 'طلبات غير معيّنة', group: 'now' },
  { key: 'active', label: 'توصيلات جارية', group: 'now' },
  { key: 'orders', label: 'كل الطلبات', group: 'now' },
  { key: 'complaints', label: 'الشكاوى', group: 'now' },

  { key: 'daily', label: '📊 تقرير اليوم', group: 'money' },
  { key: 'earnings', label: 'الأرباح', group: 'money' },
  { key: 'payouts', label: 'مدفوعات المندوبين', group: 'money' },
  { key: 'refunds', label: 'الاستردادات', group: 'money' },
  { key: 'wallet', label: 'محفظة العميل', group: 'money' },

  { key: 'menu', label: 'المطاعم والمنيو', group: 'catalog' },
  { key: 'banners', label: '📣 الإعلانات', group: 'catalog' },

  { key: 'compounds', label: 'الكومباوندات والتوصيل', group: 'places' },
  { key: 'coverage', label: 'مين بيوصّل لفين', group: 'places' },

  { key: 'drivers', label: 'إدارة المندوبين', group: 'people' },
  { key: 'shifts', label: 'الورديات', group: 'people' },
  { key: 'customers', label: 'العملاء', group: 'people' },
  { key: 'accounts', label: 'حسابات الدخول', group: 'people' },

  { key: 'settings', label: 'الإعدادات', group: 'setup' },
]

interface StalledOrder {
  id: number; status: string; vendor_name: string | null; compound_name: string | null
  customer_name: string; customer_phone: string; total: number
  payment_method: string | null; reference_at: string
  minutes_stalled: number; threshold_minutes: number
}

const ORDERS_LIMIT = 500
const LOAD_TIMEOUT_MS = 20000
const ACTIVE_ASSIGNMENT_STATUSES = ['Offered', 'Accepted', 'Picked_Up', 'Out_for_Delivery']

/**
 * Which CAIRO day a timestamp belongs to, as YYYY-MM-DD.
 *
 * 'en-CA' is the trick: it is the one common locale whose short date format is
 * already ISO order, so this needs no padding or reassembly. The timeZone is
 * the whole point -- an order placed at 01:30 Cairo is 22:30 UTC the previous
 * day, so keying on the raw date would file it under yesterday, and «النهاردة»
 * would quietly drop the small hours.
 */
const cairoDayKey = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })

/**
 * Move a YYYY-MM-DD key by whole days, in date space rather than by adding
 * 86400000ms. Egypt observes DST, so a 24-hour subtraction lands on the same
 * calendar day twice a year -- which would make «إمبارح» show today's orders on
 * exactly the day someone is most likely to be reconciling them.
 */
function shiftDayKey(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + delta)
  return dt.toISOString().slice(0, 10)
}

type OrderDateFilter = 'today' | 'yesterday' | 'older' | 'all'

export default function Admin() {
  const { confirmSheet, promptSheet, alertSheet, sheetElement } = useSheets()
  const [tab, setTab] = useState<Tab>('unassigned')
  const [openGroup, setOpenGroup] = useState<TabGroup>('now')
  // null = closed, undefined-id form = adding, populated = editing.
  const [driverForm, setDriverForm] = useState<ReturnType<typeof driverToForm> | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [earnings, setEarnings] = useState<Earning[]>([])
  const [assigning, setAssigning] = useState<Order | null>(null)
  // Closing must clear the refusal too. Only the backdrop did, so Escape, the
  // Android Back handler and the إلغاء button all left #41's «الطلب ده مع مندوب
  // بالفعل» sitting inside a freshly-opened dialog headed «طلب #58».
  const closeAssign = () => { setAssigning(null); setModalError('') }
  const assigningRef = useDismissable(closeAssign, !!assigning)
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [openRest, setOpenRest] = useState<number | null>(null)
  const [priceToolFor, setPriceToolFor] = useState<Restaurant | null>(null)
  const [bulkPricePercent, setBulkPricePercent] = useState('')
  const [bulkPriceCategories, setBulkPriceCategories] = useState<string[]>([])
  const [bulkPriceBusy, setBulkPriceBusy] = useState(false)
  const [addingItemFor, setAddingItemFor] = useState<Restaurant | null>(null)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
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
  const [pendingRefunds, setPendingRefunds] = useState<PendingRefund[]>([])
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
  // Items are NOT loaded with the 500-order window -- that would be thousands of
  // rows nobody reads. They are fetched once, on expand, and kept.
  const [orderItems, setOrderItems] = useState<Record<number, { name: string; qty: number; total: number; size_name: string | null; combo_name: string | null; addon_names: string[] | null }[]>>({})

  async function toggleOrderDetail(id: number) {
    const next = openHistory === id ? null : id
    setOpenHistory(next)
    if (next === null || orderItems[id]) return
    const { data, error } = await supabase.from('order_items')
      .select('name, qty, total, size_name, combo_name, addon_names').eq('order_id', id).order('id')
    // Caching [] on a failed read told the operator the order was empty -- in
    // the exact situation the panel exists for ("the customer says an item was
    // missing") -- and never retried, because the key was then present.
    if (error) { setActionError('مش قادرين نحمّل أصناف الطلب دلوقتي، اقفل وافتح تاني'); return }
    setOrderItems(prev => ({ ...prev, [id]: data ?? [] }))
  }
  const [vendorAccounts, setVendorAccounts] = useState<{ profile_id: string; restaurant_id: number; email: string }[]>([])
  const [driverAccounts, setDriverAccounts] = useState<{ profile_id: string; driver_id: number; email: string }[]>([])
  const [catalogAccounts, setCatalogAccounts] = useState<{ profile_id: string; name: string; email: string; role: 'catalog' | 'supervisor' }[]>([])
  const [newCatalogName, setNewCatalogName] = useState('')
  const [accountBusy, setAccountBusy] = useState<string | null>(null)
  const [newCreds, setNewCreds] = useState<{ email: string; password: string } | null>(null)
  const credsRef = useDismissable(() => setNewCreds(null), !!newCreds)
  // «اتنسخ ✓» flash on the creds-modal copy button; the 1.5s timeout resets it.
  const [credsCopied, setCredsCopied] = useState(false)
  const [rankDraft, setRankDraft] = useState<Record<number, string>>({})
  const [globalServiceFeeDraft, setGlobalServiceFeeDraft] = useState<string | null>(null)
  const [lastGlobalServiceFeePct, setLastGlobalServiceFeePct] = useState<number | null>(null)
  const [newRestaurant, setNewRestaurant] = useState({ name: '', description: '', category: '', vendor_type: 'restaurant', prep_minutes: '20' })
  const [showAddRestaurant, setShowAddRestaurant] = useState(false)
  const [uploadingImage, setUploadingImage] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [stalled, setStalled] = useState<StalledOrder[]>([])
  // Keyed by assignment_id. This ENRICHES the "توصيلات جارية" tab rather than
  // replacing its data source: `assignments` is still what the tab iterates, so
  // the grouping, the actions and the reassign modal are untouched and the two
  // lists cannot drift into disagreeing about which deliveries are in flight.
  // The RPC supplies only what PostgREST could not -- items, destination, and a
  // server-measured age for the driver's last fix.
  const [liveById, setLiveById] = useState<Record<number, LiveDelivery>>({})
  const [orderQuery, setOrderQuery] = useState('')
  const [orderSearchResults, setOrderSearchResults] = useState<Order[] | null>(null)
  const [orderSearching, setOrderSearching] = useState(false)
  const [orderStatusFilter, setOrderStatusFilter] = useState<'all' | OrderStatus>('all')
  // Opens on today, because that is what the board is for on any given shift.
  const [orderDateFilter, setOrderDateFilter] = useState<OrderDateFilter>('today')
  const [orderDateFrom, setOrderDateFrom] = useState('')
  const [orderDateTo, setOrderDateTo] = useState('')
  // «أقدم» goes to the SERVER rather than filtering the loaded window. The
  // window is ORDERS_LIMIT = 500 rows; today that is the entire history, so
  // filtering locally would look correct and stay correct right up until the
  // 501st order -- at which point a real day would report «مفيش طلبات» and say
  // nothing about only having looked at part of the history. That is the exact
  // false negative the search box was rewritten to eliminate; see the comment
  // on the search effect below. Today and yesterday stay local: they are always
  // inside the newest 500.
  // Test orders are hidden from every count and list by default. The chip still
  // shows how many exist -- hiding them silently would make a test that went
  // wrong look like an order that vanished.
  const [showTestOrders, setShowTestOrders] = useState(false)
  const [orderRangeResults, setOrderRangeResults] = useState<Order[] | null>(null)
  const [orderRangeLoading, setOrderRangeLoading] = useState(false)
  const [orderRangeFailed, setOrderRangeFailed] = useState(false)
  const [reassigning, setReassigning] = useState<Assignment | null>(null)
  const reassigningRef = useDismissable(() => setReassigning(null), !!reassigning)
  const [reassignBusy, setReassignBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  // actionError is set from ~40 call sites across this file, many of them
  // buttons far down a scrolled list (deleting a menu item, editing a
  // compound fee near the bottom of settings). The banner itself renders
  // fixed at the very top of the page, above both tab rows, so a failure
  // fired from deep in the page previously updated state entirely off-screen
  // -- no visible feedback at the point of the tap, easy to miss.
  const actionErrorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (actionError) actionErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [actionError])
  // Rendered INSIDE the reassign modal. The page-level banner sits at the very
  // top behind a fixed inset-0 overlay, so a failed reassign produced no visible
  // feedback at all while the modal stayed open -- the operator just kept tapping.
  const [modalError, setModalError] = useState('')
  const inFlightRef = useRef<Promise<void> | null>(null)
  const [syncFailed, setSyncFailed] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // `refreshing` only covers manualRefresh() -- the initial mount fetch (~20
  // queries, up to LOAD_TIMEOUT_MS) sets no loading flag at all, so the page
  // rendered its full layout against empty arrays and looked blank until data
  // arrived. This tracks that first fetch specifically, for a skeleton instead.
  const [firstLoad, setFirstLoad] = useState(true)

  // A plain `if (inFlight) return` guard makes every post-mutation refresh a
  // silent no-op whenever the poll happens to be running -- and this page fires
  // ~20 queries per cycle, so on mobile data that is most of the time. The
  // consequence here is duplicate writes: add a menu item, the list does not
  // change, add it again, two live items at whatever price was typed second.
  // Callers that just mutated something pass force.
  async function load(force = false): Promise<void> {
    if (inFlightRef.current) {
      if (!force) return inFlightRef.current
      await inFlightRef.current.catch(() => {})
    }
    const p = runLoad().finally(() => { if (inFlightRef.current === p) inFlightRef.current = null })
    inFlightRef.current = p
    return p
  }

  async function runLoad() {
    try {
      // supabase-js has no timeout. Without a ceiling, one hung request pins the
      // in-flight ref forever: every later load(true) waits on a dead promise, no
      // setState runs, nothing re-renders, and the board freezes on an old
      // snapshot while still looking authoritative.
      const withTimeout = <T,>(q: PromiseLike<T>): Promise<T | { data: null; error: Error }> =>
        Promise.race([
          Promise.resolve(q),
          new Promise<{ data: null; error: Error }>(res =>
            setTimeout(() => res({ data: null, error: new Error('timeout') }), LOAD_TIMEOUT_MS)),
        ]) as Promise<T | { data: null; error: Error }>

      // Capping a query and then filtering it in the client is not the same as
      // filtering server-side: `.limit(300)` on driver_earnings meant "the 300
      // most recent deliveries platform-wide", so a driver whose unpaid rows
      // fell outside that window showed 0 EGP owed with the pay button greyed
      // out -- and if some fell inside, the confirm dialog quoted a smaller
      // number than settle_driver_earnings would actually settle. Every
      // operationally-important set is now filtered on the server and left
      // uncapped; the caps only ever apply to display-only history.
      const [
        openO, refundO, recentO, activeA, recentA, d, unpaidE, recentE, r, m, st, sh, esc, sl,
        openComp, recentComp, sr, cpd, cov, lr, wt, stalled, refunds, rel, liveD,
      ] = await Promise.all([
        // "Operationally live" is NOT the same as "not terminal in the order
        // lifecycle": Failed_Delivery is retryable and must stay loaded so it
        // can be re-dispatched, and awaiting_payment is needed for the InstaPay
        // banner. Only Delivered and Cancelled are truly done with.
        withTimeout(supabase.from('orders').select('*, restaurants(name)')
          .not('status', 'in', '("Delivered","Cancelled")')
          .order('id', { ascending: false })),
        withTimeout(supabase.from('orders').select('*, restaurants(name)')
          .eq('refund_status', 'pending').order('id', { ascending: false })),
        withTimeout(supabase.from('orders').select('*, restaurants(name)')
          .order('id', { ascending: false }).limit(ORDERS_LIMIT)),
        withTimeout(supabase.from('delivery_assignments').select('*, orders(*, restaurants(name)), drivers(*)')
          .in('status', ACTIVE_ASSIGNMENT_STATUSES).order('id', { ascending: false })),
        withTimeout(supabase.from('delivery_assignments').select('*, orders(*, restaurants(name)), drivers(*)')
          .order('id', { ascending: false }).limit(400)),
        withTimeout(supabase.from('drivers').select('*').order('id')),
        withTimeout(supabase.from('driver_earnings').select('*, drivers(name)')
          .eq('paid', false).order('id', { ascending: false })),
        withTimeout(supabase.from('driver_earnings').select('*, drivers(name)')
          .order('id', { ascending: false }).limit(300)),
        withTimeout(supabase.from('restaurants').select('*').order('id')),
        withTimeout(supabase.from('menu_items').select('*').order('id')),
        withTimeout(supabase.from('settings').select('*').order('key')),
        withTimeout(supabase.from('shifts').select('*').order('shift_date', { ascending: false }).limit(40)),
        withTimeout(supabase.from('shift_swap_requests').select('*, shifts(*), requester:drivers!shift_swap_requests_requested_by_fkey(name)')
          .eq('status', 'escalated').order('escalated_at', { ascending: false })),
        withTimeout(supabase.from('delivery_slots').select('*').order('restaurant_id').order('start_time')),
        withTimeout(supabase.from('complaints').select('*, orders(customer_name, customer_phone, restaurants(name)), drivers(name)')
          .neq('status', 'resolved').order('id', { ascending: false })),
        withTimeout(supabase.from('complaints').select('*, orders(customer_name, customer_phone, restaurants(name)), drivers(name)')
          .eq('status', 'resolved').order('id', { ascending: false }).limit(100)),
        withTimeout(supabase.from('settlement_requests').select('*, drivers(name)').eq('status', 'pending').order('id', { ascending: false })),
        withTimeout(supabase.from('compounds').select('*').eq('active', true).order('direction').order('distance_km')),
        withTimeout(supabase.from('vendor_coverage').select('*')),
        withTimeout(supabase.from('order_ratings').select('*, orders(customer_name, customer_phone, restaurants(name))')
          .or('driver_rating.lte.2,restaurant_rating.lte.2').order('id', { ascending: false }).limit(30)),
        withTimeout(supabase.from('wallet_transactions').select('order_id').not('order_id', 'is', null).ilike('reason', 'تعويض%')),
        withTimeout(toDataError(adminReport<StalledOrder[]>('stalledOrders'))),
        withTimeout(toDataError(adminReport<PendingRefund[]>('pendingRefunds'))),
        // Was an N+1: restaurant_reliability() once per restaurant, sequentially
        // awaited, inside the same 15s cycle.
        withTimeout(toDataError(catalogCheck<Record<string, Reliability>>('restaurantsReliabilityAll'))),
        withTimeout(toDataError(adminReport<LiveDelivery[]>('liveDeliveries'))),
      ])

      const byId = <T extends { id: number }>(...lists: (T[] | null | undefined)[]): T[] => {
        const seen = new Map<number, T>()
        for (const list of lists) for (const row of list ?? []) if (!seen.has(row.id)) seen.set(row.id, row)
        return [...seen.values()].sort((a, b) => b.id - a.id)
      }

      const coreFailed = !!(openO.error || activeA.error || d.error || unpaidE.error)

      if (!openO.error && !refundO.error && !recentO.error) {
        setOrders(byId(openO.data as Order[], refundO.data as Order[], recentO.data as Order[]))
      }
      if (!activeA.error && !recentA.error) {
        setAssignments(byId(activeA.data as Assignment[], recentA.data as Assignment[]))
      }
      if (!d.error) setDrivers(d.data ?? [])
      if (!unpaidE.error && !recentE.error) {
        setEarnings(byId(unpaidE.data as Earning[], recentE.data as Earning[]))
      }
      if (!r.error) setRestaurants(r.data ?? [])
      if (!m.error) setMenu(m.data ?? [])
      if (!st.error) setSettings(st.data ?? [])
      if (!sh.error) setShifts(sh.data ?? [])
      if (!esc.error) setEscalations(esc.data ?? [])
      if (!sl.error) setSlots(sl.data ?? [])
      if (!openComp.error && !recentComp.error) {
        setComplaints(byId(openComp.data as Complaint[], recentComp.data as Complaint[]))
      }
      if (!sr.error) setSettlementRequests(sr.data ?? [])
      if (!cpd.error) setCompounds(cpd.data ?? [])
      if (!cov.error) setCoverage(cov.data ?? [])
      if (!lr.error) setLowRatings(lr.data ?? [])
      if (!wt.error) setCompensatedOrderIds(new Set((wt.data ?? []).map((t: any) => t.order_id)))
      if (!stalled.error) setStalled((stalled.data as StalledOrder[]) ?? [])
      if (!refunds.error) setPendingRefunds((refunds.data as PendingRefund[]) ?? [])
      if (!rel.error) setReliability((rel.data as Record<number, Reliability>) ?? {})
      // Deliberately NOT part of coreFailed. If this one query fails the board
      // still lists every live delivery and every action still works -- only the
      // items and the map go missing. Failing the whole load over it would take
      // dispatch offline to protect a detail panel.
      if (!liveD.error) {
        const next: Record<number, LiveDelivery> = {}
        for (const row of ((liveD.data as LiveDelivery[]) ?? [])) next[row.assignment_id] = row
        setLiveById(next)
      }

      const accountsRes = await adminReport<{
        vendors: { profile_id: string; restaurant_id: number; email: string }[]
        drivers: { profile_id: string; driver_id: number; email: string }[]
        catalog: { profile_id: string; name: string; email: string; role: 'catalog' | 'supervisor' }[]
      }>('listAccounts')
      if (accountsRes.ok) {
        setVendorAccounts(accountsRes.data?.vendors ?? [])
        setDriverAccounts(accountsRes.data?.drivers ?? [])
        setCatalogAccounts(accountsRes.data?.catalog ?? [])
      }

      setSyncFailed(coreFailed)
      if (!coreFailed) setLastSyncAt(Date.now())

      ping('escalated_shifts', (esc.data ?? []).length, 'مندوب محتاج بديل', 'في وردية اتصعّدت للإدارة')
      ping('complaints', (openComp.data ?? []).filter((c: Complaint) => c.status === 'open').length, 'شكوى جديدة', 'في عميل بلّغ عن مشكلة')
      ping('settlement_requests', (sr.data ?? []).length, 'طلب تسوية مبكرة', 'مندوب طالب تسوية قبل ميعاده')
      ping('stalled', ((stalled.data as StalledOrder[]) ?? []).length, 'طلب واقف', 'في طلب عدّى الوقت المسموح ومحدش حركه')
    } catch {
      setSyncFailed(true)
    }
  }

  // Filtering the loaded window client-side made the search box a confident
  // false negative: a customer calls about Wednesday's order, 500 orders have
  // been placed since, and the screen says "مفيش طلبات بالبحث ده". Search the
  // server instead so history-wide really means history-wide.
  useEffect(() => {
    const raw = orderQuery.trim()
    if (raw.length < 2) { setOrderSearchResults(null); setOrderSearching(false); return }
    const q = raw.startsWith('#') ? raw.slice(1) : raw
    let cancelled = false
    setOrderSearching(true)
    const t = setTimeout(async () => {
      const filters = [
        `customer_name.ilike.%${q}%`,
        `customer_phone.ilike.%${q}%`,
        `zone.ilike.%${q}%`,
        `unit_number.ilike.%${q}%`,
      ]
      if (/^[0-9]+$/.test(q)) filters.unshift(`id.eq.${q}`)
      const { data, error } = await supabase.from('orders').select('*, restaurants(name)')
        .or(filters.join(',')).order('id', { ascending: false }).limit(200)
      if (cancelled) return
      setOrderSearching(false)
      // On failure fall back to the local window rather than claiming no results.
      setOrderSearchResults(error ? null : ((data as Order[]) ?? []))
    }, 400)
    return () => { cancelled = true; clearTimeout(t) }
  }, [orderQuery])

  // The «أقدم» range, fetched from the server for the reason above.
  //
  // The query bounds are deliberately loose -- one day either side, in plain
  // UTC -- and the exact day matching is done below with cairoDayKey. Computing
  // a true Cairo midnight as an instant means knowing whether DST was in effect
  // on that date, and getting that subtly wrong would silently shift a day's
  // orders by an hour. Over-fetching two days and filtering precisely is both
  // simpler and correct.
  useEffect(() => {
    if (orderDateFilter !== 'older' || !orderDateFrom) { setOrderRangeLoading(false); return }
    const to = orderDateTo || orderDateFrom
    let cancelled = false
    setOrderRangeLoading(true); setOrderRangeFailed(false)
    const t = setTimeout(async () => {
      const { data, error } = await supabase.from('orders').select('*, restaurants(name)')
        .gte('created_at', `${shiftDayKey(orderDateFrom, -1)}T00:00:00Z`)
        .lt('created_at', `${shiftDayKey(to, 2)}T00:00:00Z`)
        .order('id', { ascending: false }).limit(ORDERS_LIMIT)
      if (cancelled) return
      setOrderRangeLoading(false)
      // Say it failed. Falling back to the loaded window here would reproduce
      // the false negative this whole path exists to avoid.
      if (error) { setOrderRangeFailed(true); setOrderRangeResults(null); return }
      setOrderRangeResults((data as Order[]) ?? [])
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [orderDateFilter, orderDateFrom, orderDateTo])

  useEffect(() => {
    registerPush(persistPushToken)
    load().finally(() => setFirstLoad(false))
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  // The normal 15s board refresh remains the fallback. Realtime makes a menu
  // or restaurant edit made by a vendor visible to the admin immediately.
  useCatalogSync({ refresh: () => load(true), fallbackIntervalMs: 60_000 })

  const escalateAfter = Number(settings.find(s => s.key === 'escalate_after_minutes')?.value ?? 15)
  const isLate = (o: Order) => {
    const from = o.dispatch_at ? +new Date(o.dispatch_at) : +new Date(o.created_at)
    return (Date.now() - from) / 60000 > escalateAfter
  }
  const isCooking = (o: Order) => !!o.dispatch_at && +new Date(o.dispatch_at) > Date.now()
  const minsUntilDispatch = (o: Order) =>
    o.dispatch_at ? Math.max(0, Math.round((+new Date(o.dispatch_at) - Date.now()) / 60000)) : 0

  const activeStatuses = ACTIVE_ASSIGNMENT_STATUSES
  const assignedOrderIds = new Set(assignments.filter(a => activeStatuses.includes(a.status) || a.status === 'Delivered').map(a => a.order_id))
  // Previously only Delivered/Cancelled were excluded, so an InstaPay order the
  // customer had NOT paid for appeared here and could be dispatched to a driver
  // -- while simultaneously sitting in the "بانتظار التأكيد" banner awaiting
  // payment confirmation. Failed_Delivery silently re-entered the queue too.
  const undispatchable = new Set<string>([...CLOSED_ORDER_STATUSES, ...UNPAID_ORDER_STATUSES])
  const unassigned = orders
    .filter(o => !undispatchable.has(o.status) && !assignedOrderIds.has(o.id))
    .sort((a, b) => Number(isCooking(a)) - Number(isCooking(b)))
  const active = assignments.filter(a => activeStatuses.includes(a.status))
  const noAnswerReports = assignments.filter(a => a.no_answer_reported_at && !a.no_answer_admin_action)
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
  // The reassign modal used raw availableDrivers, so it offered motorcycle
  // riders for a large supermarket order that the assign modal for the very
  // same order would have restricted to vans -- with no notice either.
  const reassignNeedsVan = (() => {
    const o = reassigning?.orders
    if (!o) return false
    const r = restaurants.find(x => x.id === o.restaurant_id)
    if (r?.vendor_type !== 'supermarket') return false
    return o.pricing_status === 'pending_quote' || o.subtotal >= vanRequiredSubtotal
  })()
  const reassignCandidates = (reassignNeedsVan
    ? availableDrivers.filter(d => d.vehicle_type === 'van')
    : availableDrivers).filter(d => d.id !== reassigning?.driver_id)
  // Anything can call setTab -- the wallet button on an order row, a banner
  // action -- and that tab may live under a group that is not open, which would
  // render a body with no matching chip. The group follows the tab, never the
  // other way round.
  useEffect(() => {
    const g = TABS.find(t => t.key === tab)?.group
    if (g) setOpenGroup(g)
  }, [tab])

  // What each tab is asking for. One place, so the group chip and the tab agree
  // by construction rather than by two people remembering to update both.
  const tabBadges: Partial<Record<Tab, number>> = {
    unassigned: unassigned.length,
    active: noAnswerReports.length,
    refunds: pendingRefunds.length,
    complaints: complaints.filter(c => c.status !== 'resolved').length,
    payouts: settlementRequests.length,
    shifts: escalations.length,
  }

  useEffect(() => { ping('unassigned_late', unassigned.filter(isLate).length, 'طلب متأخر', 'في طلب محدش استلمه من زمان') },
    [unassigned.filter(isLate).length])
  useEffect(() => { ping('no_answer', noAnswerReports.length, 'عميل ما ردش', 'مندوب اتصل بعميل ومردش، محتاج قرارك') },
    [noAnswerReports.length])

  // admin_assign_order can refuse for TEN distinct reasons. This handled one of
  // them and answered «حصل خطأ، جرب تاني» to the other nine -- so an order that
  // had been round the houses five times, or a driver who had already declined
  // that exact order, both read as a broken button. The system was working and
  // refusing to say so, which is worse than a bug: it sends you back to tap
  // again, which is how order #41 reached attempt number 8.
  async function assign(order: Order, driver: Driver) {
    setModalError('')
    const res = await dispatchOperation('assign', { orderId: order.id, driverId: driver.id }, {
      dispatch_rule_blocked: 'المندوب ده وصل للحد الأقصى (٣ طلبات) أو شغال في اتجاه مختلف',
      driver_already_declined: `${driver.name} رفض الطلب ده قبل كده — اختار مندوب تاني`,
      too_many_attempts: 'الطلب ده اتعرض على مندوبين ٥ مرات. ده مشكلة توزيع مش مشكلة إعادة محاولة — كلّم مندوب بنفسك أو الغِ الطلب',
      already_assigned: 'الطلب ده مع مندوب بالفعل — حدّث الصفحة',
      order_closed: 'الطلب ده اتقفل خلاص (اتسلّم أو اتلغى)',
      order_not_paid: 'الطلب لسه مادفعش — أكّد الدفع الأول',
      order_not_priced: 'الطلب لسه مسعّرش — حط السعر الأول',
      driver_suspended: 'حساب المندوب ده موقوف',
      driver_not_found: 'المندوب ده مش موجود — حدّث الصفحة',
      order_not_found: 'الطلب ده مش موجود — حدّث الصفحة',
      admin_only: 'مش من صلاحياتك تعيّن مندوب للطلب ده',
    })
    if (!res.ok) { setModalError(res.error); return }
    setAssigning(null); setModalError(''); load(true)
  }

  // Bulk import is the only way a driver record is created, and it parses
  // "الاسم, رقم, النوع" out of a textarea -- so a typo, a swapped column or a
  // driver who simply goes by another name was permanent. The RLS policy
  // "admin manages drivers" already allows an admin UPDATE on this table; only
  // the field was missing.
  async function editDriverDetails(d: Driver) {
    const name = await promptSheet({ title: 'اسم المندوب', initial: d.name ?? '' })
    if (name === null) return
    if (!name.trim()) { setActionError('الاسم ماينفعش يكون فاضي'); return }

    const phone = await promptSheet({ title: 'رقم موبايل المندوب', initial: d.phone ?? '', inputMode: 'tel', dir: 'ltr' })
    if (phone === null) return
    if (!isValidEgyptPhone(phone)) { setActionError(PHONE_HINT); return }

    const patch: Record<string, unknown> = {}
    if (name.trim() !== (d.name ?? '')) patch.name = name.trim()
    if (phone.trim() !== (d.phone ?? '')) patch.phone = phone.trim()
    if (Object.keys(patch).length === 0) { setActionError(''); return }

    const { error } = await supabase.from('drivers').update(patch).eq('id', d.id)
    if (error) { setActionError('مش قادرين نحفظ بيانات المندوب دلوقتي'); return }
    // create_driver_login copies the driver's name onto their profile, so a
    // rename here would otherwise leave the two disagreeing forever.
    if (patch.name) await supabase.from('profiles').update({ name: patch.name }).eq('driver_id', d.id)
    setActionError('')
    load(true)
  }


  // Driver accounts are bound to one phone (first phone wins). This is the ONLY
  // way out of that binding, so it has to be here, obvious, and one tap -- a
  // driver who buys a new phone or clears their browser cannot work until it
  // is pressed. Confirmed rather than instant, because pressing it on the wrong
  // row frees the account to be claimed by whichever phone opens it next.
  async function resetDriverDevice(d: Driver) {
    const bound = d.device_label
    if (!await confirmSheet({
      title: `فك ربط الجهاز عن ${d.name}؟`,
      body: <>{bound ? `الجهاز الحالي: ${bound}` : 'مفيش جهاز مربوط دلوقتي'}<br /><br />أول موبايل يفتح حسابه بعد كده هيتربط بيه.</>,
    })) return
    const res = await adminAccountDriverAction('resetDriverDevice', { driverId: d.id })
    if (!res.ok) { await alertSheet(res.error); return }
    load()
  }

  async function editInstapay(d: Driver) {
    const value = await promptSheet({
      title: 'رقم إنستاباي بتاع المندوب',
      body: 'اسيبه فاضي لو زي رقم الموبايل',
      initial: d.instapay_number ?? '', inputMode: 'tel', dir: 'ltr',
    })
    if (value === null) return
    const { error } = await supabase.from('drivers').update({ instapay_number: value.trim() || null }).eq('id', d.id)
    if (error) { await alertSheet('حصل خطأ، جرب تاني'); return }
    load(true)
  }

  async function toggleDriver(d: Driver, field: 'active' | 'available') {
    const patch: Record<string, unknown> = { [field]: !d[field] }
    if (field === 'active' && d.active) patch.status = 'Suspended'
    if (field === 'active' && !d.active) patch.status = 'Available'
    const { error } = await supabase.from('drivers').update(patch).eq('id', d.id)
    if (error) { setActionError('مش قادرين نحدّث المندوب دلوقتي'); return }
    setActionError('')
    load(true)
  }

  async function updatePrice(it: MenuItem, price: number) {
    if (!price || price === it.price) return
    const { error } = await supabase.from('menu_items').update({ price }).eq('id', it.id)
    if (error) { setActionError('السعر ماتحفظش — جرب تاني'); return }
    setActionError('')
    load(true)
  }

  async function toggleItem(it: MenuItem) {
    const { error } = await supabase.from('menu_items').update({ available: !it.available }).eq('id', it.id)
    if (error) { setActionError('مش قادرين نغيّر التوفر دلوقتي'); return }
    setActionError('')
    load(true)
  }

  // Open/closed for every vendor, computed by the SAME database function that
  // gates ordering. Recomputing it here from vendor_hours would mean the admin
  // badge and the customer's card could disagree about whether a shop is open,
  // which is the one thing this screen must never do.
  const [openStates, setOpenStates] = useState<Record<number, {
    is_open: boolean; next_open_at: string | null; closed_until: string | null; has_hours: boolean
  }>>({})

  async function loadOpenStates() {
    const res = await staffOperation<{ id: number }[]>('vendorOpenStates')
    if (!res.ok) return   // keep the last known states rather than blanking the row
    const map: typeof openStates = {}
    for (const s of res.data ?? []) map[s.id] = s as never
    setOpenStates(map)
  }
  useEffect(() => { loadOpenStates() }, [])

  // Closing from here is a TEMPORARY close: it sets closed_until to the next
  // scheduled opening rather than flipping a permanent flag. A flag needs a
  // human to undo it, and the proof humans do not is that all twelve vendors
  // sat closed until today.
  async function toggleRestaurant(r: Restaurant) {
    const st = openStates[r.id]
    const open = !(st?.is_open ?? true)
    const patch = open
      ? { closed_until: null, is_open: true }
      : { closed_until: st?.next_open_at ?? endOfCairoDayIso(), is_open: false }
    const { error } = await supabase.from('restaurants').update(patch).eq('id', r.id)
    if (error) { setActionError('مش قادرين نفتح/نقفل المطعم دلوقتي'); return }
    setActionError('')
    loadOpenStates()
    load(true)
  }

  /** Midnight tonight, Cairo. The fallback expiry when a vendor has no hours,
   *  matching vendor_set_open()'s own fallback. Offset is derived, never
   *  hardcoded -- Egypt observes DST and a fixed +02:00 is an hour wrong all
   *  summer. */
  function endOfCairoDayIso(): string {
    const now = new Date()
    const day = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })
    const [y, m, d] = day.split('-').map(Number)
    const offset = new Date(now.toLocaleString('sv-SE', { timeZone: 'Africa/Cairo' }) + 'Z').getTime() - now.getTime()
    return new Date(Date.UTC(y, m - 1, d + 1, 0, 0) - offset).toISOString()
  }

  async function reassignShift(shiftId: number, driverId: number, requestId: number) {
    const { error: e1 } = await supabase.from('shifts').update({ driver_id: driverId, status: 'swapped' }).eq('id', shiftId)
    if (e1) { setActionError('مش قادرين نغيّر مندوب الوردية دلوقتي'); return }
    const { error: e2 } = await supabase.from('shift_swap_requests').update({ status: 'accepted', accepted_by: driverId, accepted_at: new Date().toISOString() }).eq('id', requestId)
    if (e2) {
      // Write #1 already committed, so the screen MUST refresh -- leaving the
      // picker open over stale data invited a second reassignment to a
      // different driver.
      setActionError('الوردية اتغيّرت بس طلب الاستبدال لسه مفتوح — راجعه')
      setReassignFor(null); load(true); return
    }
    setReassignFor(null)
    load(true)
  }

  async function addSlot(restaurantId: number) {
    const { error } = await supabase.from('delivery_slots').insert({
      restaurant_id: restaurantId, start_time: newSlot.start_time,
      end_time: newSlot.end_time, capacity: Number(newSlot.capacity)
    })
    // Cleared the form and reloaded whether or not the row existed, so a failed
    // insert was indistinguishable from a stale list.
    if (error) { setActionError(`إضافة الفترة فشلت — ${error.message}`); return }
    setActionError('')
    setNewSlot({ start_time: '', end_time: '', capacity: '6' })
    load(true)
  }

  async function toggleSlot(slot: DeliverySlotRow) {
    const { error } = await supabase.from('delivery_slots').update({ active: !slot.active }).eq('id', slot.id)
    if (error) { setActionError('مش قادرين نغيّر الفترة دلوقتي'); return }
    setActionError('')
    load(true)
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
    load(true)
  }

  async function addShift() {
    const { error } = await supabase.from('shifts').insert({
      driver_id: Number(newShift.driver_id), shift_date: newShift.shift_date,
      start_time: newShift.start_time, end_time: newShift.end_time
    })
    if (error) { setActionError(`إضافة الوردية فشلت — ${error.message}`); return }
    setActionError('')
    setNewShift({ driver_id: '', shift_date: '', start_time: '', end_time: '' })
    load(true)
  }

  async function updateRestaurant(r: Restaurant, patch: Record<string, unknown>) {
    const { error } = await supabase.from('restaurants').update(patch).eq('id', r.id)
    if (error) { setActionError('مش قادرين نحفظ بيانات المطعم دلوقتي'); return }
    setActionError('')
    load(true)
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
      // new guards in the edge function
      cannot_target_self: 'مينفعش تعمل كده على حسابك إنت',
      target_not_staff: 'العملية دي للمطاعم والمندوبين بس',
      profile_not_found: 'الحساب ده مش موجود',
      password_too_short: 'كلمة السر لازم تكون 8 حروف أو أكتر',
      rate_limited: 'حاولت كتير في وقت قصير، استنى شوية',
      rate_limit_check_failed: 'حصل خطأ مؤقت، جرب تاني',
      profile_id_required: 'محتاج تحدد الحساب',
      restaurant_id_required: 'محتاج تحدد المطعم',
      driver_id_required: 'محتاج تحدد المندوب',
      invalid_json: 'حصل خطأ في إرسال البيانات',
      method_not_allowed: 'حصل خطأ غير متوقع',
      internal_error: 'حصل خطأ في السيرفر، جرب تاني',
    }
    // Anything still unmapped is an English snake_case code, which is worse than
    // useless in an RTL Arabic dialog -- log it and show something readable.
    if (!labels[code]) console.warn('[admin-accounts] unmapped error code:', code)
    return labels[code] ?? 'حصل خطأ، جرب تاني'
  }

  async function createVendorLogin(restaurantId: number) {
    setAccountBusy(`vendor-${restaurantId}`)
    const result = await callAccountsFn({ action: 'create_vendor_login', restaurant_id: restaurantId })
    setAccountBusy(null)
    if (result.error) { await alertSheet('حصل خطأ: ' + result.error); return }
    setNewCreds({ email: result.email, password: result.password })
    load(true)
  }

  async function createDriverLogin(driverId: number) {
    setAccountBusy(`driver-${driverId}`)
    const result = await callAccountsFn({ action: 'create_driver_login', driver_id: driverId })
    setAccountBusy(null)
    if (result.error) { await alertSheet('حصل خطأ: ' + result.error); return }
    setNewCreds({ email: result.email, password: result.password })
    load(true)
  }

  async function createCatalogLogin() {
    const name = newCatalogName.trim()
    if (!name) return
    setAccountBusy('catalog-new')
    const result = await callAccountsFn({ action: 'create_catalog_login', name })
    setAccountBusy(null)
    if (result.error) { await alertSheet('حصل خطأ: ' + result.error); return }
    setNewCatalogName('')
    setNewCreds({ email: result.email, password: result.password })
    // force: this branch was written against the old load() that took no
    // arguments. Merged onto the in-flight guard, a bare load() is a no-op
    // whenever the poll is running, so the new account would not appear and
    // the operator would create a second one.
    load(true)
  }

  // Moved off the admin-accounts edge function onto admin_delete_staff().
  // That function's assertTargetIsStaff permits vendor, driver and catalog only,
  // so a supervisor account could be created from this very screen and then
  // never removed -- and redeploying 15KB of live authentication code to add one
  // string is a worse risk than the bug. The RPC also refuses to delete an admin
  // or the caller themself, and refuses a driver still holding cash or mid-
  // delivery, none of which the edge function checked.
  async function removeLogin(profileId: string) {
    if (!await confirmSheet({
      title: 'تأكيد إلغاء الحساب؟',
      body: <>مش هيقدر يدخل تاني.<br /><br />سجل الطلبات والأرباح هيفضل زي ما هو.</>,
      danger: true,
    })) return
    setAccountBusy(profileId)
    const res = await adminAccountDriverAction('deleteStaff', { profileId }, {
      cannot_delete_self: 'مينفعش تلغي حسابك انت',
      cannot_delete_admin: 'مينفعش تلغي حساب إدارة من هنا',
      driver_has_live_delivery: 'المندوب ده معاه طلب شغال دلوقتي — سيبه يخلّصه أو اسحب الطلب منه الأول',
      profile_not_found: 'الحساب ده مش موجود — حدّث الصفحة',
      admin_only: 'مش من صلاحياتك',
    })
    setAccountBusy(null)
    if (!res.ok) {
      // actionError renders at the very top of the page, above both tab rows,
      // while the accounts list is hundreds of pixels down -- so a refusal here
      // was invisible and the operator just tapped again. This one keeps the
      // blocking dialog on purpose.
      if (res.code === 'driver_holds_cash') {
        if (!await confirmSheet({
          title: 'المندوب ده لسه ماسك كاش على عهدته',
          body: 'لو ألغيت الحساب مش هتقدر تسوّي الكاش من الشاشة دي بعد كده. متأكد؟',
          danger: true,
        })) return
        setAccountBusy(profileId)
        const forced = await adminAccountDriverAction('deleteStaff', { profileId, force: true })
        setAccountBusy(null)
        if (!forced.ok) { setActionError(forced.error); return }
        setActionError(''); load(true)
        return
      }
      setActionError(res.error); return
    }
    setActionError('')
    load(true)
  }

  async function resetPassword(profileId: string) {
    setAccountBusy(profileId)
    const result = await callAccountsFn({ action: 'reset_password', profile_id: profileId })
    setAccountBusy(null)
    if (result.error) { await alertSheet('حصل خطأ: ' + result.error); return }
    setNewCreds({ email: '(نفس الإيميل)', password: result.password })
  }

  async function setCustomPassword(profileId: string) {
    const pw = await promptSheet({
      title: 'كلمة سر مخصصة',
      placeholder: '٨ حروف على الأقل',
      dir: 'ltr',
      validate: v => v.length >= 8 ? null : 'لازم ٨ حروف على الأقل',
    })
    if (!pw) return
    setAccountBusy(profileId)
    const result = await callAccountsFn({ action: 'reset_password', profile_id: profileId, custom_password: pw })
    setAccountBusy(null)
    if (result.error) { await alertSheet('حصل خطأ: ' + result.error); return }
    await alertSheet(<>تم تغيير كلمة السر — <bdi dir="ltr" className="font-mono">{pw}</bdi></>)
  }

  async function changeEmail(profileId: string, currentEmail: string) {
    const newEmail = await promptSheet({ title: 'الإيميل الجديد', initial: currentEmail, dir: 'ltr', inputMode: 'text' })
    if (!newEmail || newEmail.trim() === currentEmail) return
    setAccountBusy(profileId)
    const result = await callAccountsFn({ action: 'update_email', profile_id: profileId, new_email: newEmail.trim() })
    setAccountBusy(null)
    if (result.error) { await alertSheet('حصل خطأ: ' + result.error); return }
    await alertSheet('تم تغيير الإيميل')
    load(true)
  }

  async function uploadLogo(r: Restaurant, file: File) {
    setUploadingImage(`r${r.id}`); setImageError(null)
    const { url, error } = await uploadVendorImage(file, `restaurants/${r.id}/logo`)
    setUploadingImage(null)
    if (error) { setImageError(error); return }
    const { error: linkError } = await supabase.from('restaurants').update({ logo_url: url }).eq('id', r.id)
    if (linkError) { setActionError('الصورة اترفعت بس ماتربطتش بالمطعم — جرب تاني'); return }
    setActionError('')
    load(true)
  }

  // The COVER photo, which is a different picture doing a different job from
  // the logo. The home card now leads with a photograph, and until this existed
  // that photograph was picked automatically from the menu -- best-ranked
  // photographed item -- which is a guess. On live data the guess gave أرابياتا
  // a plain foul sandwich as its shopfront. This is the override.
  async function uploadCover(r: Restaurant, file: File) {
    setUploadingImage(`cover${r.id}`); setImageError(null)
    const { url, error } = await uploadVendorImage(file, `restaurants/${r.id}/cover`)
    setUploadingImage(null)
    if (error) { setImageError(error); return }
    const { error: linkError } = await supabase.from('restaurants').update({ cover_image_url: url }).eq('id', r.id)
    if (linkError) { setActionError('الصورة اترفعت بس ماتربطتش بالمطعم — جرب تاني'); return }
    setActionError('')
    load(true)
  }

  /**
   * Goes through an RPC rather than a direct table update, unlike the image
   * fields beside it. Placement is a commercial lever -- it decides which vendor
   * gets the top of the home screen -- so it gets an is_admin() gate in the
   * database rather than relying on the RLS policy that happens to allow the
   * update today.
   */
  /**
   * One writer for both controls, always sending the rank currently in the box.
   *
   * `<input type="number">` yields '' for anything it cannot parse, so «1e»
   * used to arrive as null and CLEAR the rank rather than be rejected. The
   * draft is a string and is validated as one.
   */
  async function commitRank(r: Restaurant, featured: boolean | null = null) {
    const raw = (rankDraft[r.id] ?? (r.display_order == null ? '' : String(r.display_order))).trim()
    let order: number | null
    if (raw === '') {
      order = null
    } else if (!/^\d+$/.test(raw) || Number(raw) < 1) {
      setActionError('المركز لازم يكون رقم صحيح ١ أو أكبر')
      setRankDraft(d => ({ ...d, [r.id]: r.display_order == null ? '' : String(r.display_order) }))
      return
    } else {
      order = Number(raw)
    }
    if (order === (r.display_order ?? null) && featured === null) return

    const res = await adminCatalogAction('setRestaurantRank', {
      restaurantId: r.id, displayOrder: order, featured,
    }, { rank_must_be_positive: 'المركز لازم يكون ١ أو أكبر' })
    if (!res.ok) { setActionError(res.error); return }
    setRankDraft(d => { const n = { ...d }; delete n[r.id]; return n })
    load(true)
  }

  function openPriceTool(r: Restaurant) {
    const categories = [...new Set(menu.filter(i => i.restaurant_id === r.id).map(i => i.category).filter(Boolean))]
    setPriceToolFor(r)
    setBulkPricePercent('')
    setBulkPriceCategories(categories)
  }

  async function applyBulkPriceChange() {
    const r = priceToolFor
    if (!r) return
    const allCategories = [...new Set(menu.filter(i => i.restaurant_id === r.id).map(i => i.category).filter(Boolean))]
    const percent = Number(bulkPricePercent)
    if (!/^[-+]?\d+(\.\d+)?$/.test(bulkPricePercent.trim()) || percent < -50 || percent > 100 || percent === 0) {
      setActionError('اكتب نسبة بين −٥٠٪ و١٠٠٪، ومش صفر')
      return
    }
    if (bulkPriceCategories.length === 0) { setActionError('اختار قسم واحد على الأقل'); return }
    const scope = bulkPriceCategories.length === allCategories.length ? 'كل أقسام المطعم' : bulkPriceCategories.join('، ')
    if (!await confirmSheet({
      title: `تعديل أسعار ${r.name}؟`,
      body: `هن${percent > 0 ? 'زوّد' : 'نقلّل'} الأسعار ${Math.abs(percent)}٪ في: ${scope}. يشمل الأصناف والأحجام والكومبو والإضافات. الطلبات القديمة مش هتتغير.`,
      confirmLabel: 'تأكيد تعديل الأسعار', danger: percent < 0,
    })) return
    setBulkPriceBusy(true)
    const res = await adminCatalogAction<{ items: number; sizes: number; combos: number; addons: number }>('adjustRestaurantPrices', {
      restaurantId: r.id, percent, categories: bulkPriceCategories.length === allCategories.length ? null : bulkPriceCategories,
    }, { categories_required: 'اختار قسم واحد على الأقل', invalid_pct: 'النسبة غير صالحة' })
    setBulkPriceBusy(false)
    if (!res.ok) { setActionError(res.error); return }
    setPriceToolFor(null)
    await alertSheet(`تم تعديل ${res.data?.items ?? 0} صنف، ${res.data?.sizes ?? 0} حجم، ${res.data?.combos ?? 0} كومبو و${res.data?.addons ?? 0} إضافة.`)
    load(true)
  }

  async function bakeRestaurantFee(r: Restaurant) {
    const pct = Math.round((r.service_fee_pct ?? 0) * 100)
    if (pct <= 0) { setActionError('رسوم المطعم الداخلية مقفولة بالفعل'); return }
    if (!await confirmSheet({
      title: `إلغاء رسوم ${pct}٪ بدون تغيير الأسعار؟`,
      body: 'هنثبت السعر الحالي لكل الأصناف والأحجام والكومبو والإضافات كسعر نهائي، ثم نقفل رسوم المطعم الداخلية. ده لا يغيّر أي طلب قديم ولا رسوم الخدمة العامة الظاهرة في الفاتورة.',
      confirmLabel: 'ثبّت الأسعار وألغِ الرسوم', danger: true,
    })) return
    setBulkPriceBusy(true)
    const res = await adminCatalogAction<{ items: number; sizes: number; combos: number; addons: number }>('bakeRestaurantServiceFee', { restaurantId: r.id }, {
      service_fee_not_enabled: 'رسوم المطعم الداخلية مقفولة بالفعل',
    })
    setBulkPriceBusy(false)
    if (!res.ok) { setActionError(res.error); return }
    setPriceToolFor(null)
    await alertSheet(`تم تثبيت الأسعار وإلغاء رسوم المطعم. اتراجع ${res.data?.items ?? 0} صنف وكل اختياراته.`)
    load(true)
  }

  async function removeCover(r: Restaurant) {
    if (!await confirmSheet({ title: 'إزالة صورة الواجهة؟', body: 'هنرجع نختار صورة تلقائيًا من القايمة.', danger: true })) return
    const { error } = await supabase.from('restaurants').update({ cover_image_url: null }).eq('id', r.id)
    if (error) { setActionError('مش قادرين نشيل الصورة دلوقتي'); return }
    load(true)
  }

  async function removeLogo(r: Restaurant) {
    if (!await confirmSheet({ title: 'إزالة شعار المطعم؟', danger: true })) return
    const { error } = await supabase.from('restaurants').update({ logo_url: null }).eq('id', r.id)
    if (error) { setActionError('مش قادرين نشيل الصورة دلوقتي'); return }
    setActionError('')
    load(true)
  }

  async function uploadItemImage(it: MenuItem, file: File) {
    setUploadingImage(`i${it.id}`); setImageError(null)
    const { url, error } = await uploadVendorImage(file, `menu-items/${it.id}/image`)
    setUploadingImage(null)
    if (error) { setImageError(error); return }
    const { error: linkError } = await supabase.from('menu_items').update({ image_url: url }).eq('id', it.id)
    if (linkError) { setActionError('الصورة اترفعت بس ماتربطتش بالصنف — جرب تاني'); return }
    setActionError('')
    load(true)
  }

  async function addRestaurant() {
    if (!newRestaurant.name.trim()) return
    const { error } = await supabase.from('restaurants').insert({
      name: newRestaurant.name.trim(),
      description: newRestaurant.description.trim(),
      category: newRestaurant.category.trim() || 'أصناف',
      vendor_type: newRestaurant.vendor_type,
      prep_minutes: Number(newRestaurant.prep_minutes) || 20,
      rating: 5, is_open: true, order_mode: 'catalog'
    })
    if (error) { setActionError(`إضافة المطعم فشلت — ${error.message}`); return }
    setActionError('')
    setNewRestaurant({ name: '', description: '', category: '', vendor_type: 'restaurant', prep_minutes: '20' })
    load(true)
  }

  async function archiveRestaurant(r: Restaurant, archived: boolean) {
    if (archived && !await confirmSheet({
      title: `تأكيد إخفاء ${r.name}؟`,
      body: 'هيختفي من التطبيق للعملاء بس بياناته وطلباته القديمة هتفضل موجودة.',
      danger: true,
    })) return
    const { error } = await supabase.from('restaurants').update({ archived }).eq('id', r.id)
    if (error) { setActionError('مش قادرين نأرشف المطعم دلوقتي'); return }
    setActionError('')
    load(true)
  }

  // The result was discarded. You agree 400 ج.م on the phone and hang up; the
  // RPC fails; the order sits unpriced and un-dispatchable while the customer
  // waits for a driver who can never be assigned.
  async function confirmCustomOrderPrice(orderId: number, subtotal: number) {
    if (!subtotal || subtotal <= 0) { setActionError('اكتب سعر صحيح'); return }
    const res = await vendorOperation('confirmPrice', { orderId, subtotal }, {
      not_authorized: 'التسعير للإدارة بس',
      order_not_found: 'الطلب ده مش طلب خاص أو مش موجود',
      invalid_amount: 'السعر لازم يكون رقم أكبر من صفر',
    })
    if (!res.ok) { setActionError(res.error); return }
    setActionError('')
    load(true)
  }

  async function updateSetting(st: Setting, value: string) {
    if (value === st.value) return
    const { error } = await supabase.from('settings').update({ value }).eq('key', st.key)
    if (error) { setActionError('الإعداد ماتحفظش — جرب تاني'); return }
    setActionError('')
    load(true)
  }

  /** Same Toggle-plus-remembered-percent pattern as the per-restaurant fee
   *  below, but for the one global settings.service_fee_percent row that
   *  place_order actually reads for the visible checkout line item. These are
   *  two separate mechanisms that happen to share a name -- this one shows
   *  up to the customer, the per-restaurant one never does. */
  async function commitGlobalServiceFee(pctOverride?: number) {
    const st = settings.find(s => s.key === 'service_fee_percent')
    if (!st) return
    const raw = (pctOverride != null ? String(pctOverride) : (globalServiceFeeDraft ?? st.value)).trim()
    if (!/^\d+(\.\d+)?$/.test(raw)) { setActionError('نسبة الرسوم لازم تكون رقم'); setGlobalServiceFeeDraft(null); return }
    const pct = Number(raw)
    if (pct < 0 || pct > 100) { setActionError('نسبة الرسوم لازم تكون بين ٠ و١٠٠'); return }
    if (String(pct) === st.value) { setGlobalServiceFeeDraft(null); return }
    await updateSetting(st, String(pct))
    if (pct > 0) setLastGlobalServiceFeePct(pct)
    setGlobalServiceFeeDraft(null)
  }

  async function toggleGlobalServiceFee() {
    const st = settings.find(s => s.key === 'service_fee_percent')
    if (!st) return
    const isOn = Number(st.value) > 0
    if (isOn) { await commitGlobalServiceFee(0); return }
    await commitGlobalServiceFee(lastGlobalServiceFeePct ?? 8)
  }

  // Both move real money and are irreversible, and both fired on a single click
  // with no confirm and no error check -- while markRefunded, which is cheaper,
  // already confirmed.
  async function settleCash(driverId: number) {
    // The card's figure can be up to a poll old, and settle_driver_cash() zeroes
    // whatever the server currently holds -- so quoting stale state could have
    // the operator count out 1200 while the server cleared 1450. Re-read first.
    const { data: fresh, error: freshErr } = await supabase
      .from('drivers').select('name, cash_held').eq('id', driverId).single()
    if (freshErr || !fresh) { setActionError('مش قادرين نتأكد من الكاش دلوقتي، جرب تاني'); return }
    const d = fresh
    if (!await confirmSheet({
      title: `تأكيد استلام ${d.cash_held ?? 0} ج.م كاش من ${d.name}؟`,
      body: 'ده هيصفّر الكاش المسجل عليه، ومش هينفع يتراجع.',
      danger: true,
    })) return
    setActionError('')
    const res = await adminFinancialAction('settleCash', { driverId })
    if (!res.ok) { setActionError(res.error); return }
    load(true)
  }

  async function settleEarnings(driverId: number) {
    const d = drivers.find(x => x.id === driverId)
    // Re-read before quoting, exactly as settleCash does. The client array is up
    // to one 15s poll stale and settle_driver_earnings settles whatever is
    // unpaid NOW -- so two deliveries landing in the gap had the dialog say 120
    // while the ledger recorded 140 paid, and the driver had no unpaid rows left
    // to claim the missing 20 against.
    const { data: fresh, error: freshErr } = await supabase
      .from('driver_earnings').select('driver_earning').eq('driver_id', driverId).eq('paid', false)
    if (freshErr) { setActionError('مش قادرين نتأكد من الأرباح دلوقتي، جرب تاني'); return }
    const unpaid = (fresh ?? []).reduce((s, e) => s + Number(e.driver_earning), 0)
    if (unpaid <= 0) { setActionError('مفيش أرباح مستحقة للمندوب ده'); return }
    if (!await confirmSheet({
      title: `تأكيد دفع ${unpaid} ج.م أرباح لـ ${d?.name ?? 'المندوب'}؟`,
      body: 'مش هينفع يتراجع.',
      danger: true,
    })) return
    setActionError('')
    const res = await adminFinancialAction('settleEarnings', { driverId })
    if (!res.ok) { setActionError(res.error); return }
    load(true)
  }

  // The "توصيلات جارية" tab had no actions whatsoever, so a stalled delivery
  // could be surfaced but not acted on.
  async function unassignOrder(a: Assignment) {
    const reason = await promptSheet({
      title: `سحب الطلب #${a.order_id} من ${a.drivers?.name ?? 'المندوب'}؟`,
      body: 'الطلب هيرجع تاني لقائمة الطلبات المتاحة.',
      placeholder: 'السبب (اختياري)',
    })
    if (reason === null) return
    setActionError('')
    const res = await dispatchOperation('unassign', { orderId: a.order_id, reason: reason || 'admin_unassigned' })
    if (!res.ok) { setActionError(res.error); return }
    load(true)
  }

  // Admin could not cancel an order at all outside the "customer didn't answer"
  // banner, so a wrong, duplicate or abandoned order past `pending` had no exit
  // -- the only way out was to drive it to Delivered or leave it open forever.
  // cancel_order() has always permitted an admin at any status (the
  // `too_late_to_cancel` guard is `and not is_admin()`); nothing but the button
  // was missing. It refunds wallet credit, flags a refund where money was taken,
  // and releases the driver, so this must go through the RPC and never through a
  // direct status update.
  async function cancelOrder(o: Order) {
    if (CLOSED_ORDER_STATUSES.includes(o.status as OrderStatus)) return
    const reason = await promptSheet({
      title: `إلغاء الطلب #${o.id}؟`,
      body: o.status === 'pending'
        ? undefined
        : <>الطلب #{o.id} حالته «{orderStatusLabel(o.status)}» — يعني اتقبل أو خرج للتوصيل بالفعل.<br /><br />الإلغاء هيسحبه من المندوب ويرجّع رصيد المحفظة لو استُخدم. لو العميل دفع، هيتسجل استرداد مطلوب.</>,
      placeholder: 'السبب (هيتسجل على الطلب)',
    })
    if (reason === null) return
    if (!reason.trim()) { setActionError('اكتب سبب الإلغاء'); return }
    setActionError('')
    const res = await rpc('cancel_order', { p_order_id: o.id, p_reason: reason.trim() })
    if (!res.ok) { setActionError(res.error); return }
    load(true)
  }

  // Delivery used to be five distance bands in `settings`, so 20 of the 62
  // compounds shared one 350 ج.م price across an 11 km spread and no individual
  // place could be corrected without moving every other place in its band.
  // The fee now lives on the compound row. This is the only way to edit it --
  // the bands survive solely to seed a newly added compound.
  async function saveCompoundFee(c: Compound, raw: string) {
    const fee = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(fee)) { setActionError('اكتب رقم صحيح'); return }
    if (fee === Number(c.delivery_fee)) return
    setActionError('')
    const res = await adminCompoundAction('setCompoundFee', { compoundId: c.id, fee })
    if (!res.ok) { setActionError(res.error); return }
    load(true)
  }

  // A driver whose phone dies mid-round strands the order: mark_delivered is
  // gated on my_driver_id(), so nobody else could finish it. The alternative was
  // to record a real delivery as Failed or Cancelled, which corrupts the
  // driver's stats and the day's cash reconciliation at the same time.
  async function forceDelivered(a: Assignment) {
    const reason = await promptSheet({
      title: `تسجيل الطلب #${a.order_id} كمُسلَّم بدل المندوب؟`,
      body: 'استخدم ده لما المندوب يكون سلّم فعلاً ومش قادر يأكد بنفسه (بطارية، شبكة).',
      placeholder: 'السبب',
    })
    if (reason === null) return
    if (!reason.trim()) { setActionError('اكتب السبب'); return }
    const cash = await confirmSheet({
      title: 'المندوب استلم الكاش من العميل؟',
      body: 'لو استلمه هيتسجل على عهدته.',
      confirmLabel: 'أيوه استلمه',
      cancelLabel: 'لأ',
    })
    setActionError('')
    const res = await dispatchOperation('forceDelivered', {
      orderId: a.order_id, reason: reason.trim(), cashCollected: cash,
    })
    if (!res.ok) { setActionError(res.error); return }
    load(true)
  }

  // The supervisor login is created as catalog staff and converted here.
  // admin-accounts (the edge function that mints the auth user) gained a
  // create_supervisor_login action in the repo, but it has not been redeployed;
  // until it is, this is the supported path and it produces an identical
  // account. The conversion RPC only moves a profile between these two
  // no-restaurant, no-driver roles -- it cannot mint an admin.
  async function convertStaffRole(profileId: string, role: 'catalog' | 'supervisor') {
    const label = role === 'supervisor' ? 'مشرف تشغيل' : 'موظف قوايم'
    if (!await confirmSheet({
      title: `تحويل الحساب ده لـ «${label}»؟`,
      body: 'هيتغيّر اللي يقدر يشوفه ويعمله على طول.',
    })) return
    setActionError('')
    const res = await adminAccountDriverAction('convertStaffRole', { profileId, role })
    if (!res.ok) { setActionError(res.error); return }
    load(true)
  }

  async function reassignOrder(a: Assignment, driver: Driver) {
    setModalError(''); setReassignBusy(true)
    const res = await dispatchOperation('reassign', {
      orderId: a.order_id, driverId: driver.id, reason: 'admin_reassigned'
    }, {
      dispatch_rule_blocked: 'المندوب ده وصل للحد الأقصى (٣ طلبات) أو شغال في اتجاه مختلف',
      wrong_vehicle_type: 'الطلب ده محتاج فان',
      no_active_assignment: 'الطلب ده مابقاش مع مندوب — حدّث الصفحة',
    })
    setReassignBusy(false)
    if (!res.ok) { setModalError(res.error); return }
    setReassigning(null); setModalError(''); setActionError('')
    load(true)
  }
  async function updatePayoutSchedule(d: Driver, schedule: string) {
    const { error } = await supabase.from('drivers').update({ payout_schedule: schedule }).eq('id', d.id)
    if (error) { setActionError('مش قادرين نحفظ جدول الدفع'); return }
    setActionError('')
    load(true)
  }
  async function updateComplaintStatus(c: Complaint, status: string) {
    const { error } = await supabase.from('complaints').update({ status }).eq('id', c.id)
    if (error) { setActionError('مش قادرين نحدّث الشكوى دلوقتي'); return }
    setActionError('')
    load(true)
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
    if (!await confirmSheet({ title: 'تأكيد إنك حوّلت المبلغ فعلاً للعميل؟' })) return
    const result = await adminFinancialAction('markRefunded', { orderId })
    if (!result.ok) { await alertSheet(result.error); return }
    load(true)
  }
  async function toggleCoverage(restaurantId: number, compoundId: number) {
    const existing = coverage.find(c => c.restaurant_id === restaurantId && c.compound_id === compoundId)
    setActionError('')
    if (existing) {
      // Removing coverage silently stops a vendor appearing for a whole compound.
      const compound = compounds.find(c => c.id === compoundId)
      if (!await confirmSheet({
        title: `إلغاء تغطية ${compound?.name ?? 'المكان ده'}؟`,
        body: 'المطعم مش هيظهر لعملاء المكان ده.',
        danger: true,
      })) return
      const { error } = await supabase.from('vendor_coverage').delete().eq('id', existing.id)
      if (error) { setActionError('مش قادرين نلغي التغطية دلوقتي'); return }
    } else {
      const { error } = await supabase.from('vendor_coverage').insert({ restaurant_id: restaurantId, compound_id: compoundId })
      if (error) { setActionError('مش قادرين نضيف التغطية دلوقتي'); return }
    }
    load(true)
  }
  async function sendWalletCredit() {
    if (!walletPhone.trim() || !walletAmount) return
    // A typo in this free-typed phone credits a stranger with no reversal path.
    if (!await confirmSheet({
      title: `إضافة ${walletAmount} ج.م لمحفظة ${walletPhone.trim()}؟`,
      body: 'اتأكد من الرقم — مفيش طريقة تتراجع.',
      danger: true,
    })) return
    const result = await adminFinancialAction('creditWallet', {
      phone: walletPhone.trim(), amount: Number(walletAmount), reason: walletReason.trim() || 'admin credit',
      orderId: walletOrderId
    })
    setWalletResult(!result.ok ? result.error : `تمت إضافة ${walletAmount} ج.م لمحفظة ${walletPhone}`)
    if (result.ok) {
      setWalletPhone(''); setWalletAmount(''); setWalletReason('')
      if (walletOrderId != null) setCompensatedOrderIds(prev => new Set(prev).add(walletOrderId))
      setWalletOrderId(null)
    }
  }

  async function toggleRx(it: MenuItem) {
    const { error } = await supabase.from('menu_items').update({ requires_prescription: !it.requires_prescription }).eq('id', it.id)
    if (error) { setActionError('مش قادرين نغيّر إعداد الروشتة دلوقتي'); return }
    setActionError('')
    load(true)
  }

  const vehicleLabel = (v: string) => v === 'van' ? '🚐 فان' : '🏍️ موتوسيكل'
  const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : null

  // Only orders where the CUSTOMER has said they transferred.
  //
  // This used to list every order sitting at awaiting_payment, which is the
  // state an InstaPay order is BORN in -- so a queue headed "تحويلات بانتظار
  // التأكيد" filled up with orders where nobody had transferred anything and
  // there was nothing to confirm. The one signal that a transfer actually
  // needs checking is instapay_claimed_at, which is set by
  // mark_instapay_claimed() when the customer taps "حوّلت المبلغ ✓".
  //
  // Orders still waiting for the customer to pay are not lost: they are in
  // كل الطلبات under awaiting_payment, and the stalled-orders banner picks them
  // up if they sit there. This queue is a work list, and work only exists once
  // someone claims to have paid.
  const pendingInstapay = orders.filter(o =>
    (o.payment_method === 'instapay' || o.cod_deposit_amount != null)
    && o.status === 'awaiting_payment'
    && o.instapay_claimed_at != null)

  const CATEGORY_LABEL: Record<string, string> = {
    missing_item: '📦 نقص صنف', wrong_item: '❌ صنف غلط', driver_conduct: '🛵 مشكلة مع المندوب',
    quality: '👎 جودة الطلب', other: '❓ حاجة تانية'
  }

  async function flagDriverDispute(c: Complaint) {
    const note = await promptSheet({ title: 'ملاحظة عن المشكلة مع المندوب', placeholder: '(اختياري)' })
    if (note === null) return
    const res = await adminCompoundAction('flagDriverDispute', { complaintId: c.id, note })
    if (!res.ok) { await alertSheet('حصل خطأ، جرب تاني'); return }
    await alertSheet('اتسجلت في سجل المندوب')
  }

  // 'cancel' used to call mark_delivery_failed, which sets Failed_Delivery, pays
  // the driver and stops -- it never touched refund_status and never returned
  // wallet credit. So a customer who paid by InstaPay and was not home lost the
  // money silently, under a button reading إلغاء الطلب. The two outcomes are
  // different and are now named differently.
  async function resolveNoAnswer(a: Assignment, action: 'wait' | 'contact' | 'fail' | 'refund') {
    if (action === 'fail' && !await confirmSheet({
      title: 'تسجيل الطلب كتوصيل فاشل؟',
      body: 'المندوب هياخد أجره، ومفيش استرداد للعميل. لو العميل دفع، استخدم «إلغاء واسترداد» بدل ده.',
      danger: true,
    })) return
    if (action === 'refund' && !await confirmSheet({
      title: 'إلغاء الطلب واسترداد فلوس العميل؟',
      body: 'رصيد المحفظة هيرجع، ولو العميل حوّل فلوس هيتسجل استرداد مطلوب في تبويب الاستردادات.',
      danger: true,
    })) return
    const result = await dispatchOperation('resolveNoAnswer', { assignmentId: a.id, resolution: action })
    if (!result.ok) { await alertSheet(result.error); return }
    load(true)
  }

  async function confirmInstapayPayment(o: Order) {
    setAccountBusy(`instapay-${o.id}`)
    const result = await adminFinancialAction(
      o.cod_deposit_amount != null ? 'confirmCodDeposit' : 'confirmInstapay',
      { orderId: o.id },
    )
    setAccountBusy(null)
    if (!result.ok) { await alertSheet(result.error); return }
    load(true)
  }

  const totalDriver = earnings.reduce((s, e) => s + Number(e.driver_earning), 0)
  const totalAdmin = earnings.reduce((s, e) => s + Number(e.admin_amount), 0)

  const addr = (o: Order) => `${o.zone} — وحدة ${o.unit_number}${o.address_notes ? ` — ${o.address_notes}` : ''}`
  const customer = (o: Order) => (
    <div className="mt-2.5 bg-night border border-line rounded-xl p-3 text-sm space-y-1">
      <p>👤 {o.customer_name} · <a className="text-sea" dir="ltr" href={`tel:${o.customer_phone}`}>{o.customer_phone}</a></p>
      <p>📍 {addr(o)}</p>
      {o.customer_note && <p className="text-sandink">📝 {o.customer_note}</p>}
    </div>
  )

  if (firstLoad) {
    // Matches what actually renders once data arrives: the group tab bar,
    // the sub-tab bar beneath it, then a run of order cards -- the default
    // "unassigned" tab, not the stat-grid layout that only appears inside
    // specific other tabs. Getting this shape (and roughly its height) right
    // is the point: a skeleton that doesn't match the real layout just moves
    // the layout shift from "before data" to "when the skeleton is replaced".
    return (
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">لوحة التحكم</h1>
        <div className="flex gap-1.5 pb-1.5">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonBlock key={i} className="h-9 w-24 shrink-0" />)}
        </div>
        <div className="flex gap-1.5 pb-2 mb-4">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonBlock key={i} className="h-8 w-20 shrink-0" />)}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonOrderCard key={i} />)}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">لوحة التحكم</h1>

      {actionError && (
        <div ref={actionErrorRef} className="card p-3 mb-4 border-red-400/50 bg-red-500/5 flex items-center justify-between gap-3">
          <p className="text-sm text-red-700 font-semibold">{actionError}</p>
          <button className="btn-ghost !py-1.5 !px-3 text-xs shrink-0" onClick={() => setActionError('')}>تمام</button>
        </div>
      )}

      {/* Third banner in the region that already does exactly this for
          no-answer reports and pending InstaPay. Before this, the only lateness
          detection anywhere in the admin surface applied to *unassigned* orders
          -- once an order had a driver, nothing ever flagged it again, so the
          60-minute Accepted and 90-minute Out_for_Delivery cases were invisible. */}
      {stalled.length > 0 && (
        <div className="card p-4 mb-4 border-red-400/50 bg-red-500/5">
          <p className="font-bold mb-3">⏳ طلبات واقفة محتاجة تدخّل ({stalled.length})</p>
          <div className="space-y-2.5">
            {stalled.map(o => {
              const hrs = Math.floor(o.minutes_stalled / 60)
              const mins = o.minutes_stalled % 60
              const since = hrs > 0 ? `${hrs} ساعة و${mins} دقيقة` : `${mins} دقيقة`
              const assignment = assignments.find(a => a.order_id === o.id && activeStatuses.includes(a.status))
              // stalled_orders() returns a projection, not the row. The actions
              // below need the real order (pricing_status, kitchen_status, the
              // fields cancel_order and the assign modal read).
              const full = orders.find(x => x.id === o.id)
              return (
                <div key={o.id} className="bg-night border border-line rounded-xl p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm">طلب #{o.id} — {o.vendor_name} — {o.total} ج.م</p>
                      <p className="text-xs text-mist mt-0.5">
                        👤 {o.customer_name} · <a className="text-sea" dir="ltr" href={`tel:${o.customer_phone}`}>{o.customer_phone}</a>
                      </p>
                      <p className="text-xs text-mist mt-0.5">📍 {o.compound_name ?? '—'}</p>
                    </div>
                    <span className="text-xs font-semibold bg-red-500/10 text-red-700 rounded-full px-2.5 py-1 shrink-0">
                      {orderStatusLabel(o.status)}
                    </span>
                  </div>
                  {full?.pricing_status === 'pending_quote' && (
                    <p className="text-xs text-sandink font-semibold mt-1.5 bg-sand/10 rounded-lg px-2 py-1">
                      🧾 واقف عليك إنت — الطلب ده محتاج تسعير قبل ما أي مندوب يقدر ياخده
                    </p>
                  )}
                  <p className="text-xs text-red-700 font-semibold mt-1.5">
                    واقف من {since} (الحد {o.threshold_minutes} دقيقة)
                    {o.payment_method === 'cod' ? ' · كاش' : o.payment_method === 'instapay' ? ' · إنستاباي' : ''}
                  </p>
                  {/* This banner is the one screen an admin looks at when
                      something is wrong, and it used to offer four actions --
                      three of which needed a driver to already be attached.
                      The most common stall by far is an order with NO driver,
                      and for that the only option was "افتح الطلب", i.e. go and
                      find it in another tab. Every reason an order can be stuck
                      now has its own way out, right here. */}
                  <div className="flex gap-2 mt-2.5 flex-wrap">
                    <a className="btn-ghost !py-1.5 text-xs flex-1 min-w-[7rem] text-center" href={`tel:${o.customer_phone}`}>اتصل بالعميل</a>

                    {/* Stuck on YOU: it needs a price. */}
                    {full?.pricing_status === 'pending_quote' && (
                      <button className="btn-sea !py-1.5 text-xs flex-1 min-w-[7rem]"
                        onClick={() => { setTab('orders'); setOrderStatusFilter('all'); setOrderQuery(`#${o.id}`) }}>
                        🧾 سعّر الطلب
                      </button>
                    )}

                    {/* Stuck on YOU: it needs the payment confirming. */}
                    {full?.status === 'awaiting_payment' && (
                      <button className="btn-sea !py-1.5 text-xs flex-1 min-w-[7rem]"
                        disabled={accountBusy === `instapay-${o.id}`}
                        onClick={() => full && confirmInstapayPayment(full)}>
                        {accountBusy === `instapay-${o.id}` ? '…' : '💳 تأكيد الاستلام'}
                      </button>
                    )}

                    {/* Stuck because nobody has taken it. This is the common one. */}
                    {!assignment && full && full.status !== 'awaiting_payment' && full.pricing_status !== 'pending_quote' && (
                      <button className="btn-sea !py-1.5 text-xs flex-1 min-w-[7rem]" onClick={() => setAssigning(full)}>
                        🛵 عيّن مندوب
                      </button>
                    )}

                    {assignment && (
                      <>
                        <button className="btn-ghost !py-1.5 text-xs flex-1 min-w-[7rem]" onClick={() => setReassigning(assignment)}>
                          غيّر المندوب
                        </button>
                        <button className="btn-ghost !py-1.5 text-xs flex-1 min-w-[7rem]" onClick={() => unassignOrder(assignment)}>
                          اسحب الطلب
                        </button>
                        {assignment.status === 'Out_for_Delivery' && (
                          <button className="btn-ghost !py-1.5 text-xs flex-1 min-w-[7rem]" onClick={() => forceDelivered(assignment)}>
                            سجّله كمُسلَّم
                          </button>
                        )}
                      </>
                    )}

                    <button className="btn-ghost !py-1.5 text-xs flex-1 min-w-[7rem]"
                      onClick={() => { setTab('orders'); setOrderStatusFilter('all'); setOrderQuery(`#${o.id}`) }}>
                      افتح الطلب
                    </button>

                    {/* The exit. Every other button here tries to rescue the
                        order; this is the one that ends it, so it is last and
                        it is red. */}
                    {full && (
                      <button className="btn-danger !py-1.5 text-xs flex-1 min-w-[7rem]" onClick={() => cancelOrder(full)}>
                        إلغاء الطلب
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {noAnswerReports.length > 0 && (
        <div className="card p-4 mb-4 border-red-400/50 bg-red-500/5">
          <p className="font-bold mb-3">☎️ عملاء ما ردوش على المندوب ({noAnswerReports.length})</p>
          <div className="space-y-2.5">
            {noAnswerReports.map(a => {
              const o = a.orders
              if (!o) return null
              return (
                <div key={a.id} className="bg-night border border-line rounded-xl p-3">
                  <p className="font-semibold text-sm">طلب #{o.id} — {o.restaurants?.name} — {o.total} ج.م</p>
                  <p className="text-xs text-mist mt-0.5">👤 {o.customer_name} · <a className="text-sea" dir="ltr" href={`tel:${o.customer_phone}`}>{o.customer_phone}</a></p>
                  <p className="text-xs text-mist mt-0.5">📍 {addr(o)}</p>
                  <p className="text-xs text-sandink mt-1">
                    {a.delivery_problem_reason
                      ? `🛵 المندوب بلّغ: ${a.delivery_problem_reason}`
                      : 'المندوب اتصل ومردش حد، اتبلّغ الإدارة'}
                  </p>
                  <div className="flex gap-2 mt-2.5 flex-wrap">
                    <a className="btn-ghost !py-1.5 text-xs flex-1 min-w-[7rem] text-center" href={`tel:${o.customer_phone}`}>اتصل بالعميل</a>
                    <button className="btn-ghost !py-1.5 text-xs flex-1 min-w-[7rem]" onClick={() => resolveNoAnswer(a, 'wait')}>يستنى 5 دقايق</button>
                    <button className="btn-ghost !py-1.5 text-xs flex-1 min-w-[7rem]" onClick={() => forceDelivered(a)}>سجّله كمُسلَّم</button>
                    <button className="btn-ghost !py-1.5 text-xs flex-1 min-w-[7rem] !text-red-600" onClick={() => resolveNoAnswer(a, 'fail')}>توصيل فاشل</button>
                    <button className="btn-danger !py-1.5 text-xs flex-1 min-w-[7rem]" onClick={() => resolveNoAnswer(a, 'refund')}>إلغاء واسترداد</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {pendingInstapay.length > 0 && (
        <div className="card p-4 mb-4 border-sand/50 bg-sand/5">
          <p className="font-bold mb-3">📲 تحويلات InstaPay بانتظار التأكيد ({pendingInstapay.length})</p>
          <div className="space-y-2.5">
            {pendingInstapay.map(o => (
              <div key={o.id} className="bg-night border border-line rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-sm">
                    #{o.id} — {o.restaurants?.name} —{' '}
                    {o.cod_deposit_amount != null ? `عربون ${o.cod_deposit_amount} ج.م (من ${o.total})` : `${o.total} ج.م`}
                  </p>
                  <p className="text-xs text-mist" dir="ltr">{o.customer_phone}</p>
                  {/* Every row in this list is now a claimed transfer, so the
                      "لسه ماقالش إنه حوّل" branch was unreachable. Show WHEN
                      they said it instead -- that is the number that decides
                      whether this is fresh or has been sitting. */}
                  <p className="text-xs mt-0.5 text-emerald-700">
                    ✓ قال إنه حوّل{o.instapay_claimed_at ? ` · ${new Date(o.instapay_claimed_at).toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit' })}` : ''}
                  </p>
                </div>
                <button className="btn-sea !py-1.5 !px-3.5 text-sm shrink-0" disabled={accountBusy === `instapay-${o.id}`}
                  onClick={() => confirmInstapayPayment(o)}>
                  {accountBusy === `instapay-${o.id}` ? '...' : 'تأكيد الاستلام'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin called registerPush() on mount but never rendered this, so a
          failed registration had no retry and no message -- the page just
          quietly stopped being reachable once closed. Renders nothing once a
          token is actually in hand. */}
      <EnablePushButton
        onToken={persistPushToken}
        label="فعّل تنبيهات الإدارة"
      />

      <EnableSoundButton />

      {/* Two rows instead of one row of sixteen. The group carries the alert
          count of everything inside it, so nothing that needed you becomes
          invisible by being one level down. */}
      <div className="flex gap-1.5 overflow-x-auto pb-1.5 -mx-4 px-4">
        {GROUPS.map(g => {
          const n = TABS.filter(t => t.group === g.key).reduce((sum, t) => sum + (tabBadges[t.key] ?? 0), 0)
          const on = openGroup === g.key
          return (
            <button key={g.key}
              className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-semibold border-2 transition-colors
                ${on ? 'bg-sea text-white border-sea' : 'bg-shell border-line text-mist hover:border-sea/40'}`}
              onClick={() => {
                setOpenGroup(g.key)
                // Land on the first tab that is asking for something, otherwise
                // the first tab in the group.
                const inGroup = TABS.filter(t => t.group === g.key)
                const urgent = inGroup.find(t => (tabBadges[t.key] ?? 0) > 0)
                const next = (urgent ?? inGroup[0]).key
                if (next !== 'wallet') setWalletOrderId(null)
                setTab(next)
              }}>
              {g.label}
              {n > 0 && (
                <span className={`mr-1.5 rounded-full px-1.5 text-[11px] font-bold ${on ? 'bg-white text-sea' : 'bg-red-600 text-white'}`}>{n}</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-4 -mx-4 px-4">
        {TABS.filter(t => t.group === openGroup).map(t => (
          <button key={t.key} className={`tab ${tab === t.key ? 'tab-active' : ''}`} onClick={() => { if (t.key !== 'wallet') setWalletOrderId(null); setTab(t.key) }}>
            {t.label}
            {(tabBadges[t.key] ?? 0) > 0 && (
              <span className="mr-1.5 bg-red-600 text-white rounded-full px-1.5 text-[11px] font-bold">{tabBadges[t.key]}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'unassigned' && (
        <PhoneOrderForm onCreated={() => load(true)} />
      )}

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
                <p className="text-sandink text-sm mt-1.5">🧾 طلب خاص{o.pricing_status === 'pending_quote' ? ' — لسه محتاج تسعير من تبويب الطلبات' : ''}</p>
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
                  <p className="text-xs text-sandink mt-1.5">
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
                      {/* What is in the bag, and where the rider is. An Offered
                          assignment has no driver position by definition, so the
                          panel only earns its space from Accepted onwards. */}
                      <LiveDeliveryDetail live={liveById[a.id]} />
                      {/* This tab previously rendered a header, a driver name, a
                          status badge and a customer block -- and nothing else.
                          No reassign, no unassign, no cancel. */}
                      <div className="flex gap-2 mt-3">
                        <button className="btn-ghost !py-1.5 text-xs flex-1" onClick={() => setReassigning(a)}>غيّر المندوب</button>
                        <button className="btn-ghost !py-1.5 text-xs flex-1" onClick={() => unassignOrder(a)}>اسحب الطلب</button>
                        {a.status === 'Out_for_Delivery' && (
                          <button className="btn-ghost !py-1.5 text-xs flex-1" onClick={() => forceDelivered(a)}>سجّله كمُسلَّم</button>
                        )}
                        {a.orders && (
                          <button className="btn-danger !py-1.5 text-xs flex-1" onClick={() => cancelOrder(a.orders!)}>إلغاء</button>
                        )}
                      </div>
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
          {driverForm
            ? <DriverForm initial={driverForm}
                onDone={() => { setDriverForm(null); load(true) }}
                onCancel={() => setDriverForm(null)} />
            : <button className="btn-sea w-full text-sm" onClick={() => setDriverForm({
                id: null, name: '', phone: '', vehicle_type: 'motorcycle',
                vehicle_plate: '', instapay_number: '', payout_schedule: 'daily', active: true,
              })}>➕ إضافة مندوب</button>}
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

          {drivers.map(d => {
            const disputeCount = earnings.filter(e => e.driver_id === d.id && e.disputed).length
            return (
            <div key={d.id} className="card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-bold">{d.name}</h2>
                  <p className="text-sm text-mist mt-0.5">★ {d.rating} · {d.total_deliveries} توصيلة · {vehicleLabel(d.vehicle_type)} · {d.vehicle_plate}</p>
                  <p className="text-sm text-mist mt-0.5" dir="ltr">{d.phone}</p>
                  <p className="text-xs text-mist mt-1">إنستاباي: {d.instapay_number || d.phone}</p>
                  {/* So you can match the binding against the phone in the
                      driver's hand before deciding whether to reset it. */}
                  <p className="text-xs text-mist mt-1">
                    📱 {d.device_id ? `مربوط بـ ${d.device_label || 'جهاز'}` : 'مش مربوط بجهاز لسه'}
                  </p>
                  {disputeCount > 0 && (
                    <p className="text-sm text-red-600 font-semibold mt-1">⚠️ {disputeCount} مشكلة مؤكدة في السجل</p>
                  )}
                </div>
                <span className={d.active ? 'badge-open' : 'badge-closed'}>{driverStatusLabel(d.status)}</span>
              </div>
              <div className="flex flex-wrap gap-2.5 mt-3">
                <Toggle on={!!d.available} onChange={() => toggleDriver(d, 'available')} label="متاح" labelOff="موقوف مؤقتًا" />
                <Toggle on={!!d.active} onChange={() => toggleDriver(d, 'active')} label="الحساب شغال" labelOff="الحساب موقوف" />
                <button className="btn-ghost text-sm flex-1" onClick={() => setDriverForm(driverToForm(d))}>تعديل البيانات</button>
                <button className="btn-ghost text-sm flex-1" onClick={() => editInstapay(d)}>تعديل إنستاباي</button>
                <button className="btn-ghost text-sm flex-1" onClick={() => resetDriverDevice(d)}>فك ربط الجهاز</button>
              </div>
            </div>
            )
          })}
        </div>
      )}

      {tab === 'orders' && (
        <div className="space-y-6">
          {/* The date is the first question asked of this screen -- almost every
              visit is "what happened today" or "find yesterday's order" -- and
              it used to be answered by scrolling past everything newer. It sits
              ABOVE search and status because it narrows what those then search
              within, rather than competing with them. */}
          {(() => {
            const todayKey = cairoDayKey(new Date().toISOString())
            const yKey = shiftDayKey(todayKey, -1)
            const real = orders.filter(o => !o.is_test)
            const testCount = orders.filter(o => o.is_test).length
            const todayCount = real.filter(o => cairoDayKey(o.created_at) === todayKey).length
            const yCount = real.filter(o => cairoDayKey(o.created_at) === yKey).length
            const chip = (key: OrderDateFilter, label: string, count?: number) => (
              <button key={key} onClick={() => setOrderDateFilter(key)}
                className={`rounded-full border px-3.5 min-h-[36px] text-sm font-semibold transition-colors ${
                  orderDateFilter === key
                    ? 'bg-sea border-sea text-white'
                    : 'bg-shell border-line text-foam'}`}>
                {label}
                {count != null && (
                  <span className={`text-xs font-normal ${orderDateFilter === key ? 'text-white/70' : 'text-mist'}`}> {count}</span>
                )}
              </button>
            )
            return (
              <div className="flex flex-wrap gap-2">
                {chip('today', 'النهاردة', todayCount)}
                {chip('yesterday', 'إمبارح', yCount)}
                {chip('older', 'أقدم')}
                {chip('all', 'الكل', real.length)}
                {testCount > 0 && (
                  <button onClick={() => setShowTestOrders(v => !v)}
                    className={`rounded-full border px-3.5 min-h-[36px] text-sm font-semibold transition-colors ${
                      showTestOrders
                        ? 'bg-sandink border-sandink text-white'
                        : 'bg-shell border-dashed border-linestrong text-sandink'}`}>
                    🧪 التجارب
                    <span className={`text-xs font-normal ${showTestOrders ? 'text-white/70' : 'text-mist'}`}> {testCount}</span>
                  </button>
                )}
              </div>
            )
          })()}

          {orderDateFilter === 'older' && (
            <div className="card p-3 flex flex-wrap items-center gap-2">
              <span className="text-sm text-mist">من يوم</span>
              <input type="date" className="field !w-auto" aria-label="من يوم" value={orderDateFrom}
                max={shiftDayKey(cairoDayKey(new Date().toISOString()), -2)}
                onChange={e => setOrderDateFrom(e.target.value)} />
              <span className="text-sm text-mist">لـ</span>
              <input type="date" className="field !w-auto" aria-label="لـ يوم" value={orderDateTo}
                min={orderDateFrom || undefined}
                max={shiftDayKey(cairoDayKey(new Date().toISOString()), -2)}
                onChange={e => setOrderDateTo(e.target.value)} />
              {!orderDateFrom && <span className="text-xs text-mist">اختار يوم عشان نجيب طلباته</span>}
              {orderDateFrom && !orderDateTo && <span className="text-xs text-mist">يوم واحد بس</span>}
            </div>
          )}
          {orderRangeFailed && (
            <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-2.5" role="alert">
              مش قادرين نجيب طلبات الأيام دي — جرب تاني. (مابنعرضش اللي محمّل عندنا عشان
              ما نقولش «مفيش طلبات» وإحنا مادوّرناش فعلاً.)
            </p>
          )}

          {/* Finding an order by number or a customer by phone previously meant
              scrolling the entire order history. */}
          <div className="card p-3 flex flex-col sm:flex-row gap-2">
            <input className="field flex-1" value={orderQuery} onChange={e => setOrderQuery(e.target.value)}
              placeholder="دوّر برقم الطلب، اسم العميل، تليفونه، أو المطعم…" aria-label="بحث في الطلبات" />
            <select className="field sm:w-52" value={orderStatusFilter}
              onChange={e => setOrderStatusFilter(e.target.value as 'all' | OrderStatus)}>
              <option value="all">كل الحالات</option>
              {ORDER_STATUSES.map(st => <option key={st} value={st}>{orderStatusLabel(st)}</option>)}
            </select>
            {(orderQuery || orderStatusFilter !== 'all') && (
              <button className="btn-ghost shrink-0" onClick={() => { setOrderQuery(''); setOrderStatusFilter('all') }}>
                مسح
              </button>
            )}
          </div>

          {(() => {
            const q = orderQuery.trim().toLowerCase()
            const todayKey = cairoDayKey(new Date().toISOString())
            const yKey = shiftDayKey(todayKey, -1)
            // Precedence matters. A search already spans the whole history, so
            // when one is running its results are the source even for «أقدم» --
            // otherwise typing a name while on a range would search only that
            // range and call the rest of history absent.
            const source = orderSearchResults
              ?? (orderDateFilter === 'older' ? (orderRangeResults ?? []) : orders)
            const filteredOrders = source.filter(o => {
              // Test orders are their own view, not an addition to the real one:
              // mixing them is what made #38 look like revenue.
              if (!!o.is_test !== showTestOrders) return false
              const day = cairoDayKey(o.created_at)
              // While showing tests the date chips are ignored: you want the test
              // you just ran, and hunting for it behind a date filter is the
              // opposite of useful. Status and search still apply.
              if (!showTestOrders) {
                if (orderDateFilter === 'today' && day !== todayKey) return false
                if (orderDateFilter === 'yesterday' && day !== yKey) return false
                if (orderDateFilter === 'older') {
                  if (day >= yKey) return false
                  if (orderDateFrom && day < orderDateFrom) return false
                  if (orderDateFrom && day > (orderDateTo || orderDateFrom)) return false
                }
              }
              if (orderStatusFilter !== 'all' && o.status !== orderStatusFilter) return false
              if (!q) return true
              if (q.startsWith('#')) return String(o.id) === q.slice(1)
              return String(o.id).includes(q)
                || (o.customer_name ?? '').toLowerCase().includes(q)
                || (o.customer_phone ?? '').includes(q)
                || (o.restaurants?.name ?? '').toLowerCase().includes(q)
                || (o.zone ?? '').toLowerCase().includes(q)
            })
            if (orderSearching) return <p className="text-mist text-center py-8">بندوّر…</p>
            if (orderRangeLoading) return <p className="text-mist text-center py-8">بنجيب طلبات الأيام دي…</p>
            if (orderDateFilter === 'older' && !orderDateFrom && !orderSearchResults) return (
              <p className="text-mist text-center py-8">اختار يوم من فوق</p>
            )
            // An empty day is a real answer and reads differently from an empty
            // search. Saying «مفيش طلبات بالبحث ده» on a date with no search
            // running sends someone hunting for a filter they never set.
            if (filteredOrders.length === 0) return (
              <p className="text-mist text-center py-8">
                {q ? 'مفيش طلبات بالبحث ده'
                   : orderDateFilter === 'today' ? 'مفيش طلبات النهاردة لسه'
                   : orderDateFilter === 'yesterday' ? 'مفيش طلبات إمبارح'
                   : 'مفيش طلبات في الأيام دي'}
              </p>
            )
            const groups: { label: string; items: typeof orders }[] = []
            for (const o of filteredOrders) {
              const label = new Date(o.created_at).toLocaleDateString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long' })
              const last = groups[groups.length - 1]
              if (last && last.label === label) last.items.push(o)
              else groups.push({ label, items: [o] })
            }
            return groups.map(group => (
              <div key={group.label}>
                <h3 className="font-bold text-mist text-sm mb-2.5">{group.label} ({group.items.length})</h3>
                <div className="space-y-3">
                  {/* A test order looks different at a glance -- dashed edge,
                      gold wash, explicit badge -- so it can never be mistaken
                      for revenue by someone glancing at the screen. */}
                  {group.items.map(o => (
            <div key={o.id} className={o.is_test
              ? 'card p-4 border-dashed border-linestrong bg-sand/10'
              : 'card p-4'}>
              <div className="flex items-start justify-between">
                <h2 className="font-bold">
                  #{o.id} — {o.restaurants?.name}
                  {o.is_test && (
                    <span className="mr-2 align-middle text-[10px] font-bold bg-sandink text-white rounded-full px-2 py-0.5">
                      🧪 تجربة
                    </span>
                  )}
                </h2>
                <div className="text-left">
                  {/* «قيد التسعير» belongs only to an order still waiting for a
                      price. A cancelled one is not waiting for anything, and
                      showing it in the biggest text on the card — with «ملغي»
                      small underneath — buried the one fact that matters. */}
                  <span className={`font-bold block ${
                    isCancelled(o.status) ? 'text-red-600'
                    : o.is_test ? 'text-sandink' : 'text-sea'}`}>
                    {isCancelled(o.status) ? 'ملغي'
                      : o.pricing_status === 'pending_quote' ? 'قيد التسعير'
                      : `${o.total} ج.م`}
                  </span>
                  <span className="text-xs text-mist">
                    {isCancelled(o.status) ? `${o.total} ج.م` : orderStatusLabel(o.status)}
                  </span>
                </div>
              </div>

              {/* Money correction after the fact. Writes a visible line rather
                  than editing the header, so the customer's own item list still
                  adds up to what they are charged. */}
              {!o.is_test && <OrderAdjust orderId={o.id} onDone={() => load(true)} />}

              {o.order_type === 'custom_request' && (
                <div className="mt-2.5 bg-sand/10 border border-sand/30 rounded-xl p-3 text-sm space-y-1">
                  <p className="font-semibold">🧾 طلب خاص</p>
                  {(o.request_items ?? []).map((it, i) => <p key={i}>• {it.name} × {it.qty}</p>)}
                  {o.request_notes && <p className="italic">"{o.request_notes}"</p>}
                  {o.prescription_path && <div className="pt-1"><PrescriptionLink path={o.prescription_path} /></div>}
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

              {/* `pricing_status` does NOT clear when an order is cancelled, so a
                  cancelled custom order still reads pending_quote forever. This
                  block was therefore offering a live price box on a dead order —
                  and confirm_custom_order_price had no status check either, so
                  typing a number would have rewritten the total of an order the
                  customer had already walked away from. Order #86 was exactly
                  this: cancelled at 14:07 and still asking to be priced. */}
              {o.order_type === 'custom_request' && o.pricing_status === 'pending_quote'
                && !isCancelled(o.status) && (
                <div className="flex items-center gap-2 mt-3">
                  <input type="number" inputMode="decimal" placeholder="السعر بعد المكالمة" aria-label="السعر بعد المكالمة"
                    className="field !py-1.5 text-sm" id={`quote-${o.id}`} />
                  <button className="btn-sea shrink-0 !py-1.5 text-sm" onClick={() => {
                    const el = document.getElementById(`quote-${o.id}`) as HTMLInputElement
                    confirmCustomOrderPrice(o.id, Number(el.value))
                  }}>تأكيد السعر</button>
                </div>
              )}

              {!CLOSED_ORDER_STATUSES.includes(o.status as OrderStatus) && (
                <div className="flex gap-2 mt-3">
                  <button className="btn-danger !py-1.5 text-xs" onClick={() => cancelOrder(o)}>إلغاء الطلب</button>
                </div>
              )}

              {/* A delivered order used to end at a total and a status word.
                  Everything you actually reach for afterwards -- who drove it,
                  how long it took against the SLA it promised, whether the cash
                  came back -- was either inside a collapsed timeline or nowhere.
                  This is the answer to "what happened with #41", on the card. */}
              {(() => {
                if (!CLOSED_ORDER_STATUSES.includes(o.status as OrderStatus)) return null
                // assignments is capped at 400 while orders reaches 500 and
                // search is unbounded, so an older order simply is not in this
                // list. Saying «محدش» there would claim nobody delivered an
                // order that was delivered.
                const done = assignments.find(a => a.order_id === o.id && a.delivered_at)
                const known = assignments.some(a => a.order_id === o.id)
                const mins = done?.delivered_at
                  ? Math.round((new Date(done.delivered_at).getTime() - new Date(o.created_at).getTime()) / 60000)
                  : null
                const late = mins != null && o.sla_minutes != null && mins > o.sla_minutes
                const cash = o.payment_method === 'cod'
                  ? (o.cod_deposit_amount != null
                      ? `كاش ${Math.round((o.total - o.cod_deposit_amount) * 100) / 100} + عربون ${o.cod_deposit_amount}`
                      : `كاش ${o.total}`)
                  : o.payment_method === 'instapay' ? 'InstaPay' : 'أونلاين'
                return (
                  <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                    {known && (
                      <span className="bg-night border border-line rounded-lg px-2 py-1">
                        🛵 {done?.drivers?.name ?? 'محدش'}
                      </span>
                    )}
                    {mins != null && (
                      <span className={`rounded-lg px-2 py-1 border ${late ? 'bg-red-500/10 border-red-500/30 text-red-700' : 'bg-night border-line'}`}>
                        ⏱ {mins} دقيقة{o.sla_minutes ? ` / ${o.sla_minutes}` : ''}{late ? ' — متأخر' : ''}
                      </span>
                    )}
                    <span className="bg-night border border-line rounded-lg px-2 py-1">💵 {cash}</span>
                    {/* WHEN, not just why. The reason chip said
                        «customer_cancelled» and nothing else, so the one
                        question you actually ask — how long did we sit on it
                        before they gave up — had no answer on this card. */}
                    {o.status === 'Cancelled' && (o.cancel_reason || o.cancelled_at) && (
                      <span className="bg-red-500/10 border border-red-500/30 text-red-700 rounded-lg px-2 py-1">
                        ✕ {cancelReasonLabel(o.cancel_reason)}
                        {o.cancelled_at && ` · اتلغى ${fmtTime(o.cancelled_at)}`}
                        {o.cancelled_at && o.created_at &&
                          ` · بعد ${Math.max(0, Math.round(
                            (new Date(o.cancelled_at).getTime() - new Date(o.created_at).getTime()) / 60000))} دقيقة`}
                      </span>
                    )}
                  </div>
                )
              })()}

              <button className="text-xs text-sea font-semibold mt-3" onClick={() => toggleOrderDetail(o.id)}>
                {openHistory === o.id ? 'إخفاء التفاصيل ▲' : 'عرض التفاصيل الكاملة ▼'}
              </button>
              {openHistory === o.id && (
                <div className="mt-2 bg-night border border-line rounded-xl p-3 text-xs space-y-1.5">
                  {/* What was actually in the bag. Never shown anywhere in Admin
                      for a catalogue order before now -- so "the customer says
                      an item was missing" had no answer on this screen. */}
                  {o.order_type === 'catalog' && (
                    <div className="pb-2 mb-2 border-b border-line">
                      <p className="font-semibold mb-1">🧾 الأصناف</p>
                      {orderItems[o.id] === undefined ? (
                        <p className="text-mist">بنحمّل…</p>
                      ) : orderItems[o.id].length === 0 ? (
                        <p className="text-mist">مفيش أصناف مسجلة</p>
                      ) : orderItems[o.id].map((it, i) => (
                        <p key={i}>
                          <span className="font-semibold">{it.qty}×</span> {it.name}
                          {[it.size_name, it.combo_name, ...(it.addon_names ?? [])].filter(Boolean).length > 0 && (
                            <span className="text-mist"> — {[it.size_name, it.combo_name, ...(it.addon_names ?? [])].filter(Boolean).join(' · ')}</span>
                          )}
                          <span className="text-mist"> · {it.total} ج.م</span>
                        </p>
                      ))}
                    </div>
                  )}

                  {/* The money, itemised. The card shows one number; a customer
                      querying their bill is asking about these four. */}
                  <div className="pb-2 mb-2 border-b border-line">
                    <p className="font-semibold mb-1">💰 الحساب</p>
                    <p>المنتجات: {o.subtotal} ج.م</p>
                    <p>التوصيل: {o.delivery_fee} ج.م</p>
                    {Number(o.service_fee ?? 0) > 0 && <p>رسوم الخدمة: {o.service_fee} ج.م</p>}
                    {Number(o.wallet_used ?? 0) > 0 && <p className="text-sea">من المحفظة: −{o.wallet_used} ج.م</p>}
                    <p className="font-semibold">الإجمالي: {o.total} ج.م</p>
                  </div>

                  <p>🕐 الطلب اتعمل: {fmtTime(o.created_at)}</p>
                  {assignments.filter(a => a.order_id === o.id).map(a => (
                    <div key={a.id} className="border-t border-line pt-1.5 mt-1.5 first:border-t-0 first:pt-0 first:mt-0">
                      <p className="font-semibold">محاولة {a.attempt_number} — {a.drivers?.name} ({assignmentStatusLabel(a.status)})</p>
                      {a.offered_at && <p>عُرض عليه: {fmtTime(a.offered_at)}</p>}
                      {a.responded_at && <p>رد: {fmtTime(a.responded_at)}</p>}
                      {a.picked_up_at && <p>استلم من المطعم: {fmtTime(a.picked_up_at)}</p>}
                      {a.delivered_at && <p>سلّم: {fmtTime(a.delivered_at)}</p>}
                      {a.rejection_reason && <p className="text-sandink">سبب: {a.rejection_reason}</p>}
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


      {tab === 'daily' && <DailyReportTab />}

      {tab === 'earnings' && (
        <div>
          {/* Sits above the earnings rows on purpose. Those tell you what the
              orders you already have were worth; this tells you how many
              visitors never became one. The second number is the one that can
              still be changed. */}
          <div className="mb-4"><FunnelPanel /></div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div className="card p-4 text-center"><p className="text-sm text-mist">التوصيلات (آخر 300)</p><p className="text-2xl font-bold mt-1">{earnings.length}</p></div>
            <div className="card p-4 text-center"><p className="text-sm text-mist">أرباح المندوبين</p><p className="text-2xl font-bold mt-1 text-sea">{totalDriver} ج.م</p></div>
            <div className="card p-4 text-center"><p className="text-sm text-mist">أرباح الإدارة</p><p className="text-2xl font-bold mt-1 text-sandink">{totalAdmin} ج.م</p></div>
          </div>
          <div className="space-y-2.5">
            {earnings.map(e => (
              <div key={e.id} className="card p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-sm">
                <span className="font-semibold">{e.drivers?.name} — طلب #{e.order_id}</span>
                <span className="text-mist">رسوم: {e.delivery_fee} · <span className="text-sea">مندوب: {e.driver_earning}</span> · <span className="text-sandink">إدارة: {e.admin_amount}</span></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'menu' && (
        <div className="space-y-3">
          {/* This used to live under "حسابات الدخول" (login accounts), mixed
              in with vendor/driver/catalog credential management. Every other
              restaurant-level control -- rank, featured, hours, images --
              already lives in this tab, so an admin looking to add or hide a
              restaurant would reasonably check here first and not find it. */}
          {showAddRestaurant ? (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="font-semibold">إضافة مطعم/متجر جديد</p>
                <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => setShowAddRestaurant(false)}>إلغاء</button>
              </div>
              <div className="space-y-2.5">
                <input className="field" placeholder="الاسم" aria-label="اسم المطعم/المتجر" value={newRestaurant.name}
                  onChange={e => setNewRestaurant({ ...newRestaurant, name: e.target.value })} />
                <input className="field" placeholder="وصف قصير" aria-label="وصف قصير" value={newRestaurant.description}
                  onChange={e => setNewRestaurant({ ...newRestaurant, description: e.target.value })} />
                <div className="flex gap-2">
                  <input className="field" placeholder="التصنيف (مثال: فاست فود)" aria-label="التصنيف" value={newRestaurant.category}
                    onChange={e => setNewRestaurant({ ...newRestaurant, category: e.target.value })} />
                  <select className="field !w-auto" value={newRestaurant.vendor_type}
                    onChange={e => setNewRestaurant({ ...newRestaurant, vendor_type: e.target.value })}>
                    <option value="restaurant">🍽️ مطعم</option>
                    <option value="supermarket">🛒 سوبر ماركت</option>
                    <option value="pharmacy">💊 صيدلية</option>
                  </select>
                </div>
                <button className="btn-sea w-full" disabled={!newRestaurant.name.trim()}
                  onClick={() => { addRestaurant(); setShowAddRestaurant(false) }}>
                  إضافة
                </button>
                <p className="text-xs text-mist">تقدر بعد كده تظبط وقت التحضير ونوع الطلب (طلب من القايمة / طلب خاص / طلب مندوب بس) من هنا برضه</p>
              </div>
            </div>
          ) : (
            <button className="btn-ghost w-full" onClick={() => setShowAddRestaurant(true)}>+ مطعم/متجر جديد</button>
          )}
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
                      <h2 className="font-bold truncate">
                        {r.display_order != null && (
                          <span className="text-[10px] font-bold text-sea bg-sea/10 rounded-full px-1.5 py-0.5 ml-1.5 align-middle">#{r.display_order}</span>
                        )}
                        {r.name}
                        {r.featured && <span className="text-sm align-middle"> ⭐</span>}
                        {r.archived ? ' (متوقف)' : ''}
                      </h2>
                      <p className="text-sm text-mist mt-0.5">{its.length} صنف · اضغط للتعديل والترتيب</p>
                    </div>
                  </button>
                  {/* Two actions, not three. The red «إيقاف» pill used to sit
                      here next to a red closed-status pill — two alarms side by
                      side that meant different things. Archiving is destructive
                      and rare, so it moved inside the expanded card. */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => setAddingItemFor(r)}>+ صنف</button>
                    <Toggle on={openStates[r.id]?.is_open ?? true} onChange={() => toggleRestaurant(r)}
                      label={openLabel(openStates[r.id] ?? {}).text} labelOff={openLabel(openStates[r.id] ?? {}).text} />
                  </div>
                </div>

                {/* WHO APPEARS FIRST — deliberately the first thing in the
                    expanded card: it exists precisely because nobody could
                    find it when it sat under the hours and the logo.

                    Before this existed the sort fell through to the vendor's
                    NAME -- order_ratings is empty, so the review and rating
                    tiebreakers both collapse, and the customer list for الحجاز ٣
                    read أرابياتا · ديڤادو · ستوديو مصر · سينابون · ماكدونالدز ·
                    هارت أتاك. That is the Arabic alphabet, not a decision.

                    No badge is shown to the customer for either control. */}
                {expanded && (
                  <div className="mt-3 rounded-xl bg-shellup p-3 max-w-md">
                    <p className="text-xs font-semibold mb-2">ترتيب الظهور للعميل</p>
                    <div className="flex items-center gap-3">
                      {/* CONTROLLED, and the rank is read from the live input
                          rather than from props when the toggle is tapped.
                          Blur fires before click: typing «2» and then tapping
                          «مميز» sent onBlur(rank=2) and then onClick with the
                          STALE r.display_order (still null, because load()
                          had not returned), which silently cleared the 2. */}
                      <input
                        type="number" min={1} inputMode="numeric"
                        className="field !w-20 text-center"
                        placeholder="—"
                        value={rankDraft[r.id] ?? (r.display_order == null ? '' : String(r.display_order))}
                        onChange={e => setRankDraft(d => ({ ...d, [r.id]: e.target.value }))}
                        onBlur={() => commitRank(r)} />
                      <Toggle on={!!r.featured} onChange={() => commitRank(r, !r.featured)} label="مميز ⭐" labelOff="مميز" />
                    </div>
                    <p className="text-[11px] text-mist mt-2 leading-relaxed">
                      الرقم = المركز (١ يعني الأول). سيبه فاضي يعني مش مرتّب.
                      «مميز» بيرفعه فوق غير المرتّبين من غير ما تحدد له مركز.
                      <b className="text-sandink"> المطعم المقفول بينزل تحت في كل الأحوال.</b>
                    </p>
                  </div>
                )}

                {expanded && <VendorHoursRow restaurant={r} onSaved={loadOpenStates} />}

                {expanded && (
                  <div className="flex items-center gap-3 mt-3">
                    <label className="relative cursor-pointer group">
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                        onChange={e => e.target.files?.[0] && uploadLogo(r, e.target.files[0])} />
                      {r.logo_url
                        ? <img src={r.logo_url} alt="" className="w-14 h-14 rounded-xl object-cover border border-line group-hover:opacity-70" />
                        : <div className="w-14 h-14 rounded-xl bg-shellup grid place-items-center text-mist text-[10px] group-hover:opacity-70">اضغط لإضافة</div>}
                    </label>
                    <div className="text-xs text-mist">
                      <p>{uploadingImage === `r${r.id}` ? 'جاري رفع الشعار…' : 'الشعار — بيظهر جنب الاسم'}</p>
                      {r.logo_url && (
                        <button className="text-red-500 font-semibold mt-1" onClick={() => removeLogo(r)}>✗ إزالة الشعار</button>
                      )}
                    </div>
                  </div>
                )}

                {/* Two different pictures doing two different jobs, so they sit
                    next to each other and say which is which. The logo is the
                    small round mark beside the name; this is the wide photo the
                    customer sees first on the home screen. */}
                {expanded && (
                  <div className="mt-3">
                    <label className="relative cursor-pointer group block">
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                        onChange={e => e.target.files?.[0] && uploadCover(r, e.target.files[0])} />
                      {r.cover_image_url
                        ? <img src={r.cover_image_url} alt="" className="w-full aspect-[5/2] rounded-xl object-cover border border-line group-hover:opacity-80" />
                        : <div className="w-full aspect-[5/2] rounded-xl bg-shellup border border-dashed border-linestrong grid place-items-center text-mist text-xs group-hover:opacity-80">
                            اضغط لرفع صورة واجهة المطعم
                          </div>}
                    </label>
                    {/* Same 5:2 the customer sees. It previewed at 16:9 here,
                        so a cover cropped to look right in the admin lost a
                        strip top and bottom on the home screen. */}
                    <p className="text-xs text-mist mt-1.5">
                      {uploadingImage === `cover${r.id}`
                        ? 'جاري رفع صورة الواجهة…'
                        : r.cover_image_url
                          ? 'صورة الواجهة — دي اللي بتظهر في الرئيسية'
                          : 'من غير صورة واجهة بنختار أحسن صورة من القايمة تلقائيًا'}
                    </p>
                    {r.cover_image_url && (
                      <button className="text-red-500 text-xs font-semibold mt-1" onClick={() => removeCover(r)}>
                        ✗ إزالة صورة الواجهة
                      </button>
                    )}
                  </div>
                )}
                {imageError && expanded && <p className="text-xs text-sandink mt-1">{imageError}</p>}

                {expanded && (
                  <div className="mt-3 pt-2.5 border-t border-line flex items-center justify-between gap-3 text-sm">
                    <div>
                      <p className="font-semibold">إدارة أسعار المنيو</p>
                      <p className="text-xs text-mist mt-0.5">عدّل كل الأقسام أو أقسام تختارها مرة واحدة</p>
                    </div>
                    <button className="btn-ghost !py-1.5 !px-3 text-xs shrink-0" onClick={() => openPriceTool(r)}>تعديل جماعي</button>
                  </div>
                )}

                {/* Archiving lives HERE, not as a red pill on every collapsed
                    card. It is rare and destructive; giving it a permanent
                    header slot made every closed vendor look like two alarms. */}
                {expanded && (
                  <div className="mt-3 pt-2.5 border-t border-line flex justify-end">
                    <button
                      className={`text-xs font-semibold ${r.archived ? 'text-emerald-700' : 'text-red-500'}`}
                      onClick={() => archiveRestaurant(r, !r.archived)}>
                      {r.archived ? '↩ تفعيل المطعم تاني' : '⛔ إيقاف المطعم — يختفي من التطبيق خالص'}
                    </button>
                  </div>
                )}

                {reliability[r.id] && reliability[r.id].total_orders > 0 && (
                  <p className="text-xs text-mist mt-2">
                    ⏱ متوسط وقت القبول: <bdi dir="ltr">{reliability[r.id].avg_accept_minutes ?? '—'}</bdi> د ·
                    {' '}<span className={reliability[r.id].slow_accepts > 2 ? 'text-red-600' : 'text-mist'}>
                      <bdi dir="ltr">{reliability[r.id].slow_accepts}</bdi> طلب اتأخر قبوله (٣٠ يوم)
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

                {/* The category-discount block used to live here: every category
                    listed with an empty «+ إضافة خصم» beneath it, seven of them
                    for McDonald's, all above the first item. It now sits beside
                    the category it belongs to, inside MenuItemsPanel. */}

                {/* Gated on the toggle OR the type, not the type alone: once a
                    supermarket turns slots off it must still be able to turn
                    them back on, and any other vendor that has them on needs
                    the panel to switch them off. */}
                {expanded && (r.vendor_type === 'supermarket' || r.uses_delivery_slots) && (
                  <div className="mt-4 border-t border-line pt-3">
                    {/* The switch comes first, because it decides whether
                        anything below it matters. Off = this vendor takes
                        on-demand orders priced by distance like every other
                        vendor; the slot rows stay configured underneath, so
                        turning it back on restores them unchanged. */}
                    <label className="flex items-start gap-2.5 mb-3 cursor-pointer">
                      <input type="checkbox" className="w-5 h-5 mt-0.5 shrink-0"
                        checked={!!r.uses_delivery_slots}
                        onChange={async e => {
                          const res = await adminAccountDriverAction('setVendorSlots',
                            { restaurantId: r.id, enabled: e.target.checked },
                            { admin_only: 'محتاج صلاحية أدمن', vendor_not_found: 'المحل مش موجود' })
                          if (!res.ok) { setActionError(res.error); return }
                          setActionError('')
                          load(true)
                        }} />
                      <span className="min-w-0">
                        <span className="text-sm font-semibold block">التوصيل بفترات محددة</span>
                        <span className="text-xs text-mist block">
                          {r.uses_delivery_slots
                            ? 'الزبون لازم يختار فترة قبل ما يطلب'
                            : 'توصيل عادي بالمسافة زي باقي المحلات'}
                        </span>
                      </span>
                    </label>
                    {r.uses_delivery_slots && (<>
                    <p className="text-sm text-mist mb-2">فترات التوصيل</p>
                    <div className="space-y-2">
                      {slots.filter(sl => sl.restaurant_id === r.id).map(sl => (
                        <div key={sl.id} className="flex items-center justify-between bg-night border border-line rounded-xl p-2.5 text-sm">
                          <span><bdi dir="ltr">{sl.start_time.slice(0,5)} – {sl.end_time.slice(0,5)}</bdi> · سعة {sl.capacity}</span>
                          <Toggle on={!!sl.active} onChange={() => toggleSlot(sl)} label="فعّالة" labelOff="موقوفة" />
                        </div>
                      ))}
                      {slots.filter(sl => sl.restaurant_id === r.id).length === 0 && (
                        <p className="text-xs text-mist">لسه مفيش فترات — ضيف واحدة تحت</p>
                      )}
                    </div>
                    <div className="flex gap-2 mt-3">
                      <input type="time" className="field !py-1.5 text-sm" aria-label="وقت البداية" value={newSlot.start_time}
                        onChange={e => setNewSlot({ ...newSlot, start_time: e.target.value })} />
                      <input type="time" className="field !py-1.5 text-sm" aria-label="وقت النهاية" value={newSlot.end_time}
                        onChange={e => setNewSlot({ ...newSlot, end_time: e.target.value })} />
                      <input type="number" className="field !py-1.5 !w-20 text-sm" placeholder="سعة" aria-label="السعة" value={newSlot.capacity}
                        onChange={e => setNewSlot({ ...newSlot, capacity: e.target.value })} />
                    </div>
                    <button className="btn-sea w-full mt-2 text-sm"
                      disabled={!newSlot.start_time || !newSlot.end_time}
                      onClick={() => addSlot(r.id)}>إضافة فترة</button>
                    <p className="text-xs text-mist mt-2 leading-relaxed">
                      السعة = أقصى عدد طلبات في الفترة دي. اربطها بعدد المندوبين المتاحين وقتها مش بسرعة تجهيز السوبر ماركت.
                    </p>
                    </>)}
                  </div>
                )}

                {expanded && (
                  <MenuItemsPanel
                    restaurant={r}
                    items={its}
                    uploadingImage={uploadingImage}
                    onEdit={setEditingItem}
                    onTogglePrice={updatePrice}
                    onToggleAvailable={toggleItem}
                    onToggleRx={toggleRx}
                    onUploadImage={uploadItemImage}
                    onAddItem={() => setAddingItemFor(r)}
                    onChanged={() => load(true)}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'compounds' && <CompoundsTab />}

      {tab === 'customers' && <CustomersTab />}

      {tab === 'banners' && <BannersAdmin />}

      {tab === 'settings' && (
        <div className="space-y-3">
          {/* The visible checkout line item -- separate from any per-restaurant
              baked-in fee under كتالوج المطاعم. Pulled out of the generic list
              below (which renders numbers as plain inputs) so it gets the same
              Toggle everything else on/off uses. */}
          {settings.some(s => s.key === 'service_fee_percent') && (() => {
            const st = settings.find(s => s.key === 'service_fee_percent')!
            const pct = Number(st.value) || 0
            return (
              <div className="card p-4 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm">رسوم الخدمة العامة (بند ظاهر في الفاتورة)</p>
                  <p className="text-xs text-mist mt-0.5">بتتحسب من قيمة المنتجات وتظهر للعميل كبند منفصل عند الدفع</p>
                </div>
                <Toggle on={pct > 0} onChange={toggleGlobalServiceFee} />
                {pct > 0 && (
                  <>
                    <input type="number" min={0.5} max={100} step="0.5"
                      className="field !w-20 !py-1.5 text-center"
                      value={globalServiceFeeDraft ?? String(pct)}
                      onChange={e => setGlobalServiceFeeDraft(e.target.value)}
                      onBlur={() => commitGlobalServiceFee()} />
                    <span className="text-mist text-sm">%</span>
                  </>
                )}
              </div>
            )
          })()}
          {/* The fee_tier_* rows are no longer what anyone pays. They are only a
              seed for a compound added later. Leaving them in the same list as
              live settings invites someone to "fix delivery pricing" here and
              watch nothing change. */}
          {settings.filter(st => !st.key.startsWith('fee_tier') && st.key !== 'service_fee_percent').map(st => {
            const isBool = st.value === 'true' || st.value === 'false'
            const on = st.value === 'true'
            return (
              <div key={st.key} className="card p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{st.label || st.key}</p>
                </div>
                {isBool ? (
                  <Toggle on={on} onChange={() => updateSetting(st, on ? 'false' : 'true')} label="مفعّل" labelOff="مقفول" />
                ) : (
                  <input defaultValue={st.value} className="field !w-24 !py-1.5 text-center"
                    onBlur={e => updateSetting(st, e.target.value)} />
                )}
              </div>
            )
          })}
          <p className="text-xs text-mist mt-4 leading-relaxed">
            وقت وصول المندوب بيتحسب قبل ما الأكل يجهز، عشان يوصل المطعم في الوقت المناسب
            من غير ما يستنى.
          </p>

          <div className="pt-6">
            <h3 className="font-bold mb-1">رسوم التوصيل لكل كمبوند</h3>
            <p className="text-xs text-mist mb-3 leading-relaxed">
              السعر بقى لكل كمبوند لوحده — مش بالكيلومتر. غيّر الرقم واخرج من الخانة
              عشان يتحفظ. العميل بيشوف الرقم ده على طول قبل ما يبدأ يطلب.
            </p>
            {(() => {
              const groups: { label: string; items: Compound[] }[] = []
              for (const c of compounds) {
                const label = c.direction === 'north' ? 'شمال' : 'جنوب'
                const last = groups[groups.length - 1]
                if (last && last.label === label) last.items.push(c)
                else groups.push({ label, items: [c] })
              }
              return groups.map(g => (
                <div key={g.label} className="mb-4">
                  <h4 className="text-sm font-bold text-mist mb-2">{g.label} ({g.items.length})</h4>
                  <div className="space-y-2">
                    {g.items.map(c => (
                      <div key={c.id} className="card p-3 flex items-center justify-between gap-3">
                        <p className="font-semibold text-sm truncate min-w-0">{c.name}</p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <input type="number" inputMode="numeric" min={0}
                            defaultValue={String(c.delivery_fee)}
                            aria-label={`رسوم التوصيل لـ ${c.name}`}
                            className="field !w-24 !py-1.5 text-center"
                            onBlur={e => saveCompoundFee(c, e.target.value)} />
                          <span className="text-xs text-mist">ج.م</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            })()}
          </div>
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
                      {e.shifts && new Date(e.shifts.shift_date).toLocaleDateString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'numeric' })}
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
              <select className="field" aria-label="اختر مندوب" value={newShift.driver_id}
                onChange={e => setNewShift({ ...newShift, driver_id: e.target.value })}>
                <option value="">اختر مندوب…</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <input type="date" className="field" aria-label="تاريخ الوردية" value={newShift.shift_date}
                onChange={e => setNewShift({ ...newShift, shift_date: e.target.value })} />
              <input type="time" className="field" aria-label="وقت بداية الوردية" value={newShift.start_time}
                onChange={e => setNewShift({ ...newShift, start_time: e.target.value })} />
              <input type="time" className="field" aria-label="وقت نهاية الوردية" value={newShift.end_time}
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
                    <span className="text-mist"> — {new Date(sh.shift_date).toLocaleDateString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo' })} · {sh.start_time.slice(0,5)}–{sh.end_time.slice(0,5)}</span>
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
              <h2 className="font-bold text-sandink mb-3">⏳ طلبات تسوية مبكرة</h2>
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
                      <p className="font-bold text-sandink mt-0.5">{d.cash_held ?? 0} ج.م</p>
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
            <input className="field" dir="ltr" placeholder="رقم موبايل العميل" aria-label="رقم موبايل العميل" value={walletPhone} onChange={e => setWalletPhone(e.target.value)} />
            <div className="flex gap-2">
              <input className="field !w-28" type="number" placeholder="المبلغ" aria-label="المبلغ" value={walletAmount} onChange={e => setWalletAmount(e.target.value)} />
              <input className="field" placeholder="السبب (اختياري)" aria-label="السبب" value={walletReason} onChange={e => setWalletReason(e.target.value)} />
            </div>
            <button className="btn-sea w-full" disabled={!walletPhone.trim() || !walletAmount} onClick={sendWalletCredit}>إضافة الرصيد</button>
            {walletResult && <p className="text-sm text-mist">{walletResult}</p>}
          </div>
        </div>
      )}

      {tab === 'refunds' && (
        <div className="space-y-3">
          {pendingRefunds.length === 0 ? (
            <div className="card p-6 text-center text-mist">مفيش مبالغ مستحقة للاسترداد 👌</div>
          ) : (
            <>
              <p className="text-sm text-mist leading-relaxed">
                دي فلوس العميل دفعها فعلاً والطلب اتلغى. حوّلها بنفسك على إنستاباي،
                وبعدين دوس "حوّلت المبلغ" — الزرار بيسجّل التحويل بس، مش بيحوّل.
              </p>
              {pendingRefunds.map(o => (
                <div key={o.id} className="card p-4 border-sand/40">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">طلب #{o.id} — {o.vendor_name ?? '—'}</p>
                      <p className="text-xs text-mist mt-0.5">
                        👤 {o.customer_name} · <a className="text-sea" dir="ltr" href={`tel:${o.customer_phone}`}>{o.customer_phone}</a>
                      </p>
                      {o.cancel_reason && <p className="text-xs text-mist mt-0.5">📝 {o.cancel_reason}</p>}
                      <p className="text-xs text-mist mt-0.5">
                        {o.payment_method === 'cod' ? 'عربون كاش أونلاين' : o.payment_method === 'instapay' ? 'إنستاباي' : o.payment_method}
                        {o.cancelled_at ? ` · اتلغى ${fmtTime(o.cancelled_at)}` : ''}
                      </p>
                    </div>
                    <div className="text-left shrink-0">
                      <span className="font-bold text-sea block">{o.refund_amount} ج.م</span>
                      {Number(o.refund_amount) !== Number(o.total) && (
                        <span className="text-[11px] text-mist">من إجمالي {o.total}</span>
                      )}
                    </div>
                  </div>
                  <button className="btn-sea w-full !py-2 text-sm mt-3" onClick={() => markRefunded(o.id)}>
                    حوّلت المبلغ ✓
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'complaints' && (
        <div className="space-y-3">
          {/* The refunds list used to live here, inside الشكاوى, where nobody
              looking for money they owed would think to open it -- and it printed
              o.total as the amount, which for a COD order that only ever took a
              50% deposit is roughly double. It is its own tab now, with the
              amount computed by admin_pending_refunds(). */}
          {lowRatings.length > 0 && (
            <div className="space-y-2 mb-1">
              <p className="text-sm font-semibold">⭐ تقييمات منخفضة (نجمتين أو أقل)</p>
              {lowRatings.map(rt => (
                <div key={rt.id} className="card p-3.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">طلب #{rt.order_id} — {rt.orders?.restaurants?.name}</p>
                    <p className="text-xs text-mist truncate flex items-center gap-1 flex-wrap">
                      <span>{rt.orders?.customer_name} · <bdi dir="ltr">{rt.orders?.customer_phone}</bdi></span>
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

          {/* "لا توجد شكاوى" (no complaints exist) was shown for BOTH "there
              are genuinely none" and "there are some, they're just hidden by
              this filter" -- the exact confident-false-negative the orders
              tab's own empty state deliberately avoids elsewhere on this
              page. An admin scanning for a complaint they know was filed
              could read this as "it never happened." */}
          {complaints.filter(c => showResolvedComplaints || c.status !== 'resolved').length === 0 && (
            <div className="card p-6 text-center text-mist">
              {complaints.length === 0
                ? 'لا توجد شكاوى'
                : 'مفيش شكاوى مفتوحة — كل الشكاوى الموجودة اتحلّت'}
            </div>
          )}
          {complaints.filter(c => showResolvedComplaints || c.status !== 'resolved').map(c => (
            <div key={c.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-bold">طلب #{c.order_id} — {c.orders?.restaurants?.name}</h2>
                <span className={`text-xs font-semibold rounded-full px-2.5 py-1 shrink-0 ${c.status === 'open' ? 'bg-red-500/15 text-red-600' : c.status === 'reviewed' ? 'bg-sand/15 text-sandink' : 'bg-emerald-500/15 text-emerald-700'}`}>
                  {c.status === 'open' ? 'جديدة' : c.status === 'reviewed' ? 'قيد المراجعة' : 'اتحلت'}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-xs font-semibold bg-shellup rounded-full px-2 py-0.5">{CATEGORY_LABEL[c.category] ?? c.category}</span>
                {c.drivers?.name && <span className="text-xs text-mist">🛵 {c.drivers.name}</span>}
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
                {c.category === 'driver_conduct' && c.driver_id && (
                  <button className="btn-ghost flex-1 text-sm !text-red-600" onClick={() => flagDriverDispute(c)}>⚠️ علّم في سجل المندوب</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'accounts' && (
        <div className="space-y-6">
          <div className="mb-6">
            <p className="font-semibold mb-1">موظفي القوايم</p>
            <p className="text-xs text-mist mb-3">
              حساب بيقدر يضيف ويعدّل الأصناف والأسعار والأحجام والإضافات لكل المطاعم — ومش بيشوف الطلبات
              ولا المندوبين ولا الأرباح ولا الإعدادات.
            </p>
            <p className="text-xs text-mist mb-3 leading-relaxed">
              <b>مشرف التشغيل</b> بيشتغل على طلبات المطاعم بس: بيكلّم المطعم ويسجّل
              القبول والجاهزية، بيعيّن المندوبين ويسحبهم، وبيحل مشاكل التوصيل.
              مش بيشوف الصيدلية ولا الماركت، ومش بيلمس أي فلوس — تأكيد التحويلات
              وتسوية الكاش والاستردادات كلها عندك إنت. لإنشاء واحد: اعمل حساب
              هنا وبعدين اضغط «خلّيه مشرف تشغيل».
            </p>

            <div className="card p-3.5 mb-3">
              <div className="flex gap-2">
                <input className="field flex-1" value={newCatalogName}
                  onChange={e => setNewCatalogName(e.target.value)}
                  placeholder="اسم الموظف" aria-label="اسم الموظف" />
                <button className="btn-sea shrink-0 !px-4" disabled={!newCatalogName.trim() || accountBusy === 'catalog-new'}
                  onClick={createCatalogLogin}>
                  {accountBusy === 'catalog-new' ? '...' : 'إنشاء حساب'}
                </button>
              </div>
            </div>

            <div className="space-y-2.5">
              {catalogAccounts.map(acc => (
                <div key={acc.profile_id} className="card p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">
                        {acc.name}
                        <span className={`mr-2 text-[11px] font-bold rounded-full px-2 py-0.5 ${
                          acc.role === 'supervisor' ? 'bg-sea/10 text-sea' : 'bg-shellup text-mist'}`}>
                          {acc.role === 'supervisor' ? 'مشرف تشغيل' : 'قوايم'}
                        </span>
                      </p>
                      <p className="text-xs text-mist truncate" dir="ltr">{acc.email}</p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <AccountActionsMenu
                        busy={accountBusy === acc.profile_id}
                        onChangeEmail={() => changeEmail(acc.profile_id, acc.email)}
                        onResetPassword={() => resetPassword(acc.profile_id)}
                        onCustomPassword={() => setCustomPassword(acc.profile_id)}
                        onRemove={() => removeLogin(acc.profile_id)}
                      />
                    </div>
                  </div>
                  <button className="btn-ghost w-full !py-1.5 text-xs mt-2.5"
                    onClick={() => convertStaffRole(acc.profile_id, acc.role === 'supervisor' ? 'catalog' : 'supervisor')}>
                    {acc.role === 'supervisor' ? 'رجّعه موظف قوايم' : 'خلّيه مشرف تشغيل'}
                  </button>
                </div>
              ))}
              {catalogAccounts.length === 0 && (
                <p className="text-xs text-mist">مفيش حسابات قوايم لسه</p>
              )}
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
                      <div className="flex items-center gap-1.5 shrink-0">
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
                        <Toggle on={!r.archived} onChange={() => archiveRestaurant(r, !r.archived)} label="ظاهر في التطبيق" labelOff="مخفي" />
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
                      type="number" min={1} placeholder="بلا حد أقصى" aria-label={`أقصى مسافة توصيل لـ ${r.name}`}
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
                      <p className="text-xs text-sandink mb-2">⚠️ المطعم ده حاليًا مقتصر بس على الأماكن المعلّمة تحت — لو عايزه يرجع يوصل بالمسافة القصوى بس، شيل كل التعليمات.</p>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-64 overflow-y-auto">
                      {compounds.map(c => {
                        const checked = explicit.some(e => e.compound_id === c.id)
                        return (
                          <label key={c.id} className={`flex items-center gap-1.5 text-xs rounded-lg px-2 py-1.5 cursor-pointer ${checked ? 'bg-sea/10 text-sea font-semibold' : 'bg-shellup/50'}`}>
                            <Toggle on={checked} onChange={() => toggleCoverage(r.id, c.id)} ariaLabel={`تغطية ${c.name} — ${r.name}`} />
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
        <div ref={credsRef} className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" role="dialog" aria-modal="true" onClick={() => setNewCreds(null)}>
          <div className="card w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-3">بيانات الدخول</h3>
            <p className="text-sm text-mist mb-1">الإيميل</p>
            <p className="font-mono text-sm bg-night border border-line rounded-lg p-2.5 mb-3" dir="ltr">{newCreds.email}</p>
            <p className="text-sm text-mist mb-1">كلمة السر</p>
            <p className="font-mono text-sm bg-night border border-line rounded-lg p-2.5 mb-4" dir="ltr">{newCreds.password}</p>
            <div className="flex items-center gap-2 mb-4">
              <p className="text-xs text-sandink flex-1">⚠️ ده ظاهر مرة واحدة بس — انسخه وابعته دلوقتي</p>
              <button className="btn-sea !py-2 text-xs shrink-0" onClick={() => {
                navigator.clipboard.writeText(`${newCreds.email}\n${newCreds.password}`)
                setCredsCopied(true)
                window.setTimeout(() => setCredsCopied(false), 1500)
              }}>{credsCopied ? 'اتنسخ ✓' : '📋 نسخ'}</button>
            </div>
            <button className="btn-sea w-full" onClick={() => setNewCreds(null)}>تمام</button>
          </div>
        </div>
      )}

      {assigning && (
        <div ref={assigningRef} className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" role="dialog" aria-modal="true" onClick={closeAssign}>
          <div className="card w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-4">اختيار مندوب متاح — طلب #{assigning.id}</h3>
            {assigningNeedsVan && (
              <p className="text-sandink text-sm mb-3">🚐 الطلب محتاج فان — لسه السعر متأكدش أو الطلب كبير</p>
            )}
            {/* The refusal has to be readable HERE. The page-level banner sits
                behind a fixed inset-0 overlay, so a failed assign produced no
                visible message at all -- which is how ten distinct reasons
                became one alert() saying nothing. */}
            {modalError && (
              <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-3" role="alert">{modalError}</p>
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
                      <p className="text-xs text-sandink mt-1">شغال دلوقتي على {driverActiveCount} طلب</p>
                    )}
                  </button>
                )
              })}
            </div>
            <button className="btn-ghost w-full mt-4" onClick={() => setAssigning(null)}>إلغاء</button>
          </div>
        </div>
      )}

      {reassigning && (
        <div ref={reassigningRef} className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" role="dialog" aria-modal="true"
          onClick={() => setReassigning(null)}>
          <div className="card w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">تغيير المندوب — طلب #{reassigning.order_id}</h3>
            <p className="text-sm text-mist mb-4">
              دلوقتي مع {reassigning.drivers?.name ?? 'مندوب'} · {assignmentStatusLabel(reassigning.status)}
            </p>
            {reassignNeedsVan && (
              <p className="text-sandink text-sm mb-3">🚐 الطلب محتاج فان — لسه السعر متأكدش أو الطلب كبير</p>
            )}
            {modalError && (
              <p className="text-sm text-red-600 bg-red-500/10 rounded-xl p-3 mb-3">{modalError}</p>
            )}
            {reassignCandidates.length === 0 && (
              <p className="text-mist text-sm">
                {reassignNeedsVan ? 'لا يوجد فان تاني متاح حالياً' : 'لا يوجد مندوب تاني متاح حالياً'}
              </p>
            )}
            <div className="space-y-2.5">
              {reassignCandidates.map(d => {
                const driverActiveCount = active.filter(a => a.driver_id === d.id).length
                return (
                  <button key={d.id} className="w-full card !bg-night p-3.5 text-right hover:border-sea/50 transition-colors disabled:opacity-50"
                    disabled={reassignBusy}
                    onClick={() => reassignOrder(reassigning, d)}>
                    <p className="font-semibold">{d.name}</p>
                    <p className="text-sm text-mist mt-0.5">★ {d.rating} · {vehicleLabel(d.vehicle_type)} · {d.vehicle_plate}</p>
                    {driverActiveCount > 0 && (
                      <p className="text-xs text-sandink mt-1">شغال دلوقتي على {driverActiveCount} طلب</p>
                    )}
                  </button>
                )
              })}
            </div>
            <button className="btn-ghost w-full mt-4" onClick={() => setReassigning(null)}>إلغاء</button>
          </div>
        </div>
      )}

      {addingItemFor && (
        <AddMenuItemModal
          restaurant={addingItemFor}
          onClose={() => setAddingItemFor(null)}
          // Straight from "added" into its sizes and options, instead of
          // closing and making someone hunt for the row they just created.
          onSaved={(created) => {
            load(true)
            if (created) { setAddingItemFor(null); setEditingItem(created) }
          }}
        />
      )}

      {editingItem && (
        <MenuItemEditor
          item={editingItem}
          restaurantName={restaurants.find(r => r.id === editingItem.restaurant_id)?.name}
          onClose={() => setEditingItem(null)}
          onSaved={() => { setEditingItem(null); load(true) }}
          onDeleted={() => { setEditingItem(null); load(true) }}
        />
      )}

      {priceToolFor && (() => {
        const r = priceToolFor
        const categories = [...new Set(menu.filter(i => i.restaurant_id === r.id).map(i => i.category).filter(Boolean))]
        const selectedAll = categories.length > 0 && bulkPriceCategories.length === categories.length
        return (
          <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" role="dialog" aria-modal="true">
            <div className="card !rounded-2xl p-5 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between gap-3 mb-1">
                <div>
                  <h3 className="font-bold">إدارة أسعار {r.name}</h3>
                  <p className="text-xs text-mist mt-1">تتطبق على السعر النهائي للأصناف واختياراتها الجديدة فقط.</p>
                </div>
                <button className="btn-ghost !py-1 !px-2" onClick={() => setPriceToolFor(null)} disabled={bulkPriceBusy}>✕</button>
              </div>

              <div className="mt-5">
                <label className="text-sm font-semibold block mb-2">تعديل نسبة الأسعار</label>
                <div className="flex items-center gap-2">
                  <input autoFocus type="number" inputMode="decimal" min={-50} max={100} step="0.5" className="field !w-28 text-center" placeholder="مثال 8" value={bulkPricePercent} onChange={e => setBulkPricePercent(e.target.value)} disabled={bulkPriceBusy} />
                  <span className="text-mist">٪ زيادة أو نسبة سالبة للتخفيض</span>
                </div>
                <div className="flex items-center justify-between mt-4 mb-2">
                  <p className="text-sm font-semibold">الأقسام</p>
                  <button className="text-xs text-sea font-semibold" disabled={bulkPriceBusy} onClick={() => setBulkPriceCategories(selectedAll ? [] : categories)}>{selectedAll ? 'إلغاء اختيار الكل' : 'اختيار الكل'}</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {categories.map(category => {
                    const checked = bulkPriceCategories.includes(category)
                    return <label key={category} className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs ${checked ? 'border-sea bg-sea/10 text-sea font-semibold' : 'border-line text-mist'}`}>
                      <input className="sr-only" type="checkbox" checked={checked} disabled={bulkPriceBusy} onChange={() => setBulkPriceCategories(current => checked ? current.filter(x => x !== category) : [...current, category])} />
                      {category}
                    </label>
                  })}
                  {categories.length === 0 && <p className="text-xs text-mist">مفيش أصناف في المنيو لسه.</p>}
                </div>
                <button className="btn-sea w-full mt-4" disabled={bulkPriceBusy || categories.length === 0} onClick={applyBulkPriceChange}>{bulkPriceBusy ? 'جاري الحفظ…' : 'راجع وطبّق التعديل'}</button>
              </div>

              <div className="mt-5 pt-4 border-t border-line">
                <p className="text-sm font-semibold">إلغاء الرسوم المخفية</p>
                <p className="text-xs text-mist mt-1 leading-relaxed">يثبّت سعر المنيو الحالي ثم يجعل رسوم هذا المطعم ٠٪. العميل لا يرى رسوم المطعم كبند منفصل.</p>
                <button className="btn-ghost w-full mt-3 text-sm" disabled={bulkPriceBusy || !(r.service_fee_pct && r.service_fee_pct > 0)} onClick={() => bakeRestaurantFee(r)}>
                  ثبّت الأسعار وألغِ رسوم المطعم ({Math.round((r.service_fee_pct ?? 0) * 100)}٪)
                </button>
                {!(r.service_fee_pct && r.service_fee_pct > 0) && <p className="text-xs text-emerald-700 mt-2">رسوم المطعم الداخلية مقفولة بالفعل.</p>}
              </div>
            </div>
          </div>
        )
      })()}

      {sheetElement}
    </div>
  )
}


/**
 * The end-of-day audit, live.
 *
 * Written after doing it by hand on 2026-08-07 and watching the answer change
 * within the hour. Three things it deliberately does that a naive dashboard
 * does not:
 *
 *  - It reports what SALKA KEPT, not GMV. On 6 August the app moved 8,167 ج.م
 *    of food and Salka's share of it was 737. A dashboard leading with the
 *    bigger number tells you a loss-making day was a triumph.
 *  - It counts the funnel by DEVICE, not by event. 408 arrivals from 267 phones
 *    is a denominator that flatters every rate underneath it.
 *  - It names its own assumption. Rider salary is paid outside the system --
 *    nothing in the database reads driver_daily_salary_egp -- so the figure is
 *    labelled as an assumption rather than presented as fact.
 */
function DailyReportTab() {
  // Was `Date.now() + 3h`, which is Cairo only during EEST -- in winter the tab
  // opened on tomorrow's empty report between 23:00 and midnight local.
  const [day, setDay] = useState(() =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date()))
  const [r, setR] = useState<any>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setBusy(true); setErr('')
    adminReport('dailyReport', { date: day }).then(res => {
      if (cancelled) return
      setBusy(false)
      // setR(null) matters: without it a failed fetch left the PREVIOUS day's
      // report rendered underneath the new date and the error banner -- a P&L
      // screen showing yesterday's result as though it were today's.
      if (!res.ok) { setErr(res.error); setR(null); return }
      const { data } = res
      setR(data)
    })
    return () => { cancelled = true }
  }, [day])

  const n = (v: any) => Number(v ?? 0).toLocaleString('ar-EG-u-nu-latn',
    { maximumFractionDigits: 0 })

  const shift = (days: number) => {
    const d = new Date(day + 'T12:00:00Z')
    d.setDate(d.getDate() + days)
    setDay(d.toISOString().slice(0, 10))
  }

  const f = r?.funnel ?? {}
  const steps: [string, number][] = [
    ['دخلوا التطبيق', f.arrived ?? 0],
    ['اختاروا مكانهم', f.chose_place ?? 0],
    ['فتحوا مطعم', f.opened_vendor ?? 0],
    ['ضافوا صنف', f.added_item ?? 0],
    ['بدأوا الدفع', f.checkout ?? 0],
    ['طلبوا', f.ordered ?? 0],
  ]
  // Steps are counted per DEVICE over the same window, but a returning device
  // can choose a place without a fresh `arrival`, so a later step can exceed
  // the first. Without this the bar renders width:500% and the label «500٪».
  const top = Math.max(...steps.map(x => x[1]), 1)
  // `?? []` only defends against null. If the RPC ever returns an object here
  // instead of an array, `.find` is not a function and the THROW takes down the
  // whole Admin tree, not just this tab.
  const browsers: any[] = Array.isArray(r?.by_browser) ? r.by_browser : []
  const inApp = browsers.find(b => b.segment === 'in_app')
  const normal = browsers.find(b => b.segment === 'browser')
  const losing = Number(r?.result ?? 0) < 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button className="btn-ghost text-sm" onClick={() => shift(-1)}>اليوم اللي قبله ←</button>
        <span className="font-bold text-sm">{day}</span>
        <button className="btn-ghost text-sm" onClick={() => shift(1)}>→ اليوم اللي بعده</button>
      </div>

      {busy && <div className="card p-6 text-center text-mist">بنحسب…</div>}
      {err && <div className="card p-4 text-red-600 text-sm">{err}</div>}

      {r && !busy && (
        <>
          <div className={`card p-5 ${losing ? 'bg-red-500/5 border-red-500/25' : 'bg-emerald-500/5 border-emerald-500/25'}`}>
            <p className="text-sm font-semibold mb-1">
              {losing ? '▼ نتيجة اليوم' : '▲ نتيجة اليوم'}
            </p>
            <p className={`text-4xl font-bold ${losing ? 'text-red-600' : 'text-emerald-700'}`}>
              <bdi dir="ltr">{n(r.result)}</bdi> <span className="text-lg">ج.م</span>
            </p>
            <p className="text-sm text-mist mt-2">
              دخل سالكة {n(r.revenue)} ج.م − أجور {r.riders_active} مندوبين {n(r.assumed_rider_cost)} ج.م
            </p>
            {/* Said out loud, because nothing in the database actually pays this. */}
            <p className="text-[11px] text-mist mt-1">
              الأجور مفترضة من إعداد «المرتب اليومي» ({n(r.rider_daily_salary)} ج.م) — النظام نفسه مش بيصرفها
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Stat k="طلبات اتوصّلت" v={n(r.delivered)} sub={`من ${n(r.orders_created)} اتعملوا`} />
            <Stat k="نسبة الإلغاء" v={`${n(r.cancel_pct)}٪`} sub={`${n(r.cancelled)} طلب`} warn={Number(r.cancel_pct) > 15} />
            <Stat k="دخل سالكة للطلب" v={n(r.revenue_per_delivered)} sub="توصيل + خدمة" />
            <Stat k="تكلفة المندوب للطلب" v={n(r.cost_per_delivered)} sub="أجور ÷ طلبات" warn />
            <Stat k="من نقطة التعادل" v={`${n(r.pct_of_breakeven ?? 0)}٪`} sub={`محتاج ${n(r.breakeven_orders)} طلب`} warn={Number(r.pct_of_breakeven ?? 0) < 100} />
            <Stat k="قيمة الطلبات كلها" v={n(r.gmv)} sub="أغلبها بضاعة للتجار" />
          </div>

          {(Number(r.unpriced_left_open) > 0 || Number(r.unpaid_left_open) > 0) && (
            <div className="card p-4 bg-sand/10 border-sand/40 text-sm">
              <b>سايبين معلّق:</b>{' '}
              {Number(r.unpriced_left_open) > 0 && <>{n(r.unpriced_left_open)} طلب مستني تسعير. </>}
              {Number(r.unpaid_left_open) > 0 && <>{n(r.unpaid_left_open)} طلب مستني دفع.</>}
            </div>
          )}

          <div className="card p-4">
            <h3 className="font-bold text-sm mb-3">من دخل التطبيق لحد ما طلب</h3>
            {steps.map(([label, val], i) => (
              <div key={label} className="mb-2">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className={i === 0 ? 'font-semibold' : 'text-mist'}>{label}</span>
                  <span className="font-bold">
                    {n(val)}{i > 0 && <span className="text-mist font-normal"> · {Math.round(val / top * 100)}٪</span>}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-shellup overflow-hidden">
                  <div className="h-full bg-sea rounded-full"
                    style={{ width: `${Math.max(val / top * 100, val > 0 ? 1.5 : 0)}%` }} />
                </div>
              </div>
            ))}
          </div>

          {inApp && Number(inApp.devices) > 0 && (
            <div className="card p-4">
              <h3 className="font-bold text-sm mb-1">متصفح فيسبوك الداخلي</h3>
              <p className="text-xs text-mist mb-3">
                إعلانات فيسبوك بتفتح جوه التطبيق نفسه. لو الرقم ده فضل صفر، فلوس الإعلانات بتضيع.
              </p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-shellup p-3">
                  <p className="text-xs text-mist">جوه فيسبوك</p>
                  <p className="font-bold">{n(inApp.devices)} جهاز</p>
                  <p className="text-xs text-mist">{n(inApp.chose_place)} اختاروا مكانهم · {n(inApp.ordered)} طلبوا</p>
                </div>
                <div className="rounded-xl bg-shellup p-3">
                  <p className="text-xs text-mist">متصفح عادي</p>
                  <p className="font-bold">{n(normal?.devices)} جهاز</p>
                  <p className="text-xs text-mist">{n(normal?.chose_place)} اختاروا مكانهم · {n(normal?.ordered)} طلبوا</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ k, v, sub, warn }: { k: string; v: string; sub?: string; warn?: boolean }) {
  return (
    <div className="card p-3.5">
      <p className="text-[11px] text-mist mb-1 min-h-[2.4em] leading-snug">{k}</p>
      <p className={`text-xl font-bold ${warn ? 'text-red-600' : ''}`}>{v}</p>
      {sub && <p className="text-[11px] text-mist mt-0.5">{sub}</p>}
    </div>
  )
}
