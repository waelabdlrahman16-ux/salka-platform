import { withSupabase } from "@supabase/server"
import { fail, isRateLimitError, json } from "../_shared/secure.ts"

type Db = { public: { Tables: Record<string, never>; Views: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>; Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }> } }
type Action = "setAvailable" | "claimDevice" | "savePushToken" | "updateLocation" | "clearLocation" | "myStats" | "availableOrders"
const ACTIONS = new Set<Action>(["setAvailable","claimDevice","savePushToken","updateLocation","clearLocation","myStats","availableOrders"])
const KNOWN = ["not_a_driver","invalid_state","driver_suspended","finish_your_orders_first","invalid_device","device_locked","not_authenticated","bad_platform","empty_token"]
function clean(v: unknown,max: number): string | null { if(typeof v!=="string")return null;const s=v.trim();return s&&s.length<=max?s:null }
function finiteNum(v: unknown): number | null { return typeof v==="number" && Number.isFinite(v) ? v : null }
async function digest(v:string):Promise<string>{const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("")}

const handler=withSupabase<Db>({auth:"user"},async(req,ctx)=>{
  if(req.method!=="POST")return json({error:"method_not_allowed"},405)
  if(Number(req.headers.get("content-length")??0)>8192)return json({error:"request_too_large"},413)
  let body:unknown;try{body=await req.json()}catch{return json({error:"invalid_json"},400)}
  if(!body||typeof body!=="object"||Array.isArray(body))return json({error:"invalid_request"},400)
  const input=body as Record<string,unknown>,action=input.action
  if(typeof action!=="string"||!ACTIONS.has(action as Action))return json({error:"invalid_action"},400)
  const userId=ctx.userClaims?.id;if(!userId)return json({error:"not_logged_in"},401)
  const who=await digest(userId)
  // updateLocation is polled every 20s per driver (<=30/10min). availableOrders
  // and myStats are polled together every 10s via the same load() tick
  // (<=60/10min each) -- their per-user caps need headroom above that, not just
  // above the write actions'.
  const perUserMax = action==="updateLocation" ? 40 : (action==="availableOrders"||action==="myStats") ? 90 : 20
  for(const [bucket,max,window] of [[`driver-self:${action}:${who}`,perUserMax,"10 minutes"],["driver-self-global",4000,"10 minutes"]] as const){
    const {error}=await ctx.supabaseAdmin.rpc("check_rate_limit",{p_bucket:bucket,p_max:max,p_window:window})
    if(error){if(isRateLimitError(error))return json({error:"rate_limited"},429);return fail("driver-self-service","rate_limit_check_failed",500,error)}
  }
  let fn="",args:Record<string,unknown>={}
  if(action==="setAvailable"){
    if(typeof input.available!=="boolean")return json({error:"invalid_driver_input"},400)
    fn="driver_set_available";args={p_available:input.available}
  }else if(action==="claimDevice"){
    // Device pairing: this decides which physical phone acts as this driver, so
    // it gets the same strict, no-silent-defaults validation as the write paths
    // above rather than the looser treatment of the read-only actions below.
    const deviceId=clean(input.deviceId,200)
    if(!deviceId)return json({error:"invalid_device"},400)
    // An empty/whitespace label (no navigator, e.g.) is valid -- the DB function
    // nullifies it itself. Only a non-string value is a caller bug.
    if(input.label!=null&&typeof input.label!=="string")return json({error:"invalid_driver_input"},400)
    const label=typeof input.label==="string"?(clean(input.label,120)??''):null
    if(typeof input.label==="string"&&input.label.length>120)return json({error:"invalid_driver_input"},400)
    fn="driver_claim_device";args={p_device_id:deviceId,p_label:label}
  }else if(action==="savePushToken"){
    const token=clean(input.pushToken,4096),platform=input.platform
    if(!token||(platform!=="web"&&platform!=="android"&&platform!=="ios"))return json({error:"invalid_driver_input"},400)
    fn="save_my_push_token";args={p_push_token:token,p_platform:platform}
  }else if(action==="updateLocation"){
    const lat=finiteNum(input.lat),lng=finiteNum(input.lng)
    if(lat===null||lng===null||lat<-90||lat>90||lng<-180||lng>180)return json({error:"invalid_driver_input"},400)
    fn="update_my_location";args={p_lat:lat,p_lng:lng}
  }else if(action==="clearLocation"){
    fn="clear_my_location";args={}
  }else if(action==="myStats"){
    fn="my_driver_stats";args={}
  }else{
    fn="available_orders";args={}
  }
  const result=await ctx.supabaseAdmin.rpc(fn,{...args,p_auth_user_id:userId})
  if(result.error){const known=KNOWN.find(c=>result.error?.message?.includes(c));if(known)return json({error:known},400);return fail("driver-self-service","driver_action_failed",500,result.error)}
  return json({ok:true,data:result.data??null})
})
export default {fetch:handler}
