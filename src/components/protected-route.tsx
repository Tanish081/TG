import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useAuth } from "@/hooks/use-auth"

export function ProtectedRoute() {
  const { session, loading, needsPasswordSetup } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  if (needsPasswordSetup && location.pathname !== "/set-password") {
    return <Navigate to="/set-password" replace />
  }

  return <Outlet />
}
