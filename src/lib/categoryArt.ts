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

type Art = { emoji: string; tint: string }

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
  'عروض': { emoji: '🏷️', tint: TINT.green },

  // breakfast & sides
  'فطار': { emoji: '🍳', tint: TINT.bake },
  'بيض': { emoji: '🍳', tint: TINT.bake },
  'فول وطعمية': { emoji: '🥙', tint: TINT.bake },
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
  'أدوية': { emoji: '💊', tint: TINT.green },
  'أجهزة طبية': { emoji: '🩺', tint: TINT.green },
  'عناية شخصية': { emoji: '🧴', tint: TINT.lilac },
  'مستلزمات الأطفال': { emoji: '🍼', tint: TINT.lilac },
  'خضار وفاكهة': { emoji: '🥦', tint: TINT.veg },
  'ألبان': { emoji: '🧀', tint: TINT.dairy },
  'بقالة': { emoji: '🛒', tint: TINT.neutral },
  'منظفات': { emoji: '🧼', tint: TINT.drink },
  'مستلزمات الشاطئ': { emoji: '🏖️', tint: TINT.sea },
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
function normalise(s: string): string {
  const folded = (s || '')
    .replace(/ـ/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
  return folded.startsWith('ال') ? folded.slice(2) : folded
}

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
