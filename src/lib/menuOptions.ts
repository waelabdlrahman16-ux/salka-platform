import { supabase } from './supabase'
import type { MenuItemAddon, MenuItemCombo, MenuItemSize } from './types'

// Sizes, combos and add-ons for every item of one vendor.
//
// This existed twice, character for character, in CartPage and CheckoutPage --
// two screens that must agree on the total, each with its own copy of the code
// that computes it. Duplicate logic drifting apart is the defect that has cost
// this project the most, so the copies are now one function.
//
// Both copies also discarded every error and then called setOptionsLoaded(true)
// regardless. `optionsLoaded` is what unlocks the confirm button and the
// displayed total, so a failed read did not merely lose the options: it told
// both screens the options were LOADED and empty. Every combo and every sized
// line then priced at the item's base price, and the customer was shown -- and
// tapped confirm on -- a total lower than the one place_order would charge.
//
// Now it reports failure, and the caller keeps the button locked.
export type MenuOptions = {
  ok: boolean
  sizes: MenuItemSize[]
  combos: MenuItemCombo[]
  addons: MenuItemAddon[]
}

const EMPTY: MenuOptions = { ok: true, sizes: [], combos: [], addons: [] }
const FAILED: MenuOptions = { ok: false, sizes: [], combos: [], addons: [] }

export async function loadMenuOptions(restaurantId: number | null | undefined): Promise<MenuOptions> {
  if (!restaurantId) return EMPTY

  const idsRes = await supabase.from('menu_items').select('id').eq('restaurant_id', restaurantId)
  if (idsRes.error) return FAILED
  const ids = (idsRes.data ?? []).map(x => x.id)
  // A vendor with no items is a real, successful answer -- not a failure.
  if (!ids.length) return EMPTY

  const [szRes, cbRes, grRes] = await Promise.all([
    supabase.from('menu_item_sizes').select('*').in('menu_item_id', ids).eq('available', true),
    supabase.from('menu_item_combos').select('*').in('menu_item_id', ids).eq('available', true),
    supabase.from('menu_item_addon_groups').select('id').in('menu_item_id', ids),
  ])
  if (szRes.error || cbRes.error || grRes.error) return FAILED

  const groupIds = (grRes.data ?? []).map(g => g.id)
  let addons: MenuItemAddon[] = []
  if (groupIds.length) {
    const adRes = await supabase.from('menu_item_addons').select('*').in('group_id', groupIds).eq('available', true)
    if (adRes.error) return FAILED
    addons = (adRes.data as MenuItemAddon[]) ?? []
  }

  return {
    ok: true,
    sizes: (szRes.data as MenuItemSize[]) ?? [],
    combos: (cbRes.data as MenuItemCombo[]) ?? [],
    addons,
  }
}
