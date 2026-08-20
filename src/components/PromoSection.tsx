import { useEffect, useId, useState } from 'react'
import Icon from './Icon'
import {
  fetchPromoOffers, promoAppliedText, promoReasonText,
  type PromoBasket, type PromoOffer, type PromoQuote,
} from '../lib/promoOffers'

/**
 * «وفّر في طلبك» -- the voucher block.
 *
 * Three states, in the order a customer meets them:
 *
 *   OFFERED   a code an admin has ticked, priced against this basket, with the
 *             saving shown and one tap to take it. Nobody types anything.
 *   BLOCKED   the same card, greyed, carrying the reason -- «الحد الأدنى ٣٠٠ ج.م».
 *             Deliberately not hidden: a customer who can see that spending a
 *             little more saves them something often does.
 *   APPLIED   green, named, with the saving and a way to remove it.
 *
 * A typed box sits underneath for codes that are NOT advertised -- SORRY200 and
 * anything else handed out one customer at a time. It is collapsed behind
 * «أضف كود» when there is an offer to show, and open by default when there is
 * not, so the common case is one tap and the rare case is still one tap away.
 *
 * WHAT THIS COMPONENT DOES NOT DO: decide anything about money. The parent owns
 * the applied code and its quote, both of which come from the server. This
 * renders them.
 */

interface Props {
  basket: PromoBasket
  /** The code currently applied to the order, '' when none. Owned by the parent. */
  code: string
  /** The server's verdict on `code`. Null while nothing is applied. */
  quote: PromoQuote | null
  checking: boolean
  onApply: (code: string) => void
  onRemove: () => void
}

export default function PromoSection({ basket, code, quote, checking, onApply, onRemove }: Props) {
  const fid = useId()
  const [offers, setOffers] = useState<PromoOffer[]>([])
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')

  const applied = !!code.trim()
  const isApplied = applied && !checking && quote?.valid === true
  const failed = applied && !checking && quote?.valid === false

  // Re-price the offers whenever the basket moves: a card that says «وفّر ٣١ ج.م»
  // while the basket says something else is worse than no card at all.
  const { restaurantId, compoundId, subtotal, deliveryFee, serviceFee } = basket
  useEffect(() => {
    let cancelled = false
    fetchPromoOffers({ restaurantId, compoundId, subtotal, deliveryFee, serviceFee })
      .then(list => { if (!cancelled) setOffers(list) })
    return () => { cancelled = true }
  }, [restaurantId, compoundId, subtotal, deliveryFee, serviceFee])

  // Once a code is on the order, its own card is the applied one -- showing it
  // again in the offer list would read as a second, separate discount.
  const visibleOffers = offers.filter(o => o.code.toUpperCase() !== code.trim().toUpperCase())

  function submitTyped() {
    const clean = draft.trim().toUpperCase()
    if (!clean) return
    onApply(clean)
    setDraft('')
    setTyping(false)
  }

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-[15px]">
          <Icon name="tag" size="sm" className="inline-block align-[-0.15em] me-1.5" />وفّر في طلبك
        </h2>
        {!typing && (
          <button type="button" className="text-sm text-sea underline shrink-0"
            onClick={() => setTyping(true)}>
            أضف كود
          </button>
        )}
      </div>

      {/* APPLIED */}
      {isApplied && quote && (
        <div className="rounded-xl border border-success bg-successbg p-3 flex items-center gap-3 mb-2">
          <Icon name="checkCircle" size="md" className="text-success shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm" dir="ltr">{code.trim().toUpperCase()}</p>
            <p className="text-xs text-success font-semibold mt-0.5">{promoAppliedText(quote)}</p>
          </div>
          <button type="button" className="text-sm text-mist underline shrink-0" onClick={onRemove}>
            شيل الكود
          </button>
        </div>
      )}

      {/* APPLIED BUT REFUSED -- the code is on the order and the server said no. */}
      {failed && (
        <div className="rounded-xl border border-dangerline bg-dangerbg p-3 flex items-center gap-3 mb-2">
          <Icon name="warning" size="md" className="text-danger shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm" dir="ltr">{code.trim().toUpperCase()}</p>
            <p className="text-xs text-danger mt-0.5">{promoReasonText(quote)}</p>
          </div>
          <button type="button" className="text-sm text-mist underline shrink-0" onClick={onRemove}>
            شيل الكود
          </button>
        </div>
      )}

      {checking && applied && <p className="text-xs text-mist mb-2">بنتأكد من الكود…</p>}

      {/* OFFERED / BLOCKED */}
      {visibleOffers.map(offer => (
        <div key={offer.code}
          className={`rounded-xl border p-3 flex items-center gap-3 mb-2 ${
            offer.valid ? 'border-line' : 'border-line opacity-60'}`}>
          <Icon name="tag" size="md" className={offer.valid ? 'text-sea shrink-0' : 'text-mist shrink-0'} />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm" dir="ltr">{offer.code}</p>
            <p className={`text-xs mt-0.5 ${offer.valid ? 'text-mist' : 'text-mist'}`}>
              {offer.valid ? promoAppliedText(offer).replace('وفّرت', 'وفّر') : promoReasonText(offer)}
            </p>
          </div>
          {offer.valid ? (
            // «استبدل», not «استخدم», once something is already on the order. An
            // order carries ONE code (orders.promo_code_id is singular), so this
            // button replaces rather than adds. Saying «استخدم» while a code is
            // applied promises a second discount and silently swaps the first.
            <button type="button" className="btn-sea !py-1.5 !px-4 text-sm shrink-0"
              onClick={() => onApply(offer.code)}>
              {applied ? 'استبدل' : 'استخدم'}
            </button>
          ) : (
            // Not a disabled button: there is nothing to press, and a dead
            // control invites tapping and reads as a broken screen.
            <span className="text-xs text-mist shrink-0">مش متاح</span>
          )}
        </div>
      ))}

      {/* TYPE YOUR OWN -- open by default when there is nothing to offer. */}
      {(typing || (!visibleOffers.length && !applied)) && (
        <div className="mt-2">
          <label className="sr-only" htmlFor={`${fid}-code`}>كود الخصم</label>
          <div className="flex items-stretch gap-2">
            <input id={`${fid}-code`} className="field flex-1" value={draft} dir="ltr" maxLength={32}
              placeholder="اكتب كود الخصم"
              onChange={e => setDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitTyped() } }} />
            <button type="button" className="btn-sea !py-2 !px-5 text-sm shrink-0"
              onClick={submitTyped} disabled={!draft.trim()}>
              تطبيق
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
