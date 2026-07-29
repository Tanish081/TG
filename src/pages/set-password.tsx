import { useState, type FormEvent } from "react"
import { Navigate } from "react-router-dom"
import { KeyRound } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function SetPasswordPage() {
  const { needsPasswordSetup, updatePassword, teacher } = useAuth()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!needsPasswordSetup) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError("Password must be at least 8 characters")
      return
    }
    if (password !== confirm) {
      setError("Passwords don't match")
      return
    }
    setSubmitting(true)
    const { error } = await updatePassword(password)
    setSubmitting(false)
    if (error) setError(error)
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <KeyRound className="size-6" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">
            Welcome{teacher ? `, ${teacher.name}` : ""}
          </h1>
        </div>
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle>Set your password</CardTitle>
            <CardDescription>One-time setup — you'll use this to sign in from now on.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={submitting} className="mt-2">
                {submitting ? "Saving…" : "Set password & continue"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
