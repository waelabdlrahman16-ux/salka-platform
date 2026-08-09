import { withSupabase } from "@supabase/server"
import { fail, isRateLimitError, json } from "../_shared/secure.ts"

type SessionDatabase = {
  public: {
    Tables: Record<string, never>
    Views: Record<string, never>
    Functions: {
      check_rate_limit: {
        Args: { p_bucket: string; p_max: number; p_window: string }
        Returns: undefined
      }
      last_address_for_phone: {
        Args:
          | { p_phone: string; p_session_token: string | null; p_auth_user_id: string | null }
          | { p_phone: string; p_session_token: string | null }
        Returns: unknown
      }
      my_last_request: {
        Args:
          | { p_restaurant_id: number; p_session_token: string | null; p_auth_user_id: string | null }
          | { p_restaurant_id: number; p_session_token: string | null }
        Returns: unknown
      }
      my_orders: {
        Args:
          | { p_phone: string; p_session_token: string | null; p_auth_user_id: string | null }
          | { p_phone: string; p_session_token: string | null }
        Returns: unknown
      }
      session_logout: { Args: { p_token: string }; Returns: undefined }
      session_whoami: { Args: { p_token: string }; Returns: unknown }
      wallet_balance_for_phone: {
        Args:
          | { p_phone: string; p_session_token: string | null; p_auth_user_id: string | null }
          | { p_phone: string; p_session_token: string | null }
        Returns: number
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

type Action = "lastAddress" | "lastRequest" | "logout" | "orders" | "wallet" | "whoami"

const ACTION_LIMITS: Record<Action, number> = {
  lastAddress: 30,
  lastRequest: 30,
  logout: 20,
  orders: 30,
  wallet: 30,
  whoami: 60,
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function sessionToken(value: unknown): string | null | undefined {
  if (value == null || value === "") return null
  return typeof value === "string" && UUID.test(value) ? value : undefined
}

function phone(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length >= 8 && trimmed.length <= 24 && /^[0-9+()\s-]+$/.test(trimmed) ? trimmed : null
}

function positiveId(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2_147_483_647
    ? Number(value) : null
}

function missingNewOverload(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "PGRST202" || !!error?.message?.includes("Could not find the function")
}

async function identityDigest(req: Request, identity: string): Promise<string> {
  const pepper = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!pepper) throw new Error("missing_rate_limit_pepper")
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const fallback = forwarded || req.headers.get("cf-connecting-ip") || "unknown"
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(identity || fallback))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("")
}

const customerSessionAccess = withSupabase<SessionDatabase>(
  { auth: ["user", "publishable"] },
  async (req, ctx) => {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)
    const contentLength = Number(req.headers.get("content-length") ?? 0)
    if (contentLength > 8192) return json({ error: "request_too_large" }, 413)

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
    const token = sessionToken(input.sessionToken ?? input.token)
    if (token === undefined) return json({ error: "invalid_session_token" }, 400)
    const authUserId = ctx.userClaims?.id ?? null

    if ((safeAction === "whoami" || safeAction === "logout") && !token) {
      return json({ error: "invalid_session_token" }, 400)
    }

    let digest: string
    try { digest = await identityDigest(req, authUserId || token || "") } catch (error) {
      return fail("customer-session-access", "rate_limit_identity_failed", 500, error)
    }
    for (const [bucket, max, window] of [
      [`customer-session:${safeAction}:${digest}`, ACTION_LIMITS[safeAction], "1 minute"],
      [`customer-session-global:${safeAction}`, 5000, "1 minute"],
    ] as const) {
      const { error } = await ctx.supabaseAdmin.rpc("check_rate_limit", {
        p_bucket: bucket,
        p_max: max,
        p_window: window,
      })
      if (error) {
        if (isRateLimitError(error)) return json({ error: "rate_limited" }, 429)
        return fail("customer-session-access", "rate_limit_check_failed", 500, error)
      }
    }

    let result: { data: unknown; error: { code?: string; message?: string } | null }
    if (safeAction === "whoami") {
      result = await ctx.supabaseAdmin.rpc("session_whoami", { p_token: token! })
    } else if (safeAction === "logout") {
      result = await ctx.supabaseAdmin.rpc("session_logout", { p_token: token! })
    } else if (safeAction === "lastRequest") {
      const restaurantId = positiveId(input.restaurantId)
      if (!restaurantId) return json({ error: "invalid_customer_input" }, 400)
      result = await ctx.supabaseAdmin.rpc("my_last_request", {
        p_restaurant_id: restaurantId,
        p_session_token: token,
        p_auth_user_id: authUserId,
      })
      if (missingNewOverload(result.error)) {
        result = await ctx.supabase.rpc("my_last_request", {
          p_restaurant_id: restaurantId,
          p_session_token: token,
        })
      }
    } else {
      const customerPhone = phone(input.phone)
      if (!customerPhone) return json({ error: "invalid_phone" }, 400)
      if (safeAction === "lastAddress") {
        result = await ctx.supabaseAdmin.rpc("last_address_for_phone", {
          p_phone: customerPhone,
          p_session_token: token,
          p_auth_user_id: authUserId,
        })
        if (missingNewOverload(result.error)) {
          result = await ctx.supabase.rpc("last_address_for_phone", {
            p_phone: customerPhone,
            p_session_token: token,
          })
        }
      } else if (safeAction === "orders") {
        result = await ctx.supabaseAdmin.rpc("my_orders", {
          p_phone: customerPhone,
          p_session_token: token,
          p_auth_user_id: authUserId,
        })
        if (missingNewOverload(result.error)) {
          result = await ctx.supabase.rpc("my_orders", {
            p_phone: customerPhone,
            p_session_token: token,
          })
        }
      } else {
        result = await ctx.supabaseAdmin.rpc("wallet_balance_for_phone", {
          p_phone: customerPhone,
          p_session_token: token,
          p_auth_user_id: authUserId,
        })
        if (missingNewOverload(result.error)) {
          result = await ctx.supabase.rpc("wallet_balance_for_phone", {
            p_phone: customerPhone,
            p_session_token: token,
          })
        }
      }
    }

    if (result.error) {
      if (result.error.message?.includes("not_logged_in")) return json({ error: "not_logged_in" }, 401)
      return fail("customer-session-access", "customer_session_read_failed", 500, result.error)
    }
    return json({ ok: true, data: result.data })
  },
)

export default { fetch: customerSessionAccess }
