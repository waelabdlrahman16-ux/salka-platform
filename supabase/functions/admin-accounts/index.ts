import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { securePassword, secureSlugFallback, isRateLimitError, CORS_HEADERS, json, fail } from "../_shared/secure.ts"

// Admin-only account management: create/remove vendor and driver logins,
// and reset passwords. Uses the Auth Admin API (service role) rather than
// raw SQL inserts into auth.users, so Supabase's own identity bookkeeping
// stays consistent.

// Was Math.random() with a fixed "Sk9-" prefix and a known 56-char alphabet.
// Every vendor and driver password in the system came from that function, and
// the repo is public -- so the prefix, the length and the alphabet were all
// published, leaving only a non-cryptographic PRNG between an attacker and a
// staff login. securePassword() uses crypto.getRandomValues with rejection
// sampling, and drops the constant prefix.
const genPassword = () => securePassword(14)

function slugify(name: string): string {
  const ascii = name.replace(/[^\x00-\x7F]/g, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
  return ascii || secureSlugFallback()
}

/**
 * Every mutating action takes a caller-supplied profile_id. Without this, one
 * compromised or careless admin session could delete, reset or take over any
 * other admin account -- or its own. Restrict targets to staff logins.
 */
async function assertTargetIsStaff(admin: any, profileId: string, callerId: string) {
  if (profileId === callerId) return { error: "cannot_target_self", status: 400 }
  const { data: target } = await admin.from("profiles").select("role").eq("id", profileId).maybeSingle()
  if (!target) return { error: "profile_not_found", status: 404 }
  // catalog and supervisor are staff too -- otherwise an admin could create one
  // and then never reset its password or remove it. Every new role has to be
  // added here as well as to the create action; forgetting produces an account
  // that cannot be recovered or deleted, and nothing fails at creation time to
  // warn you.
  if (!["vendor", "driver", "catalog", "supervisor"].includes(target.role)) {
    return { error: "target_not_staff", status: 403 }
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  try {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

    const authHeader = req.headers.get("Authorization") ?? ""
    const token = authHeader.replace("Bearer ", "")
    if (!token) return json({ error: "missing_auth" }, 401)

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    if (userErr || !userData?.user) return json({ error: "invalid_session" }, 401)

    const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", userData.user.id).maybeSingle()
    if (callerProfile?.role !== "admin") return json({ error: "admin_only" }, 403)

    // This endpoint creates and destroys logins and had no rate limiting at all.
    const { error: limitErr } = await admin.rpc("check_rate_limit", {
      // Generous enough for bulk onboarding (one call per restaurant/driver at
      // launch) while still bounding a runaway script.
      p_bucket: `admin_accounts:${userData.user.id}`, p_max: 200, p_window: "10 minutes"
    })
    if (limitErr) {
      if (isRateLimitError(limitErr)) return json({ error: "rate_limited" }, 429)
      return fail("admin-accounts", "rate_limit_check_failed", 500, limitErr)
    }

    let body: any
    try { body = await req.json() } catch { return json({ error: "invalid_json" }, 400) }
    const { action } = body

    if (action === "create_vendor_login") {
      const { restaurant_id } = body
      if (!restaurant_id) return json({ error: "restaurant_id_required" }, 400)

      const { data: existing } = await admin.from("profiles").select("id").eq("role", "vendor").eq("restaurant_id", restaurant_id).maybeSingle()
      if (existing) return json({ error: "login_already_exists" }, 409)

      const { data: restaurant } = await admin.from("restaurants").select("name").eq("id", restaurant_id).single()
      if (!restaurant) return json({ error: "restaurant_not_found" }, 404)

      const email = `vendor.${slugify(restaurant.name)}.${restaurant_id}@salka.app`
      const password = genPassword()

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { is_staff: true }
      })
      if (createErr || !created?.user) return fail("admin-accounts", "create_user_failed", 500, createErr)

      const { error: profErr } = await admin.from("profiles").insert({
        id: created.user.id, role: "vendor", restaurant_id, name: restaurant.name
      })
      if (profErr) {
        await admin.auth.admin.deleteUser(created.user.id)
        return fail("admin-accounts", "profile_insert_failed", 500, profErr)
      }

      return json({ email, password })
    }

    if (action === "create_driver_login") {
      const { driver_id } = body
      if (!driver_id) return json({ error: "driver_id_required" }, 400)

      const { data: existing } = await admin.from("profiles").select("id").eq("role", "driver").eq("driver_id", driver_id).maybeSingle()
      if (existing) return json({ error: "login_already_exists" }, 409)

      const { data: driver } = await admin.from("drivers").select("name").eq("id", driver_id).single()
      if (!driver) return json({ error: "driver_not_found" }, 404)

      const email = `driver.${slugify(driver.name)}.${driver_id}@salka.app`
      const password = genPassword()

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { is_staff: true }
      })
      if (createErr || !created?.user) return fail("admin-accounts", "create_user_failed", 500, createErr)

      const { error: profErr } = await admin.from("profiles").insert({
        id: created.user.id, role: "driver", driver_id, name: driver.name
      })
      if (profErr) {
        await admin.auth.admin.deleteUser(created.user.id)
        return fail("admin-accounts", "profile_insert_failed", 500, profErr)
      }

      return json({ email, password })
    }

    // Catalogue staff and supervisors have no restaurant_id and no driver_id --
    // they work across every vendor, and their scope comes from the role alone.
    // One block for both: the two differ by a single string, and a copy-pasted
    // twin is how the second one silently stops matching the first.
    if (action === "create_catalog_login" || action === "create_supervisor_login") {
      const role = action === "create_supervisor_login" ? "supervisor" : "catalog"
      const { name } = body
      if (!name || typeof name !== "string" || !name.trim()) return json({ error: "name_required" }, 400)

      // slugify() already falls back to random bytes for a fully non-ASCII name;
      // the extra suffix stops two people with the same name from colliding.
      const email = `${role}.${slugify(name)}.${secureSlugFallback()}@salka.app`
      const password = genPassword()

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { is_staff: true }
      })
      if (createErr || !created?.user) return fail("admin-accounts", "create_user_failed", 500, createErr)

      const { error: profErr } = await admin.from("profiles").insert({
        id: created.user.id, role, name: name.trim()
      })
      if (profErr) {
        await admin.auth.admin.deleteUser(created.user.id)
        return fail("admin-accounts", "profile_insert_failed", 500, profErr)
      }

      return json({ email, password })
    }

    if (action === "remove_login") {
      const { profile_id } = body
      if (!profile_id) return json({ error: "profile_id_required" }, 400)
      const guard = await assertTargetIsStaff(admin, profile_id, userData.user.id)
      if (guard) return json({ error: guard.error }, guard.status)

      // delete the higher-privilege resource (the actual login) first -- if
      // this fails, the profile row is left intact and nothing is broken.
      // Doing it the other way around (profile first) risks leaving a
      // fully-functional orphaned auth account with no profile if the auth
      // deletion step then fails.
      const { error: delErr } = await admin.auth.admin.deleteUser(profile_id)
      if (delErr) return fail("admin-accounts", "delete_failed", 500, delErr)

      await admin.from("profiles").delete().eq("id", profile_id)
      return json({ ok: true })
    }

    if (action === "reset_password") {
      const { profile_id, custom_password } = body
      if (!profile_id) return json({ error: "profile_id_required" }, 400)
      const guard = await assertTargetIsStaff(admin, profile_id, userData.user.id)
      if (guard) return json({ error: guard.error }, guard.status)

      // A custom_password shorter than 8 was silently replaced with a generated
      // one and returned as though it were the requested password. Any client
      // that bypassed the UI's length check therefore set a password nobody
      // knew. Reject instead of substituting.
      if (custom_password !== undefined && custom_password !== null && custom_password !== "") {
        if (typeof custom_password !== "string" || custom_password.length < 8) {
          return json({ error: "password_too_short" }, 400)
        }
      }
      const password = (typeof custom_password === "string" && custom_password.length >= 8)
        ? custom_password
        : genPassword()
      const { error: updErr } = await admin.auth.admin.updateUserById(profile_id, { password })
      if (updErr) return fail("admin-accounts", "reset_failed", 500, updErr)

      return json({ password })
    }

    if (action === "update_email") {
      const { profile_id, new_email } = body
      if (!profile_id || !new_email) return json({ error: "profile_id_and_email_required" }, 400)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(new_email)) return json({ error: "invalid_email" }, 400)
      const guard = await assertTargetIsStaff(admin, profile_id, userData.user.id)
      if (guard) return json({ error: guard.error }, guard.status)

      const { error: updErr } = await admin.auth.admin.updateUserById(profile_id, {
        email: new_email, email_confirm: true
      })
      if (updErr) return fail("admin-accounts", "email_update_failed", 500, updErr)

      return json({ email: new_email })
    }

    return json({ error: "unknown_action" }, 400)
  } catch (e) {
    console.error("admin-accounts unhandled error:", e)
    return json({ error: "internal_error" }, 500)
  }
})
