import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeft, FolderOpen, UsersRound } from "lucide-react"
import { supabase } from "@/lib/supabase"
import type { Database, YearLevel } from "@/types/database"
import { SectionShell } from "@/components/section-shell"

type BatchWithTg = Database["public"]["Tables"]["batches"]["Row"] & {
  tg_teacher: { name: string } | null
}

const YEAR_LEVELS: YearLevel[] = ["FE", "SE", "TE", "BE"]
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
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

export default function BatchesPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [divisionId, setDivisionId] = useState<string>("")
  const [rollStart, setRollStart] = useState("1")
  const [rollEnd, setRollEnd] = useState("15")
  const [tgTeacherId, setTgTeacherId] = useState<string>("")

  const [editTarget, setEditTarget] = useState<BatchWithTg | null>(null)
  const [editRollStart, setEditRollStart] = useState("")
  const [editRollEnd, setEditRollEnd] = useState("")
  const [editTgTeacherId, setEditTgTeacherId] = useState("")

  const [divisionRollRange, setDivisionRollRange] = useState<{ min: number; max: number } | null>(null)

  const [openYear, setOpenYear] = useState<YearLevel | null>(null)
  const [openDivision, setOpenDivision] = useState<string | null>(null)

  const { data: divisions } = useQuery({
    queryKey: ["divisions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("divisions")
        .select("*")
        .order("academic_year", { ascending: false })
      if (error) throw error
      return data
    },
  })

  const { data: teachers } = useQuery({
    queryKey: ["teachers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teachers").select("*").order("name")
      if (error) throw error
      return data
    },
  })
  const eligibleTgTeachers = teachers?.filter((t) => !t.is_dept_coordinator)

  const { data: batches, isLoading } = useQuery({
    queryKey: ["batches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches")
        .select("*, tg_teacher:teachers(name)")
        .order("academic_year", { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as BatchWithTg[]
    },
  })

  const yearFolders = useMemo(
    () => YEAR_LEVELS.map((y) => ({ year: y, batches: (batches ?? []).filter((b) => b.year_level === y) })),
    [batches],
  )

  const divisionFolders = useMemo(() => {
    if (!openYear) return []
    const inYear = (batches ?? []).filter((b) => b.year_level === openYear)
    const letters = [...new Set(inYear.map((b) => b.division))].sort()
    return letters.map((d) => ({
      division: d,
      batches: inYear.filter((b) => b.division === d).sort((a, b) => a.roll_start - b.roll_start),
    }))
  }, [batches, openYear])

  const activeBatches = openDivision
    ? (divisionFolders.find((f) => f.division === openDivision)?.batches ?? [])
    : []

  const create = useMutation({
    mutationFn: async () => {
      const division = divisions?.find((d) => d.id === divisionId)
      if (!division) throw new Error("Pick a division")
      const { error } = await supabase.from("batches").insert({
        academic_year: division.academic_year,
        year_level: division.year_level,
        branch_code: division.branch_code,
        division: division.division,
        roll_start: Number(rollStart),
        roll_end: Number(rollEnd),
        tg_teacher_id: tgTeacherId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success("Batch created")
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: ["batches"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("batches").delete().eq("id", id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["batches"] }),
    onError: (err: Error) => toast.error(err.message),
  })

  const edit = useMutation({
    mutationFn: async () => {
      if (!editTarget) return
      const { error } = await supabase
        .from("batches")
        .update({
          roll_start: Number(editRollStart),
          roll_end: Number(editRollEnd),
          tg_teacher_id: editTgTeacherId,
        })
        .eq("id", editTarget.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success("Batch updated")
      setEditTarget(null)
      queryClient.invalidateQueries({ queryKey: ["batches"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  async function handleDivisionChange(id: string) {
    setDivisionId(id)
    setDivisionRollRange(null)
    const division = divisions?.find((d) => d.id === id)
    if (!division) return

    const [{ data: minRow }, { data: maxRow }] = await Promise.all([
      supabase
        .from("student_enrollments")
        .select("roll_seq")
        .eq("academic_year", division.academic_year)
        .eq("year_level", division.year_level)
        .eq("branch_code", division.branch_code)
        .eq("division", division.division)
        .order("roll_seq", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("student_enrollments")
        .select("roll_seq")
        .eq("academic_year", division.academic_year)
        .eq("year_level", division.year_level)
        .eq("branch_code", division.branch_code)
        .eq("division", division.division)
        .order("roll_seq", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (minRow && maxRow) {
      setDivisionRollRange({ min: minRow.roll_seq, max: maxRow.roll_seq })
      setRollStart(String(minRow.roll_seq))
      setRollEnd(String(maxRow.roll_seq))
    }
  }

  return (
    <SectionShell
      icon={UsersRound}
      title="TG batches"
      subtitle="A roll-range slice of a division, monitored by one TG."
      accent="blue"
      action={
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (!next) {
              setDivisionId("")
              setDivisionRollRange(null)
              setRollStart("1")
              setRollEnd("15")
              setTgTeacherId("")
            }
          }}
        >
          <DialogTrigger asChild>
            <Button>New batch</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a TG batch</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label>Division</Label>
                <Select value={divisionId} onValueChange={handleDivisionChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a division" />
                  </SelectTrigger>
                  <SelectContent>
                    {divisions?.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.year_level} {d.division} ({d.branch_code}, {d.academic_year})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {divisionRollRange && (
                  <p className="text-xs text-muted-foreground">
                    This division's enrolled roll numbers run {divisionRollRange.min}–
                    {divisionRollRange.max} — start/end below default to the full range; narrow it
                    to split across multiple TGs.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="b-start">Roll start</Label>
                  <Input
                    id="b-start"
                    type="number"
                    value={rollStart}
                    onChange={(e) => setRollStart(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="b-end">Roll end</Label>
                  <Input
                    id="b-end"
                    type="number"
                    value={rollEnd}
                    onChange={(e) => setRollEnd(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label>TG teacher</Label>
                <Select value={tgTeacherId} onValueChange={setTgTeacherId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a teacher (Dept Coordinators excluded)" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleTgTeachers?.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => create.mutate()}
                disabled={!divisionId || !tgTeacherId || create.isPending}
              >
                {create.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {!isLoading && !openYear && (
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
                {f.batches.length} batch{f.batches.length === 1 ? "" : "es"}
              </p>
            </Card>
          ))}
        </div>
      )}

      {openYear && !openDivision && (
        <>
          <button
            onClick={() => setOpenYear(null)}
            className="mb-3 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="size-3.5" /> All years
          </button>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{openYear}</h2>
          </div>
          {divisionFolders.length === 0 ? (
            <p className="text-sm text-slate-500">No batches in {openYear} yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {divisionFolders.map((f) => (
                <Card
                  key={f.division}
                  role="button"
                  onClick={() => setOpenDivision(f.division)}
                  className="cursor-pointer border-slate-200/70 bg-white/70 p-4 shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
                >
                  <div className="mb-2 flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <FolderOpen className="size-4.5" />
                  </div>
                  <p className="text-base font-semibold text-slate-900">
                    {openYear} {f.division}
                  </p>
                  <p className="text-sm text-slate-500">
                    {f.batches.length} batch{f.batches.length === 1 ? "" : "es"}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {openDivision && (
        <>
          <button
            onClick={() => setOpenDivision(null)}
            className="mb-3 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="size-3.5" /> {openYear} divisions
          </button>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">
              {openYear} {openDivision}
            </h2>
            <Badge variant="secondary">{activeBatches.length}</Badge>
          </div>
          <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Division</TableHead>
                  <TableHead>Roll range</TableHead>
                  <TableHead>TG</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeBatches.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No batches here yet
                    </TableCell>
                  </TableRow>
                )}
                {activeBatches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      {b.year_level} {b.division} ({b.branch_code}, {b.academic_year})
                    </TableCell>
                    <TableCell>
                      {b.roll_start}–{b.roll_end}
                    </TableCell>
                    <TableCell>{b.tg_teacher?.name}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditTarget(b)
                            setEditRollStart(String(b.roll_start))
                            setEditRollEnd(String(b.roll_end))
                            setEditTgTeacherId(b.tg_teacher_id)
                          }}
                        >
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => remove.mutate(b.id)}>
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
            <DialogTitle>
              Edit batch — {editTarget?.year_level} {editTarget?.division}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="edit-start">Roll start</Label>
                <Input
                  id="edit-start"
                  type="number"
                  value={editRollStart}
                  onChange={(e) => setEditRollStart(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="edit-end">Roll end</Label>
                <Input
                  id="edit-end"
                  type="number"
                  value={editRollEnd}
                  onChange={(e) => setEditRollEnd(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label>TG teacher</Label>
              <Select value={editTgTeacherId} onValueChange={setEditTgTeacherId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a teacher" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleTgTeachers?.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => edit.mutate()}
              disabled={!editRollStart || !editRollEnd || !editTgTeacherId || edit.isPending}
            >
              {edit.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionShell>
  )
}
