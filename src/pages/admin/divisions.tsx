import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Layers } from "lucide-react"
import { supabase } from "@/lib/supabase"
import type { YearLevel } from "@/types/database"
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
const UNASSIGNED = "__unassigned__"

export default function DivisionsPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [academicYear, setAcademicYear] = useState("2025-26")
  const [yearLevel, setYearLevel] = useState<YearLevel>("SE")
  const [branchCode, setBranchCode] = useState("AID")
  const [division, setDivision] = useState("")

  const { data: divisions, isLoading } = useQuery({
    queryKey: ["divisions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("divisions")
        .select("*")
        .order("academic_year", { ascending: false })
        .order("year_level")
        .order("division")
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

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("divisions").insert({
        academic_year: academicYear,
        year_level: yearLevel,
        branch_code: branchCode,
        division,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success("Division created")
      setOpen(false)
      setDivision("")
      queryClient.invalidateQueries({ queryKey: ["divisions"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const assignClassTeacher = useMutation({
    mutationFn: async ({ id, teacherId }: { id: string; teacherId: string | null }) => {
      const { error } = await supabase
        .from("divisions")
        .update({ class_teacher_id: teacherId })
        .eq("id", id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["divisions"] }),
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <SectionShell
      icon={Layers}
      title="Divisions"
      subtitle="Each division owns its own roll numbers. Assign a class teacher to each."
      accent="blue"
      action={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>New division</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a division</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="d-ay">Academic year</Label>
                  <Input
                    id="d-ay"
                    placeholder="2025-26"
                    value={academicYear}
                    onChange={(e) => setAcademicYear(e.target.value)}
                  />
                </div>
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
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="d-branch">Branch code</Label>
                  <Input
                    id="d-branch"
                    placeholder="AID"
                    value={branchCode}
                    onChange={(e) => setBranchCode(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="d-div">Division</Label>
                  <Input
                    id="d-div"
                    placeholder="A"
                    value={division}
                    onChange={(e) => setDivision(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={!division || create.isPending}>
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
            <TableHead>Division</TableHead>
            <TableHead>Year</TableHead>
            <TableHead>Branch</TableHead>
            <TableHead>AY</TableHead>
            <TableHead>Class teacher</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                Loading…
              </TableCell>
            </TableRow>
          )}
          {divisions?.map((d) => (
            <TableRow key={d.id}>
              <TableCell>{d.division}</TableCell>
              <TableCell>{d.year_level}</TableCell>
              <TableCell>{d.branch_code}</TableCell>
              <TableCell>{d.academic_year}</TableCell>
              <TableCell>
                <Select
                  value={d.class_teacher_id ?? UNASSIGNED}
                  onValueChange={(v) =>
                    assignClassTeacher.mutate({ id: d.id, teacherId: v === UNASSIGNED ? null : v })
                  }
                >
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                    {teachers?.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </Card>
    </SectionShell>
  )
}
