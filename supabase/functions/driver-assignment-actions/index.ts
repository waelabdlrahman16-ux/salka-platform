import { withSupabase } from "@supabase/server"
import { fail, isRateLimitError, json } from "../_shared/secure.ts"

type Db = { public: { Tables: Record<string, never>; Views: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>; Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }> } }
type Action = "claimOrder" | "acceptAssignment" | "arrivedAtRestaurant" | "markPickedUp" | "markOutForDelivery" | "confirmCashReceived" | "arrivedAtCustomer" | "calledCustomer" | "reportNoAnswer" | "reportProblem" | "rejectAssignment" | "markDelivered"
const ACTIONS = new Set<Action>(["claimOrder","acceptAssignment","arrivedAtRestaurant","markPickedUp","markOutForDelivery","confirmCashReceived","arrivedAtCustomer","calledCustomer","reportNoAnswer","reportProblem","rejectAssignment","markDelivered"])
const KNOWN = ["not_a_driver","driver_suspended","not_your_pool","not_ready_yet","already_taken","kitchen_not_accepted_yet","order_not_priced","wrong_vehicle_type","dispatch_rule_blocked","not_your_assignment","wrong_stage","must_arrive_first","order_not_ready","must_call_customer_first","too_early","reason_required","must_confirm_cash_first"]
function positiveId(v: unknown): number | null { return Number.isInteger(v) && Number(v)>0 && Number(v)<=2_147_483_647 ? Number(v) : null }
function clean(v: unknown,max: number): string | null { if(typeof v!=="string")return null;const s=v.trim();return s&&s.length<=max?s:null }
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
  for(const [bucket,max,window] of [[`driver-assignment:${action}:${who}`,30,"10 minutes"],["driver-assignment-global",1500,"10 minutes"]] as const){
    const {error}=await ctx.supabaseAdmin.rpc("check_rate_limit",{p_bucket:bucket,p_max:max,p_window:window})
    if(error){if(isRateLimitError(error))return json({error:"rate_limited"},429);return fail("driver-assignment-actions","rate_limit_check_failed",500,error)}
  }
  let fn="",args:Record<string,unknown>={}
  if(action==="claimOrder"){
    const orderId=positiveId(input.orderId);if(!orderId)return json({error:"invalid_assignment_input"},400)
    fn="claim_order";args={p_order_id:orderId}
  }else if(action==="acceptAssignment"){
    const assignmentId=positiveId(input.assignmentId),orderId=positiveId(input.orderId)
    if(!assignmentId||!orderId)return json({error:"invalid_assignment_input"},400)
    fn="driver_accept_assignment";args={p_assignment_id:assignmentId,p_order_id:orderId}
  }else if(action==="arrivedAtRestaurant"){
    const assignmentId=positiveId(input.assignmentId);if(!assignmentId)return json({error:"invalid_assignment_input"},400)
    fn="driver_arrived_at_restaurant";args={p_assignment_id:assignmentId}
  }else if(action==="markPickedUp"){
    const assignmentId=positiveId(input.assignmentId);if(!assignmentId)return json({error:"invalid_assignment_input"},400)
    fn="driver_mark_picked_up";args={p_assignment_id:assignmentId}
  }else if(action==="markOutForDelivery"){
    const assignmentId=positiveId(input.assignmentId);if(!assignmentId)return json({error:"invalid_assignment_input"},400)
    fn="driver_mark_out_for_delivery";args={p_assignment_id:assignmentId}
  }else if(action==="confirmCashReceived"){
    const assignmentId=positiveId(input.assignmentId);if(!assignmentId)return json({error:"invalid_assignment_input"},400)
    fn="driver_confirm_cash_received";args={p_assignment_id:assignmentId}
  }else if(action==="arrivedAtCustomer"){
    const assignmentId=positiveId(input.assignmentId);if(!assignmentId)return json({error:"invalid_assignment_input"},400)
    fn="driver_arrived_at_customer";args={p_assignment_id:assignmentId}
  }else if(action==="calledCustomer"){
    const assignmentId=positiveId(input.assignmentId);if(!assignmentId)return json({error:"invalid_assignment_input"},400)
    fn="driver_called_customer";args={p_assignment_id:assignmentId}
  }else if(action==="reportNoAnswer"){
    const assignmentId=positiveId(input.assignmentId);if(!assignmentId)return json({error:"invalid_assignment_input"},400)
    fn="driver_report_no_answer";args={p_assignment_id:assignmentId}
  }else if(action==="reportProblem"){
    const assignmentId=positiveId(input.assignmentId),reason=clean(input.reason,300)
    if(!assignmentId||!reason)return json({error:"invalid_assignment_input"},400)
    fn="driver_report_problem";args={p_assignment_id:assignmentId,p_reason:reason}
  }else if(action==="rejectAssignment"){
    const assignmentId=positiveId(input.assignmentId)
    if(!assignmentId||(input.reason!=null&&typeof input.reason!=="string")||(typeof input.reason==="string"&&input.reason.length>300))return json({error:"invalid_assignment_input"},400)
    fn="driver_reject_assignment";args={p_assignment_id:assignmentId,p_reason:typeof input.reason==="string"?input.reason.trim():""}
  }else{
    const assignmentId=positiveId(input.assignmentId),orderId=positiveId(input.orderId)
    if(!assignmentId||!orderId)return json({error:"invalid_assignment_input"},400)
    fn="mark_delivered";args={p_assignment_id:assignmentId,p_order_id:orderId}
  }
  const result=await ctx.supabaseAdmin.rpc(fn,{...args,p_auth_user_id:userId})
  if(result.error){const known=KNOWN.find(c=>result.error?.message?.includes(c));if(known)return json({error:known},400);return fail("driver-assignment-actions","assignment_action_failed",500,result.error)}
  return json({ok:true,data:result.data??null})
})
export default {fetch:handler}
