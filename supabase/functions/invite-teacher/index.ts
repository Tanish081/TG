// Edge Function: invite-teacher
//
// Two actions, both gated to the Dept Coordinator (verified below using the
// caller's own JWT before switching to the service-role client):
//
//   invite   — creates a new teacher's auth account (which triggers the
//              `teachers` row via on_auth_user_created) and emails them a
//              set-password invite. This is the default action.
//   delete   — removes a teacher's auth account entirely. `teachers.id`
//              references `auth.users.id` with `on delete cascade`, so this
//              also removes their `teachers` row and anything that
//              cascades from it.
//
// Requires the service-role key, so this cannot run on the client (§1).
//
// Deploy: supabase functions deploy invite-teacher
// Call from the client: supabase.functions.invoke('invite-teacher', { body: { action, ... } })

import { createClient } from "npm:@supabase/supabase-js@2"

// Browsers preflight cross-origin POSTs that carry an Authorization header
// with an OPTIONS request — without these headers on every response
// (including the OPTIONS one), the preflight fails and the browser never
// even sends the real request. Surfaces client-side as "Failed to send a
// request to the Edge Function", not as anything from this function's own
// logic, which makes it easy to misdiagnose as an auth or logic bug.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders })
  }

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: corsHeaders,
    })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

  // Client scoped to the caller's own JWT, only used to check who's calling.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user },
  } = await callerClient.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: jsonHeaders })
  }

  const { data: callerTeacher } = await callerClient
    .from("teachers")
    .select("is_dept_coordinator")
    .eq("id", user.id)
    .single()

  if (!callerTeacher?.is_dept_coordinator) {
    return new Response(JSON.stringify({ error: "Only a Dept Coordinator can manage teachers" }), {
      status: 403,
      headers: jsonHeaders,
    })
  }

  const body = await req.json()
  const action = body.action ?? "invite"
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  if (action === "delete") {
    const { teacherId } = body
    if (!teacherId || typeof teacherId !== "string") {
      return new Response(JSON.stringify({ error: "teacherId is required" }), {
        status: 400,
        headers: jsonHeaders,
      })
    }
    if (teacherId === user.id) {
      return new Response(JSON.stringify({ error: "You can't delete your own account" }), {
        status: 400,
        headers: jsonHeaders,
      })
    }
    const { error } = await adminClient.auth.admin.deleteUser(teacherId)
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: jsonHeaders })
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: jsonHeaders })
  }

  const { email, name } = body
  if (!email || typeof email !== "string") {
    return new Response(JSON.stringify({ error: "email is required" }), { status: 400, headers: jsonHeaders })
  }

  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { name: name ?? email },
  })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: jsonHeaders })
  }

  return new Response(JSON.stringify({ user: data.user }), { status: 200, headers: jsonHeaders })
})
