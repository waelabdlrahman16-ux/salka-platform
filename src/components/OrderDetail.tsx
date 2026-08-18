import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Order, RequestItem } from '../lib/types'

// Shared between Supervisor and Admin so both staff surfaces show the same
// facts about an order the same way -- moved out of Supervisor.tsx (its
// original home) rather than reimplemented, since it already carries the
// hard-won handling of the two very different shapes an order's contents
// come in.
//
// The supervisor is reading this list down a phone line to a restaurant, or
// off their own screen while walking a supermarket aisle, so it has to be the
// real thing -- sizes, combo and add-ons included, exactly as the kitchen
// screen would show it. An admin resolving a stuck order needs the same
// truth for the same reason.
//
// The two kinds of order keep their contents in DIFFERENT PLACES. A catalog
// order has order_items rows. A pharmacy or market order has none at all --
// there is no menu to reference -- and carries what the customer typed in
// orders.request_items instead. Reading only order_items is why every custom
// order used to render "مفيش أصناف على الطلب ده": an empty shopping list,
// which is exactly the thing someone might be sent out to buy.
export function OrderLines({ order }: { order: Order }) {
  const [lines, setLines] = useState<
    { id: number; name: string; qty: number; size_name: string | null; combo_name: string | null; addon_names: string[] | null }[] | null
  >(null)
  const [failed, setFailed] = useState(false)

  // Only a custom_request carries request_items. A pickup_request is an errand
  // -- collect a parcel, take the payment -- and legitimately has no item list
  // at all, so it must NOT be told "the customer typed nothing, ring them".
  // useMemo, not a bare expression: this is a dependency of the effect below, and
  // a fresh array every render made that effect re-run on every render. It bailed
  // out immediately each time via the `if (fromRequest) return` guard, so nothing
  // broke -- but it was work done on every paint for nothing.
  const fromRequest: RequestItem[] | null = useMemo(
    () => (order.order_type === 'custom_request' ? (order.request_items ?? []) : null),
    [order.order_type, order.request_items],
  )

  useEffect(() => {
    if (fromRequest) return
    let live = true
    supabase.from('order_items').select('id, name, qty, size_name, combo_name, addon_names')
      .eq('order_id', order.id)
      .then(({ data, error }) => {
        if (!live) return
        // postgrest resolves with { error } rather than rejecting, so an
        // unchecked read here renders "no items" for a failure -- and whoever
        // is reading this card thinks the bag really is empty.
        if (error) { setFailed(true); return }
        setLines((data as any) ?? [])
      })
    return () => { live = false }

  }, [order.id, fromRequest])

  const note = order.request_notes?.trim()
  const extras = (
    <>
      {note && <p className="text-xs text-sandink mt-2 pt-2 border-t border-dashed border-line">📝 {note}</p>}
      {order.prescription_path && (
        <p className="text-xs text-sandink mt-1">📎 العميل رفع صورة روشتة. شوفها من شاشة الإدارة</p>
      )}
    </>
  )

  if (fromRequest) {
    if (fromRequest.length === 0 && !note) {
      return <p className="text-mist text-xs">العميل ما كتبش أصناف. كلّمه قبل ما تشتري</p>
    }
    return (
      <>
        {fromRequest.map((l, i) => (
          <div key={i} className="flex justify-between gap-2">
            <span className="font-semibold">{l.name}</span>
            <span className="text-xs text-mist shrink-0">×{l.qty}</span>
          </div>
        ))}
        {extras}
      </>
    )
  }

  if (failed) {
    return <p className="text-red-600 text-xs">مش قادرين نحمّل أصناف الطلب. حدّث الصفحة قبل ما تتصرف فيه</p>
  }
  if (lines === null) return <p className="text-mist text-xs">…</p>
  // Still render the note on an item-less order: a pickup_request keeps the
  // whole instruction there, so returning early would hide the only content.
  if (lines.length === 0) {
    return <><p className="text-mist text-xs">مفيش أصناف على الطلب ده</p>{extras}</>
  }

  return (
    <>
      {lines.map(l => (
        <div key={l.id}>
          <span className="font-semibold">{l.name} × {l.qty}</span>
          {(l.combo_name || l.size_name || (l.addon_names && l.addon_names.length > 0)) && (
            <span className="block text-xs text-mist">
              {[l.combo_name && `كومبو ${l.combo_name}`, l.size_name, ...(l.addon_names ?? [])]
                .filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
      ))}
      {extras}
    </>
  )
}

// Subtotal, service fee and delivery fee are three separate columns on the
// order row -- total is not a number staff can re-derive from what the card
// already showed, and a stuck order is exactly the moment someone needs to
// see whether the total is high because of the food, the distance, or the
// platform fee, not just that it IS 240 ج.م.
export function PriceBreakdown({ order }: { order: Order }) {
  return (
    <div className="mt-2 rounded-xl bg-shellup px-3 py-2 text-xs space-y-0.5">
      <div className="flex justify-between"><span className="text-mist">الأصناف</span><span>{order.subtotal} ج.م</span></div>
      {!!order.service_fee && (
        <div className="flex justify-between"><span className="text-mist">رسوم الخدمة</span><span>{order.service_fee} ج.م</span></div>
      )}
      <div className="flex justify-between"><span className="text-mist">التوصيل</span><span>{order.delivery_fee} ج.م</span></div>
      <div className="flex justify-between font-bold border-t border-line pt-1 mt-1">
        <span>الإجمالي</span><span className="text-sea">{order.total} ج.م</span>
      </div>
    </div>
  )
}
