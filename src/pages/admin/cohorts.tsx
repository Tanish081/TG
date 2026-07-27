import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { LayoutDashboard } from "lucide-react"
import { supabase } from "@/lib/supabase"
import type { Database } from "@/types/database"
import { SectionShell } from "@/components/section-shell"

type CohortWithDetails = Database["public"]["Tables"]["cohorts"]["Row"] & {
  subject: { code: string; name: string } | null
  cohort_members: { count: number }[]
  teaching_assignments: { id: string; teacher_id: string; teacher: { name: string } | null } | null
}
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export default function CohortsPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<"core" | "elective">("core")
  const [subjectId, setSubjectId] = useState("")
  const [academicYear, setAcademicYear] = useState("2025-26")
  const [label, setLabel] = useState("")
  const [divisionId, setDivisionId] = useState("")

  const [assignOpen, setAssignOpen] = useState(false)
  const [assignCohortId, setAssignCohortId] = useState<string | null>(null)
  const [assignTeacherId, setAssignTeacherId] = useState("")

  const [syncCohort, setSyncCohort] = useState<CohortWithDetails | null>(null)
  const [syncDivisionId, setSyncDivisionId] = useState("")

  const { data: subjects } = useQuery({
    queryKey: ["subjects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subjects").select("*").order("code")
      if (error) throw error
      return data
    },
  })

  const { data: divisions } = useQuery({
    queryKey: ["divisions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("divisions").select("*").order("division")
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

  const selectedDivision = divisions?.find((d) => d.id === divisionId)
  // A core cohort belongs to one division, so its subject must match that
  // division's year — electives aren't pinned to one division at creation
  // time, so their subject list stays unfiltered.
  const availableSubjects =
    type === "core" && selectedDivision
      ? subjects?.filter((s) => s.year_level === selectedDivision.year_level)
      : subjects

  const { data: cohorts, isLoading } = useQuery({
    queryKey: ["cohorts-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cohorts")
        .select("*, subject:subjects(code, name), cohort_members(count), teaching_assignments(id, teacher_id, teacher:teachers(name))")
        .order("academic_year", { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as CohortWithDetails[]
    },
  })

  const create = useMutation({
    mutationFn: async () => {
      const division = type === "core" ? divisions?.find((d) => d.id === divisionId) : undefined

      const { data: cohort, error } = await supabase
        .from("cohorts")
        .insert({
          subject_id: subjectId,
          academic_year: academicYear,
          type,
          label,
          year_level: division?.year_level ?? null,
          branch_code: division?.branch_code ?? null,
          division: division?.division ?? null,
        })
        .select()
        .single()
      if (error) throw error

      if (division) {
        const { data: enrollments, error: enrollErr } = await supabase
          .from("student_enrollments")
          .select("id")
          .eq("academic_year", division.academic_year)
          .eq("year_level", division.year_level)
          .eq("branch_code", division.branch_code)
          .eq("division", division.division)
        if (enrollErr) throw enrollErr
        if (enrollments && enrollments.length > 0) {
          const { error: memberErr } = await supabase
            .from("cohort_members")
            .insert(enrollments.map((e) => ({ cohort_id: cohort.id, enrollment_id: e.id })))
          if (memberErr) throw memberErr
        }
      }
    },
    onSuccess: () => {
      toast.success("Cohort created")
      setOpen(false)
      setLabel("")
      queryClient.invalidateQueries({ queryKey: ["cohorts-admin"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const assign = useMutation({
    mutationFn: async () => {
      if (!assignCohortId) return
      // One teacher per cohort — replaces whoever was assigned before.
      const { error } = await supabase.from("teaching_assignments").upsert(
        {
          teacher_id: assignTeacherId,
          cohort_id: assignCohortId,
          academic_year: academicYear,
        },
        { onConflict: "cohort_id" },
      )
      if (error) throw error
    },
    onSuccess: () => {
      toast.success("Teacher assigned")
      setAssignOpen(false)
      queryClient.invalidateQueries({ queryKey: ["cohorts-admin"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const sync = useMutation({
    mutationFn: async () => {
      if (!syncCohort) return
      const division = divisions?.find((d) => d.id === syncDivisionId)
      if (!division) throw new Error("Pick a division")

      const { error: updateErr } = await supabase
        .from("cohorts")
        .update({
          year_level: division.year_level,
          branch_code: division.branch_code,
          division: division.division,
        })
        .eq("id", syncCohort.id)
      if (updateErr) throw updateErr

      const { data: enrollments, error: enrollErr } = await supabase
        .from("student_enrollments")
        .select("id")
        .eq("academic_year", division.academic_year)
        .eq("year_level", division.year_level)
        .eq("branch_code", division.branch_code)
        .eq("division", division.division)
      if (enrollErr) throw enrollErr

      if (enrollments && enrollments.length > 0) {
        const { error: memberErr } = await supabase
          .from("cohort_members")
          .upsert(
            enrollments.map((e) => ({ cohort_id: syncCohort.id, enrollment_id: e.id })),
            { onConflict: "cohort_id,enrollment_id", ignoreDuplicates: true },
          )
        if (memberErr) throw memberErr
      }
      return enrollments?.length ?? 0
    },
    onSuccess: (count) => {
      toast.success(`Synced — ${count ?? 0} students in cohort now`)
      setSyncCohort(null)
      setSyncDivisionId("")
      queryClient.invalidateQueries({ queryKey: ["cohorts-admin"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <SectionShell
      icon={LayoutDashboard}
      title="Cohorts"
      subtitle="Core cohorts auto-populate from a division. Electives start empty."
      accent="blue"
      action={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>New cohort</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a cohort</DialogTitle>
            </DialogHeader>
            <Tabs
              value={type}
              onValueChange={(v) => {
                setType(v as "core" | "elective")
                setSubjectId("")
              }}
            >
              <TabsList className="mb-2 w-full">
                <TabsTrigger value="core" className="flex-1">
                  Core
                </TabsTrigger>
                <TabsTrigger value="elective" className="flex-1">
                  Elective
                </TabsTrigger>
              </TabsList>
              <TabsContent value="core" className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Division (whole division becomes the roster)</Label>
                  <Select
                    value={divisionId}
                    onValueChange={(v) => {
                      setDivisionId(v)
                      setSubjectId("")
                    }}
                  >
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
                </div>
              </TabsContent>
              <TabsContent value="elective">
                <p className="text-sm text-muted-foreground">
                  Starts with no members. Each division's class teacher adds their own students from
                  "My division".
                </p>
              </TabsContent>
            </Tabs>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label>Subject</Label>
                <Select value={subjectId} onValueChange={setSubjectId}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        type === "core" && !selectedDivision
                          ? "Pick a division first"
                          : "Pick a subject"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSubjects?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.code} — {s.name}
                      </SelectItem>
                    ))}
                    {availableSubjects?.length === 0 && (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">
                        No {selectedDivision?.year_level} subjects yet
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Academic year</Label>
                  <Input value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Label</Label>
                  <Input
                    placeholder="e.g. SE-A Data Structures"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => create.mutate()}
                disabled={!subjectId || !label || (type === "core" && !divisionId) || create.isPending}
              >
                {create.isPending ? "Saving…" : "Save"}
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
            <TableHead>Label</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Teacher</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                Loading…
              </TableCell>
            </TableRow>
          )}
          {cohorts?.map((c) => (
            <TableRow key={c.id}>
              <TableCell>{c.label}</TableCell>
              <TableCell>{c.subject?.code}</TableCell>
              <TableCell>
                <Badge variant={c.type === "core" ? "secondary" : "outline"}>{c.type}</Badge>
              </TableCell>
              <TableCell>{c.cohort_members?.[0]?.count ?? 0}</TableCell>
              <TableCell>{c.teaching_assignments?.teacher?.name ?? "—"}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  {c.type === "core" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSyncCohort(c)
                        setSyncDivisionId(
                          divisions?.find(
                            (d) =>
                              d.year_level === c.year_level &&
                              d.branch_code === c.branch_code &&
                              d.division === c.division,
                          )?.id ?? "",
                        )
                      }}
                    >
                      Sync members
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAssignCohortId(c.id)
                      setAssignTeacherId(c.teaching_assignments?.teacher_id ?? "")
                      setAssignOpen(true)
                    }}
                  >
                    {c.teaching_assignments ? "Reassign teacher" : "Assign teacher"}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </Card>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign subject teacher</DialogTitle>
            <DialogDescription>
              One teacher per cohort — this replaces whoever is currently assigned.
            </DialogDescription>
          </DialogHeader>
          <Select value={assignTeacherId} onValueChange={setAssignTeacherId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a teacher" />
            </SelectTrigger>
            <SelectContent>
              {teachers?.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button onClick={() => assign.mutate()} disabled={!assignTeacherId || assign.isPending}>
              {assign.isPending ? "Saving…" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!syncCohort} onOpenChange={(open) => !open && setSyncCohort(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sync members — {syncCohort?.label}</DialogTitle>
            <DialogDescription>
              Confirms which division this core cohort belongs to, then adds any students in that
              division who aren't cohort members yet (covers anyone enrolled after this cohort was
              created).
            </DialogDescription>
          </DialogHeader>
          <Select value={syncDivisionId} onValueChange={setSyncDivisionId}>
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
          <DialogFooter>
            <Button onClick={() => sync.mutate()} disabled={!syncDivisionId || sync.isPending}>
              {sync.isPending ? "Syncing…" : "Sync now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionShell>
  )
}
