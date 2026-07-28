import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Copy, Users } from "lucide-react"
import { supabase } from "@/lib/supabase"
import type { Database } from "@/types/database"
import { SectionShell } from "@/components/section-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type Teacher = Database["public"]["Tables"]["teachers"]["Row"]

// Must match PLACEHOLDER_EMAIL_DOMAIN in supabase/functions/invite-teacher/index.ts
const PLACEHOLDER_EMAIL_DOMAIN = "no-email.teacherguardian.invalid"
const isPlaceholderEmail = (email: string) => email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`)

export default function TeachersPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")

  const [addMode, setAddMode] = useState<"invite" | "name-only">("invite")
  const [placeholderName, setPlaceholderName] = useState("")

  const [renameTarget, setRenameTarget] = useState<Teacher | null>(null)
  const [renameValue, setRenameValue] = useState("")

  const [emailTarget, setEmailTarget] = useState<Teacher | null>(null)
  const [emailValue, setEmailValue] = useState("")
  const [recoveryLink, setRecoveryLink] = useState<string | null>(null)

  const { data: teachers, isLoading } = useQuery({
    queryKey: ["teachers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teachers").select("*").order("name")
      if (error) throw error
      return data
    },
  })

  const { data: divisions } = useQuery({
    queryKey: ["divisions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("divisions")
        .select("id, year_level, division, branch_code, academic_year, class_teacher_id")
      if (error) throw error
      return data
    },
  })

  const classTeacherOf = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const d of divisions ?? []) {
      if (!d.class_teacher_id) continue
      const label = `${d.year_level}-${d.division}`
      const list = map.get(d.class_teacher_id) ?? []
      list.push(label)
      map.set(d.class_teacher_id, list)
    }
    return map
  }, [divisions])

  const invite = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("invite-teacher", {
        body: { action: "invite", email, name },
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(`Invited ${email}`)
      setOpen(false)
      setName("")
      setEmail("")
      queryClient.invalidateQueries({ queryKey: ["teachers"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const addPlaceholder = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("invite-teacher", {
        body: { action: "add", name: placeholderName },
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(`Added ${placeholderName} — set their real email later to invite them`)
      setOpen(false)
      setPlaceholderName("")
      queryClient.invalidateQueries({ queryKey: ["teachers"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const setEmail_ = useMutation({
    mutationFn: async () => {
      if (!emailTarget) return
      const { data, error } = await supabase.functions.invoke("invite-teacher", {
        body: { action: "set-email", teacherId: emailTarget.id, email: emailValue },
      })
      if (error) throw error
      return data as { actionLink: string | null }
    },
    onSuccess: (data) => {
      toast.success("Email updated")
      setEmailTarget(null)
      setEmailValue("")
      setRecoveryLink(data?.actionLink ?? null)
      queryClient.invalidateQueries({ queryKey: ["teachers"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const toggleDeptCoordinator = useMutation({
    mutationFn: async ({ id, is_dept_coordinator }: { id: string; is_dept_coordinator: boolean }) => {
      const { error } = await supabase.from("teachers").update({ is_dept_coordinator }).eq("id", id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teachers"] }),
    onError: (err: Error) => toast.error(err.message),
  })

  const toggleHod = useMutation({
    mutationFn: async ({ id, is_hod }: { id: string; is_hod: boolean }) => {
      const { error } = await supabase.from("teachers").update({ is_hod }).eq("id", id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teachers"] }),
    onError: (err: Error) => toast.error(err.message),
  })

  const rename = useMutation({
    mutationFn: async () => {
      if (!renameTarget) return
      const { error } = await supabase
        .from("teachers")
        .update({ name: renameValue })
        .eq("id", renameTarget.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success("Name updated")
      setRenameTarget(null)
      queryClient.invalidateQueries({ queryKey: ["teachers"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <SectionShell
      icon={Users}
      title="Teachers"
      subtitle="Invite teachers by email, or add them by name and fill in email later."
      accent="blue"
      action={
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (!next) {
              setName("")
              setEmail("")
              setPlaceholderName("")
              setAddMode("invite")
            }
          }}
        >
          <DialogTrigger asChild>
            <Button>Add teacher</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add a teacher</DialogTitle>
            </DialogHeader>
            <Tabs value={addMode} onValueChange={(v) => setAddMode(v as "invite" | "name-only")}>
              <TabsList className="mb-2 w-full">
                <TabsTrigger value="invite" className="flex-1">
                  Invite by email
                </TabsTrigger>
                <TabsTrigger value="name-only" className="flex-1">
                  Name only
                </TabsTrigger>
              </TabsList>
              <TabsContent value="invite" className="flex flex-col gap-4">
                <DialogDescription>
                  They'll receive an email to set their password and sign in.
                </DialogDescription>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="t-name">Name</Label>
                  <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="t-email">Email</Label>
                  <Input
                    id="t-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </TabsContent>
              <TabsContent value="name-only" className="flex flex-col gap-4">
                <DialogDescription>
                  For real rosters where you have names but not emails yet. The account is created
                  right away but can't sign in until you fill in a real email later (each teacher's
                  row will show a "Set email" action).
                </DialogDescription>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="t-pname">Name</Label>
                  <Input
                    id="t-pname"
                    value={placeholderName}
                    onChange={(e) => setPlaceholderName(e.target.value)}
                  />
                </div>
              </TabsContent>
            </Tabs>
            <DialogFooter>
              {addMode === "invite" ? (
                <Button onClick={() => invite.mutate()} disabled={!email || invite.isPending}>
                  {invite.isPending ? "Sending…" : "Send invite"}
                </Button>
              ) : (
                <Button
                  onClick={() => addPlaceholder.mutate()}
                  disabled={!placeholderName || addPlaceholder.isPending}
                >
                  {addPlaceholder.isPending ? "Adding…" : "Add teacher"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Class teacher of</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {teachers?.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{t.name}</TableCell>
                <TableCell>
                  {isPlaceholderEmail(t.email) ? (
                    <Badge variant="destructive">No email yet</Badge>
                  ) : (
                    t.email
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {t.is_dept_coordinator && <Badge>Dept Coordinator</Badge>}
                    {t.is_hod && <Badge variant="outline">HOD</Badge>}
                    {!t.is_dept_coordinator && !t.is_hod && (
                      <Badge variant="secondary">Teacher</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(classTeacherOf.get(t.id) ?? []).length === 0 ? (
                      <span className="text-sm text-muted-foreground">—</span>
                    ) : (
                      classTeacherOf.get(t.id)!.map((label) => (
                        <Badge key={label} variant="outline">
                          {label}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setRenameTarget(t)
                        setRenameValue(t.name)
                      }}
                    >
                      Rename
                    </Button>
                    {isPlaceholderEmail(t.email) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEmailTarget(t)
                          setEmailValue("")
                        }}
                      >
                        Set email
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        toggleDeptCoordinator.mutate({
                          id: t.id,
                          is_dept_coordinator: !t.is_dept_coordinator,
                        })
                      }
                    >
                      {t.is_dept_coordinator ? "Revoke coordinator" : "Make coordinator"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleHod.mutate({ id: t.id, is_hod: !t.is_hod })}
                    >
                      {t.is_hod ? "Revoke HOD" : "Make HOD"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename teacher</DialogTitle>
            <DialogDescription>{renameTarget?.email}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rename-input">Name</Label>
            <Input
              id="rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button onClick={() => rename.mutate()} disabled={!renameValue || rename.isPending}>
              {rename.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!emailTarget}
        onOpenChange={(open) => {
          if (!open) {
            setEmailTarget(null)
            setEmailValue("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set real email — {emailTarget?.name}</DialogTitle>
            <DialogDescription>
              Replaces the placeholder address so this teacher can sign in. You'll get a one-time
              link afterward to send them directly.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="set-email-input">Email</Label>
            <Input
              id="set-email-input"
              type="email"
              value={emailValue}
              onChange={(e) => setEmailValue(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => setEmail_.mutate()}
              disabled={!emailValue || setEmail_.isPending}
            >
              {setEmail_.isPending ? "Saving…" : "Save email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!recoveryLink} onOpenChange={(open) => !open && setRecoveryLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this link to the teacher</DialogTitle>
            <DialogDescription>
              One-time link to set their password and sign in. It isn't emailed automatically —
              copy it and send it yourself (WhatsApp, in person, etc).
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={recoveryLink ?? ""} className="font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => {
                if (recoveryLink) {
                  navigator.clipboard.writeText(recoveryLink)
                  toast.success("Copied")
                }
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SectionShell>
  )
}
