// Edge Function: invite-teacher
//
// Three actions, all gated to the Dept Coordinator (verified below using the
// caller's own JWT before switching to the service-role client):
//
//   invite      — creates a new teacher's auth account and emails them a
//                 set-password invite. Requires a real email.
//   add         — creates a new teacher with a placeholder email, for real
//                 rosters where names are known before emails are. No email
//                 is sent (the address isn't deliverable). The account is
//                 usable once its email is replaced via `set-email`.
//   set-email   — replaces a teacher's placeholder (or real) email with a
//                 real one, and returns a one-time recovery link the
//                 Coordinator can hand to the teacher directly (WhatsApp,
//                 in person, etc.) so they can set their password.
//
// Requires the service-role key, so this cannot run on the client (§1).
//
// Deploy: supabase functions deploy invite-teacher
// Call from the client: supabase.functions.invoke('invite-teacher', { body: { action, ... } })

import { createClient } from "npm:@supabase/supabase-js@2"

export const PLACEHOLDER_EMAIL_DOMAIN = "no-email.teacherguardian.invalid"

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401 })
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
    return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 })
  }

  const { data: callerTeacher } = await callerClient
    .from("teachers")
    .select("is_dept_coordinator")
    .eq("id", user.id)
    .single()

  if (!callerTeacher?.is_dept_coordinator) {
    return new Response(JSON.stringify({ error: "Only a Dept Coordinator can manage teachers" }), {
      status: 403,
    })
  }

  const body = await req.json()
  const action = body.action ?? "invite"
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  if (action === "invite") {
    const { email, name } = body
    if (!email || typeof email !== "string") {
      return new Response(JSON.stringify({ error: "email is required" }), { status: 400 })
    }
    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { name: name ?? email },
    })
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 })
    return new Response(JSON.stringify({ user: data.user }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  if (action === "add") {
    const { name } = body
    if (!name || typeof name !== "string") {
      return new Response(JSON.stringify({ error: "name is required" }), { status: 400 })
    }
    const placeholderEmail = `${crypto.randomUUID()}@${PLACEHOLDER_EMAIL_DOMAIN}`
    const { data, error } = await adminClient.auth.admin.createUser({
      email: placeholderEmail,
      password: crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { name },
    })
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 })
    return new Response(JSON.stringify({ user: data.user }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  if (action === "set-email") {
    const { teacherId, email } = body
    if (!teacherId || !email || typeof email !== "string") {
      return new Response(JSON.stringify({ error: "teacherId and email are required" }), { status: 400 })
    }
    const { error: updateErr } = await adminClient.auth.admin.updateUserById(teacherId, {
      email,
      email_confirm: true,
    })
    if (updateErr) return new Response(JSON.stringify({ error: updateErr.message }), { status: 400 })

    const { error: syncErr } = await adminClient.from("teachers").update({ email }).eq("id", teacherId)
    if (syncErr) return new Response(JSON.stringify({ error: syncErr.message }), { status: 400 })

    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email,
    })
    if (linkErr) return new Response(JSON.stringify({ error: linkErr.message }), { status: 400 })

    return new Response(JSON.stringify({ actionLink: linkData.properties?.action_link ?? null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 })
})
