import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import type { Session } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import type { Database } from "@/types/database"

type Teacher = Database["public"]["Tables"]["teachers"]["Row"]

interface AuthContextValue {
  session: Session | null
  teacher: Teacher | null
  loading: boolean
  needsPasswordSetup: boolean
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>
  updatePassword: (password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// Captured once at module load, before Supabase's own session-from-url
// handling has a chance to run — an invite or password-recovery email link
// lands here with `type=invite`/`type=recovery` in the URL hash. Following
// that link authenticates the user immediately (it's a valid session token),
// but never prompts them to actually set a password, so without this they'd
// just be silently logged in with no way to log in again from anywhere else.
function detectPasswordSetupFlow(): boolean {
  if (typeof window === "undefined") return false
  // Implicit flow puts it in the hash (#access_token=...&type=invite); PKCE
  // puts it in the query string (?code=...&type=invite) — check both since
  // which one applies depends on project-level Supabase Auth config.
  const hashType = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("type")
  const queryType = new URLSearchParams(window.location.search).get("type")
  const type = hashType ?? queryType
  return type === "invite" || type === "recovery"
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [teacher, setTeacher] = useState<Teacher | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(detectPasswordSetupFlow)

  useEffect(() => {
    let isMounted = true

    async function loadTeacher(userId: string) {
      const { data } = await supabase
        .from("teachers")
        .select("*")
        .eq("id", userId)
        .single()
      if (isMounted) setTeacher(data ?? null)
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (!isMounted) return
      setSession(data.session)
      if (data.session) await loadTeacher(data.session.user.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!isMounted) return
      setSession(newSession)
      if (newSession) {
        await loadTeacher(newSession.user.id)
      } else {
        setTeacher(null)
      }
    })

    return () => {
      isMounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  async function signInWithPassword(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function updatePassword(password: string) {
    const { error } = await supabase.auth.updateUser({ password })
    if (!error) setNeedsPasswordSetup(false)
    return { error: error?.message ?? null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{ session, teacher, loading, needsPasswordSetup, signInWithPassword, updatePassword, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
