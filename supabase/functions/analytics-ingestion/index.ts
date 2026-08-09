import { withSupabase } from "@supabase/server"
import { fail, isRateLimitError, json } from "../_shared/secure.ts"

type Db = { public: { Tables: Record<string, never>; Views: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>; Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }> } }
const EVENTS = new Set(["arrival","place_chosen","vendor_opened","item_added","customization_opened","customization_abandoned","checkout_started","checkout_blocked","order_placed"])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function id(value: unknown): number | null | undefined { return value == null ? null : Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2_147_483_647 ? Number(value) : undefined }
async function hmac(value: string): Promise<string> {
  const pepper = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!pepper) throw new Error("missing_rate_limit_pepper")
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(pepper),{name:"HMAC",hash:"SHA-256"},false,["sign"])
  const bytes = await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("")
}
function missingOverload(error: { code?: string; message?: string } | null): boolean { return error?.code === "PGRST202" || !!error?.message?.includes("Could not find the function") }

const handler = withSupabase<Db>({ auth: ["user","publishable"] }, async (req,ctx) => {
  if (req.method !== "POST") return json({error:"method_not_allowed"},405)
  if (Number(req.headers.get("content-length") ?? 0) > 4096) return json({error:"request_too_large"},413)
  let body: unknown; try { body = await req.json() } catch { return json({error:"invalid_json"},400) }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({error:"invalid_request"},400)
  const input = body as Record<string,unknown>
  const event = input.event, deviceId = typeof input.deviceId === "string" ? input.deviceId.trim() : ""
  const sessionId = input.sessionId == null ? null : typeof input.sessionId === "string" && UUID.test(input.sessionId) ? input.sessionId : undefined
  const compoundId=id(input.compoundId),restaurantId=id(input.restaurantId),orderId=id(input.orderId)
  const props=input.props ?? {}
  if (typeof event !== "string" || !EVENTS.has(event) || !deviceId || deviceId.length > 64 || sessionId === undefined || compoundId === undefined || restaurantId === undefined || orderId === undefined || !props || typeof props !== "object" || Array.isArray(props) || JSON.stringify(props).length > 2000) return json({error:"invalid_analytics_event"},400)
  if (!Object.values(props as Record<string,unknown>).every(v=>typeof v === "string" || typeof v === "number" || typeof v === "boolean")) return json({error:"invalid_analytics_event"},400)
  let digest: string; try { digest=await hmac(deviceId) } catch(error) { return fail("analytics-ingestion","rate_limit_identity_failed",500,error) }
  for (const [bucket,max] of [[`analytics-device:${digest}`,30],["analytics-global",300]] as const) {
    const {error}=await ctx.supabaseAdmin.rpc("check_rate_limit",{p_bucket:bucket,p_max:max,p_window:"1 minute"})
    if(error){if(isRateLimitError(error))return json({error:"rate_limited"},429);return fail("analytics-ingestion","rate_limit_check_failed",500,error)}
  }
  const args={p_event:event,p_device_id:deviceId,p_session_id:sessionId,p_compound_id:compoundId,p_restaurant_id:restaurantId,p_order_id:orderId,p_props:props}
  let result=await ctx.supabaseAdmin.rpc("log_app_event",{...args,p_auth_user_id:ctx.userClaims?.id??null})
  if(missingOverload(result.error))result=await ctx.supabase.rpc("log_app_event",args)
  if(result.error)return fail("analytics-ingestion","analytics_write_failed",500,result.error)
  return json({ok:true,data:null})
})
export default { fetch: handler }
