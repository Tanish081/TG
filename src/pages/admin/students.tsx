import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { FolderOpen, ArrowRight, ListChecks } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { SectionShell } from "@/components/section-shell"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export default function StudentsPage() {
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

  const { data: enrollments } = useQuery({
    queryKey: ["all-enrollment-division-parts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_enrollments")
        .select("academic_year, year_level, branch_code, division")
      if (error) throw error
      return data
    },
  })

  const countByDivision = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of enrollments ?? []) {
      const key = `${e.academic_year}|${e.year_level}|${e.branch_code}|${e.division}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [enrollments])

  return (
    <SectionShell
      icon={ListChecks}
      title="Students"
      subtitle="Organized by division — created by each division's own class teacher."
      accent="blue"
    >
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}
      {!isLoading && divisions?.length === 0 && (
        <p className="text-sm text-slate-500">
          No divisions yet — create one first (Dept Coordinator → Divisions).
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {divisions?.map((d) => {
          const count =
            countByDivision.get(`${d.academic_year}|${d.year_level}|${d.branch_code}|${d.division}`) ?? 0
          return (
            <Link key={d.id} to={`/admin/students/${d.id}`} className="group">
              <Card className="border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex size-9 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                        <FolderOpen className="size-4.5" />
                      </div>
                      <CardTitle className="text-slate-900">
                        {d.year_level}-{d.division}
                      </CardTitle>
                    </div>
                    <ArrowRight className="size-4 text-slate-400 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                  </div>
                  <CardDescription className="text-slate-500">
                    {d.branch_code} · {d.academic_year} · {count} student{count === 1 ? "" : "s"}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          )
        })}
      </div>
    </SectionShell>
  )
}
