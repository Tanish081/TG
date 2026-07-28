import { useMemo, useRef, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Layers } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { parseRosterFile } from "@/lib/parse-roster-file"
import { displayRoll } from "@/lib/roll-code"
import { SectionShell } from "@/components/section-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { Database } from "@/types/database"

type EnrollmentWithStudent = Database["public"]["Tables"]["student_enrollments"]["Row"] & {
  student: { name: string; prn: string | null } | null
}

type CohortWithSubject = Database["public"]["Tables"]["cohorts"]["Row"] & {
  subject: { code: string } | null
}

interface AddStudentRow {
  prn: string | null
  externalRollNo: string | null
  name: string
  email: string | null
  phone: string | null
  rollSeq: number
  studentId?: string
  status: "matched" | "new" | "duplicate_in_file" | "invalid"
}

const LOW_ATTENDANCE_THRESHOLD = 75

export default function MyDivisionPage() {
  const { teacher } = useAuth()
  const queryClient = useQueryClient()
  const [electiveTarget, setElectiveTarget] = useState<string | null>(null)
  const [electiveCohortId, setElectiveCohortId] = useState("")

  const [addOpen, setAddOpen] = useState(false)
  const [addDivisionId, setAddDivisionId] = useState("")
  const [addRows, setAddRows] = useState<AddStudentRow[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: divisions } = useQuery({
    queryKey: ["my-divisions", teacher?.id],
    enabled: !!teacher,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("divisions")
        .select("*")
        .eq("class_teacher_id", teacher!.id)
      if (error) throw error
      return data
    },
  })

  const { data: enrollments, isLoading } = useQuery({
    queryKey: ["my-division-enrollments", divisions?.map((d) => d.id)],
    enabled: !!divisions && divisions.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        divisions!.map((d) =>
          supabase
            .from("student_enrollments")
            .select("*, student:students(name, prn)")
            .eq("academic_year", d.academic_year)
            .eq("year_level", d.year_level)
            .eq("branch_code", d.branch_code)
            .eq("division", d.division),
        ),
      )
      for (const r of results) if (r.error) throw r.error
      return results.flatMap((r) => (r.data ?? []) as unknown as EnrollmentWithStudent[])
    },
  })

  const enrollmentIds = useMemo(() => enrollments?.map((e) => e.id) ?? [], [enrollments])

  const { data: attendance } = useQuery({
    queryKey: ["division-attendance", enrollmentIds],
    enabled: enrollmentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("enrollment_id, status")
        .in("enrollment_id", enrollmentIds)
      if (error) throw error
      return data
    },
  })

  const { data: electiveCohorts } = useQuery({
    queryKey: ["elective-cohorts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cohorts")
        .select("*, subject:subjects(code)")
        .eq("type", "elective")
      if (error) throw error
      return (data ?? []) as unknown as CohortWithSubject[]
    },
  })

  const attendanceByEnrollment = useMemo(() => {
    const map = new Map<string, { present: number; total: number }>()
    for (const r of attendance ?? []) {
      const entry = map.get(r.enrollment_id) ?? { present: 0, total: 0 }
      entry.total += 1
      if (r.status === "present" || r.status === "late") entry.present += 1
      map.set(r.enrollment_id, entry)
    }
    return map
  }, [attendance])

  const addToElective = useMutation({
    mutationFn: async () => {
      if (!electiveTarget || !electiveCohortId) return
      const { error } = await supabase
        .from("cohort_members")
        .insert({ cohort_id: electiveCohortId, enrollment_id: electiveTarget })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success("Added to elective")
      setElectiveTarget(null)
      setElectiveCohortId("")
      queryClient.invalidateQueries({ queryKey: ["elective-cohorts"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  async function handleAddFile(file: File) {
    const parsed = await parseRosterFile(file)

    const prns = [...new Set(parsed.map((r) => r.prn).filter((v): v is string => !!v))]
    const extRolls = [...new Set(parsed.map((r) => r.externalRollNo).filter((v): v is string => !!v))]

    const [byPrnRes, byExtRes] = await Promise.all([
      prns.length > 0
        ? supabase.from("students").select("id, prn, name").in("prn", prns)
        : Promise.resolve({ data: [] as { id: string; prn: string | null; name: string }[], error: null }),
      // A roll-number match is looked up via enrollments, not students —
      // the roll code is per-year (§3/§4), so "same roll code as before"
      // means "the same enrollment record," not a permanent identity field.
      extRolls.length > 0
        ? supabase
            .from("student_enrollments")
            .select("external_roll_no, student:students(id, name)")
            .in("external_roll_no", extRolls)
        : Promise.resolve({
            data: [] as { external_roll_no: string | null; student: { id: string; name: string } | null }[],
            error: null,
          }),
    ])
    if (byPrnRes.error) {
      toast.error(byPrnRes.error.message)
      return
    }
    if (byExtRes.error) {
      toast.error(byExtRes.error.message)
      return
    }
    // A student can be matched either by PRN or by the source system's own
    // roll-code string — files like a college's onboarding sheet have no PRN
    // at all, so the roll code is the only thing to match a re-upload against.
    const byPrn = new Map(byPrnRes.data?.map((m) => [m.prn, m]))
    const byExt = new Map(
      (byExtRes.data as { external_roll_no: string | null; student: { id: string; name: string } | null }[])
        ?.filter((m) => m.student)
        .map((m) => [m.external_roll_no, m.student!]),
    )

    const seenKeys = new Set<string>()
    const built: AddStudentRow[] = parsed.map((r) => {
      const key = r.prn ?? r.externalRollNo ?? `${r.name}:${r.rollSeq}`
      const dup = seenKeys.has(key)
      seenKeys.add(key)
      const match = (r.prn && byPrn.get(r.prn)) || (r.externalRollNo && byExt.get(r.externalRollNo)) || undefined
      const invalid = r.rollSeq <= 0 || (!match && !r.name)
      return {
        prn: r.prn,
        externalRollNo: r.externalRollNo,
        name: match?.name ?? r.name,
        email: r.email,
        phone: r.phone,
        rollSeq: r.rollSeq,
        studentId: match?.id,
        status: invalid ? "invalid" : dup ? "duplicate_in_file" : match ? "matched" : "new",
      }
    })
    setAddRows(built)
  }

  const validRows = addRows.filter((r) => r.status === "matched" || r.status === "new")
  const newCount = addRows.filter((r) => r.status === "new").length
  const flaggedCount = addRows.length - validRows.length

  const confirmAdd = useMutation({
    mutationFn: async () => {
      const division = divisions?.find((d) => d.id === addDivisionId)
      if (!division) throw new Error("Pick a division")

      const toCreate = addRows.filter((r) => r.status === "new")
      let createdIds: string[] = []
      if (toCreate.length > 0) {
        const { data: created, error: createErr } = await supabase
          .from("students")
          .insert(
            toCreate.map((r) => ({
              prn: r.prn,
              name: r.name,
              email: r.email,
              phone: r.phone,
              created_by: teacher!.id,
            })),
          )
          .select("id")
        if (createErr) throw createErr
        createdIds = created?.map((c) => c.id) ?? []
      }

      let createdIdx = 0
      const toEnroll = validRows
        .map((r) => ({
          student_id: r.studentId ?? (r.status === "new" ? createdIds[createdIdx++] : undefined),
          academic_year: division.academic_year,
          year_level: division.year_level,
          branch_code: division.branch_code,
          division: division.division,
          roll_seq: r.rollSeq,
          external_roll_no: r.externalRollNo,
        }))
        .filter((r): r is { student_id: string } & typeof r => !!r.student_id)

      if (toEnroll.length === 0) throw new Error("Nothing to enroll")
      const { error: enrollErr } = await supabase.from("student_enrollments").insert(toEnroll)
      if (enrollErr) throw enrollErr
    },
    onSuccess: () => {
      toast.success(`Added ${validRows.length} students (${newCount} new)`)
      setAddOpen(false)
      setAddRows([])
      if (fileInputRef.current) fileInputRef.current.value = ""
      queryClient.invalidateQueries({ queryKey: ["my-division-enrollments"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (!divisions || divisions.length === 0) {
    return (
      <SectionShell icon={Layers} title="My division" accent="teal">
        <p className="text-sm text-slate-500">No division assigned yet — ask your Dept Coordinator.</p>
      </SectionShell>
    )
  }

  return (
    <SectionShell
      icon={Layers}
      title="My division"
      subtitle={divisions
        .map((d) => `${d.year_level}${d.division} (${d.branch_code}, ${d.academic_year})`)
        .join(", ")}
      accent="teal"
      action={
        <Dialog
          open={addOpen}
          onOpenChange={(open) => {
            setAddOpen(open)
            if (!open) {
              setAddRows([])
              setAddDivisionId("")
            } else if (divisions.length === 1) {
              setAddDivisionId(divisions[0].id)
            }
          }}
        >
          <DialogTrigger asChild>
            <Button>Add students</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add students to your division</DialogTitle>
              <DialogDescription>
                CSV or a college roster export (e.g. a subject-wise students report) both work — PRN
                is optional. Existing students are matched by PRN or their roll number; anyone new is
                created automatically.
              </DialogDescription>
            </DialogHeader>

            {divisions.length > 1 && (
              <div className="flex flex-col gap-2">
                <Select value={addDivisionId} onValueChange={setAddDivisionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a division" />
                  </SelectTrigger>
                  <SelectContent>
                    {divisions.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.year_level} {d.division} ({d.branch_code}, {d.academic_year})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => e.target.files?.[0] && handleAddFile(e.target.files[0])}
            />

            {addRows.length > 0 && (
              <>
                <div className="flex gap-2 text-sm">
                  <Badge variant="secondary">{validRows.length - newCount} existing</Badge>
                  <Badge>{newCount} new</Badge>
                  {flaggedCount > 0 && <Badge variant="destructive">{flaggedCount} flagged</Badge>}
                </div>
                <div className="max-h-64 overflow-auto rounded border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Roll</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {addRows.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">
                            {r.prn ?? r.externalRollNo ?? "—"}
                          </TableCell>
                          <TableCell>{r.rollSeq}</TableCell>
                          <TableCell>{r.name || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{r.email ?? "—"}</TableCell>
                          <TableCell>
                            {r.status === "matched" && <Badge variant="secondary">existing</Badge>}
                            {r.status === "new" && <Badge>new</Badge>}
                            {r.status === "duplicate_in_file" && (
                              <Badge variant="destructive">duplicate</Badge>
                            )}
                            {r.status === "invalid" && <Badge variant="destructive">invalid</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}

            <DialogFooter>
              <Button
                onClick={() => confirmAdd.mutate()}
                disabled={validRows.length === 0 || !addDivisionId || confirmAdd.isPending}
              >
                {confirmAdd.isPending ? "Adding…" : `Confirm — add ${validRows.length}`}
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
            <TableHead>Roll</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Attendance</TableHead>
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
          {enrollments
            ?.slice()
            .sort((a, b) => a.roll_seq - b.roll_seq)
            .map((e) => {
              const a = attendanceByEnrollment.get(e.id)
              const pct = a && a.total > 0 ? Math.round((a.present / a.total) * 100) : null
              const low = pct !== null && pct < LOW_ATTENDANCE_THRESHOLD
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-mono">{displayRoll(e)}</TableCell>
                  <TableCell>{e.student?.name}</TableCell>
                  <TableCell>
                    {pct === null ? "—" : <Badge variant={low ? "destructive" : "secondary"}>{pct}%</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => setElectiveTarget(e.id)}>
                      Add to elective
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
        </TableBody>
      </Table>
      </Card>

      <Dialog open={!!electiveTarget} onOpenChange={(open) => !open && setElectiveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to elective cohort</DialogTitle>
            <DialogDescription>Only cohorts created by the Dept Coordinator are listed.</DialogDescription>
          </DialogHeader>
          <Select value={electiveCohortId} onValueChange={setElectiveCohortId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick an elective" />
            </SelectTrigger>
            <SelectContent>
              {electiveCohorts?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label} ({c.subject?.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button onClick={() => addToElective.mutate()} disabled={!electiveCohortId || addToElective.isPending}>
              {addToElective.isPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionShell>
  )
}
