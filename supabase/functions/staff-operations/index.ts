import{withSupabase}from"@supabase/server";import{fail,isRateLimitError,json}from"../_shared/secure.ts"
type Db={public:{Tables:Record<string,never>;Views:Record<string,never>;Enums:Record<string,never>;CompositeTypes:Record<string,never>;Functions:Record<string,{Args:Record<string,unknown>;Returns:unknown}>}}
type Action="acceptSwap"|"escalateSwap"|"openSwaps"|"requestEarlySettlement"|"requestSwap"|"vendorOpenStates"
const ACTIONS=new Set<Action>(["acceptSwap","escalateSwap","openSwaps","requestEarlySettlement","requestSwap","vendorOpenStates"])
// The driver shift board and the admin vendor grid both poll on an interval, so
// the two reads get a far larger budget than the swap writes.
const READS=new Set<Action>(["openSwaps","vendorOpenStates"])
const KNOWN=["already_requested","cannot_accept_own_request","not_a_driver","not_authorized","not_your_request","not_your_shift","request_unavailable"]
const id=(v:unknown)=>Number.isInteger(v)&&Number(v)>0&&Number(v)<=2147483647?Number(v):null
async function digest(v:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("")}
const handler=withSupabase<Db>({auth:"user"},async(req,ctx)=>{if(req.method!=="POST")return json({error:"method_not_allowed"},405);if(Number(req.headers.get("content-length")??0)>8192)return json({error:"request_too_large"},413)
 let b:unknown;try{b=await req.json()}catch{return json({error:"invalid_json"},400)}if(!b||typeof b!=="object"||Array.isArray(b))return json({error:"invalid_request"},400)
 const x=b as Record<string,unknown>,action=x.action;if(typeof action!=="string"||!ACTIONS.has(action as Action))return json({error:"invalid_action"},400)
 const uid=ctx.userClaims?.id;if(!uid)return json({error:"not_logged_in"},401);const who=await digest(uid)
 const perUser=READS.has(action as Action)?150:20
 for(const[bucket,max]of[[`staff-ops:${action}:${who}`,perUser],["staff-ops-global",1500]]as const){const{error}=await ctx.supabaseAdmin.rpc("check_rate_limit",{p_bucket:bucket,p_max:max,p_window:"10 minutes"});if(error){if(isRateLimitError(error))return json({error:"rate_limited"},429);return fail("staff-operations","rate_limit_check_failed",500,error)}}
 let fn="",args:Record<string,unknown>={};const requestId=id(x.requestId)
 if(action==="openSwaps"){fn="open_swaps"}
 else if(action==="vendorOpenStates"){fn="staff_vendor_open_states"}
 else if(action==="requestEarlySettlement"){fn="request_early_settlement"}
 else if(action==="acceptSwap"){if(!requestId)return json({error:"invalid_staff_input"},400);fn="accept_swap";args={p_request_id:requestId}}
 else if(action==="escalateSwap"){if(!requestId)return json({error:"invalid_staff_input"},400);fn="escalate_swap";args={p_request_id:requestId}}
 else{const shiftId=id(x.shiftId),reason=x.reason==null?"":(typeof x.reason==="string"?x.reason.trim():undefined)
  if(!shiftId||reason===undefined||reason.length>500)return json({error:"invalid_staff_input"},400)
  fn="request_swap";args={p_shift_id:shiftId,p_reason:reason}}
 const result=await ctx.supabaseAdmin.rpc(fn,{...args,p_auth_user_id:uid})
 if(result.error){const known=KNOWN.find(c=>result.error?.message?.includes(c));if(known)return json({error:known},known==="not_a_driver"||known==="not_authorized"?403:400);return fail("staff-operations","staff_action_failed",500,result.error)}
 return json({ok:true,data:result.data??null})});export default{fetch:handler}
