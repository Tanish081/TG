// Edge Function: invite-teacher
//
// Creates a new teacher's auth account (which triggers the `teachers` row
// via on_auth_user_created) and emails them a set-password invite.
// Requires the service-role key, so this cannot run on the client (§1).
// Only an HOD may call it — verified below using the caller's own JWT
// before switching to the service-role client to perform the invite.
//
// Deploy: supabase functions deploy invite-teacher
// Call from the client: supabase.functions.invoke('invite-teacher', { body: { email, name } })

import { createClient } from "npm:@supabase/supabase-js@2"

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
    .select("is_hod")
    .eq("id", user.id)
    .single()

  if (!callerTeacher?.is_hod) {
    return new Response(JSON.stringify({ error: "Only an HOD can invite teachers" }), { status: 403 })
  }

  const { email, name } = await req.json()
  if (!email || typeof email !== "string") {
    return new Response(JSON.stringify({ error: "email is required" }), { status: 400 })
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { name: name ?? email },
  })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 })
  }

  return new Response(JSON.stringify({ user: data.user }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
})
