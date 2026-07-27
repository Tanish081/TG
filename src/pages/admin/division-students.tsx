import { useState } from "react"
import { useParams, Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeft, ListChecks } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { displayRoll } from "@/lib/roll-code"
import { SectionShell } from "@/components/section-shell"
import type { StudentStatus } from "@/types/database"
import { Input } from "@/components/ui/input"
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

const STATUSES: StudentStatus[] = ["active", "yd", "left"]

interface EnrollmentRow {
  id: string
  roll_code: string
  external_roll_no: string | null
  roll_seq: number
  student: { id: string; prn: string | null; name: string; status: StudentStatus } | null
}

export default function DivisionStudentsPage() {
  const { divisionId } = useParams<{ divisionId: string }>()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")

  const { data: division } = useQuery({
    queryKey: ["division", divisionId],
    enabled: !!divisionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("divisions")
        .select("*")
        .eq("id", divisionId!)
        .single()
      if (error) throw error
      return data
    },
  })

  const { data: enrollments, isLoading } = useQuery({
    queryKey: ["division-roster", division?.id],
    enabled: !!division,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_enrollments")
        .select("id, roll_code, external_roll_no, roll_seq, student:students(id, prn, name, status)")
        .eq("academic_year", division!.academic_year)
        .eq("year_level", division!.year_level)
        .eq("branch_code", division!.branch_code)
        .eq("division", division!.division)
        .order("roll_seq")
      if (error) throw error
      return (data ?? []) as unknown as EnrollmentRow[]
    },
  })

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: StudentStatus }) => {
      const { error } = await supabase.from("students").update({ status }).eq("id", id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["division-roster", division?.id] }),
    onError: (err: Error) => toast.error(err.message),
  })

  const filtered = enrollments?.filter((e) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      e.student?.name.toLowerCase().includes(q) || e.student?.prn?.toLowerCase().includes(q)
    )
  })

  return (
    <SectionShell
      icon={ListChecks}
      title={division ? `${division.year_level}-${division.division}` : "…"}
      subtitle={
        division
          ? `${division.branch_code} · ${division.academic_year} · read-only`
          : undefined
      }
      accent="blue"
    >
      <Link
        to="/admin/students"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" /> All divisions
      </Link>

      <Input
        placeholder="Search by name or PRN…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 bg-white/70"
      />

      <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Roll</TableHead>
              <TableHead>PRN</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
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
            {filtered?.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono">{displayRoll(e)}</TableCell>
                <TableCell>{e.student?.prn ?? "—"}</TableCell>
                <TableCell>{e.student?.name}</TableCell>
                <TableCell>
                  {e.student && (
                    <Select
                      value={e.student.status}
                      onValueChange={(v) =>
                        setStatus.mutate({ id: e.student!.id, status: v as StudentStatus })
                      }
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((st) => (
                          <SelectItem key={st} value={st}>
                            <Badge variant={st === "active" ? "secondary" : "destructive"}>{st}</Badge>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && filtered?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No students enrolled in this division yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </SectionShell>
  )
}
