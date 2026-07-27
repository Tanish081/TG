import { useMemo, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FlameKindling,
  CalendarDays,
  Mail,
  Phone,
  UserRound,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import { currentAbsenceStreak, ABSENCE_FLAG_THRESHOLD } from "@/lib/attendance-daily"
import { displayRoll } from "@/lib/roll-code"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SectionShell } from "@/components/section-shell"
import type { Database } from "@/types/database"

type EnrollmentWithStudent = Database["public"]["Tables"]["student_enrollments"]["Row"] & {
  student: { name: string; prn: string | null; email: string | null; phone: string | null } | null
}

type AttendanceRecordWithSession = {
  status: string
  session: { date: string; slot: string; subject: { code: string; name: string } | null } | null
}

type AssessmentResultWithAssessment = Database["public"]["Tables"]["assessment_results"]["Row"] & {
  assessment: {
    exam_type: string
    max_marks: number
    semester: number
    academic_year: string
    subject: { code: string; name: string } | null
  } | null
}

type AssessmentWithSubject = Database["public"]["Tables"]["assessments"]["Row"] & {
  subject: { code: string; name: string } | null
}

// ----------------------------------------------------------------------------
// Attendance health status — shared visual language with the HOD stats page.
// ----------------------------------------------------------------------------
type Status = "good" | "warning" | "critical"
const STATUS_COLOR: Record<Status, string> = {
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b",
}
const STATUS_ICON = { good: CheckCircle2, warning: AlertTriangle, critical: XCircle }
const STATUS_TEXT: Record<Status, string> = {
  good: "text-[#0ca30c]",
  warning: "text-[#c98500]",
  critical: "text-[#d03b3b]",
}
function attendanceStatus(pct: number): Status {
  if (pct >= 75) return "good"
  if (pct >= 60) return "warning"
  return "critical"
}

interface DailyDetail {
  date: string
  present: number
  total: number
  records: { subject: string; slot: string; status: string }[]
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function weekdayLetter(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "narrow" })
}

export default function TgStudentPage() {
  const { enrollmentId } = useParams<{ enrollmentId: string }>()
  const queryClient = useQueryClient()

  const [markOpen, setMarkOpen] = useState(false)
  const [assessmentId, setAssessmentId] = useState("")
  const [marks, setMarks] = useState("")

  const [gpaOpen, setGpaOpen] = useState(false)
  const [semester, setSemester] = useState("3")
  const [sgpa, setSgpa] = useState("")
  const [cgpa, setCgpa] = useState("")
  const [gpaAcademicYear, setGpaAcademicYear] = useState("2025-26")

  const { data: enrollment } = useQuery({
    queryKey: ["enrollment", enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_enrollments")
        .select("*, student:students(name, prn, email, phone)")
        .eq("id", enrollmentId!)
        .single()
      if (error) throw error
      return data as unknown as EnrollmentWithStudent
    },
  })

  const { data: attendanceRecords } = useQuery({
    queryKey: ["student-attendance", enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("status, session:attendance_sessions(date, slot, subject:subjects(code, name))")
        .eq("enrollment_id", enrollmentId!)
      if (error) throw error
      return (data ?? []) as unknown as AttendanceRecordWithSession[]
    },
  })

  const { data: assessmentResults } = useQuery({
    queryKey: ["student-assessment-results", enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assessment_results")
        .select("*, assessment:assessments(exam_type, max_marks, semester, academic_year, subject:subjects(code, name))")
        .eq("enrollment_id", enrollmentId!)
      if (error) throw error
      return (data ?? []) as unknown as AssessmentResultWithAssessment[]
    },
  })

  const { data: semesterResults } = useQuery({
    queryKey: ["student-semester-results", enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("semester_results")
        .select("*")
        .eq("enrollment_id", enrollmentId!)
        .order("semester", { ascending: false })
      if (error) throw error
      return data
    },
  })

  const { data: assessments } = useQuery({
    queryKey: ["assessments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assessments")
        .select("*, subject:subjects(code, name)")
        .order("academic_year", { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as AssessmentWithSubject[]
    },
  })

  // The definitive subject list — every subject this student is enrolled in
  // via a cohort, whether or not attendance has been taken for it yet. Drives
  // both "Attendance by subject" and the per-subject 7-day rows below, so a
  // subject with zero sessions still shows up instead of silently vanishing.
  const { data: mySubjects } = useQuery({
    queryKey: ["student-subjects", enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cohort_members")
        .select("cohort:cohorts(subject:subjects(code, name))")
        .eq("enrollment_id", enrollmentId!)
      if (error) throw error
      type Row = { cohort: { subject: { code: string; name: string } | null } | null }
      const byCode = new Map<string, string>()
      for (const r of (data as unknown as Row[]) ?? []) {
        const s = r.cohort?.subject
        if (s) byCode.set(s.code, s.name)
      }
      return [...byCode.entries()]
        .map(([code, name]) => ({ code, name }))
        .sort((a, b) => a.code.localeCompare(b.code))
    },
  })

  const attendanceBySubject = useMemo(() => {
    const map = new Map<string, { name: string; present: number; total: number }>()
    for (const s of mySubjects ?? []) map.set(s.code, { name: s.name, present: 0, total: 0 })
    for (const r of attendanceRecords ?? []) {
      const subj = r.session?.subject
      const code = subj?.code ?? "?"
      const entry = map.get(code) ?? { name: subj?.name ?? "?", present: 0, total: 0 }
      entry.total += 1
      if (r.status === "present" || r.status === "late") entry.present += 1
      map.set(code, entry)
    }
    return map
  }, [attendanceRecords, mySubjects])

  // One entry per calendar day that had a session, chronological, with the
  // per-lecture detail kept for the heatmap's hover tooltip. Kept combined
  // (not per-subject) since it drives the overall absence streak and "Today"
  // card, which are about the student's whole day, not one subject.
  const dailyDetail = useMemo(() => {
    const map = new Map<string, DailyDetail>()
    for (const r of attendanceRecords ?? []) {
      if (!r.session) continue
      const entry = map.get(r.session.date) ?? { date: r.session.date, present: 0, total: 0, records: [] }
      entry.total += 1
      if (r.status === "present" || r.status === "late") entry.present += 1
      entry.records.push({
        subject: r.session.subject?.code ?? "?",
        slot: r.session.slot,
        status: r.status,
      })
      map.set(r.session.date, entry)
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [attendanceRecords])

  // Same per-day grouping, but split out per subject — feeds the subject-wise
  // 7-day rows. The heatmap cell itself (color, size, tooltip) is unchanged;
  // only what data drives each row changes.
  const dailyBySubject = useMemo(() => {
    const bySubject = new Map<string, Map<string, DailyDetail>>()
    for (const r of attendanceRecords ?? []) {
      if (!r.session) continue
      const code = r.session.subject?.code ?? "?"
      let dateMap = bySubject.get(code)
      if (!dateMap) {
        dateMap = new Map()
        bySubject.set(code, dateMap)
      }
      const entry = dateMap.get(r.session.date) ?? {
        date: r.session.date,
        present: 0,
        total: 0,
        records: [],
      }
      entry.total += 1
      if (r.status === "present" || r.status === "late") entry.present += 1
      entry.records.push({ subject: code, slot: r.session.slot, status: r.status })
      dateMap.set(r.session.date, entry)
    }
    const result = new Map<string, DailyDetail[]>()
    for (const [code, dateMap] of bySubject) {
      result.set(code, [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date)))
    }
    return result
  }, [attendanceRecords])

  const absenceStreak = currentAbsenceStreak(dailyDetail)
  const isFlagged = absenceStreak >= ABSENCE_FLAG_THRESHOLD
  const todayDetail = dailyDetail.find((d) => d.date === todayISO())

  const addMark = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("assessment_results").insert({
        assessment_id: assessmentId,
        enrollment_id: enrollmentId!,
        marks: Number(marks),
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success("Marks recorded")
      setMarkOpen(false)
      setMarks("")
      queryClient.invalidateQueries({ queryKey: ["student-assessment-results", enrollmentId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const addGpa = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("semester_results").upsert(
        {
          enrollment_id: enrollmentId!,
          semester: Number(semester),
          sgpa: sgpa ? Number(sgpa) : null,
          cgpa: cgpa ? Number(cgpa) : null,
          academic_year: gpaAcademicYear,
        },
        { onConflict: "enrollment_id,semester" },
      )
      if (error) throw error
    },
    onSuccess: () => {
      toast.success("GPA recorded")
      setGpaOpen(false)
      queryClient.invalidateQueries({ queryKey: ["student-semester-results", enrollmentId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (!enrollment) return <p className="text-muted-foreground">Loading…</p>

  const student = enrollment.student ?? { name: "—", prn: null, email: null, phone: null }

  return (
    <SectionShell
      icon={UserRound}
      title={student.name}
      subtitle={`${displayRoll(enrollment)} · ${student.prn ?? "no PRN"}`}
      accent="teal"
      maxWidth="max-w-3xl"
      action={
        (student.email || student.phone) && (
          <div className="flex flex-col items-end gap-1 text-sm text-slate-600">
            {student.email && (
              <span className="flex items-center gap-1.5">
                <Mail className="size-3.5 text-slate-400" /> {student.email}
              </span>
            )}
            {student.phone && (
              <span className="flex items-center gap-1.5">
                <Phone className="size-3.5 text-slate-400" /> {student.phone}
              </span>
            )}
          </div>
        )
      }
    >
      <Link
        to="/tg"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" /> Back to TG group
      </Link>

      {isFlagged && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
          <FlameKindling className="size-5 shrink-0 text-destructive" />
          <p className="text-sm">
            <span className="font-medium text-destructive">
              {absenceStreak} consecutive days absent
            </span>
            <span className="text-muted-foreground"> — flagged for follow-up.</span>
          </p>
        </div>
      )}

      <div className="mb-6">
        <Card className="w-fit min-w-48 border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarDays className="size-3.5" />
              <CardDescription className="mb-0">Today</CardDescription>
            </div>
            {todayDetail ? (
              <>
                <CardTitle
                  className={cn(
                    "text-2xl",
                    STATUS_TEXT[attendanceStatus((todayDetail.present / todayDetail.total) * 100)],
                  )}
                >
                  {todayDetail.present}/{todayDetail.total}
                </CardTitle>
                <p className="text-xs text-muted-foreground">lectures present today</p>
              </>
            ) : (
              <>
                <CardTitle className="text-2xl text-muted-foreground">—</CardTitle>
                <p className="text-xs text-muted-foreground">no sessions recorded yet today</p>
              </>
            )}
          </CardHeader>
        </Card>
      </div>

      <Card className="mb-8 border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-slate-900">Last 7 working days — by subject</CardTitle>
          <CardDescription>One row per subject, most recent lectures for that subject.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {(mySubjects ?? []).map((s) => {
            const days = (dailyBySubject.get(s.code) ?? []).slice(-7)
            return (
              <div key={s.code}>
                <p className="mb-1.5 text-sm font-medium text-slate-800">
                  {s.code} <span className="font-normal text-slate-400">— {s.name}</span>
                </p>
                <div className="flex gap-2">
                  {days.map((d) => {
                    const p = d.total > 0 ? (d.present / d.total) * 100 : 0
                    const status = attendanceStatus(p)
                    return (
                      <Tooltip key={d.date}>
                        <TooltipTrigger asChild>
                          <div className="flex flex-col items-center gap-1">
                            <div
                              className="flex size-9 items-center justify-center rounded-lg text-xs font-semibold text-white transition-transform hover:scale-105"
                              style={{ backgroundColor: STATUS_COLOR[status] }}
                            >
                              {d.present}/{d.total}
                            </div>
                            <span className="text-[10px] text-muted-foreground">{weekdayLetter(d.date)}</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium">{fmtDate(d.date)}</span>
                            {d.records.map((r, i) => (
                              <span key={i} className="text-muted-foreground">
                                {r.subject} (slot {r.slot}) — {r.status}
                              </span>
                            ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    )
                  })}
                  {days.length === 0 && (
                    <p className="text-xs text-muted-foreground">No sessions yet.</p>
                  )}
                </div>
              </div>
            )
          })}
          {(!mySubjects || mySubjects.length === 0) && (
            <p className="text-sm text-muted-foreground">Not enrolled in any cohort yet.</p>
          )}
          {mySubjects && mySubjects.length > 0 && (
            <div className="flex items-center gap-4 border-t border-slate-100 pt-3 text-xs text-muted-foreground">
              {(["good", "warning", "critical"] as Status[]).map((s) => {
                const Icon = STATUS_ICON[s]
                return (
                  <span key={s} className="flex items-center gap-1">
                    <Icon className={cn("size-3.5", STATUS_TEXT[s])} />
                    {s === "good" ? "≥75%" : s === "warning" ? "60–74%" : "<60%"}
                  </span>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-medium">Attendance by subject</h2>
        <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject</TableHead>
              <TableHead>Present</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...attendanceBySubject.entries()].map(([code, a]) => {
              const pct = a.total > 0 ? Math.round((a.present / a.total) * 100) : null
              return (
                <TableRow key={code}>
                  <TableCell>
                    {code} <span className="text-muted-foreground">— {a.name}</span>
                  </TableCell>
                  <TableCell>{a.present}</TableCell>
                  <TableCell>{a.total}</TableCell>
                  <TableCell>
                    {pct === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Badge variant={pct < 75 ? "destructive" : "secondary"}>{pct}%</Badge>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            {attendanceBySubject.size === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  Not enrolled in any cohort yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </Card>
      </section>

      <section className="mb-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-medium">Marks</h2>
          <Dialog open={markOpen} onOpenChange={setMarkOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                Add marks
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record marks</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Assessment</Label>
                  <Select value={assessmentId} onValueChange={setAssessmentId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick an assessment" />
                    </SelectTrigger>
                    <SelectContent>
                      {assessments?.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.subject?.code} · {a.exam_type} · sem{" "}
                          {a.semester} ({a.academic_year})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="marks">Marks</Label>
                  <Input id="marks" type="number" value={marks} onChange={(e) => setMarks(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => addMark.mutate()} disabled={!assessmentId || !marks || addMark.isPending}>
                  {addMark.isPending ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject</TableHead>
              <TableHead>Exam</TableHead>
              <TableHead>Marks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assessmentResults?.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.assessment?.subject?.code}</TableCell>
                <TableCell>{r.assessment?.exam_type}</TableCell>
                <TableCell>
                  {r.marks} / {r.assessment?.max_marks}
                </TableCell>
              </TableRow>
            ))}
            {(!assessmentResults || assessmentResults.length === 0) && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  No marks recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </Card>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-medium">GPA</h2>
          <Dialog open={gpaOpen} onOpenChange={setGpaOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                Add / update GPA
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record semester GPA</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sem">Semester</Label>
                  <Input id="sem" type="number" value={semester} onChange={(e) => setSemester(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="ay">Academic year</Label>
                  <Input id="ay" value={gpaAcademicYear} onChange={(e) => setGpaAcademicYear(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sgpa">SGPA</Label>
                  <Input id="sgpa" type="number" step="0.01" value={sgpa} onChange={(e) => setSgpa(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="cgpa">CGPA</Label>
                  <Input id="cgpa" type="number" step="0.01" value={cgpa} onChange={(e) => setCgpa(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => addGpa.mutate()} disabled={addGpa.isPending}>
                  {addGpa.isPending ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Semester</TableHead>
              <TableHead>SGPA</TableHead>
              <TableHead>CGPA</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {semesterResults?.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.semester}</TableCell>
                <TableCell>{r.sgpa ?? "—"}</TableCell>
                <TableCell>{r.cgpa ?? "—"}</TableCell>
              </TableRow>
            ))}
            {(!semesterResults || semesterResults.length === 0) && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  No GPA recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </Card>
      </section>
    </SectionShell>
  )
}
