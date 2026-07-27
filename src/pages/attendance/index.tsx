import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { ClipboardCheck, ArrowRight } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { SectionShell } from "@/components/section-shell"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

interface AssignmentWithCohort {
  id: string
  cohort: {
    id: string
    label: string
    type: string
    subject: { code: string; name: string } | null
  } | null
}

export default function AttendancePage() {
  const { teacher } = useAuth()

  const { data: assignments, isLoading } = useQuery({
    queryKey: ["my-cohorts", teacher?.id],
    enabled: !!teacher,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teaching_assignments")
        .select("id, cohort:cohorts(id, label, type, subject:subjects(code, name))")
        .eq("teacher_id", teacher!.id)
      if (error) throw error
      return (data ?? []) as unknown as AssignmentWithCohort[]
    },
  })

  return (
    <SectionShell
      icon={ClipboardCheck}
      title="My subjects"
      subtitle="Pick a cohort to mark today's attendance."
      accent="teal"
      maxWidth="max-w-3xl"
    >
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      )}
      {!isLoading && assignments?.length === 0 && (
        <p className="text-sm text-slate-500">No cohorts assigned yet — ask your Dept Coordinator.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {assignments?.map((a) =>
          !a.cohort ? null : (
            <Link key={a.id} to={`/attendance/${a.cohort.id}`} className="group">
              <Card className="h-full border-slate-200/70 bg-white/70 shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md">
                <CardHeader>
                  <div className="mb-1 flex items-center justify-between">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-teal-100 text-teal-700">
                      <ClipboardCheck className="size-4.5" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={a.cohort.type === "core" ? "secondary" : "outline"}>
                        {a.cohort.type}
                      </Badge>
                      <ArrowRight className="size-4 text-slate-400 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                    </div>
                  </div>
                  <CardTitle className="text-slate-900">{a.cohort.label}</CardTitle>
                  <CardDescription className="text-slate-500">
                    {a.cohort.subject?.code} — {a.cohort.subject?.name}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ),
        )}
      </div>
    </SectionShell>
  )
}
