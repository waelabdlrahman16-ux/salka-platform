import { withSupabase } from "@supabase/server"
import { fail, isRateLimitError, json } from "../_shared/secure.ts"

type Db = { public: { Tables: Record<string, never>; Views: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>; Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }> } }
type Action = "upsertCompound" | "setCompoundFee" | "flagDriverDispute"
const ACTIONS = new Set<Action>(["upsertCompound","setCompoundFee","flagDriverDispute"])
const KNOWN = ["admin_only","compound_not_found","complaint_not_found","delivery_fee_required","fee_too_large","invalid_direction","invalid_fee","name_required","no_driver_on_this_complaint","region_not_found"]
function positiveId(v: unknown): number | null { return Number.isInteger(v) && Number(v)>0 && Number(v)<=2_147_483_647 ? Number(v) : null }
function clean(v: unknown,max: number): string | null { if(typeof v!=="string")return null;const s=v.trim();return s&&s.length<=max?s:null }
function finiteNum(v: unknown): number | null { return typeof v==="number"&&Number.isFinite(v)?v:null }
function missing(error: { code?: string; message?: string } | null): boolean { return error?.code==="PGRST202"||!!error?.message?.includes("Could not find the function") }
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
  for(const [bucket,max,window] of [[`admin-compound:${action}:${who}`,15,"10 minutes"],["admin-compound-global",300,"10 minutes"]] as const){
    const {error}=await ctx.supabaseAdmin.rpc("check_rate_limit",{p_bucket:bucket,p_max:max,p_window:window})
    if(error){if(isRateLimitError(error))return json({error:"rate_limited"},429);return fail("admin-compound-actions","rate_limit_check_failed",500,error)}
  }
  let fn="",args:Record<string,unknown>={}
  if(action==="upsertCompound"){
    const id=input.id==null?null:positiveId(input.id),name=clean(input.name,120),regionId=positiveId(input.regionId),fee=finiteNum(input.deliveryFee),distance=input.distanceKm==null?null:finiteNum(input.distanceKm),direction=input.direction,lat=input.latitude==null?null:finiteNum(input.latitude),lng=input.longitude==null?null:finiteNum(input.longitude)
    if((input.id!=null&&!id)||!name||!regionId||fee===null||(input.distanceKm!=null&&distance===null)||(direction!=null&&direction!=="north"&&direction!=="south")||(input.latitude!=null&&lat===null)||(input.longitude!=null&&lng===null)||(input.active!=null&&typeof input.active!=="boolean"))return json({error:"invalid_vendor_input"},400)
    fn="admin_upsert_compound";args={p_id:id,p_name:name,p_region_id:regionId,p_delivery_fee:fee,p_distance_km:distance,p_direction:direction??null,p_latitude:lat,p_longitude:lng,p_active:input.active??true}
  }else if(action==="setCompoundFee"){
    const compoundId=positiveId(input.compoundId),fee=finiteNum(input.fee)
    if(!compoundId||fee===null)return json({error:"invalid_vendor_input"},400)
    fn="admin_set_compound_fee";args={p_compound_id:compoundId,p_fee:fee}
  }else{
    const complaintId=positiveId(input.complaintId),note=input.note==null?"":typeof input.note==="string"?input.note.trim():undefined
    if(!complaintId||note===undefined||note.length>1000)return json({error:"invalid_dispatch_input"},400)
    fn="admin_flag_driver_dispute";args={p_complaint_id:complaintId,p_note:note}
  }
  let result=await ctx.supabaseAdmin.rpc(fn,{...args,p_auth_user_id:userId})
  if(missing(result.error))result=await ctx.supabase.rpc(fn,args)
  if(result.error){const known=KNOWN.find(c=>result.error?.message?.includes(c));if(known)return json({error:known},known==="admin_only"?403:400);return fail("admin-compound-actions","vendor_action_failed",500,result.error)}
  return json({ok:true,data:result.data??null})
})
export default {fetch:handler}
