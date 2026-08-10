import { withSupabase } from "@supabase/server"
import { fail, isRateLimitError, json } from "../_shared/secure.ts"

type Db = { public: { Tables: Record<string, never>; Views: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>; Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }> } }
type Action = "applyLibraryAddon" | "checkDiscountConflict" | "restaurantReliability" | "restaurantsReliabilityAll"
const ACTIONS = new Set<Action>(["applyLibraryAddon","checkDiscountConflict","restaurantReliability","restaurantsReliabilityAll"])
const KNOWN = ["not_authorised","library_item_not_found","group_name_required","menu_item_not_found","item_belongs_to_another_vendor","admin_only","invalid_scope","restaurant_required","not_authorized"]
function positiveId(v: unknown): number | null { return Number.isInteger(v) && Number(v)>0 && Number(v)<=2_147_483_647 ? Number(v) : null }
function clean(v: unknown,max: number): string | null { if(typeof v!=="string")return null;const s=v.trim();return s&&s.length<=max?s:null }
function missing(error: { code?: string; message?: string } | null): boolean { return error?.code==="PGRST202"||!!error?.message?.includes("Could not find the function") }
async function digest(v:string):Promise<string>{const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("")}

const handler=withSupabase<Db>({auth:"user"},async(req,ctx)=>{
  if(req.method!=="POST")return json({error:"method_not_allowed"},405)
  if(Number(req.headers.get("content-length")??0)>16384)return json({error:"request_too_large"},413)
  let body:unknown;try{body=await req.json()}catch{return json({error:"invalid_json"},400)}
  if(!body||typeof body!=="object"||Array.isArray(body))return json({error:"invalid_request"},400)
  const input=body as Record<string,unknown>,action=input.action
  if(typeof action!=="string"||!ACTIONS.has(action as Action))return json({error:"invalid_action"},400)
  const userId=ctx.userClaims?.id;if(!userId)return json({error:"not_logged_in"},401)
  const who=await digest(userId)
  for(const [bucket,max,window] of [[`catalog-checks:${action}:${who}`,30,"10 minutes"],["catalog-checks-global",600,"10 minutes"]] as const){
    const {error}=await ctx.supabaseAdmin.rpc("check_rate_limit",{p_bucket:bucket,p_max:max,p_window:window})
    if(error){if(isRateLimitError(error))return json({error:"rate_limited"},429);return fail("catalog-checks","rate_limit_check_failed",500,error)}
  }
  let fn="",args:Record<string,unknown>={}
  if(action==="applyLibraryAddon"){
    const libraryId=positiveId(input.libraryId)
    const rawIds=Array.isArray(input.itemIds)?input.itemIds:null
    const itemIds=rawIds&&rawIds.length>0&&rawIds.length<=200?rawIds.map(positiveId):null
    const groupName=input.groupName==null?'إضافات':clean(input.groupName,60)
    if(!libraryId||!itemIds||itemIds.some(v=>v===null)||!groupName)return json({error:"invalid_catalog_input"},400)
    fn="apply_library_addon";args={p_library_id:libraryId,p_item_ids:itemIds,p_group_name:groupName}
  }else if(action==="checkDiscountConflict"){
    const restaurantId=positiveId(input.restaurantId),scope=input.scope
    if(!restaurantId||(scope!=="item"&&scope!=="category"))return json({error:"invalid_catalog_input"},400)
    const menuItemId=input.menuItemId==null?null:positiveId(input.menuItemId)
    if(input.menuItemId!=null&&menuItemId===null)return json({error:"invalid_catalog_input"},400)
    const category=input.category==null?null:clean(input.category,60)
    if(input.category!=null&&category===null)return json({error:"invalid_catalog_input"},400)
    const excludeId=input.excludeId==null?null:positiveId(input.excludeId)
    if(input.excludeId!=null&&excludeId===null)return json({error:"invalid_catalog_input"},400)
    fn="check_discount_conflict";args={p_restaurant_id:restaurantId,p_scope:scope,p_menu_item_id:menuItemId,p_category:category,p_exclude_id:excludeId}
  }else if(action==="restaurantReliability"){
    const restaurantId=positiveId(input.restaurantId);if(!restaurantId)return json({error:"invalid_catalog_input"},400)
    fn="restaurant_reliability";args={p_restaurant_id:restaurantId}
  }else{
    fn="restaurants_reliability_all";args={}
  }
  let result=await ctx.supabaseAdmin.rpc(fn,{...args,p_auth_user_id:userId})
  if(missing(result.error))result=await ctx.supabase.rpc(fn,args)
  if(result.error){const known=KNOWN.find(c=>result.error?.message?.includes(c));if(known)return json({error:known},known==="admin_only"?403:400);return fail("catalog-checks","catalog_check_failed",500,result.error)}
  return json({ok:true,data:result.data??null})
})
export default {fetch:handler}
