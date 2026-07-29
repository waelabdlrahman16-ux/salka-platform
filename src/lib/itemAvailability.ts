// Menu items can be time-windowed (e.g. breakfast sandwiches 9am-11am only).
// available_from/available_until are Postgres `time` values, returned as
// "HH:MM:SS" strings. Comparison is done in Cairo local time regardless of
// the customer's device timezone.
export function isItemAvailableNow(availableFrom: string | null, availableUntil: string | null): boolean {
  if (!availableFrom || !availableUntil) return true
  const nowCairo = new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo', hour12: false })
  return nowCairo >= availableFrom && nowCairo <= availableUntil
}
