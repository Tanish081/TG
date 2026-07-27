import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Users } from "lucide-react"
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

type Teacher = Database["public"]["Tables"]["teachers"]["Row"]

export default function TeachersPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")

  const [renameTarget, setRenameTarget] = useState<Teacher | null>(null)
  const [renameValue, setRenameValue] = useState("")

  const { data: teachers, isLoading } = useQuery({
    queryKey: ["teachers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teachers").select("*").order("name")
      if (error) throw error
      return data
    },
  })

  const invite = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("invite-teacher", {
        body: { email, name },
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
      subtitle="Invite teachers by email, then grant Dept Coordinator or HOD as needed."
      accent="blue"
      action={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Invite teacher</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite a teacher</DialogTitle>
              <DialogDescription>
                They'll receive an email to set their password and sign in.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
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
            </div>
            <DialogFooter>
              <Button
                onClick={() => invite.mutate()}
                disabled={!email || invite.isPending}
              >
                {invite.isPending ? "Sending…" : "Send invite"}
              </Button>
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
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {teachers?.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{t.name}</TableCell>
                <TableCell>{t.email}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {t.is_dept_coordinator && <Badge>Dept Coordinator</Badge>}
                    {t.is_hod && <Badge variant="outline">HOD</Badge>}
                    {!t.is_dept_coordinator && !t.is_hod && (
                      <Badge variant="secondary">Teacher</Badge>
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
    </SectionShell>
  )
}
