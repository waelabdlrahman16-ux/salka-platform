import{withSupabase}from"@supabase/server";import{fail,isRateLimitError,json}from"../_shared/secure.ts"
type Db={public:{Tables:Record<string,never>;Views:Record<string,never>;Enums:Record<string,never>;CompositeTypes:Record<string,never>;Functions:Record<string,{Args:Record<string,unknown>;Returns:unknown}>}}
type Action="addAddress"|"deleteAddress"|"myAddresses"|"myOrders"|"myProfile"|"setDefaultAddress"|"updateAddress"|"updateName"
const ACTIONS=new Set<Action>(["addAddress","deleteAddress","myAddresses","myOrders","myProfile","setDefaultAddress","updateAddress","updateName"])
// Reads run on every app load and on the checkout screen, so they cannot share
// the writes' budget: a customer refreshing the app a few times would lock
// themselves out of their own profile.
const READS=new Set<Action>(["myAddresses","myOrders","myProfile"])
const KNOWN=["invalid_name","name_required","not_logged_in","not_your_address","too_many_addresses","unit_number_required"]
const id=(v:unknown)=>Number.isInteger(v)&&Number(v)>0&&Number(v)<=2147483647?Number(v):null
const text=(v:unknown,max:number)=>typeof v==="string"&&v.trim().length<=max?v.trim():null
const optText=(v:unknown,max:number)=>v==null?null:(typeof v==="string"&&v.trim().length<=max?v.trim():undefined)
const missing=(e:{code?:string;message?:string}|null)=>e?.code==="PGRST202"||!!e?.message?.includes("Could not find the function")
async function digest(v:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("")}
const handler=withSupabase<Db>({auth:"user"},async(req,ctx)=>{if(req.method!=="POST")return json({error:"method_not_allowed"},405);if(Number(req.headers.get("content-length")??0)>8192)return json({error:"request_too_large"},413)
 let b:unknown;try{b=await req.json()}catch{return json({error:"invalid_json"},400)}if(!b||typeof b!=="object"||Array.isArray(b))return json({error:"invalid_request"},400)
 const x=b as Record<string,unknown>,action=x.action;if(typeof action!=="string"||!ACTIONS.has(action as Action))return json({error:"invalid_action"},400)
 const uid=ctx.userClaims?.id;if(!uid)return json({error:"not_logged_in"},401);const who=await digest(uid)
 const perUser=READS.has(action as Action)?150:30
 for(const[bucket,max]of[[`customer-accounts:${action}:${who}`,perUser],["customer-accounts-global",3000]]as const){const{error}=await ctx.supabaseAdmin.rpc("check_rate_limit",{p_bucket:bucket,p_max:max,p_window:"10 minutes"});if(error){if(isRateLimitError(error))return json({error:"rate_limited"},429);return fail("customer-accounts","rate_limit_check_failed",500,error)}}
 let fn="",args:Record<string,unknown>={};const addressId=id(x.id)
 if(action==="myProfile"){fn="my_customer_profile"}
 else if(action==="myAddresses"){fn="my_customer_addresses"}
 else if(action==="myOrders"){fn="my_customer_orders"}
 else if(action==="updateName"){const name=text(x.name,60);if(!name)return json({error:"invalid_account_input"},400);fn="update_my_customer_name";args={p_name:name}}
 else if(action==="deleteAddress"){if(!addressId)return json({error:"invalid_account_input"},400);fn="delete_customer_address";args={p_id:addressId}}
 else if(action==="setDefaultAddress"){if(!addressId)return json({error:"invalid_account_input"},400);fn="set_default_address";args={p_id:addressId}}
 else if(action==="addAddress"){const label=optText(x.label,60),compoundId=id(x.compoundId),unit=text(x.unitNumber,120),notes=optText(x.notes,500)
  if(label===undefined||notes===undefined||!compoundId||!unit||typeof x.isDefault!=="boolean")return json({error:"invalid_account_input"},400)
  fn="add_customer_address";args={p_label:label,p_compound_id:compoundId,p_unit_number:unit,p_notes:notes,p_is_default:x.isDefault}}
 else{const label=optText(x.label,60),compoundId=id(x.compoundId),unit=text(x.unitNumber,120),notes=optText(x.notes,500)
  if(!addressId||label===undefined||notes===undefined||!compoundId||!unit)return json({error:"invalid_account_input"},400)
  fn="update_customer_address";args={p_id:addressId,p_label:label,p_compound_id:compoundId,p_unit_number:unit,p_notes:notes}}
 let result=await ctx.supabaseAdmin.rpc(fn,{...args,p_auth_user_id:uid});if(missing(result.error))result=await ctx.supabase.rpc(fn,args)
 if(result.error){const known=KNOWN.find(c=>result.error?.message?.includes(c));if(known)return json({error:known},known==="not_logged_in"?401:known==="not_your_address"?403:400);return fail("customer-accounts","customer_account_action_failed",500,result.error)}
 return json({ok:true,data:result.data??null})});export default{fetch:handler}
