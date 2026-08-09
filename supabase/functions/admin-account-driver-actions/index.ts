import { withSupabase } from "@supabase/server"
import { fail, isRateLimitError, json } from "../_shared/secure.ts"

type Db = { public: { Tables: Record<string, never>; Views: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>; Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }> } }
type Action = "convertStaffRole" | "deleteCustomer" | "deleteCustomerByPhone" | "deleteStaff" | "resetDriverDevice" | "setCustomerBan" | "setVendorSlots" | "upsertDriver"
const ACTIONS = new Set<Action>(["convertStaffRole","deleteCustomer","deleteCustomerByPhone","deleteStaff","resetDriverDevice","setCustomerBan","setVendorSlots","upsertDriver"])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const KNOWN = ["admin_only","cannot_delete_admin","cannot_delete_self","cannot_target_self","customer_has_live_order","customer_has_wallet_balance","driver_has_live_delivery","driver_holds_cash","driver_not_found","has_live_orders","invalid_phone","invalid_payout_schedule","invalid_role","invalid_vehicle_type","name_required","no_account_for_phone","phone_already_used","phone_required","profile_not_found","target_not_convertible","vendor_not_found"]
function positiveId(v: unknown): number | null { return Number.isInteger(v) && Number(v)>0 && Number(v)<=2_147_483_647 ? Number(v) : null }
function clean(v: unknown,max: number): string | null { if(typeof v!=="string")return null;const s=v.trim();return s&&s.length<=max?s:null }
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
  for(const [bucket,max,window] of [[`admin-account:${action}:${who}`,10,"10 minutes"],["admin-account-global",300,"10 minutes"]] as const){
    const {error}=await ctx.supabaseAdmin.rpc("check_rate_limit",{p_bucket:bucket,p_max:max,p_window:window})
    if(error){if(isRateLimitError(error))return json({error:"rate_limited"},429);return fail("admin-account-driver-actions","rate_limit_check_failed",500,error)}
  }
  let fn="",args:Record<string,unknown>={}
  if(action==="convertStaffRole"){
    const profileId=clean(input.profileId,36),role=input.role
    if(!profileId||!UUID.test(profileId)||(role!=="catalog"&&role!=="supervisor"))return json({error:"invalid_account_input"},400)
    fn="admin_convert_staff_role";args={p_profile_id:profileId,p_role:role}
  }else if(action==="deleteStaff"){
    const profileId=clean(input.profileId,36);if(!profileId||!UUID.test(profileId)||(input.force!=null&&typeof input.force!=="boolean"))return json({error:"invalid_account_input"},400)
    fn="admin_delete_staff";args={p_profile_id:profileId,p_force:input.force===true}
  }else if(action==="deleteCustomer"){
    const customerId=positiveId(input.customerId);if(!customerId||(input.force!=null&&typeof input.force!=="boolean"))return json({error:"invalid_account_input"},400)
    fn="admin_delete_customer";args={p_customer_id:customerId,p_force:input.force===true}
  }else if(action==="deleteCustomerByPhone"){
    const phone=clean(input.phone,24);if(!phone||(input.force!=null&&typeof input.force!=="boolean"))return json({error:"invalid_account_input"},400)
    fn="admin_delete_customer_by_phone";args={p_phone:phone,p_force:input.force===true}
  }else if(action==="setVendorSlots"){
    const restaurantId=positiveId(input.restaurantId);if(!restaurantId||typeof input.enabled!=="boolean")return json({error:"invalid_account_input"},400)
    fn="admin_set_vendor_slots";args={p_restaurant_id:restaurantId,p_enabled:input.enabled}
  }else if(action==="resetDriverDevice"){
    const driverId=positiveId(input.driverId);if(!driverId)return json({error:"invalid_account_input"},400)
    fn="admin_reset_driver_device";args={p_driver_id:driverId}
  }else if(action==="setCustomerBan"){
    const phone=clean(input.phone,24),reason=input.reason==null?null:typeof input.reason==="string"?input.reason.trim():undefined
    if(!phone||typeof input.banned!=="boolean"||reason===undefined||(reason?.length??0)>500)return json({error:"invalid_account_input"},400)
    fn="admin_set_customer_ban";args={p_phone:phone,p_banned:input.banned===true,p_reason:reason||null}
  }else{
    const id=input.id==null?null:positiveId(input.id),name=clean(input.name,120),phone=clean(input.phone,24),vehicle=input.vehicleType,plate=typeof input.vehiclePlate==="string"?input.vehiclePlate.trim():"",instapay=input.instapayNumber==null?null:typeof input.instapayNumber==="string"?input.instapayNumber.trim():undefined,schedule=input.payoutSchedule
    if((input.id!=null&&!id)||!name||!phone||(vehicle!=="motorcycle"&&vehicle!=="van")||plate.length>40||instapay===undefined||(instapay?.length??0)>80||(schedule!=="daily"&&schedule!=="weekly")||(input.active!=null&&typeof input.active!=="boolean"))return json({error:"invalid_account_input"},400)
    fn="admin_upsert_driver";args={p_id:id,p_name:name,p_phone:phone,p_vehicle_type:vehicle,p_vehicle_plate:plate,p_instapay_number:instapay||null,p_payout_schedule:schedule,p_active:input.active!==false}
  }
  let result=await ctx.supabaseAdmin.rpc(fn,{...args,p_auth_user_id:userId})
  if(missing(result.error))result=await ctx.supabase.rpc(fn,args)
  if(result.error){const known=KNOWN.find(c=>result.error?.message?.includes(c));if(known)return json({error:known},known==="admin_only"?403:400);return fail("admin-account-driver-actions","account_action_failed",500,result.error)}
  return json({ok:true,data:result.data??null})
})
export default {fetch:handler}
