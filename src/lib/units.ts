export const UNIT_ICONS: Record<string, string> = {
  '小小工程师': '🧱',
  '生物的多样性': '🌿',
  '宇宙': '🪐',
  '物质的变化': '🧪',
};

export function unitIcon(unit?: string) {
  if (!unit) return '📘';
  return UNIT_ICONS[unit] ?? '📘';
}
