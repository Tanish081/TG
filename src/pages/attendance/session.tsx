import { useMemo, useRef, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Upload, CalendarDays, Hash, FileText, ClipboardCheck } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import type { AttendanceStatus } from "@/types/database"
import { parseAttendanceFile, type ParsedLecture } from "@/lib/parse-attendance-file"
import { SectionShell } from "@/components/section-shell"
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
import { cn } from "@/lib/utils"
import { displayRoll } from "@/lib/roll-code"
import type { Database } from "@/types/database"

type CohortWithSubject = Database["public"]["Tables"]["cohorts"]["Row"] & {
  subject: { code: string; name: string } | null
}

const STATUS_CYCLE: AttendanceStatus[] = ["present", "absent", "late"]

const STATUS_CARD: Record<AttendanceStatus, string> = {
  present: "border-emerald-300 bg-emerald-50",
  absent: "border-red-300 bg-red-50",
  late: "border-amber-300 bg-amber-50",
}

const STATUS_TEXT: Record<AttendanceStatus, string> = {
  present: "text-emerald-700",
  absent: "text-red-700",
  late: "text-amber-700",
}

const STATUS_BAR: Record<AttendanceStatus, string> = {
  present: "bg-emerald-500",
  absent: "bg-red-500",
  late: "bg-amber-500",
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export default function AttendanceSessionPage() {
  const { cohortId } = useParams<{ cohortId: string }>()
  const { teacher } = useAuth()
  const navigate = useNavigate()

  const [date, setDate] = useState(todayISO())
  const [slot, setSlot] = useState("1")
  const [topic, setTopic] = useState("")
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>({})

  const [parsedLectures, setParsedLectures] = useState<ParsedLecture[] | null>(null)
  const [selectedLectureIdx, setSelectedLectureIdx] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: cohort } = useQuery({
    queryKey: ["cohort", cohortId],
    enabled: !!cohortId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cohorts")
        .select("*, subject:subjects(code, name)")
        .eq("id", cohortId!)
        .single()
      if (error) throw error
      return data as unknown as CohortWithSubject
    },
  })

  const { data: members, isLoading } = useQuery({
    queryKey: ["cohort-members", cohortId],
    enabled: !!cohortId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cohort_members")
        .select(
          "enrollment:student_enrollments(id, roll_code, external_roll_no, roll_seq, student:students(name, prn))",
        )
        .eq("cohort_id", cohortId!)
      if (error) throw error
      type Row = {
        enrollment: {
          id: string
          roll_code: string
          external_roll_no: string | null
          roll_seq: number
          student: { name: string; prn: string | null }
        }
      }
      return (data as unknown as Row[])
        .map((r) => r.enrollment)
        .sort((a, b) => a.roll_seq - b.roll_seq)
    },
  })

  const effectiveStatuses = useMemo(() => {
    const map: Record<string, AttendanceStatus> = {}
    for (const m of members ?? []) map[m.id] = statuses[m.id] ?? "present"
    return map
  }, [members, statuses])

  async function handleUploadFile(file: File) {
    const lectures = await parseAttendanceFile(file)
    if (lectures.length === 0) {
      toast.error("Couldn't find a roll number + lecture column in that file")
      return
    }
    setParsedLectures(lectures)
    setSelectedLectureIdx(0)
    applyLecture(lectures[0])
  }

  function applyLecture(lecture: ParsedLecture) {
    if (!members) return
    const byRollNo = new Map(lecture.statuses.map((s) => [s.rollNo.trim().toUpperCase(), s.status]))

    const next: Record<string, AttendanceStatus> = {}
    let matched = 0
    for (const m of members) {
      const key = (m.external_roll_no ?? m.roll_code).trim().toUpperCase()
      const status = byRollNo.get(key)
      if (status) {
        next[m.id] = status
        matched++
      }
    }
    setStatuses(next)
    if (lecture.date) setDate(lecture.date)
    setSlot(lecture.slot)

    const unmatched = members.length - matched
    toast.success(
      `Applied ${matched}/${members.length} from file` +
        (unmatched > 0 ? ` — ${unmatched} not found, still default to present` : ""),
    )
  }

  function cycleStatus(enrollmentId: string) {
    const current = effectiveStatuses[enrollmentId]
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length]
    setStatuses((s) => ({ ...s, [enrollmentId]: next }))
  }

  const submit = useMutation({
    mutationFn: async () => {
      if (!cohort || !members || !teacher) throw new Error("Not ready")
      const { data: session, error: sessionErr } = await supabase
        .from("attendance_sessions")
        .insert({
          teacher_id: teacher.id,
          cohort_id: cohort.id,
          subject_id: cohort.subject_id,
          date,
          slot,
          topic: topic || null,
        })
        .select()
        .single()
      if (sessionErr) throw sessionErr

      const records = members.map((m) => ({
        session_id: session.id,
        enrollment_id: m.id,
        status: effectiveStatuses[m.id],
      }))
      const { error: recordsErr } = await supabase.from("attendance_records").insert(records)
      if (recordsErr) throw recordsErr
    },
    onSuccess: () => {
      toast.success("Attendance submitted")
      navigate("/attendance")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0 }
    for (const m of members ?? []) c[effectiveStatuses[m.id]]++
    return c
  }, [members, effectiveStatuses])
  const total = members?.length ?? 0

  return (
    <SectionShell
      icon={ClipboardCheck}
      title={cohort?.label ?? "…"}
      subtitle={cohort?.subject ? `${cohort.subject.code} — ${cohort.subject.name}` : undefined}
      accent="teal"
      maxWidth="max-w-3xl"
    >
      <Card className="mb-5 border-slate-200/70 bg-white/70 p-4 shadow-sm backdrop-blur-sm">
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="date" className="flex items-center gap-1.5 text-xs text-slate-500">
              <CalendarDays className="size-3.5" /> Date
            </Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-white" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slot" className="flex items-center gap-1.5 text-xs text-slate-500">
              <Hash className="size-3.5" /> Slot
            </Label>
            <Input id="slot" value={slot} onChange={(e) => setSlot(e.target.value)} className="bg-white" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="topic" className="flex items-center gap-1.5 text-xs text-slate-500">
              <FileText className="size-3.5" /> Topic
            </Label>
            <Input
              id="topic"
              placeholder="optional"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="bg-white"
            />
          </div>
        </div>
      </Card>

      <Card className="mb-5 flex flex-wrap items-center gap-3 border-teal-200/70 bg-teal-50/50 p-4 shadow-sm backdrop-blur-sm">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-teal-300 bg-white"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="size-4" /> Upload attendance sheet
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleUploadFile(e.target.files[0])}
        />
        <p className="text-xs text-slate-500">
          Optional — fills the cards below by roll number. Nothing submits until you review and
          press Submit; every card can still be tapped by hand.
        </p>
        {parsedLectures && parsedLectures.length > 1 && (
          <Select
            value={String(selectedLectureIdx)}
            onValueChange={(v) => {
              const idx = Number(v)
              setSelectedLectureIdx(idx)
              applyLecture(parsedLectures[idx])
            }}
          >
            <SelectTrigger className="w-64 bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {parsedLectures.map((l, i) => (
                <SelectItem key={i} value={String(i)}>
                  {l.date ?? "?"} · slot {l.slot} ({l.statuses.length} students)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Card>

      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          {(["present", "absent", "late"] as AttendanceStatus[]).map((s) =>
            counts[s] > 0 ? (
              <div
                key={s}
                className={cn("h-full transition-all", STATUS_BAR[s])}
                style={{ width: `${(counts[s] / Math.max(total, 1)) * 100}%` }}
              />
            ) : null,
          )}
        </div>
        <p className="shrink-0 text-xs text-slate-500">
          {counts.present}/{total} present · tap a card to cycle
        </p>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading roster…</p>}

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {members?.map((m) => {
          const status = effectiveStatuses[m.id]
          return (
            <Card
              key={m.id}
              role="button"
              onClick={() => cycleStatus(m.id)}
              className={cn(
                "cursor-pointer select-none gap-0.5 border py-3 transition-colors",
                STATUS_CARD[status],
              )}
            >
              <div className="px-3">
                <p className="font-mono text-sm font-semibold text-slate-900">{displayRoll(m)}</p>
                <p className="truncate text-sm text-slate-700">{m.student.name}</p>
                {m.student.prn && <p className="text-xs text-slate-400">{m.student.prn}</p>}
                <p className={cn("mt-1 text-xs font-medium uppercase", STATUS_TEXT[status])}>{status}</p>
              </div>
            </Card>
          )
        })}
      </div>

      <div className="sticky bottom-4 flex justify-end">
        <Button
          onClick={() => submit.mutate()}
          disabled={!members?.length || submit.isPending}
          size="lg"
          className="bg-teal-600 shadow-lg shadow-teal-600/25 hover:bg-teal-700"
        >
          {submit.isPending ? "Submitting…" : `Submit attendance — ${total} students`}
        </Button>
      </div>
    </SectionShell>
  )
}
