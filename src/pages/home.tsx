import { Link } from "react-router-dom"
import { ArrowRight, Layers, ShieldCheck, UsersRound, ClipboardCheck, BarChart3, type LucideIcon } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useRoles, type Roles } from "@/hooks/use-roles"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const cards: { role: keyof Roles; to: string; title: string; desc: string; icon: LucideIcon }[] = [
  { role: "isDeptCoordinator", to: "/admin/teachers", title: "Dept Coordinator", desc: "Manage teachers, students, subjects, batches, and cohorts.", icon: ShieldCheck },
  { role: "isHod", to: "/hod", title: "HOD statistics", desc: "Department-wide attendance, GPA, and batch health at a glance.", icon: BarChart3 },
  { role: "isClassTeacher", to: "/division", title: "My division", desc: "View your division's roster and progress.", icon: Layers },
  { role: "isTg", to: "/tg", title: "My TG group", desc: "Monitor attendance, marks, and GPA for your batch.", icon: UsersRound },
  { role: "isSubjectTeacher", to: "/attendance", title: "Mark attendance", desc: "Take attendance for the cohorts you teach.", icon: ClipboardCheck },
]

export default function HomePage() {
  const { teacher } = useAuth()
  const { data: roles } = useRoles()

  const applicable = cards.filter((c) => roles?.[c.role])

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Welcome, {teacher?.name}</h1>
      <p className="mb-6 text-muted-foreground">
        {applicable.length > 0
          ? "Pick where you want to go."
          : "You don't have any role assignments yet — ask your Dept Coordinator to assign you."}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {applicable.map((c) => (
          <Link key={c.to} to={c.to} className="group">
            <Card className="h-full border-border/60 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md">
              <CardHeader>
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <c.icon className="size-4.5" />
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                </div>
                <CardTitle>{c.title}</CardTitle>
                <CardDescription>{c.desc}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
