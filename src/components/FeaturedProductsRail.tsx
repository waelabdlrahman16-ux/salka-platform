import { Link } from 'react-router-dom'
import { sized, IMG } from '../lib/imageUrl'
import Icon from './Icon'

export interface FeaturedProductCard {
  menu_item_id: number
  restaurant_id: number
  restaurant_name: string
  name: string
  price: number
  image_url: string | null
}

/**
 * A cross-restaurant "featured" shelf between restaurant cards on Home --
 * admin-picked dishes from any vendor, not one restaurant's own menu order.
 * Links straight into the item's own detail sheet on the restaurant page
 * (RestaurantDetail reads ?item=<id> and opens it once the menu loads) --
 * landing on the restaurant page and making the customer go find the dish
 * themselves defeated the point of featuring it in the first place.
 */
export default function FeaturedProductsRail({ items }: { items: FeaturedProductCard[] }) {
  if (items.length === 0) return null

  return (
    // A TICKET, not a band. It used to sit on the page background with no edge
    // of its own, between two restaurant cards that DID have one -- so a shelf
    // of dishes read as a third, oddly-shaped restaurant.
    //
    // The notched top and bottom edges are the shape a coupon has, and they say
    // "this is an offer" before any word does -- which is why the «أصناف مميزة»
    // heading could go: it named a category nobody can act on.
    //
    // The notches are drawn, not cut: a repeating radial-gradient in the PAGE's
    // own white punches half-circles along each edge. That keeps it one element
    // with no masks, and it survives the page scrolling under it because the
    // gradient colour is the ground it sits on.
    <div className="relative -mx-4 mb-4 bg-shellup border-y border-line overflow-hidden">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-3 pointer-events-none"
        style={{ background: 'radial-gradient(circle at 12px 0, #FFFFFF 11px, transparent 12px) 0 0 / 24px 24px repeat-x' }} />
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-3 pointer-events-none"
        style={{ background: 'radial-gradient(circle at 12px 12px, #FFFFFF 11px, transparent 12px) 0 0 / 24px 24px repeat-x' }} />

      {/* The perforation a ticket tears along. Dashed, faint, and inset so it
          reads as part of the shape rather than a divider between two things. */}
      <div className="px-4 pt-7 pb-6">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="tag" size="xs" className="text-coral-700" />
          <span className="text-[11px] font-bold text-coral-700 tracking-wide">مختارين ليك</span>
          <span className="flex-1 border-t border-dashed border-line" />
        </div>
      <div className="flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-none">
        {items.map(it => (
          <Link key={it.menu_item_id} to={`/restaurant/${it.restaurant_id}?item=${it.menu_item_id}`}
            className="shrink-0 snap-start w-28 text-right">
            <div className="rounded-xl aspect-square grid place-items-center text-2xl mb-1.5 overflow-hidden bg-shell border border-line">
              {it.image_url ? <img src={sized(it.image_url, IMG.square)} alt="" className="w-full h-full object-cover" /> : '🍽️'}
            </div>
            <p className="text-xs font-semibold line-clamp-2 leading-snug">{it.name}</p>
            <p className="text-[11px] text-mist truncate mt-0.5">{it.restaurant_name}</p>
            <p className="text-xs mt-0.5 text-sea font-bold">{it.price} ج.م</p>
          </Link>
        ))}
        </div>
      </div>
    </div>
  )
}
