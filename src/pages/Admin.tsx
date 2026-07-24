import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Assignment, Booking, Driver, Earning, MenuItem, Order, Restaurant, Setting } from '../lib/types'
import { ping, askNotificationPermission } from '../lib/notify'

type Tab = 'unassigned' | 'active' | 'drivers' | 'menu' | 'orders' | 'earnings' | 'settings'
const TABS: { key: Tab; label: string }[] = [
  { key: 'unassigned', label: 'طلبات غير معيّنة' },
  { key: 'active', label: 'توصيلات جارية' },
  { key: 'drivers', label: 'إدارة المندوبين' },
  { key: 'menu', label: 'المطاعم والمنيو' },
  { key: 'orders', label: 'كل الطلبات' },
  { key: 'earnings', label: 'الأرباح' },
  { key: 'settings', label: 'الإعدادات' },
]

export default function Admin() {
  const [tab, setTab] = useState<Tab>('unassigned')
  const [orders, setOrders] = useState<Order[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [earnings, setEarnings] = useState<Earning[]>([])
  const [assigning, setAssigning] = useState<Order | null>(null)
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [openRest, setOpenRest] = useState<number | null>(null)
  const [newItem, setNewItem] = useState({ name: '', category: '', price: '' })
  const [settings, setSettings] = useState<Setting[]>([])

  async function load() {
    const [o, a, d, b, e, r, m, st] = await Promise.all([
      supabase.from('orders').select('*, restaurants(name)').order('id', { ascending: false }),
      supabase.from('delivery_assignments').select('*, orders(*, restaurants(name)), drivers(*)').order('id', { ascending: false }),
      supabase.from('drivers').select('*').order('id'),
      supabase.from('bookings').select('*, chalets(name)').order('id', { ascending: false }),
      supabase.from('driver_earnings').select('*, drivers(name)').order('id', { ascending: false }),
      supabase.from('restaurants').select('*').order('id'),
      supabase.from('menu_items').select('*').order('id'),
      supabase.from('settings').select('*').order('key'),
    ])
    setOrders(o.data ?? []); setAssignments(a.data ?? []); setDrivers(d.data ?? [])
    setBookings(b.data ?? []); setEarnings(e.data ?? [])
    setRestaurants(r.data ?? []); setMenu(m.data ?? []); setSettings(st.data ?? [])
  }

  useEffect(() => {
    askNotificationPermission()
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  const activeStatuses = ['Offered', 'Accepted', 'Picked_Up', 'Out_for_Delivery']
  const assignedOrderIds = new Set(assignments.filter(a => activeStatuses.includes(a.status) || a.status === 'Delivered').map(a => a.order_id))
  const unassigned = orders.filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled' && !assignedOrderIds.has(o.id))
  const active = assignments.filter(a => activeStatuses.includes(a.status))
  const availableDrivers = drivers.filter(d => d.active && d.available && d.status === 'Available')
  const escalateAfter = Number(settings.find(s => s.key === 'escalate_after_minutes')?.value ?? 15)
  const isLate = (o: Order) => {
    const from = o.dispatch_at ? +new Date(o.dispatch_at) : +new Date(o.created_at)
    return (Date.now() - from) / 60000 > escalateAfter
  }
  useEffect(() => { ping('unassigned', unassigned.length, 'طلب غير معيّن', 'في طلب محدش استلمه') },
    [unassigned.length])

  async function assign(order: Order, driver: Driver) {
    const attempts = assignments.filter(a => a.order_id === order.id).length
    await supabase.from('delivery_assignments').insert({
      order_id: order.id, driver_id: driver.id, attempt_number: attempts + 1, status: 'Offered'
    })
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

  async function updateRestaurant(r: Restaurant, patch: Record<string, unknown>) {
    await supabase.from('restaurants').update(patch).eq('id', r.id)
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
      category: newItem.category.trim() || 'أصناف', price: Number(newItem.price)
    })
    setNewItem({ name: '', category: '', price: '' })
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
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-5 -mx-4 px-4">
        {TABS.map(t => (
          <button key={t.key} className={`tab ${tab === t.key ? 'tab-active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'unassigned' && (
        <div className="space-y-4">
          {unassigned.length === 0 && <div className="card p-6 text-center text-mist">لا توجد طلبات غير معيّنة</div>}
          {unassigned.map(o => (
            <div key={o.id} className={`card p-4 ${isLate(o) ? 'border-red-400/50' : ''}`}>
              <div className="flex items-start justify-between">
                <h2 className="font-bold">#{o.id} — {o.restaurants?.name}</h2>
                <span className="font-bold text-sea">{o.total} ج.م</span>
              </div>
              {isLate(o) && <p className="text-red-300 text-sm mt-1.5">⚠️ محدش استلم الطلب</p>}
              {customer(o)}
              <button className="btn-sea w-full mt-3" onClick={() => setAssigning(o)}>تعيين مندوب</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'active' && (
        <div className="space-y-4">
          {active.length === 0 && <div className="card p-6 text-center text-mist">لا توجد توصيلات جارية</div>}
          {active.map(a => (
            <div key={a.id} className="card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-bold">#{a.order_id} — {a.orders?.restaurants?.name}</h2>
                  <p className="text-sm text-mist mt-0.5">🛵 {a.drivers?.name} · محاولة {a.attempt_number}</p>
                </div>
                <span className="text-xs font-semibold bg-shellup rounded-full px-2.5 py-1">{a.status}</span>
              </div>
              {a.orders && customer(a.orders)}
            </div>
          ))}
        </div>
      )}

      {tab === 'drivers' && (
        <div className="space-y-4">
          {drivers.map(d => (
            <div key={d.id} className="card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-bold">{d.name}</h2>
                  <p className="text-sm text-mist mt-0.5">★ {d.rating} · {d.total_deliveries} توصيلة · {d.vehicle_type} · {d.vehicle_plate}</p>
                  <p className="text-sm text-mist mt-0.5" dir="ltr">{d.phone}</p>
                </div>
                <span className={d.active ? 'badge-open' : 'badge-closed'}>{d.status}</span>
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
        <div className="space-y-4">
          {orders.map(o => (
            <div key={o.id} className="card p-4">
              <div className="flex items-start justify-between">
                <h2 className="font-bold">#{o.id} — {o.restaurants?.name}</h2>
                <div className="text-left">
                  <span className="font-bold text-sea block">{o.total} ج.م</span>
                  <span className="text-xs text-mist">{o.status}</span>
                </div>
              </div>
              {customer(o)}
            </div>
          ))}
        </div>
      )}


      {tab === 'earnings' && (
        <div>
          <div className="grid grid-cols-3 gap-3 mb-5">
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
        <div className="space-y-4">
          {restaurants.map(r => {
            const its = menu.filter(m => m.restaurant_id === r.id)
            const expanded = openRest === r.id
            return (
              <div key={r.id} className="card p-4">
                <div className="flex items-start justify-between">
                  <button className="text-right" onClick={() => setOpenRest(expanded ? null : r.id)}>
                    <h2 className="font-bold">{r.name}</h2>
                    <p className="text-sm text-mist mt-0.5">{its.length} صنف · اضغط للتعديل</p>
                  </button>
                  <button className={r.is_open ? 'badge-open' : 'badge-closed'}
                    onClick={() => toggleRestaurant(r)}>{r.is_open ? 'مفتوح' : 'مغلق'}</button>
                </div>

                {expanded && (
                  <div className="flex items-center gap-2 mt-3 text-sm">
                    <span className="text-mist">وقت التحضير</span>
                    <input type="number" defaultValue={r.prep_minutes}
                      className="field !w-20 !py-1.5 text-center"
                      onBlur={e => updateRestaurant(r, { prep_minutes: Number(e.target.value) })} />
                    <span className="text-mist">دقيقة</span>
                    <button className="btn-ghost !py-1.5 text-sm mr-auto"
                      onClick={() => updateRestaurant(r, {
                        vendor_type: r.vendor_type === 'supermarket' ? 'restaurant' : 'supermarket'
                      })}>
                      {r.vendor_type === 'supermarket' ? '🛒 سوبر ماركت' : '🍽️ مطعم'}
                    </button>
                  </div>
                )}

                {expanded && (
                  <div className="mt-4 space-y-2.5">
                    {its.map(it => (
                      <div key={it.id} className="bg-night border border-line rounded-xl p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold truncate">{it.name}</p>
                            <p className="text-xs text-mist">{it.category}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <input type="number" defaultValue={it.price} className="field !w-24 !py-1.5 text-center"
                              onBlur={e => updatePrice(it, Number(e.target.value))} />
                            <span className="text-mist text-sm">ج.م</span>
                          </div>
                        </div>
                        <button className={`mt-2 text-sm ${it.available ? 'text-mist' : 'text-sand'}`}
                          onClick={() => toggleItem(it)}>
                          {it.available ? '✓ متاح — اضغط للإخفاء' : '✗ غير متاح — اضغط للإتاحة'}
                        </button>
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
                <p className="text-xs text-mist mt-0.5">{st.key}</p>
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

      {assigning && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => setAssigning(null)}>
          <div className="card w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-4">اختيار مندوب متاح — طلب #{assigning.id}</h3>
            {availableDrivers.length === 0 && <p className="text-mist text-sm">لا يوجد مندوبين متاحين حالياً</p>}
            <div className="space-y-2.5">
              {availableDrivers.map(d => (
                <button key={d.id} className="w-full card !bg-night p-3.5 text-right hover:border-sea/50 transition-colors" onClick={() => assign(assigning, d)}>
                  <p className="font-semibold">{d.name}</p>
                  <p className="text-sm text-mist mt-0.5">★ {d.rating} · {d.total_deliveries} توصيلة · {d.vehicle_type} · {d.vehicle_plate}</p>
                </button>
              ))}
            </div>
            <button className="btn-ghost w-full mt-4" onClick={() => setAssigning(null)}>إلغاء</button>
          </div>
        </div>
      )}
    </div>
  )
}
