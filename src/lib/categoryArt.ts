// Menu items don't have photography yet. Rather than faking product photos,
// give each category a distinct emoji + soft tinted tile so the grid still
// reads as a real, browsable catalog.
const MAP: Record<string, { emoji: string; tint: string }> = {
  'برجر': { emoji: '🍔', tint: '#FFE7DC' },
  'دجاج': { emoji: '🍗', tint: '#FFF1E0' },
  'بيتزا': { emoji: '🍕', tint: '#FDE9D0' },
  'أسماك': { emoji: '🦐', tint: '#E3F2F1' },
  'مأكولات بحرية': { emoji: '🦐', tint: '#E3F2F1' },
  'أدوية': { emoji: '💊', tint: '#E6F4EA' },
  'عناية شخصية': { emoji: '🧴', tint: '#EFEAFB' },
  'خضار وفاكهة': { emoji: '🥦', tint: '#E9F6E6' },
  'ألبان': { emoji: '🧀', tint: '#FFF6DE' },
  'مشروبات': { emoji: '🧃', tint: '#E4F4FB' },
  'سناكس': { emoji: '🍟', tint: '#FDEBD3' },
  'مخبوزات': { emoji: '🥐', tint: '#FBEEDD' },
}

export function artFor(category: string) {
  return MAP[category] ?? { emoji: '🍽️', tint: '#EAF1F0' }
}
