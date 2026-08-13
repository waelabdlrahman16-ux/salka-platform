import { withSupabase } from "@supabase/server"
import { fail, isRateLimitError, json } from "../_shared/secure.ts"

type Db = { public: { Tables: Record<string, never>; Views: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>; Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }> } }
type Action = "addMenuCategory" | "renameMenuCategory" | "deleteMenuCategory" | "reorderMenuCategories" | "deleteMenuItem" | "setVendorHours" | "setRestaurantRank" | "setRestaurantServiceFee"
const ACTIONS = new Set<Action>(["addMenuCategory","renameMenuCategory","deleteMenuCategory","reorderMenuCategories","deleteMenuItem","setVendorHours","setRestaurantRank","setRestaurantServiceFee"])
const KNOWN = ["admin_only","category_exists","category_not_empty","hours_incomplete","invalid_day","item_has_order_history","name_required","not_authorized","rank_must_be_positive","restaurant_not_found","invalid_pct"]
function positiveId(v: unknown): number | null { return Number.isInteger(v) && Number(v)>0 && Number(v)<=2_147_483_647 ? Number(v) : null }
function clean(v: unknown,max: number): string | null { if(typeof v!=="string")return null;const s=v.trim();return s&&s.length<=max?s:null }
async function digest(v:string):Promise<string>{const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("")}

type MenuItemStorageScope = { itemId: number; restaurantId: number }

export async function removeMenuItemImages(
  supabaseAdmin: { storage: { from(bucket: string): {
    list(path: string, options: { limit: number; offset: number; sortBy: { column: string; order: "asc" } }): PromiseLike<{ data: Array<{ id: string | null; name: string }> | null; error: { message?: string } | null }>
    remove(paths: string[]): PromiseLike<{ error: { message?: string } | null }>
  } } },
  scope: MenuItemStorageScope,
): Promise<{ removed: number; complete: boolean }> {
  const folder = `menu-items/${scope.restaurantId}/${scope.itemId}`
  const pageSize = 100
  const paths: string[] = []

  for (let offset = 0; offset < 1_000; offset += pageSize) {
    const { data, error } = await supabaseAdmin.storage.from("vendor-assets").list(folder, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    })
    if (error) throw new Error(`list_failed:${error.message ?? "unknown"}`)

    const entries = data ?? []
    for (const entry of entries) {
      if (entry.id !== null) paths.push(`${folder}/${entry.name}`)
    }
    if (entries.length < pageSize) break
    if (offset + pageSize >= 1_000) throw new Error("list_limit_exceeded")
  }

  if (paths.length === 0) return { removed: 0, complete: true }
  const { error } = await supabaseAdmin.storage.from("vendor-assets").remove(paths)
  if (error) throw new Error(`remove_failed:${error.message ?? "unknown"}`)
  return { removed: paths.length, complete: true }
}

const DAY_RE = /^[0-6]$/

function validDays(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (!Array.isArray(v) || v.length > 7) return false
  for (const d of v) {
    if (typeof d !== "object" || d === null || Array.isArray(d)) return false
    const rec = d as Record<string, unknown>
    if (!DAY_RE.test(String(rec.day)) && !Number.isInteger(rec.day)) return false
    if (Number.isInteger(rec.day) && (Number(rec.day) < 0 || Number(rec.day) > 6)) return false
    if (rec.closed != null && typeof rec.closed !== "boolean") return false
    if (rec.opens != null && typeof rec.opens !== "string") return false
    if (rec.closes != null && typeof rec.closes !== "string") return false
  }
  return true
}

const handler=withSupabase<Db>({auth:"user"},async(req,ctx)=>{
  if(req.method!=="POST")return json({error:"method_not_allowed"},405)
  if(Number(req.headers.get("content-length")??0)>32768)return json({error:"request_too_large"},413)
  let body:unknown;try{body=await req.json()}catch{return json({error:"invalid_json"},400)}
  if(!body||typeof body!=="object"||Array.isArray(body))return json({error:"invalid_request"},400)
  const input=body as Record<string,unknown>,action=input.action
  if(typeof action!=="string"||!ACTIONS.has(action as Action))return json({error:"invalid_action"},400)
  const userId=ctx.userClaims?.id;if(!userId)return json({error:"not_logged_in"},401)
  const who=await digest(userId)
  for(const [bucket,max,window] of [[`admin-catalog:${action}:${who}`,20,"10 minutes"],["admin-catalog-global",400,"10 minutes"]] as const){
    const {error}=await ctx.supabaseAdmin.rpc("check_rate_limit",{p_bucket:bucket,p_max:max,p_window:window})
    if(error){if(isRateLimitError(error))return json({error:"rate_limited"},429);return fail("admin-catalog-actions","rate_limit_check_failed",500,error)}
  }
  let fn="",args:Record<string,unknown>={}
  let menuItemStorageScope: MenuItemStorageScope | null = null
  if(action==="addMenuCategory"){
    const restaurantId=positiveId(input.restaurantId),name=clean(input.name,120)
    if(!restaurantId||!name)return json({error:"invalid_vendor_input"},400)
    fn="admin_add_menu_category";args={p_restaurant_id:restaurantId,p_name:name}
  }else if(action==="renameMenuCategory"){
    const restaurantId=positiveId(input.restaurantId),oldName=clean(input.oldName,120),newName=clean(input.newName,120)
    if(!restaurantId||!oldName||!newName)return json({error:"invalid_vendor_input"},400)
    fn="admin_rename_menu_category";args={p_restaurant_id:restaurantId,p_old:oldName,p_new:newName}
  }else if(action==="deleteMenuCategory"){
    const restaurantId=positiveId(input.restaurantId),name=clean(input.name,120)
    if(!restaurantId||!name)return json({error:"invalid_vendor_input"},400)
    fn="admin_delete_menu_category";args={p_restaurant_id:restaurantId,p_name:name}
  }else if(action==="reorderMenuCategories"){
    const restaurantId=positiveId(input.restaurantId),names=input.names
    if(!restaurantId||!Array.isArray(names)||names.length===0||names.length>200||!names.every(n=>typeof n==="string"&&n.trim().length>0&&n.length<=120))return json({error:"invalid_vendor_input"},400)
    fn="admin_reorder_menu_categories";args={p_restaurant_id:restaurantId,p_names:names}
  }else if(action==="deleteMenuItem"){
    const itemId=positiveId(input.itemId)
    if(!itemId)return json({error:"invalid_vendor_input"},400)
    const {data:item,error:itemError}=await ctx.supabaseAdmin.from("menu_items").select("restaurant_id").eq("id",itemId).maybeSingle()
    if(itemError)return fail("admin-catalog-actions","menu_item_lookup_failed",500,itemError)
    const itemRow=item as {restaurant_id?: unknown}|null
    const restaurantId=positiveId(Number(itemRow?.restaurant_id))
    if(restaurantId)menuItemStorageScope={itemId,restaurantId}
    fn="admin_delete_menu_item";args={p_item_id:itemId}
  }else if(action==="setVendorHours"){
    const restaurantId=positiveId(input.restaurantId)
    if(!restaurantId||!validDays(input.days))return json({error:"invalid_vendor_input"},400)
    fn="admin_set_vendor_hours";args={p_restaurant_id:restaurantId,p_days:input.days??[]}
  }else if(action==="setRestaurantServiceFee"){
    const restaurantId=positiveId(input.restaurantId),pct=input.pct
    if(!restaurantId||typeof pct!=="number"||!Number.isFinite(pct)||pct<0||pct>0.5)return json({error:"invalid_vendor_input"},400)
    fn="admin_set_restaurant_service_fee";args={p_restaurant_id:restaurantId,p_pct:pct}
  }else{
    const restaurantId=positiveId(input.restaurantId),displayOrder=input.displayOrder==null?null:positiveId(input.displayOrder)
    if(!restaurantId||(input.displayOrder!=null&&!displayOrder)||(input.featured!=null&&typeof input.featured!=="boolean"))return json({error:"invalid_vendor_input"},400)
    fn="admin_set_restaurant_rank";args={p_restaurant_id:restaurantId,p_display_order:displayOrder,p_featured:input.featured??null}
  }
  const result=await ctx.supabaseAdmin.rpc(fn,{...args,p_auth_user_id:userId})
  if(result.error){const known=KNOWN.find(c=>result.error?.message?.includes(c));if(known)return json({error:known},known==="admin_only"||known==="not_authorized"?403:400);return fail("admin-catalog-actions","catalog_action_failed",500,result.error)}
  let imageCleanup: { removed: number; complete: boolean } | null = null
  if(action==="deleteMenuItem"&&menuItemStorageScope){
    try{
      imageCleanup=await removeMenuItemImages(ctx.supabaseAdmin,menuItemStorageScope)
    }catch(error){
      imageCleanup={removed:0,complete:false}
      console.error("admin-catalog-actions","menu_item_image_cleanup_failed",{
        itemId:menuItemStorageScope.itemId,
        restaurantId:menuItemStorageScope.restaurantId,
        error:error instanceof Error?error.message:"unknown",
      })
    }
  }
  return json({ok:true,data:result.data??null,imageCleanup})
})
export default {fetch:handler}
