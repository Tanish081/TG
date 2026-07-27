import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Layers,
  UsersRound,
  GraduationCap,
  ClipboardCheck,
  Users,
  BarChart3,
  BookOpen,
  FolderOpen,
  ArrowLeft,
  type LucideIcon,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { SectionShell } from "@/components/section-shell"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { displayRoll } from "@/lib/roll-code"
import { cn } from "@/lib/utils"

type Status = "good" | "warning" | "critical"

const STATUS_COLOR: Record<Status, string> = {
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b",
}
const STATUS_ICON: Record<Status, LucideIcon> = {
  good: CheckCircle2,
  warning: AlertTriangle,
  critical: XCircle,
}
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

const SEQ_FILL = "#2a78d6"
const SEQ_TRACK = "#b7d3f6"

interface AttendanceAgg {
  present: number
  total: number
}

function pct(a: AttendanceAgg) {
  return a.total > 0 ? (a.present / a.total) * 100 : null
}

function fmtPct(n: number | null) {
  return n === null ? "—" : `${Math.round(n)}%`
}

// ----------------------------------------------------------------------------
// Small local building blocks. Not extracted to a shared library since this
// page is the only consumer.
// ----------------------------------------------------------------------------

function StatTile({
  icon: Icon,
  label,
  value,
  iconClassName,
  accentClassName,
}: {
  icon: LucideIcon
  label: string
  value: string
  iconClassName: string
  accentClassName?: string
}) {
  return (
    <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-md">
      <CardHeader className="pb-2">
        <div className={cn("mb-1 flex size-9 items-center justify-center rounded-xl", iconClassName)}>
          <Icon className="size-4.5" />
        </div>
        <CardDescription className="text-slate-500">{label}</CardDescription>
        <CardTitle className={cn("text-2xl font-bold tracking-tight text-slate-900", accentClassName)}>
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  )
}

function BarRow({
  label,
  sublabel,
  value,
  displayValue,
  fill,
  track,
  status,
  tooltip,
}: {
  label: string
  sublabel?: string
  value: number
  displayValue: string
  fill: string
  track: string
  status?: Status
  tooltip: string
}) {
  const Icon = status ? STATUS_ICON[status] : null
  return (
    <div className="group relative">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="truncate text-sm font-medium text-slate-800">{label}</span>
          {sublabel && <span className="ml-1.5 text-xs text-slate-500">{sublabel}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {Icon && status && <Icon className={cn("size-3.5", STATUS_TEXT[status])} />}
          <span className="font-mono text-sm font-medium tabular-nums text-slate-700">{displayValue}</span>
        </div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: track }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: fill }}
        />
      </div>
      <div className="pointer-events-none absolute -top-7 left-0 z-10 rounded-md bg-slate-900 px-2 py-1 text-xs whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        {tooltip}
      </div>
    </div>
  )
}

function StatusLegend() {
  return (
    <div className="mb-3 flex items-center gap-4 text-xs text-slate-500">
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
  )
}

// ----------------------------------------------------------------------------

interface EnrollmentPart {
  id: string
  student_id: string
  academic_year: string
  year_level: string
  branch_code: string
  division: string
  roll_seq: number
  roll_code: string
  external_roll_no: string | null
  student: { name: string } | null
}

interface AttendanceRecordDetailed {
  enrollment_id: string
  status: string
  session: { date: string; subject: { code: string; name: string } | null } | null
}

export default function HodStatsPage() {
  const { data: divisions, isLoading: loadingDivisions } = useQuery({
    queryKey: ["hod-divisions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("divisions").select("*")
      if (error) throw error
      return data
    },
  })

  const { data: batches, isLoading: loadingBatches } = useQuery({
    queryKey: ["hod-batches"],
    queryFn: async () => {
      const { data, error } = await supabase.from("batches").select("*")
      if (error) throw error
      return data
    },
  })

  const { data: teachers } = useQuery({
    queryKey: ["hod-teachers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teachers").select("id, name")
      if (error) throw error
      return data
    },
  })

  const { data: enrollments, isLoading: loadingEnrollments } = useQuery({
    queryKey: ["hod-enrollments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_enrollments")
        .select(
          "id, student_id, academic_year, year_level, branch_code, division, roll_seq, roll_code, external_roll_no, student:students(name)",
        )
      if (error) throw error
      return data as EnrollmentPart[]
    },
  })

  const { data: attendanceRecords } = useQuery({
    queryKey: ["hod-attendance"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("enrollment_id, status, session:attendance_sessions(date, subject:subjects(code, name))")
      if (error) throw error
      return (data ?? []) as unknown as AttendanceRecordDetailed[]
    },
  })

  const { data: semesterResults } = useQuery({
    queryKey: ["hod-semester-results"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("semester_results")
        .select("enrollment_id, semester, sgpa")
        .order("semester", { ascending: false })
      if (error) throw error
      return data
    },
  })

  const { data: sessionCount } = useQuery({
    queryKey: ["hod-session-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("attendance_sessions")
        .select("id", { count: "exact", head: true })
      if (error) throw error
      return count ?? 0
    },
  })

  const teacherName = useMemo(() => new Map(teachers?.map((t) => [t.id, t.name])), [teachers])

  const attendanceByEnrollment = useMemo(() => {
    const map = new Map<string, AttendanceAgg>()
    for (const r of attendanceRecords ?? []) {
      const entry = map.get(r.enrollment_id) ?? { present: 0, total: 0 }
      entry.total += 1
      if (r.status === "present" || r.status === "late") entry.present += 1
      map.set(r.enrollment_id, entry)
    }
    return map
  }, [attendanceRecords])

  const latestSgpaByEnrollment = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of semesterResults ?? []) {
      if (!map.has(r.enrollment_id) && r.sgpa !== null) map.set(r.enrollment_id, r.sgpa)
    }
    return map
  }, [semesterResults])

  function aggregateFor(ids: string[]): AttendanceAgg {
    const agg = { present: 0, total: 0 }
    for (const id of ids) {
      const a = attendanceByEnrollment.get(id)
      if (a) {
        agg.present += a.present
        agg.total += a.total
      }
    }
    return agg
  }

  function avgSgpaFor(ids: string[]): number | null {
    const values = ids.map((id) => latestSgpaByEnrollment.get(id)).filter((v): v is number => v !== undefined)
    if (values.length === 0) return null
    return values.reduce((a, b) => a + b, 0) / values.length
  }

  const divisionStats = useMemo(() => {
    if (!divisions || !enrollments) return []
    return divisions.map((d) => {
      const ids = enrollments
        .filter(
          (e) =>
            e.academic_year === d.academic_year &&
            e.year_level === d.year_level &&
            e.branch_code === d.branch_code &&
            e.division === d.division,
        )
        .map((e) => e.id)
      return {
        key: d.id,
        label: `${d.year_level}-${d.division}`,
        sublabel: `${d.branch_code} · ${d.academic_year} · ${ids.length} students`,
        attendance: aggregateFor(ids),
        avgSgpa: avgSgpaFor(ids),
      }
    })
  }, [divisions, enrollments, attendanceByEnrollment, latestSgpaByEnrollment])

  const batchStats = useMemo(() => {
    if (!batches || !enrollments) return []
    return batches.map((b) => {
      const ids = enrollments
        .filter(
          (e) =>
            e.academic_year === b.academic_year &&
            e.year_level === b.year_level &&
            e.branch_code === b.branch_code &&
            e.division === b.division &&
            e.roll_seq >= b.roll_start &&
            e.roll_seq <= b.roll_end,
        )
        .map((e) => e.id)
      return {
        key: b.id,
        label: `${b.year_level}-${b.division} (${b.roll_start}–${b.roll_end})`,
        sublabel: `TG: ${teacherName.get(b.tg_teacher_id) ?? "—"} · ${ids.length} students`,
        attendance: aggregateFor(ids),
        avgSgpa: avgSgpaFor(ids),
      }
    })
  }, [batches, enrollments, teacherName, attendanceByEnrollment, latestSgpaByEnrollment])

  const subjectStats = useMemo(() => {
    const map = new Map<string, { name: string; present: number; total: number }>()
    for (const r of attendanceRecords ?? []) {
      const subj = r.session?.subject
      if (!subj) continue
      const entry = map.get(subj.code) ?? { name: subj.name, present: 0, total: 0 }
      entry.total += 1
      if (r.status === "present" || r.status === "late") entry.present += 1
      map.set(subj.code, entry)
    }
    return [...map.entries()]
      .map(([code, v]) => ({ code, ...v }))
      .sort((a, b) => a.code.localeCompare(b.code))
  }, [attendanceRecords])

  const overview = useMemo(() => {
    const allIds = enrollments?.map((e) => e.id) ?? []
    const dept = aggregateFor(allIds)
    const distinctStudents = new Set(enrollments?.map((e) => e.student_id)).size
    const countBelow = (threshold: number) =>
      allIds.filter((id) => {
        const a = attendanceByEnrollment.get(id)
        const p = a ? pct(a) : null
        return p !== null && p < threshold
      }).length
    return {
      totalDivisions: divisions?.length ?? 0,
      totalStudents: distinctStudents,
      totalTeachers: teachers?.length ?? 0,
      totalBatches: batches?.length ?? 0,
      totalSessions: sessionCount ?? 0,
      deptAttendance: pct(dept),
      deptAvgSgpa: avgSgpaFor(allIds),
      lowAttendance75: countBelow(75),
      lowAttendance50: countBelow(50),
    }
  }, [divisions, enrollments, teachers, batches, sessionCount, attendanceByEnrollment, latestSgpaByEnrollment])

  // Drill-down: click a "below X%" tile -> division folders with counts -> a
  // division's actual student names. Built on demand (cheap — everything's
  // already in memory) rather than kept in a separate query.
  const [lowAttendanceModal, setLowAttendanceModal] = useState<{
    threshold: number
    divisionKey: string | null
  } | null>(null)

  const lowAttendanceGroups = useMemo(() => {
    if (!lowAttendanceModal || !divisions || !enrollments) return []
    const { threshold } = lowAttendanceModal
    return divisions
      .map((d) => {
        const students = enrollments
          .filter(
            (e) =>
              e.academic_year === d.academic_year &&
              e.year_level === d.year_level &&
              e.branch_code === d.branch_code &&
              e.division === d.division,
          )
          .map((e) => {
            const a = attendanceByEnrollment.get(e.id)
            const p = a ? pct(a) : null
            return p !== null && p < threshold
              ? { id: e.id, roll: displayRoll(e), name: e.student?.name ?? "—", pct: p }
              : null
          })
          .filter((s): s is { id: string; roll: string; name: string; pct: number } => !!s)
          .sort((a, b) => a.pct - b.pct)
        return {
          key: d.id,
          label: `${d.year_level}-${d.division}`,
          sublabel: `${d.branch_code} · ${d.academic_year}`,
          students,
        }
      })
      .filter((g) => g.students.length > 0)
      .sort((a, b) => b.students.length - a.students.length)
  }, [lowAttendanceModal, divisions, enrollments, attendanceByEnrollment])

  const activeGroup = lowAttendanceGroups.find((g) => g.key === lowAttendanceModal?.divisionKey)

  const isLoading = loadingDivisions || loadingBatches || loadingEnrollments

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })

  return (
    <SectionShell icon={BarChart3} title="Department Overview" subtitle={`${today} · read-only`} accent="indigo">
      <>
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatTile
                icon={Layers}
                label="Divisions"
                value={String(overview.totalDivisions)}
                iconClassName="bg-indigo-100 text-indigo-600"
              />
              <StatTile
                icon={Users}
                label="Students"
                value={String(overview.totalStudents)}
                iconClassName="bg-violet-100 text-violet-600"
              />
              <StatTile
                icon={GraduationCap}
                label="Teachers"
                value={String(overview.totalTeachers)}
                iconClassName="bg-sky-100 text-sky-600"
              />
              <StatTile
                icon={UsersRound}
                label="TG batches"
                value={String(overview.totalBatches)}
                iconClassName="bg-amber-100 text-amber-600"
              />
              <StatTile
                icon={ClipboardCheck}
                label="Sessions held"
                value={String(overview.totalSessions)}
                iconClassName="bg-emerald-100 text-emerald-600"
              />
            </div>

            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
                <CardHeader className="pb-2">
                  <CardDescription className="text-slate-500">Department attendance</CardDescription>
                  <CardTitle
                    className={cn(
                      "text-3xl font-bold tracking-tight",
                      overview.deptAttendance !== null
                        ? STATUS_TEXT[attendanceStatus(overview.deptAttendance)]
                        : "text-slate-900",
                    )}
                  >
                    {fmtPct(overview.deptAttendance)}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
                <CardHeader className="pb-2">
                  <CardDescription className="text-slate-500">Department avg SGPA</CardDescription>
                  <CardTitle className="text-3xl font-bold tracking-tight text-slate-900">
                    {overview.deptAvgSgpa === null ? "—" : overview.deptAvgSgpa.toFixed(2)}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card
                role="button"
                onClick={() => setLowAttendanceModal({ threshold: 75, divisionKey: null })}
                className="cursor-pointer border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm transition-shadow hover:border-indigo-200 hover:shadow-md"
              >
                <CardHeader className="pb-2">
                  <CardDescription className="text-slate-500">Below 75% attendance</CardDescription>
                  <CardTitle
                    className={cn(
                      "text-3xl font-bold tracking-tight",
                      overview.lowAttendance75 > 0 ? STATUS_TEXT.warning : "text-slate-900",
                    )}
                  >
                    {overview.lowAttendance75}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card
                role="button"
                onClick={() => setLowAttendanceModal({ threshold: 50, divisionKey: null })}
                className="cursor-pointer border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm transition-shadow hover:border-indigo-200 hover:shadow-md"
              >
                <CardHeader className="pb-2">
                  <CardDescription className="text-slate-500">Below 50% attendance</CardDescription>
                  <CardTitle
                    className={cn(
                      "text-3xl font-bold tracking-tight",
                      overview.lowAttendance50 > 0 ? STATUS_TEXT.critical : "text-slate-900",
                    )}
                  >
                    {overview.lowAttendance50}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            <div className="mb-6 grid gap-4 lg:grid-cols-2">
              <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-base text-slate-900">Attendance by division</CardTitle>
                  <CardDescription className="text-slate-500">Core + elective, combined.</CardDescription>
                </CardHeader>
                <CardContent>
                  <StatusLegend />
                  <div className="flex flex-col gap-4">
                    {divisionStats.map((d) => {
                      const p = pct(d.attendance)
                      return (
                        <BarRow
                          key={d.key}
                          label={d.label}
                          sublabel={d.sublabel}
                          value={p ?? 0}
                          displayValue={fmtPct(p)}
                          fill={p === null ? SEQ_TRACK : STATUS_COLOR[attendanceStatus(p)]}
                          track="#eef0f2"
                          status={p === null ? undefined : attendanceStatus(p)}
                          tooltip={`${d.attendance.present} present / ${d.attendance.total} records`}
                        />
                      )
                    })}
                    {divisionStats.length === 0 && (
                      <p className="text-sm text-slate-500">No divisions yet.</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-base text-slate-900">Attendance by TG batch</CardTitle>
                  <CardDescription className="text-slate-500">Each batch's own roll range.</CardDescription>
                </CardHeader>
                <CardContent>
                  <StatusLegend />
                  <div className="flex flex-col gap-4">
                    {batchStats.map((b) => {
                      const p = pct(b.attendance)
                      return (
                        <BarRow
                          key={b.key}
                          label={b.label}
                          sublabel={b.sublabel}
                          value={p ?? 0}
                          displayValue={fmtPct(p)}
                          fill={p === null ? SEQ_TRACK : STATUS_COLOR[attendanceStatus(p)]}
                          track="#eef0f2"
                          status={p === null ? undefined : attendanceStatus(p)}
                          tooltip={`${b.attendance.present} present / ${b.attendance.total} records`}
                        />
                      )
                    })}
                    {batchStats.length === 0 && (
                      <p className="text-sm text-slate-500">No TG batches yet.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <BookOpen className="size-4 text-indigo-600" />
                    <CardTitle className="text-base text-slate-900">Attendance by subject</CardTitle>
                  </div>
                  <CardDescription className="text-slate-500">Across every cohort teaching it.</CardDescription>
                </CardHeader>
                <CardContent>
                  <StatusLegend />
                  <div className="flex flex-col gap-4">
                    {subjectStats.map((s) => {
                      const p = pct(s)
                      return (
                        <BarRow
                          key={s.code}
                          label={s.code}
                          sublabel={s.name}
                          value={p ?? 0}
                          displayValue={fmtPct(p)}
                          fill={p === null ? SEQ_TRACK : STATUS_COLOR[attendanceStatus(p)]}
                          track="#eef0f2"
                          status={p === null ? undefined : attendanceStatus(p)}
                          tooltip={`${s.present} present / ${s.total} records`}
                        />
                      )
                    })}
                    {subjectStats.length === 0 && (
                      <p className="text-sm text-slate-500">No attendance recorded yet.</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-base text-slate-900">Average SGPA by division</CardTitle>
                  <CardDescription className="text-slate-500">
                    Latest recorded semester result per student, averaged.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-4">
                    {divisionStats.map((d) => (
                      <BarRow
                        key={d.key}
                        label={d.label}
                        sublabel={d.sublabel}
                        value={d.avgSgpa === null ? 0 : (d.avgSgpa / 10) * 100}
                        displayValue={d.avgSgpa === null ? "—" : d.avgSgpa.toFixed(2)}
                        fill={SEQ_FILL}
                        track="#eef0f2"
                        tooltip={
                          d.avgSgpa === null ? "No GPA recorded yet" : `Avg SGPA ${d.avgSgpa.toFixed(2)} / 10`
                        }
                      />
                    ))}
                    {divisionStats.length === 0 && (
                      <p className="text-sm text-slate-500">No divisions yet.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        <Dialog
        open={!!lowAttendanceModal}
        onOpenChange={(open) => !open && setLowAttendanceModal(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            {activeGroup ? (
              <button
                onClick={() => setLowAttendanceModal((m) => m && { ...m, divisionKey: null })}
                className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
              >
                <ArrowLeft className="size-3.5" /> All divisions
              </button>
            ) : null}
            <DialogTitle className="text-slate-900">
              {activeGroup
                ? `${activeGroup.label} — below ${lowAttendanceModal?.threshold}%`
                : `Students below ${lowAttendanceModal?.threshold}% attendance`}
            </DialogTitle>
            <DialogDescription>
              {activeGroup
                ? activeGroup.sublabel
                : "Grouped by division — open one to see names."}
            </DialogDescription>
          </DialogHeader>

          {!activeGroup ? (
            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
              {lowAttendanceGroups.map((g) => (
                <button
                  key={g.key}
                  onClick={() => setLowAttendanceModal((m) => m && { ...m, divisionKey: g.key })}
                  className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-left transition-colors hover:bg-slate-50"
                >
                  <div className="flex items-center gap-2">
                    <FolderOpen className="size-4 text-slate-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">{g.label}</p>
                      <p className="text-xs text-slate-500">{g.sublabel}</p>
                    </div>
                  </div>
                  <Badge variant="destructive">{g.students.length}</Badge>
                </button>
              ))}
              {lowAttendanceGroups.length === 0 && (
                <p className="py-4 text-center text-sm text-slate-500">
                  No students below this threshold — nice.
                </p>
              )}
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Roll</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Attendance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeGroup.students.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.roll}</TableCell>
                      <TableCell className="text-sm">{s.name}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="destructive">{Math.round(s.pct)}%</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
      </>
    </SectionShell>
  )
}
