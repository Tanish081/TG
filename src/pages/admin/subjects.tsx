import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeft, BookOpen, FolderOpen } from "lucide-react"
import { supabase } from "@/lib/supabase"
import type { Database, YearLevel } from "@/types/database"
import { SectionShell } from "@/components/section-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

const YEAR_LEVELS: YearLevel[] = ["FE", "SE", "TE", "BE"]

type Subject = Database["public"]["Tables"]["subjects"]["Row"]

export default function SubjectsPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [yearLevel, setYearLevel] = useState<YearLevel>("SE")
  const [semester, setSemester] = useState("3")
  const [openYear, setOpenYear] = useState<YearLevel | null>(null)

  const [editTarget, setEditTarget] = useState<Subject | null>(null)
  const [editName, setEditName] = useState("")
  const [editCode, setEditCode] = useState("")
  const [editYearLevel, setEditYearLevel] = useState<YearLevel>("SE")
  const [editSemester, setEditSemester] = useState("3")

  const { data: subjects, isLoading } = useQuery({
    queryKey: ["subjects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subjects").select("*").order("code")
      if (error) throw error
      return data
    },
  })

  const yearFolders = useMemo(() => {
    return YEAR_LEVELS.map((y) => ({
      year: y,
      subjects: (subjects ?? []).filter((s) => s.year_level === y).sort((a, b) => a.code.localeCompare(b.code)),
    }))
  }, [subjects])

  const activeFolder = yearFolders.find((f) => f.year === openYear)

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("subjects").insert({
        name,
        code,
        year_level: yearLevel,
        semester: Number(semester),
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success("Subject added")
      setOpen(false)
      setName("")
      setCode("")
      queryClient.invalidateQueries({ queryKey: ["subjects"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      // cohorts.subject_id cascades on delete, so deleting a subject with
      // cohorts would silently wipe them (and their attendance/members) —
      // block it with a clear reason instead of letting that happen, or of
      // surfacing the raw foreign-key error that attendance_sessions.subject_id
      // (which doesn't cascade) would throw once any session exists.
      const { count, error: countErr } = await supabase
        .from("cohorts")
        .select("id", { count: "exact", head: true })
        .eq("subject_id", id)
      if (countErr) throw countErr
      if (count && count > 0) {
        throw new Error(
          `Can't delete — ${count} cohort${count === 1 ? "" : "s"} still use${count === 1 ? "s" : ""} this subject. Delete those cohorts first.`,
        )
      }
      const { error } = await supabase.from("subjects").delete().eq("id", id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["subjects"] }),
    onError: (err: Error) => toast.error(err.message),
  })

  const edit = useMutation({
    mutationFn: async () => {
      if (!editTarget) return
      const { error } = await supabase
        .from("subjects")
        .update({
          name: editName,
          code: editCode,
          year_level: editYearLevel,
          semester: Number(editSemester),
        })
        .eq("id", editTarget.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success("Subject updated")
      setEditTarget(null)
      queryClient.invalidateQueries({ queryKey: ["subjects"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <SectionShell
      icon={BookOpen}
      title="Subjects"
      subtitle="The anchor for cohorts and assessments."
      accent="blue"
      action={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Add subject</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add a subject</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="s-name">Name</Label>
                <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="s-code">Code</Label>
                <Input id="s-code" value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Year level</Label>
                  <Select value={yearLevel} onValueChange={(v) => setYearLevel(v as YearLevel)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {YEAR_LEVELS.map((y) => (
                        <SelectItem key={y} value={y}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="s-sem">Semester</Label>
                  <Input
                    id="s-sem"
                    type="number"
                    value={semester}
                    onChange={(e) => setSemester(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={!name || !code || create.isPending}>
                {create.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {!isLoading && !activeFolder && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {yearFolders.map((f) => (
            <Card
              key={f.year}
              role="button"
              onClick={() => setOpenYear(f.year)}
              className="cursor-pointer border-slate-200/70 bg-white/70 p-4 shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
            >
              <div className="mb-2 flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                <FolderOpen className="size-4.5" />
              </div>
              <p className="text-base font-semibold text-slate-900">{f.year}</p>
              <p className="text-sm text-slate-500">
                {f.subjects.length} subject{f.subjects.length === 1 ? "" : "s"}
              </p>
            </Card>
          ))}
        </div>
      )}

      {activeFolder && (
        <>
          <button
            onClick={() => setOpenYear(null)}
            className="mb-3 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="size-3.5" /> All years
          </button>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{activeFolder.year}</h2>
            <Badge variant="secondary">{activeFolder.subjects.length}</Badge>
          </div>
          <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Sem</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeFolder.subjects.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No subjects in {activeFolder.year} yet
                    </TableCell>
                  </TableRow>
                )}
                {activeFolder.subjects.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.code}</TableCell>
                    <TableCell>{s.name}</TableCell>
                    <TableCell>{s.semester}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditTarget(s)
                            setEditName(s.name)
                            setEditCode(s.code)
                            setEditYearLevel(s.year_level)
                            setEditSemester(String(s.semester))
                          }}
                        >
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => remove.mutate(s.id)}>
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit subject</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="es-name">Name</Label>
              <Input id="es-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="es-code">Code</Label>
              <Input id="es-code" value={editCode} onChange={(e) => setEditCode(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label>Year level</Label>
                <Select value={editYearLevel} onValueChange={(v) => setEditYearLevel(v as YearLevel)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {YEAR_LEVELS.map((y) => (
                      <SelectItem key={y} value={y}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="es-sem">Semester</Label>
                <Input
                  id="es-sem"
                  type="number"
                  value={editSemester}
                  onChange={(e) => setEditSemester(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => edit.mutate()} disabled={!editName || !editCode || edit.isPending}>
              {edit.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionShell>
  )
}
