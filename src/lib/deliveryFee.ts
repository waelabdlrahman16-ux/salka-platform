// Mirrors the server-side delivery_fee_for_distance() SQL function.
// This is a display estimate only — the actual charge is always computed
// server-side in place_order/submit_custom_order/request_pickup from the
// compound's real distance, so this can't be spoofed by editing client code.
export function estimateDeliveryFee(distanceKm: number): number {
  let raw: number
  if (distanceKm <= 20) raw = 65 + 13.5 * (distanceKm - 10)
  else if (distanceKm <= 30) raw = 200 + 15 * (distanceKm - 20)
  else raw = 350 + 15 * (distanceKm - 30)
  return Math.max(30, Math.round(raw / 5) * 5)
}
