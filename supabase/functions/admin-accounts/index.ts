import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Admin-only account management: create/remove vendor and driver logins,
// and reset passwords. Uses the Auth Admin API (service role) rather than
// raw SQL inserts into auth.users, so Supabase's own identity bookkeeping
// stays consistent.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  })
}

function genPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
  let s = "Sk9-"
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

function slugify(name: string): string {
  const ascii = name.replace(/[^\x00-\x7F]/g, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
  return ascii || Math.random().toString(36).slice(2, 8)
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
      if (createErr || !created?.user) return json({ error: "create_user_failed", detail: createErr?.message }, 500)

      const { error: profErr } = await admin.from("profiles").insert({
        id: created.user.id, role: "vendor", restaurant_id, name: restaurant.name
      })
      if (profErr) {
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: "profile_insert_failed", detail: profErr.message }, 500)
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
      if (createErr || !created?.user) return json({ error: "create_user_failed", detail: createErr?.message }, 500)

      const { error: profErr } = await admin.from("profiles").insert({
        id: created.user.id, role: "driver", driver_id, name: driver.name
      })
      if (profErr) {
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: "profile_insert_failed", detail: profErr.message }, 500)
      }

      return json({ email, password })
    }

    if (action === "remove_login") {
      const { profile_id } = body
      if (!profile_id) return json({ error: "profile_id_required" }, 400)

      // delete the higher-privilege resource (the actual login) first -- if
      // this fails, the profile row is left intact and nothing is broken.
      // Doing it the other way around (profile first) risks leaving a
      // fully-functional orphaned auth account with no profile if the auth
      // deletion step then fails.
      const { error: delErr } = await admin.auth.admin.deleteUser(profile_id)
      if (delErr) return json({ error: "delete_failed", detail: delErr.message }, 500)

      await admin.from("profiles").delete().eq("id", profile_id)
      return json({ ok: true })
    }

    if (action === "reset_password") {
      const { profile_id, custom_password } = body
      if (!profile_id) return json({ error: "profile_id_required" }, 400)

      const password = (typeof custom_password === "string" && custom_password.length >= 8)
        ? custom_password
        : genPassword()
      const { error: updErr } = await admin.auth.admin.updateUserById(profile_id, { password })
      if (updErr) return json({ error: "reset_failed", detail: updErr.message }, 500)

      return json({ password })
    }

    if (action === "update_email") {
      const { profile_id, new_email } = body
      if (!profile_id || !new_email) return json({ error: "profile_id_and_email_required" }, 400)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(new_email)) return json({ error: "invalid_email" }, 400)

      const { error: updErr } = await admin.auth.admin.updateUserById(profile_id, {
        email: new_email, email_confirm: true
      })
      if (updErr) return json({ error: "email_update_failed", detail: updErr.message }, 500)

      return json({ email: new_email })
    }

    return json({ error: "unknown_action" }, 400)
  } catch (e) {
    console.error("admin-accounts unhandled error:", e)
    return json({ error: "internal_error" }, 500)
  }
})
