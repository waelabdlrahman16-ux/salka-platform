import { withSupabase } from "@supabase/server"
import { fail, isRateLimitError, json } from "../_shared/secure.ts"

type CatalogDatabase = {
  public: {
    Tables: Record<string, never>
    Views: Record<string, never>
    Functions: {
      check_rate_limit: {
        Args: { p_bucket: string; p_max: number; p_window: string }
        Returns: undefined
      }
      delivery_quote: {
        Args: { p_compound_id: number; p_restaurant_id: number | null }
        Returns: unknown
      }
      open_slots: { Args: { p_restaurant_id: number }; Returns: unknown }
      popular_request_items: { Args: { p_restaurant_id: number }; Returns: unknown }
      restaurant_public: { Args: { p_id: number }; Returns: unknown }
      restaurants_for_compound: { Args: { p_compound_id: number }; Returns: unknown }
      search_menu_for_compound: {
        Args: { p_compound_id: number; p_q: string; p_limit: number }
        Returns: unknown
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

type Action =
  | "deliveryQuote"
  | "openSlots"
  | "popularItems"
  | "restaurant"
  | "restaurants"
  | "searchMenu"

const ACTION_LIMITS: Record<Action, number> = {
  deliveryQuote: 60,
  openSlots: 60,
  popularItems: 30,
  restaurant: 90,
  restaurants: 90,
  searchMenu: 60,
}

function positiveId(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2_147_483_647
    ? Number(value) : null
}

async function clientDigest(req: Request): Promise<string> {
  // Supabase's ingress supplies x-forwarded-for. HMAC it before using it as a
  // database bucket: plain SHA-256 is not enough for IPv4 addresses because
  // their small search space makes them reversible by brute force.
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const address = forwarded || req.headers.get("cf-connecting-ip") || "unknown"
  const pepper = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!pepper) throw new Error("missing_rate_limit_pepper")
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(address))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("")
}

const publicCatalog = withSupabase<CatalogDatabase>({ auth: "publishable" }, async (req, ctx) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

  const contentLength = Number(req.headers.get("content-length") ?? 0)
  if (contentLength > 4096) return json({ error: "request_too_large" }, 413)

  let body: unknown
  try { body = await req.json() } catch { return json({ error: "invalid_json" }, 400) }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "invalid_request" }, 400)
  }

  const input = body as Record<string, unknown>
  const action = input.action
  if (typeof action !== "string" || !(action in ACTION_LIMITS)) {
    return json({ error: "invalid_action" }, 400)
  }
  const safeAction = action as Action

  let digest: string
  try { digest = await clientDigest(req) } catch (error) {
    return fail("public-catalog", "rate_limit_identity_failed", 500, error)
  }
  for (const [bucket, max, window] of [
    [`public-catalog:${safeAction}:${digest}`, ACTION_LIMITS[safeAction], "1 minute"],
    [`public-catalog-global:${safeAction}`, 5000, "1 minute"],
  ] as const) {
    const { error } = await ctx.supabaseAdmin.rpc("check_rate_limit", {
      p_bucket: bucket,
      p_max: max,
      p_window: window,
    })
    if (error) {
      if (isRateLimitError(error)) return json({ error: "rate_limited" }, 429)
      return fail("public-catalog", "rate_limit_check_failed", 500, error)
    }
  }

  let result: { data: unknown; error: { message?: string } | null }
  switch (safeAction) {
    case "deliveryQuote": {
      const compoundId = positiveId(input.compoundId)
      const restaurantId = input.restaurantId == null ? null : positiveId(input.restaurantId)
      if (!compoundId || (input.restaurantId != null && !restaurantId)) {
        return json({ error: "invalid_catalog_input" }, 400)
      }
      result = await ctx.supabaseAdmin.rpc("delivery_quote", {
        p_compound_id: compoundId,
        p_restaurant_id: restaurantId,
      })
      break
    }
    case "openSlots":
    case "popularItems":
    case "restaurant": {
      const restaurantId = positiveId(input.restaurantId)
      if (!restaurantId) return json({ error: "invalid_catalog_input" }, 400)
      if (safeAction === "openSlots") {
        result = await ctx.supabaseAdmin.rpc("open_slots", { p_restaurant_id: restaurantId })
      } else if (safeAction === "popularItems") {
        result = await ctx.supabaseAdmin.rpc("popular_request_items", { p_restaurant_id: restaurantId })
      } else {
        result = await ctx.supabaseAdmin.rpc("restaurant_public", { p_id: restaurantId })
      }
      break
    }
    case "restaurants": {
      const compoundId = positiveId(input.compoundId)
      if (!compoundId) return json({ error: "invalid_catalog_input" }, 400)
      result = await ctx.supabaseAdmin.rpc("restaurants_for_compound", { p_compound_id: compoundId })
      break
    }
    case "searchMenu": {
      const compoundId = positiveId(input.compoundId)
      const q = typeof input.q === "string" ? input.q.trim() : ""
      const limit = input.limit == null ? 12 : Number(input.limit)
      if (!compoundId || q.length < 2 || q.length > 80 || !Number.isInteger(limit) || limit < 1 || limit > 30) {
        return json({ error: "invalid_catalog_input" }, 400)
      }
      result = await ctx.supabaseAdmin.rpc("search_menu_for_compound", {
        p_compound_id: compoundId,
        p_q: q,
        p_limit: limit,
      })
      break
    }
  }

  if (result.error) return fail("public-catalog", "catalog_read_failed", 500, result.error)
  return json({ ok: true, data: result.data })
})

export default { fetch: publicCatalog }
