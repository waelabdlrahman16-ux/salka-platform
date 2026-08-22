import { withSupabase } from "@supabase/server"
import { fail,isRateLimitError,json } from "../_shared/secure.ts"
type Db={public:{Tables:Record<string,never>;Views:Record<string,never>;Enums:Record<string,never>;CompositeTypes:Record<string,never>;Functions:Record<string,{Args:Record<string,unknown>;Returns:unknown}>}}
type Action="assign"|"forceDelivered"|"markFailed"|"reassign"|"resolveNoAnswer"|"staffPickup"|"unassign"
const ACTIONS=new Set<Action>(["assign","forceDelivered","markFailed","reassign","resolveNoAnswer","staffPickup","unassign"])
const KNOWN=["admin_only","already_assigned","assignment_not_found","compound_id_required","compound_missing_fee","dispatch_rule_blocked","driver_already_declined","driver_not_found","driver_suspended","invalid_action","invalid_collect_amount","missing_customer_details","no_active_assignment","not_authorized","not_your_pool","order_closed","order_not_found","order_not_paid","order_not_priced","quote_not_accepted","reason_required","restaurant_not_found","too_many_attempts"]
const id=(v:unknown)=>Number.isInteger(v)&&Number(v)>0&&Number(v)<=2147483647?Number(v):null
const str=(v:unknown,max:number,empty=false)=>typeof v==="string"&&v.trim().length<=max&&(empty||v.trim())?v.trim():null
async function digest(v:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("")}
const handler=withSupabase<Db>({auth:"user"},async(req,ctx)=>{
 if(req.method!=="POST")return json({error:"method_not_allowed"},405)
 if(Number(req.headers.get("content-length")??0)>8192)return json({error:"request_too_large"},413)
 let body:unknown;try{body=await req.json()}catch{return json({error:"invalid_json"},400)}
 if(!body||typeof body!=="object"||Array.isArray(body))return json({error:"invalid_request"},400)
 const x=body as Record<string,unknown>,action=x.action;if(typeof action!=="string"||!ACTIONS.has(action as Action))return json({error:"invalid_action"},400)
 const uid=ctx.userClaims?.id;if(!uid)return json({error:"not_logged_in"},401);const who=await digest(uid)
 for(const [bucket,max] of [[`dispatch:${action}:${who}`,15],["dispatch-global",500]] as const){const {error}=await ctx.supabaseAdmin.rpc("check_rate_limit",{p_bucket:bucket,p_max:max,p_window:"10 minutes"});if(error){if(isRateLimitError(error))return json({error:"rate_limited"},429);return fail("dispatch-operations","rate_limit_check_failed",500,error)}}
 let fn="",args:Record<string,unknown>={};const orderId=id(x.orderId),assignmentId=id(x.assignmentId),driverId=id(x.driverId)
 if(action==="assign"){if(!orderId||!driverId)return json({error:"invalid_dispatch_input"},400);fn="admin_assign_order";args={p_order_id:orderId,p_driver_id:driverId,p_force:x.force===true}}
 else if(action==="unassign"){const reason=str(x.reason,500,true);if(!orderId||reason===null)return json({error:"invalid_dispatch_input"},400);fn="admin_unassign_order";args={p_order_id:orderId,p_reason:reason||"admin_unassigned"}}
 else if(action==="reassign"){const reason=str(x.reason,500,true);if(!orderId||!driverId||reason===null)return json({error:"invalid_dispatch_input"},400);fn="admin_reassign_order";args={p_order_id:orderId,p_driver_id:driverId,p_reason:reason||"admin_reassigned"}}
 else if(action==="forceDelivered"){const reason=str(x.reason,500);if(!orderId||!reason||typeof x.cashCollected!=="boolean")return json({error:"invalid_dispatch_input"},400);fn="admin_force_delivered";args={p_order_id:orderId,p_reason:reason,p_cash_collected:x.cashCollected}}
 else if(action==="resolveNoAnswer"){if(!assignmentId||typeof x.resolution!=="string"||!["wait","contact","fail","refund","cancel"].includes(x.resolution))return json({error:"invalid_dispatch_input"},400);fn="admin_resolve_no_answer";args={p_assignment_id:assignmentId,p_action:x.resolution}}
 else if(action==="markFailed"){if(!assignmentId)return json({error:"invalid_dispatch_input"},400);fn="mark_delivery_failed";args={p_assignment_id:assignmentId}}
 else{const restaurantId=id(x.restaurantId),compoundId=id(x.compoundId),name=str(x.customerName,120),phone=str(x.customerPhone,24),unit=str(x.unitNumber,120),notes=str(x.addressNotes,1000,true),request=str(x.requestNotes,1000,true),amount=Number(x.collectAmount);if(!restaurantId||!compoundId||!name||!phone||!unit||notes===null||request===null||!Number.isFinite(amount)||amount<0||amount>1000000)return json({error:"invalid_dispatch_input"},400);fn="staff_create_pickup_order";args={p_restaurant_id:restaurantId,p_customer_name:name,p_customer_phone:phone,p_compound_id:compoundId,p_unit_number:unit,p_address_notes:notes,p_collect_amount:amount,p_request_notes:request}}
 const result=await ctx.supabaseAdmin.rpc(fn,{...args,p_auth_user_id:uid})
 if(result.error){const known=KNOWN.find(c=>result.error?.message?.includes(c));if(known)return json({error:known},known==="admin_only"?403:400);return fail("dispatch-operations","dispatch_action_failed",500,result.error)}
 return json({ok:true,data:result.data??null})
});export default{fetch:handler}
