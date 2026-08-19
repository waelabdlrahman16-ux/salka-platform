import { Link } from 'react-router-dom'
import { sized, IMG } from '../lib/imageUrl'

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
    // Full-bleed band on its own surface. It used to sit on the page background
    // with no edge of its own, between two restaurant cards that DID have one --
    // so a shelf of dishes read as a third, oddly-shaped restaurant. The band
    // says "this is a different kind of thing" before the heading does.
    // The heading is gone: the band already says "different kind of thing",
    // and «أصناف مميزة» named a category the customer cannot act on -- the
    // dishes and their prices say what this is.
    <div className="-mx-4 px-4 py-4 mb-4 bg-warm border-y border-line">
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
  )
}
