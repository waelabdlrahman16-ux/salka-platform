import { withSupabase } from "@supabase/server"
import { fail, isRateLimitError, json } from "../_shared/secure.ts"

type Db = { public: { Tables: Record<string, never>; Views: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>; Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }> } }
type Action = "customerDetail" | "customers" | "dailyReport" | "funnel" | "listAccounts" | "liveDeliveries" | "pendingRefunds" | "pushHealth" | "stalledOrders" | "validatePush" | "vendorsWithoutItems"
const ACTIONS = new Set<Action>(["customerDetail","customers","dailyReport","funnel","listAccounts","liveDeliveries","pendingRefunds","pushHealth","stalledOrders","validatePush","vendorsWithoutItems"])
const KNOWN = ["admin_only","not_authorized"]
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
function clean(v: unknown,max: number): string | null { if(typeof v!=="string")return null;const s=v.trim();return s&&s.length<=max?s:null }
async function digest(v:string):Promise<string>{const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("")}

const handler=withSupabase<Db>({auth:"user"},async(req,ctx)=>{
  if(req.method!=="POST")return json({error:"method_not_allowed"},405)
  if(Number(req.headers.get("content-length")??0)>4096)return json({error:"request_too_large"},413)
  let body:unknown;try{body=await req.json()}catch{return json({error:"invalid_json"},400)}
  if(!body||typeof body!=="object"||Array.isArray(body))return json({error:"invalid_request"},400)
  const input=body as Record<string,unknown>,action=input.action
  if(typeof action!=="string"||!ACTIONS.has(action as Action))return json({error:"invalid_action"},400)
  const userId=ctx.userClaims?.id;if(!userId)return json({error:"not_logged_in"},401)
  const who=await digest(userId)
  // Admin.tsx's dashboard load() runs every 15s and fires stalledOrders,
  // pendingRefunds, liveDeliveries and listAccounts every single cycle --
  // <=40 calls/10min each, above the flat 30 every other action here got.
  // A left-open admin dashboard hit its own rate limit on a cycle; confirmed
  // in production logs (admin-reports 429s recurring every ~15s for a real
  // admin session). The other six actions are user-triggered, not polled,
  // and keep the tighter cap.
  const POLLED = new Set(["stalledOrders","pendingRefunds","liveDeliveries","listAccounts"])
  const perUserMax = POLLED.has(action) ? 90 : 30
  for(const [bucket,max,window] of [[`admin-reports:${action}:${who}`,perUserMax,"10 minutes"],["admin-reports-global",600,"10 minutes"]] as const){
    const {error}=await ctx.supabaseAdmin.rpc("check_rate_limit",{p_bucket:bucket,p_max:max,p_window:window})
    if(error){if(isRateLimitError(error))return json({error:"rate_limited"},429);return fail("admin-reports","rate_limit_check_failed",500,error)}
  }
  if(action==="validatePush"){
    // Do not bypass the database's canonical admin/supervisor authorization
    // merely because this action has no RPC result of its own.
    const authorization=await ctx.supabaseAdmin.rpc("admin_push_health",{p_auth_user_id:userId})
    if(authorization.error){
      const known=KNOWN.find(c=>authorization.error?.message?.includes(c))
      if(known)return json({error:known},403)
      return fail("admin-reports","push_health_authorization_failed",500,authorization.error)
    }
    // push-health uses FCM validate_only: it checks whether every stored token
    // is still registered without delivering a banner or sound. Keep its
    // webhook secret server-to-server; the browser only receives the result.
    const url=Deno.env.get("SUPABASE_URL"),secret=Deno.env.get("PUSH_WEBHOOK_SECRET")
    if(!url||!secret)return fail("admin-reports","push_health_not_configured",500)
    let response:Response
    try{
      response=await fetch(`${url}/functions/v1/push-health`,{method:"POST",headers:{"x-webhook-secret":secret,"content-type":"application/json"},body:"{}"})
    }catch(error){return fail("admin-reports","push_health_unreachable",502,error)}
    const data=await response.json().catch(()=>null)
    if(!response.ok||!data||typeof data!=="object")return fail("admin-reports","push_health_failed",502,data)
    return json({ok:true,data})
  }
  let fn="",args:Record<string,unknown>={}
  if(action==="customerDetail"){
    const phone=clean(input.phone,24);if(!phone)return json({error:"invalid_phone"},400)
    fn="admin_customer_detail";args={p_phone:phone}
  }else if(action==="customers"){
    fn="admin_customers";args={}
  }else if(action==="dailyReport"){
    const date=input.date==null?null:clean(input.date,10)
    if(input.date!=null&&(!date||!DATE_RE.test(date)))return json({error:"invalid_request"},400)
    fn="admin_daily_report";args={p_date:date}
  }else if(action==="funnel"){
    const days=input.days==null?7:Number(input.days)
    if(!Number.isInteger(days)||days<1||days>365)return json({error:"invalid_request"},400)
    fn="admin_funnel";args={p_days:days}
  }else if(action==="listAccounts"){
    fn="admin_list_accounts";args={}
  }else if(action==="liveDeliveries"){
    fn="admin_live_deliveries";args={}
  }else if(action==="pendingRefunds"){
    fn="admin_pending_refunds";args={}
  }else if(action==="pushHealth"){
    fn="admin_push_health";args={}
  }else if(action==="stalledOrders"){
    fn="admin_stalled_orders";args={}
  }else{
    fn="admin_vendors_without_items";args={}
  }
  const result=await ctx.supabaseAdmin.rpc(fn,{...args,p_auth_user_id:userId})
  if(result.error){const known=KNOWN.find(c=>result.error?.message?.includes(c));if(known)return json({error:known},403);return fail("admin-reports","report_action_failed",500,result.error)}
  return json({ok:true,data:result.data??null})
})
export default {fetch:handler}
