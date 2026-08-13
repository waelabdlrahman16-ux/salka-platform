import { withSupabase } from "@supabase/server"
import { fail, isRateLimitError, json } from "../_shared/secure.ts"

type Db = { public: { Tables: Record<string, never>; Views: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>; Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }> } }
type Action = "adjustOrder" | "confirmCodDeposit" | "confirmInstapay" | "creditWallet" | "markRefunded" | "settleCash" | "settleEarnings" | "markAuditTest" | "archiveOrder" | "deleteTestOrder"
const ACTIONS = new Set<Action>(["adjustOrder","confirmCodDeposit","confirmInstapay","creditWallet","markRefunded","settleCash","settleEarnings","markAuditTest","archiveOrder","deleteTestOrder"])
const KNOWN = ["admin_only","already_confirmed","audit_mark_too_late","deposit_not_required","driver_not_found","invalid_audit_reason","invalid_credit_amount","invalid_order_id","invalid_phone","negative_total","order_cancelled","order_not_closed","order_not_found","payment_not_claimed","reason_required","reason_too_long","refund_not_pending","test_order_has_financial_or_customer_history","test_order_required"]
function positiveId(v: unknown): number | null { return Number.isInteger(v) && Number(v) > 0 && Number(v) <= 2_147_483_647 ? Number(v) : null }
async function digest(v: string): Promise<string> { const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)); return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("") }

const handler = withSupabase<Db>({ auth: "user" }, async (req,ctx) => {
  if(req.method!=="POST")return json({error:"method_not_allowed"},405)
  if(Number(req.headers.get("content-length")??0)>4096)return json({error:"request_too_large"},413)
  let body:unknown;try{body=await req.json()}catch{return json({error:"invalid_json"},400)}
  if(!body||typeof body!=="object"||Array.isArray(body))return json({error:"invalid_request"},400)
  const input=body as Record<string,unknown>, action=input.action
  if(typeof action!=="string"||!ACTIONS.has(action as Action))return json({error:"invalid_action"},400)
  const userId=ctx.userClaims?.id;if(!userId)return json({error:"not_logged_in"},401)
  const who=await digest(userId)
  for(const [bucket,max,window] of [[`admin-financial:${action}:${who}`,10,"10 minutes"],["admin-financial-global",300,"10 minutes"]] as const){
    const {error}=await ctx.supabaseAdmin.rpc("check_rate_limit",{p_bucket:bucket,p_max:max,p_window:window})
    if(error){if(isRateLimitError(error))return json({error:"rate_limited"},429);return fail("admin-financial-actions","rate_limit_check_failed",500,error)}
  }
  let fn="",args:Record<string,unknown>={}
  if(action==="adjustOrder"){
    const orderId=positiveId(input.orderId),amount=Number(input.amount),reason=typeof input.reason==="string"?input.reason.trim():""
    if(!orderId||!Number.isFinite(amount)||amount===0||Math.abs(amount)>1_000_000||!reason||reason.length>500)return json({error:"invalid_financial_input"},400)
    fn="admin_adjust_order";args={p_order_id:orderId,p_amount:amount,p_reason:reason,p_charge_service_fee:input.chargeServiceFee===true}
  }else if(action==="creditWallet"){
    const amount=Number(input.amount),phone=typeof input.phone==="string"?input.phone.trim():"",reason=typeof input.reason==="string"?input.reason.trim():"",orderId=input.orderId==null?null:positiveId(input.orderId)
    if(!phone||phone.length>24||!Number.isFinite(amount)||amount<=0||amount>1_000_000||!reason||reason.length>500||(input.orderId!=null&&!orderId))return json({error:"invalid_financial_input"},400)
    fn="credit_wallet";args={p_phone:phone,p_amount:amount,p_reason:reason,p_order_id:orderId}
  }else if(action==="markAuditTest"){
    const orderId=positiveId(input.orderId),reason=typeof input.reason==="string"?input.reason.trim():""
    if(!orderId||reason.length<3||reason.length>500)return json({error:"invalid_audit_input"},400)
    fn="admin_mark_order_as_test";args={p_order_id:orderId,p_reason:reason}
  }else if(action==="archiveOrder"||action==="deleteTestOrder"){
    const orderId=positiveId(input.orderId)
    if(!orderId)return json({error:"invalid_financial_input"},400)
    fn=action==="archiveOrder"?"admin_archive_order":"admin_delete_test_order";args={p_order_id:orderId}
  }else{
    const targetId=positiveId(action==="settleCash"||action==="settleEarnings"?input.driverId:input.orderId)
    if(!targetId)return json({error:"invalid_financial_input"},400)
    if(action==="confirmCodDeposit"){fn="admin_confirm_cod_deposit";args={p_order_id:targetId}}
    else if(action==="confirmInstapay"){fn="admin_confirm_instapay_payment";args={p_order_id:targetId,p_force:input.force===true}}
    else if(action==="markRefunded"){fn="mark_refunded";args={p_order_id:targetId}}
    else if(action==="settleCash"){fn="settle_driver_cash";args={p_driver_id:targetId}}
    else{fn="settle_driver_earnings";args={p_driver_id:targetId}}
  }
  const result=await ctx.supabaseAdmin.rpc(fn,{...args,p_auth_user_id:userId})
  if(result.error){const known=KNOWN.find(c=>result.error?.message?.includes(c));if(known)return json({error:known},known==="admin_only"?403:400);return fail("admin-financial-actions","financial_action_failed",500,result.error)}
  return json({ok:true,data:result.data??null})
})
export default { fetch: handler }
