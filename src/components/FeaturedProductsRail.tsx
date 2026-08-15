import { Link } from 'react-router-dom'

export interface FeaturedProductCard {
  menu_item_id: number
  restaurant_id: number
  name: string
  price: number
  image_url: string | null
}

/**
 * A cross-restaurant "featured" shelf between restaurant cards on Home --
 * admin-picked dishes from any vendor, not one restaurant's own menu order.
 * Links to the restaurant page rather than opening the item directly: there
 * is no per-item deep link into RestaurantDetail yet, and the restaurant
 * page is never a wrong destination for "I want that dish."
 */
export default function FeaturedProductsRail({ items }: { items: FeaturedProductCard[] }) {
  if (items.length === 0) return null

  return (
    <div className="mb-4">
      <h2 className="font-bold text-base mb-2">أصناف مميزة</h2>
      <div className="flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-none">
        {items.map(it => (
          <Link key={it.menu_item_id} to={`/restaurant/${it.restaurant_id}`}
            className="shrink-0 snap-start w-28 text-right">
            <div className="rounded-xl aspect-square grid place-items-center text-2xl mb-1.5 overflow-hidden bg-shellup">
              {it.image_url ? <img src={it.image_url} alt="" className="w-full h-full object-cover" /> : '🍽️'}
            </div>
            <p className="text-xs font-semibold line-clamp-2 leading-snug">{it.name}</p>
            <p className="text-xs mt-0.5 text-sea font-bold">{it.price} ج.م</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
