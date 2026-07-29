import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeft, FolderOpen, LayoutDashboard, Shuffle } from "lucide-react"
import { supabase } from "@/lib/supabase"
import type { Database, YearLevel } from "@/types/database"
import { SectionShell } from "@/components/section-shell"

const YEAR_LEVELS: YearLevel[] = ["FE", "SE", "TE", "BE"]

type CohortWithDetails = Database["public"]["Tables"]["cohorts"]["Row"] & {
  subject: { code: string; name: string; year_level: YearLevel } | null
  cohort_members: { count: number }[]
  teaching_assignments: { id: string; teacher_id: string; teacher: { name: string } | null } | null
}

const ELECTIVE_FOLDER = "__elective__"
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

  const [assignOpen, setAssignOpen] = useState(false)
  const [assignCohortId, setAssignCohortId] = useState<string | null>(null)
  const [assignTeacherId, setAssignTeacherId] = useState("")

  const [syncCohort, setSyncCohort] = useState<CohortWithDetails | null>(null)
  const [syncDivisionId, setSyncDivisionId] = useState("")

  const [editTarget, setEditTarget] = useState<CohortWithDetails | null>(null)
  const [editLabel, setEditLabel] = useState("")
  const [editSubjectId, setEditSubjectId] = useState("")
  const [editAcademicYear, setEditAcademicYear] = useState("")

  const [deleteTarget, setDeleteTarget] = useState<CohortWithDetails | null>(null)

  const [openYear, setOpenYear] = useState<YearLevel | null>(null)
  const [openDivision, setOpenDivision] = useState<string | null>(null)

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

  const { data: cohorts, isLoading } = useQuery({
    queryKey: ["cohorts-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cohorts")
        .select("*, subject:subjects(code, name, year_level), cohort_members(count), teaching_assignments(id, teacher_id, teacher:teachers(name))")
        .order("academic_year", { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as CohortWithDetails[]
    },
  })

  const coreCohorts = useMemo(() => (cohorts ?? []).filter((c) => c.type === "core"), [cohorts])
  const electiveCohorts = useMemo(() => (cohorts ?? []).filter((c) => c.type === "elective"), [cohorts])

  // Core cohorts are created one-per-division automatically — a subject
  // applies to every division that shares its year level, not just one.
  const selectedSubjectForCreate = subjects?.find((s) => s.id === subjectId)
  const coreCreatePreview = useMemo(() => {
    if (type !== "core" || !selectedSubjectForCreate) return []
    return (divisions ?? [])
      .filter((d) => d.year_level === selectedSubjectForCreate.year_level)
      .map((d) => ({
        division: d,
        alreadyExists: coreCohorts.some(
          (c) =>
            c.subject_id === subjectId &&
            c.year_level === d.year_level &&
            c.branch_code === d.branch_code &&
            c.division === d.division,
        ),
      }))
  }, [type, selectedSubjectForCreate, divisions, coreCohorts, subjectId])
  const coreCreatePending = coreCreatePreview.filter((p) => !p.alreadyExists)

  const yearFolders = useMemo(
    () =>
      YEAR_LEVELS.map((y) => ({
        year: y,
        cohorts: coreCohorts.filter((c) => c.year_level === y),
        electives: electiveCohorts.filter((c) => c.subject?.year_level === y),
      })),
    [coreCohorts, electiveCohorts],
  )

  const openYearFolder = yearFolders.find((f) => f.year === openYear)

  const divisionFolders = useMemo(() => {
    if (!openYear) return []
    const inYear = coreCohorts.filter((c) => c.year_level === openYear)
    const letters = [...new Set(inYear.map((c) => c.division).filter((d): d is string => !!d))].sort()
    return letters.map((d) => ({
      division: d,
      cohorts: inYear.filter((c) => c.division === d).sort((a, b) => a.label.localeCompare(b.label)),
    }))
  }, [coreCohorts, openYear])

  const activeCohorts =
    openDivision === ELECTIVE_FOLDER
      ? (openYearFolder?.electives ?? [])
      : openDivision
        ? (divisionFolders.find((f) => f.division === openDivision)?.cohorts ?? [])
        : []

  // A core cohort's subject must stay within its own division's year level;
  // electives aren't pinned to a division, so their subject list is unfiltered.
  const editAvailableSubjects =
    editTarget?.type === "core" && editTarget.year_level
      ? subjects?.filter((s) => s.year_level === editTarget.year_level)
      : subjects

  const create = useMutation({
    mutationFn: async () => {
      if (type === "elective") {
        const { error } = await supabase.from("cohorts").insert({
          subject_id: subjectId,
          academic_year: academicYear,
          type: "elective",
          label,
          year_level: null,
          branch_code: null,
          division: null,
        })
        if (error) throw error
        return 1
      }

      // Core: one cohort per division sharing this subject's year level,
      // each auto-populated with that division's full roster. Divisions
      // that already have a cohort for this subject are skipped.
      const subject = selectedSubjectForCreate
      if (!subject) throw new Error("Pick a subject")
      const targets = coreCreatePending.map((p) => p.division)
      if (targets.length === 0) throw new Error("Nothing to create — every matching division already has this cohort")

      const { data: newCohorts, error } = await supabase
        .from("cohorts")
        .insert(
          targets.map((d) => ({
            subject_id: subjectId,
            academic_year: academicYear,
            type: "core" as const,
            label: `${d.year_level}-${d.division} ${subject.code}`,
            year_level: d.year_level,
            branch_code: d.branch_code,
            division: d.division,
          })),
        )
        .select()
      if (error) throw error

      for (const cohort of newCohorts ?? []) {
        const division = targets.find(
          (d) =>
            d.year_level === cohort.year_level &&
            d.branch_code === cohort.branch_code &&
            d.division === cohort.division,
        )
        if (!division) continue
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
      return targets.length
    },
    onSuccess: (count) => {
      toast.success(
        type === "core" ? `Created ${count} cohort${count === 1 ? "" : "s"}` : "Cohort created",
      )
      setOpen(false)
      setLabel("")
      setSubjectId("")
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

  const edit = useMutation({
    mutationFn: async () => {
      if (!editTarget) return
      const { error } = await supabase
        .from("cohorts")
        .update({
          label: editLabel,
          subject_id: editSubjectId,
          academic_year: editAcademicYear,
        })
        .eq("id", editTarget.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success("Cohort updated")
      setEditTarget(null)
      queryClient.invalidateQueries({ queryKey: ["cohorts-admin"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cohorts").delete().eq("id", id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success("Cohort deleted")
      setDeleteTarget(null)
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
              <TabsContent value="core">
                <p className="text-sm text-muted-foreground">
                  Pick a subject below — a cohort is created automatically for every division that
                  shares its year level, each pre-filled with that division's full roster. You can
                  edit any of them individually afterward.
                </p>
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
                    <SelectValue placeholder="Pick a subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.code} — {s.name} ({s.year_level})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {type === "core" && selectedSubjectForCreate && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <p className="text-xs font-medium text-slate-600">
                    {coreCreatePending.length} of {coreCreatePreview.length} {selectedSubjectForCreate.year_level}{" "}
                    division{coreCreatePreview.length === 1 ? "" : "s"} will get a cohort
                  </p>
                  {coreCreatePreview.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No {selectedSubjectForCreate.year_level} divisions exist yet.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {coreCreatePreview.map((p) => (
                        <Badge
                          key={p.division.id}
                          variant={p.alreadyExists ? "secondary" : "outline"}
                          className={p.alreadyExists ? "opacity-60" : "border-blue-300 text-blue-700"}
                        >
                          {p.division.division}
                          {p.alreadyExists ? " (exists)" : ""}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Academic year</Label>
                  <Input value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} />
                </div>
                {type === "elective" && (
                  <div className="flex flex-col gap-2">
                    <Label>Label</Label>
                    <Input
                      placeholder="e.g. Competitive Programming"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                    />
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => create.mutate()}
                disabled={
                  !subjectId ||
                  (type === "elective" && !label) ||
                  (type === "core" && coreCreatePending.length === 0) ||
                  create.isPending
                }
              >
                {create.isPending
                  ? "Saving…"
                  : type === "core"
                    ? `Create ${coreCreatePending.length || ""} cohort${coreCreatePending.length === 1 ? "" : "s"}`
                    : "Save"}
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
                {f.cohorts.length} core · {f.electives.length} elective
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
          {divisionFolders.length === 0 && (openYearFolder?.electives.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">No cohorts in {openYear} yet.</p>
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
                    {f.cohorts.length} cohort{f.cohorts.length === 1 ? "" : "s"}
                  </p>
                </Card>
              ))}
              {(openYearFolder?.electives.length ?? 0) > 0 && (
                <Card
                  role="button"
                  onClick={() => setOpenDivision(ELECTIVE_FOLDER)}
                  className="cursor-pointer border-slate-200/70 bg-white/70 p-4 shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md"
                >
                  <div className="mb-2 flex size-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                    <Shuffle className="size-4.5" />
                  </div>
                  <p className="text-base font-semibold text-slate-900">{openYear} Elective</p>
                  <p className="text-sm text-slate-500">
                    {openYearFolder?.electives.length} cohort{openYearFolder?.electives.length === 1 ? "" : "s"}
                  </p>
                </Card>
              )}
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
            <ArrowLeft className="size-3.5" /> {openYear} folders
          </button>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">
              {openDivision === ELECTIVE_FOLDER ? `${openYear} Elective` : `${openYear} ${openDivision}`}
            </h2>
            <Badge variant="secondary">{activeCohorts.length}</Badge>
          </div>
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
                {activeCohorts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No cohorts here yet
                    </TableCell>
                  </TableRow>
                )}
                {activeCohorts.map((c) => (
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
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditTarget(c)
                            setEditLabel(c.label)
                            setEditSubjectId(c.subject_id)
                            setEditAcademicYear(c.academic_year)
                          }}
                        >
                          Edit
                        </Button>
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
                        <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(c)}>
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

      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit cohort</DialogTitle>
            <DialogDescription>
              {editTarget?.type === "core"
                ? "To move this cohort to a different division, use \"Sync members\" instead — this only edits its label, subject, and academic year."
                : "Elective cohort — label, subject, and academic year."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Subject</Label>
              <Select value={editSubjectId} onValueChange={setEditSubjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a subject" />
                </SelectTrigger>
                <SelectContent>
                  {editAvailableSubjects?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label>Academic year</Label>
                <Input value={editAcademicYear} onChange={(e) => setEditAcademicYear(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Label</Label>
                <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => edit.mutate()}
              disabled={!editLabel || !editSubjectId || !editAcademicYear || edit.isPending}
            >
              {edit.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.label}?</DialogTitle>
            <DialogDescription>
              Also deletes its {deleteTarget?.cohort_members?.[0]?.count ?? 0} member
              {deleteTarget?.cohort_members?.[0]?.count === 1 ? "" : "s"} and any attendance already
              recorded for it. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
              disabled={remove.isPending}
            >
              {remove.isPending ? "Deleting…" : "Delete cohort"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionShell>
  )
}
