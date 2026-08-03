import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CalendarClock, FileDown, Plus, Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { generateMeetingMinutesPdf } from "@/lib/meeting-minutes"
import { displayRoll } from "@/lib/roll-code"
import { cn } from "@/lib/utils"
import { SectionShell } from "@/components/section-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { CommunicationMode, Database } from "@/types/database"

type EnrollmentWithStudent = Database["public"]["Tables"]["student_enrollments"]["Row"] & {
  student: { name: string; prn: string | null } | null
}

type Meeting = Database["public"]["Tables"]["tg_meetings"]["Row"]
type Counseling = Database["public"]["Tables"]["tg_counseling_sessions"]["Row"] & {
  enrollment: { roll_code: string; external_roll_no: string | null; roll_seq: number; student: { name: string } | null } | null
}
type Communication = Database["public"]["Tables"]["tg_communications"]["Row"] & {
  enrollment: { roll_code: string; external_roll_no: string | null; roll_seq: number; student: { name: string } | null } | null
}

const MODE_LABELS: Record<CommunicationMode, string> = {
  call: "Call",
  message: "Message",
  email: "Email",
  in_person: "In person",
  other: "Other",
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export default function TgRecordsPage() {
  const { teacher } = useAuth()
  const queryClient = useQueryClient()

  const { data: batches } = useQuery({
    queryKey: ["my-batches", teacher?.id],
    enabled: !!teacher,
    queryFn: async () => {
      const { data, error } = await supabase.from("batches").select("*").eq("tg_teacher_id", teacher!.id)
      if (error) throw error
      return data
    },
  })

  const { data: enrollments } = useQuery({
    queryKey: ["my-batch-enrollments", batches?.map((b) => b.id)],
    enabled: !!batches && batches.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        batches!.map((b) =>
          supabase
            .from("student_enrollments")
            .select("*, student:students(name, prn)")
            .eq("academic_year", b.academic_year)
            .eq("year_level", b.year_level)
            .eq("branch_code", b.branch_code)
            .eq("division", b.division)
            .gte("roll_seq", b.roll_start)
            .lte("roll_seq", b.roll_end),
        ),
      )
      for (const r of results) if (r.error) throw r.error
      return results.flatMap((r) => (r.data ?? []) as unknown as EnrollmentWithStudent[])
    },
  })

  const enrollmentsByBatch = useMemo(() => {
    const map = new Map<string, EnrollmentWithStudent[]>()
    if (!batches || !enrollments) return map
    for (const b of batches) {
      map.set(
        b.id,
        enrollments.filter(
          (e) =>
            e.academic_year === b.academic_year &&
            e.year_level === b.year_level &&
            e.branch_code === b.branch_code &&
            e.division === b.division &&
            e.roll_seq >= b.roll_start &&
            e.roll_seq <= b.roll_end,
        ),
      )
    }
    return map
  }, [batches, enrollments])

  const batchLabel = (b?: Database["public"]["Tables"]["batches"]["Row"]) =>
    b ? `${b.year_level}${b.division} ${b.roll_start}-${b.roll_end}` : "—"

  // ---------------------------------------------------------------- meetings
  const { data: meetings, isLoading: meetingsLoading } = useQuery({
    queryKey: ["tg-meetings", teacher?.id],
    enabled: !!teacher,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tg_meetings")
        .select("*")
        .eq("tg_teacher_id", teacher!.id)
        .order("meeting_date", { ascending: false })
      if (error) throw error
      return data as Meeting[]
    },
  })

  const [meetingOpen, setMeetingOpen] = useState(false)
  const [meetingBatchId, setMeetingBatchId] = useState("")
  const [meetingDate, setMeetingDate] = useState(todayISO())
  const [meetingTime, setMeetingTime] = useState("15:00")
  const [agenda, setAgenda] = useState("")
  const [attendanceMap, setAttendanceMap] = useState<Record<string, boolean>>({})

  const meetingRoster = meetingBatchId ? (enrollmentsByBatch.get(meetingBatchId) ?? []) : []

  function openMeetingDialog() {
    const defaultBatchId = batches?.[0]?.id ?? ""
    setMeetingBatchId(defaultBatchId)
    setMeetingDate(todayISO())
    setMeetingTime("15:00")
    setAgenda("")
    const roster = enrollmentsByBatch.get(defaultBatchId) ?? []
    setAttendanceMap(Object.fromEntries(roster.map((e) => [e.id, true])))
    setMeetingOpen(true)
  }

  function handleMeetingBatchChange(id: string) {
    setMeetingBatchId(id)
    const roster = enrollmentsByBatch.get(id) ?? []
    setAttendanceMap(Object.fromEntries(roster.map((e) => [e.id, true])))
  }

  const createMeeting = useMutation({
    mutationFn: async () => {
      if (!teacher || !meetingBatchId) throw new Error("Pick a batch")
      const { data: meeting, error } = await supabase
        .from("tg_meetings")
        .insert({
          tg_teacher_id: teacher.id,
          batch_id: meetingBatchId,
          meeting_date: meetingDate,
          meeting_time: meetingTime,
          agenda,
        })
        .select()
        .single()
      if (error) throw error

      const records = meetingRoster.map((e) => ({
        meeting_id: meeting.id,
        enrollment_id: e.id,
        present: attendanceMap[e.id] ?? true,
      }))
      if (records.length > 0) {
        const { error: attErr } = await supabase.from("tg_meeting_attendance").insert(records)
        if (attErr) throw attErr
      }
    },
    onSuccess: () => {
      toast.success("Meeting saved")
      setMeetingOpen(false)
      queryClient.invalidateQueries({ queryKey: ["tg-meetings"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMeeting = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tg_meetings").delete().eq("id", id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tg-meetings"] }),
    onError: (err: Error) => toast.error(err.message),
  })

  async function handleDownloadMinutes(meeting: Meeting) {
    const { data, error } = await supabase
      .from("tg_meeting_attendance")
      .select("present, enrollment:student_enrollments(roll_code, external_roll_no, roll_seq, student:students(name))")
      .eq("meeting_id", meeting.id)
    if (error) {
      toast.error(error.message)
      return
    }
    type Row = {
      present: boolean
      enrollment: { roll_code: string; external_roll_no: string | null; roll_seq: number; student: { name: string } | null } | null
    }
    const attendees = ((data ?? []) as unknown as Row[])
      .filter((r) => r.enrollment)
      .map((r) => ({
        roll: displayRoll(r.enrollment!),
        name: r.enrollment!.student?.name ?? "—",
        present: r.present,
      }))
    const batch = batches?.find((b) => b.id === meeting.batch_id)
    await generateMeetingMinutesPdf({
      batchLabel: batchLabel(batch),
      tgName: teacher?.name ?? "—",
      meetingDate: meeting.meeting_date,
      meetingTime: meeting.meeting_time,
      agenda: meeting.agenda,
      attendees,
    })
  }

  // -------------------------------------------------------------- counseling
  const { data: counseling, isLoading: counselingLoading } = useQuery({
    queryKey: ["tg-counseling", teacher?.id],
    enabled: !!teacher,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tg_counseling_sessions")
        .select("*, enrollment:student_enrollments(roll_code, external_roll_no, roll_seq, student:students(name))")
        .eq("tg_teacher_id", teacher!.id)
        .order("session_date", { ascending: false })
      if (error) throw error
      return data as unknown as Counseling[]
    },
  })

  const [counselingOpen, setCounselingOpen] = useState(false)
  const [counselingEnrollmentId, setCounselingEnrollmentId] = useState("")
  const [counselingDate, setCounselingDate] = useState(todayISO())
  const [reason, setReason] = useState("")
  const [remarks, setRemarks] = useState("")

  const createCounseling = useMutation({
    mutationFn: async () => {
      if (!teacher || !counselingEnrollmentId) throw new Error("Pick a student")
      const { error } = await supabase.from("tg_counseling_sessions").insert({
        tg_teacher_id: teacher.id,
        enrollment_id: counselingEnrollmentId,
        session_date: counselingDate,
        reason,
        remarks: remarks || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success("Counseling session saved")
      setCounselingOpen(false)
      setCounselingEnrollmentId("")
      setReason("")
      setRemarks("")
      queryClient.invalidateQueries({ queryKey: ["tg-counseling"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteCounseling = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tg_counseling_sessions").delete().eq("id", id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tg-counseling"] }),
    onError: (err: Error) => toast.error(err.message),
  })

  // ----------------------------------------------------------- communication
  const { data: communications, isLoading: commLoading } = useQuery({
    queryKey: ["tg-communications", teacher?.id],
    enabled: !!teacher,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tg_communications")
        .select("*, enrollment:student_enrollments(roll_code, external_roll_no, roll_seq, student:students(name))")
        .eq("tg_teacher_id", teacher!.id)
        .order("comm_date", { ascending: false })
      if (error) throw error
      return data as unknown as Communication[]
    },
  })

  const [commOpen, setCommOpen] = useState(false)
  const [commEnrollmentId, setCommEnrollmentId] = useState("")
  const [commDate, setCommDate] = useState(todayISO())
  const [mode, setMode] = useState<CommunicationMode>("call")
  const [purpose, setPurpose] = useState("")
  const [result, setResult] = useState("")

  const createComm = useMutation({
    mutationFn: async () => {
      if (!teacher || !commEnrollmentId) throw new Error("Pick a student")
      const { error } = await supabase.from("tg_communications").insert({
        tg_teacher_id: teacher.id,
        enrollment_id: commEnrollmentId,
        comm_date: commDate,
        mode,
        purpose,
        result: result || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success("Communication logged")
      setCommOpen(false)
      setCommEnrollmentId("")
      setPurpose("")
      setResult("")
      queryClient.invalidateQueries({ queryKey: ["tg-communications"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteComm = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tg_communications").delete().eq("id", id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tg-communications"] }),
    onError: (err: Error) => toast.error(err.message),
  })

  if (!batches || batches.length === 0) {
    return (
      <SectionShell icon={CalendarClock} title="TG Records" accent="teal">
        <p className="text-sm text-slate-500">No batch assigned yet — ask your Dept Coordinator.</p>
      </SectionShell>
    )
  }

  return (
    <SectionShell
      icon={CalendarClock}
      title="TG Records"
      subtitle="Meetings, counseling, and communication — kept for future reference."
      accent="teal"
    >
      <Tabs defaultValue="meetings">
        <TabsList className="mb-4">
          <TabsTrigger value="meetings">Meetings</TabsTrigger>
          <TabsTrigger value="counseling">Counseling</TabsTrigger>
          <TabsTrigger value="communication">Communication</TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------- Meetings */}
        <TabsContent value="meetings">
          <div className="mb-3 flex justify-end">
            <Dialog open={meetingOpen} onOpenChange={setMeetingOpen}>
              <DialogTrigger asChild>
                <Button onClick={openMeetingDialog}>
                  <Plus className="size-4" /> New meeting
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Record a batch meeting</DialogTitle>
                  <DialogDescription>Date, time, agenda, and who attended.</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                  {batches.length > 1 && (
                    <div className="flex flex-col gap-2">
                      <Label>Batch</Label>
                      <Select value={meetingBatchId} onValueChange={handleMeetingBatchChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {batches.map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              {batchLabel(b)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="m-date">Date</Label>
                      <Input id="m-date" type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="m-time">Time</Label>
                      <Input id="m-time" type="time" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="m-agenda">Agenda</Label>
                    <Textarea id="m-agenda" value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={3} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <Label>
                        Attendance ({Object.values(attendanceMap).filter(Boolean).length}/{meetingRoster.length} present)
                      </Label>
                      <p className="text-xs text-muted-foreground">Tap a student to toggle</p>
                    </div>
                    <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto rounded border bg-slate-50/50 p-2 sm:grid-cols-3">
                      {meetingRoster
                        .slice()
                        .sort((a, b) => a.roll_seq - b.roll_seq)
                        .map((e) => {
                          const present = attendanceMap[e.id] ?? true
                          return (
                            <button
                              key={e.id}
                              type="button"
                              onClick={() => setAttendanceMap((m) => ({ ...m, [e.id]: !present }))}
                              className={cn(
                                "group relative flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs shadow-sm transition-all duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:shadow-sm",
                                present
                                  ? "border-emerald-200 bg-white ring-1 ring-emerald-100"
                                  : "border-red-200 bg-red-50/70 ring-1 ring-red-100",
                              )}
                            >
                              <span
                                className={cn(
                                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white transition-colors duration-150",
                                  present ? "bg-emerald-500" : "bg-red-500",
                                )}
                              >
                                {present ? "✓" : "✕"}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="font-mono text-slate-900">{displayRoll(e)}</div>
                                <div className="truncate text-slate-600">{e.student?.name}</div>
                              </div>
                            </button>
                          )
                        })}
                      {meetingRoster.length === 0 && (
                        <p className="col-span-full text-center text-sm text-muted-foreground">No students in this batch</p>
                      )}
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => createMeeting.mutate()}
                    disabled={!meetingBatchId || !agenda || createMeeting.isPending}
                  >
                    {createMeeting.isPending ? "Saving…" : "Save meeting"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Agenda</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meetingsLoading && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                )}
                {!meetingsLoading && meetings?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No meetings recorded yet
                    </TableCell>
                  </TableRow>
                )}
                {meetings?.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{new Date(m.meeting_date).toLocaleDateString()}</TableCell>
                    <TableCell>{m.meeting_time.slice(0, 5)}</TableCell>
                    <TableCell>{batchLabel(batches.find((b) => b.id === m.batch_id))}</TableCell>
                    <TableCell className="max-w-xs truncate">{m.agenda}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleDownloadMinutes(m)}>
                          <FileDown className="size-3.5" /> Minutes
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteMeeting.mutate(m.id)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* -------------------------------------------------------- Counseling */}
        <TabsContent value="counseling">
          <div className="mb-3 flex justify-end">
            <Dialog open={counselingOpen} onOpenChange={setCounselingOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="size-4" /> New session
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Record a counseling session</DialogTitle>
                  <DialogDescription>For a student with a specific concern.</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Label>Student</Label>
                    <Select value={counselingEnrollmentId} onValueChange={setCounselingEnrollmentId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Pick a student" />
                      </SelectTrigger>
                      <SelectContent>
                        {enrollments
                          ?.slice()
                          .sort((a, b) => a.roll_seq - b.roll_seq)
                          .map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {displayRoll(e)} — {e.student?.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="c-date">Date</Label>
                    <Input id="c-date" type="date" value={counselingDate} onChange={(e) => setCounselingDate(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="c-reason">Reason</Label>
                    <Input
                      id="c-reason"
                      placeholder="e.g. Personal difficulties affecting attendance"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="c-remarks">Remarks</Label>
                    <Textarea id="c-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => createCounseling.mutate()}
                    disabled={!counselingEnrollmentId || !reason || createCounseling.isPending}
                  >
                    {createCounseling.isPending ? "Saving…" : "Save session"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {counselingLoading && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                )}
                {!counselingLoading && counseling?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No counseling sessions recorded yet
                    </TableCell>
                  </TableRow>
                )}
                {counseling?.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{new Date(c.session_date).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {c.enrollment ? `${displayRoll(c.enrollment)} — ${c.enrollment.student?.name}` : "—"}
                    </TableCell>
                    <TableCell className="max-w-[16rem] truncate">{c.reason}</TableCell>
                    <TableCell className="max-w-[16rem] truncate text-muted-foreground">{c.remarks ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => deleteCounseling.mutate(c.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------- Communication */}
        <TabsContent value="communication">
          <div className="mb-3 flex justify-end">
            <Dialog open={commOpen} onOpenChange={setCommOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="size-4" /> New entry
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Log a communication</DialogTitle>
                  <DialogDescription>e.g. calling a student about low attendance.</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Label>Student</Label>
                    <Select value={commEnrollmentId} onValueChange={setCommEnrollmentId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Pick a student" />
                      </SelectTrigger>
                      <SelectContent>
                        {enrollments
                          ?.slice()
                          .sort((a, b) => a.roll_seq - b.roll_seq)
                          .map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {displayRoll(e)} — {e.student?.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="comm-date">Date</Label>
                      <Input id="comm-date" type="date" value={commDate} onChange={(e) => setCommDate(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>Mode</Label>
                      <Select value={mode} onValueChange={(v) => setMode(v as CommunicationMode)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(MODE_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="comm-purpose">Purpose</Label>
                    <Input
                      id="comm-purpose"
                      placeholder="e.g. Low attendance follow-up"
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="comm-result">Result</Label>
                    <Textarea id="comm-result" value={result} onChange={(e) => setResult(e.target.value)} rows={3} />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => createComm.mutate()}
                    disabled={!commEnrollmentId || !purpose || createComm.isPending}
                  >
                    {createComm.isPending ? "Saving…" : "Save entry"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                )}
                {!commLoading && communications?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No communication logged yet
                    </TableCell>
                  </TableRow>
                )}
                {communications?.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{new Date(c.comm_date).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {c.enrollment ? `${displayRoll(c.enrollment)} — ${c.enrollment.student?.name}` : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{MODE_LABELS[c.mode]}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate">{c.purpose}</TableCell>
                    <TableCell className="max-w-[14rem] truncate text-muted-foreground">{c.result ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => deleteComm.mutate(c.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </SectionShell>
  )
}
