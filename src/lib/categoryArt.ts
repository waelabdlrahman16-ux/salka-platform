import type { IconName } from '../components/Icon'
// Menu items don't have photography yet. Rather than faking product photos,
// give each category a distinct emoji + soft tinted tile so the grid still
// reads as a real, browsable catalog.
//
// The original map was written against idealised category names and matched
// almost nothing the vendors actually type. Of 189 live items only 34 (18%)
// found an entry; everything else fell through to the generic plate, which is
// why whole restaurants read as a wall of 🍽️. The misses were nearly all
// cosmetic: the data says "الدجاج", the map said "دجاج"; the data says
// "سندويتشات دجاج" and there was no substring matching at all. Meanwhile
// "برجر", "سناكس" and "خضار وفاكهة" sat in the map matching nothing live.
//
// So: normalise before comparing, then fall back to substring matching.
// Vendors keep typing whatever they like and the grid still looks intentional.

// A category is drawn one of two ways, and which one is not a style choice.
// FOOD keeps its emoji: artFor() renders full-size inside the image tile as the
// stand-in when a vendor has no logo, so it is doing the job of product
// photography, and appetite is the point.
//
// The non-food vendors below have no appetite to trade on -- a pill, a spray
// bottle, a beach umbrella -- so they take an icon instead, which reads as
// interface, takes brand colour, and looks the same on every device.
type Art = { emoji?: string; icon?: IconName; tint: string }

// Reused rather than extended -- every tint here already shipped in this file,
// so adding a category can never introduce an unreviewed colour.
const TINT = {
  meat: '#FFE7DC',
  chicken: '#FFF1E0',
  warm: '#FDE9D0',
  sea: '#E3F2F1',
  green: '#E6F4EA',
  lilac: '#EFEAFB',
  veg: '#E9F6E6',
  dairy: '#FFF6DE',
  drink: '#E4F4FB',
  fries: '#FDEBD3',
  bake: '#FBEEDD',
  neutral: '#F4EEE3',
} as const

const MAP: Record<string, Art> = {
  // mains
  'برجر': { emoji: '🍔', tint: TINT.meat },
  'لحوم': { emoji: '🥩', tint: TINT.meat },
  'سندويتشات لحم': { emoji: '🥙', tint: TINT.meat },
  'دجاج': { emoji: '🍗', tint: TINT.chicken },
  'دواجن': { emoji: '🍗', tint: TINT.chicken },
  'سندويتشات دجاج': { emoji: '🥙', tint: TINT.chicken },
  'بيتزا': { emoji: '🍕', tint: TINT.warm },
  'باستا': { emoji: '🍝', tint: TINT.warm },
  'أرز': { emoji: '🍚', tint: TINT.warm },
  'طواجن': { emoji: '🥘', tint: TINT.warm },
  'صواني': { emoji: '🥘', tint: TINT.warm },
  'شوربات': { emoji: '🍲', tint: TINT.warm },
  'أسماك': { emoji: '🦐', tint: TINT.sea },
  'مأكولات بحرية': { emoji: '🦐', tint: TINT.sea },

  // meals & offers
  'وجبات': { emoji: '🍱', tint: TINT.warm },
  'وجبات عائلية': { emoji: '🍱', tint: TINT.warm },
  'وجبات فردية': { emoji: '🍱', tint: TINT.warm },
  'وجبات الاطفال': { emoji: '🧒', tint: TINT.lilac },
  'أطفال': { emoji: '🧒', tint: TINT.lilac },
  'هابي ميل': { emoji: '🎁', tint: TINT.lilac },
  'عروض': { icon: 'tag', tint: TINT.green },

  // breakfast & sides
  'فطار': { emoji: '🍳', tint: TINT.bake },
  'بيض': { emoji: '🍳', tint: TINT.bake },
  'فول وطعمية': { emoji: '🥙', tint: TINT.bake },
  // Added when the 2026-08-04 category cleanup split أرابياتا's five
  // "سندوتشات X" tabs down to the filling alone. Substring matching only works
  // in one direction -- a short key like "فول" cannot match the longer
  // "فول وطعمية" entry -- so each short form needs its own line.
  'فول': { emoji: '🥙', tint: TINT.bake },
  'طعمية': { emoji: '🥙', tint: TINT.bake },
  'متنوعة': { emoji: '🥙', tint: TINT.bake },
  'ساندويتشات لحم': { emoji: '🥙', tint: TINT.meat },
  'ساندويتشات دجاج': { emoji: '🥙', tint: TINT.chicken },
  'سينابون رولز': { emoji: '🍩', tint: TINT.bake },
  'تشيز كيك سيناميكس': { emoji: '🍰', tint: TINT.bake },
  'رول-اون-ذا-جو': { emoji: '🥐', tint: TINT.bake },
  'ماتشا': { emoji: '🍵', tint: TINT.veg },
  'مقبلات': { emoji: '🥗', tint: TINT.veg },
  'سلطات': { emoji: '🥗', tint: TINT.veg },
  'أطباق جانبية': { emoji: '🥔', tint: TINT.fries },
  'بطاطس': { emoji: '🍟', tint: TINT.fries },
  'سناكس': { emoji: '🍟', tint: TINT.fries },
  'إضافات': { emoji: '🧂', tint: TINT.neutral },

  // sweet & drinks
  'حلو': { emoji: '🍰', tint: TINT.bake },
  'حلويات': { emoji: '🍰', tint: TINT.bake },
  'مخبوزات': { emoji: '🥐', tint: TINT.bake },
  'مشروبات': { emoji: '🧃', tint: TINT.drink },
  'ماك كافيه': { emoji: '☕', tint: TINT.drink },
  'قهوة': { emoji: '☕', tint: TINT.drink },

  // non-food vendors
  'أدوية': { icon: 'pill', tint: TINT.green },
  'أجهزة طبية': { icon: 'stethoscope', tint: TINT.green },
  'عناية شخصية': { icon: 'handSoap', tint: TINT.lilac },
  'مستلزمات الأطفال': { icon: 'baby', tint: TINT.lilac },
  'خضار وفاكهة': { icon: 'carrot', tint: TINT.veg },
  'ألبان': { icon: 'cheese', tint: TINT.dairy },
  'بقالة': { icon: 'basket', tint: TINT.neutral },
  'منظفات': { icon: 'sprayBottle', tint: TINT.drink },
  'مستلزمات الشاطئ': { icon: 'umbrella', tint: TINT.sea },
}

const DEFAULT: Art = { emoji: '🍽️', tint: TINT.neutral }

/**
 * The Arabic vendors type is not the Arabic this map was written in. Fold the
 * differences that carry no meaning here:
 *   أ إ آ  -> ا    hamza forms, typed inconsistently
 *   ى      -> ي    "هابى ميل" and "هابي ميل" are both in the live data
 *   ة      -> ه    "وجبات عائلية" and "وجبات عائليه" likewise
 *   ـ      dropped  tatweel, a purely typographic stretch
 *   leading "ال"   "الدجاج" and "دجاج" are the same category
 */
// Exported because the home search needed exactly this and did not have it: a
// customer typing «كشرى» found nothing, because the vendor is «كشري بلازا».
// Arabic has several spellings of the same word and a raw includes() treats
// them as different strings. This file already knew that -- it was written
// because the data said «الدجاج» and the map said «دجاج» -- so search should
// use the same folding rather than grow its own.
export function normaliseArabic(s: string): string {
  const folded = (s || '')
    .replace(/ـ/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
  return folded.startsWith('ال') ? folded.slice(2) : folded
}

const normalise = normaliseArabic

// Built once, sorted longest-key-first so substring matching cannot pick a
// shorter, wronger entry: "سندويتشات دجاج" must match the sandwich, not the
// bare "دجاج" it happens to contain. Same trap as item_unavailable/unavailable.
const ENTRIES: Array<[string, Art]> = Object.entries(MAP)
  .map(([k, v]) => [normalise(k), v] as [string, Art])
  .sort((a, b) => b[0].length - a[0].length)

const EXACT = new Map(ENTRIES)

export function artFor(category: string): Art {
  const key = normalise(category)
  if (!key) return DEFAULT

  const exact = EXACT.get(key)
  if (exact) return exact

  for (const [k, art] of ENTRIES) {
    if (key.includes(k)) return art
  }
  return DEFAULT
}

// ---------------------------------------------------------------------------
// Cross-vendor browse
//
// A customer can only find food by already knowing which restaurant sells it.
// There is no way to ask "who does seafood?".
//
// A first attempt derived the answer from item categories, and testing killed
// it: كنتاكي files all seven of its items under "وجبات", and هارت أتاك uses
// "وجبات عائلية / فردية / أطفال". Those words describe a portion size, not a
// food, so two whole vendors matched nothing. Item categories are written by
// vendors for their own menu, and they are not comparable across vendors.
//
// restaurants.category already is comparable -- it is curated per vendor and is
// printed on every restaurant card today. It only needs its spelling folded:
// "فاست فود" and "فاست فوود" are the same thing, as are "أسماك وبحري" and
// "سي فوود".
// ---------------------------------------------------------------------------

export type VendorKind = 'فاست فود' | 'بيتزا' | 'بحري' | 'شرقي' | 'مشويات' | 'حلويات' | 'أخرى'

const KIND_MAP: Record<string, VendorKind> = {
  'فاست فود': 'فاست فود',
  'فاست فوود': 'فاست فود',
  'برجر': 'فاست فود',
  'بيتزا': 'بيتزا',
  'اسماك وبحري': 'بحري',
  'سي فوود': 'بحري',
  'اسماك': 'بحري',
  'ماكولات بحرية': 'بحري',
  'فطار واكل شرقي': 'شرقي',
  'اكل شرقي': 'شرقي',
  'فطار': 'شرقي',
  'مشويات': 'مشويات',
  'حلويات': 'حلويات',
  'مخبوزات': 'حلويات',
}

const KIND_ENTRIES: Array<[string, VendorKind]> = Object.entries(KIND_MAP)
  .map(([k, v]) => [normalise(k), v] as [string, VendorKind])
  .sort((a, b) => b[0].length - a[0].length)

const KIND_EXACT = new Map(KIND_ENTRIES)

/** Which browse bucket a vendor belongs to, from its own curated category. */
export function vendorKind(category: string | null | undefined): VendorKind {
  const key = normalise(category ?? '')
  if (!key) return 'أخرى'

  const exact = KIND_EXACT.get(key)
  if (exact) return exact

  for (const [k, kind] of KIND_ENTRIES) {
    if (key.includes(k)) return kind
  }
  return 'أخرى'
}

/** Display order and icon for the browse row. 'أخرى' is deliberately absent:
 *  it is a fallback for matching, never something to offer as a filter. */
export const BROWSE_KINDS: Array<{ kind: VendorKind; emoji: string }> = [
  { kind: 'فاست فود', emoji: '🍔' },
  { kind: 'بيتزا', emoji: '🍕' },
  { kind: 'بحري', emoji: '🦐' },
  { kind: 'شرقي', emoji: '🍳' },
  { kind: 'مشويات', emoji: '🔥' },
  { kind: 'حلويات', emoji: '🍰' },
]
