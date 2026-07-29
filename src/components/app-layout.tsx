import { useState, type FormEvent } from "react"
import { Outlet, NavLink, useLocation } from "react-router-dom"
import {
  GraduationCap,
  Users,
  BookOpen,
  Layers,
  UsersRound,
  ClipboardCheck,
  LayoutDashboard,
  ListChecks,
  LogOut,
  BarChart3,
  ShieldCheck,
  KeyRound,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/hooks/use-auth"
import { useRoles, type Roles } from "@/hooks/use-roles"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

interface NavSection {
  key: keyof Roles
  label: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    key: "isDeptCoordinator",
    label: "Dept Coordinator",
    items: [
      { to: "/admin/teachers", label: "Teachers", icon: Users },
      { to: "/admin/students", label: "Students & roster", icon: ListChecks },
      { to: "/admin/subjects", label: "Subjects", icon: BookOpen },
      { to: "/admin/divisions", label: "Divisions", icon: Layers },
      { to: "/admin/batches", label: "TG batches", icon: UsersRound },
      { to: "/admin/cohorts", label: "Cohorts", icon: LayoutDashboard },
    ],
  },
  {
    key: "isHod",
    label: "HOD",
    items: [{ to: "/hod", label: "Statistics", icon: BarChart3 }],
  },
  {
    key: "isClassTeacher",
    label: "Class teacher",
    items: [{ to: "/division", label: "My division", icon: Layers }],
  },
  {
    key: "isTg",
    label: "TG",
    items: [{ to: "/tg", label: "My TG group", icon: UsersRound }],
  },
  {
    key: "isSubjectTeacher",
    label: "Subject teacher",
    items: [{ to: "/attendance", label: "Mark attendance", icon: ClipboardCheck }],
  },
]

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { updatePassword } = useAuth()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError("Password must be at least 8 characters")
      return
    }
    if (password !== confirm) {
      setError("Passwords don't match")
      return
    }
    setSubmitting(true)
    const { error } = await updatePassword(password)
    setSubmitting(false)
    if (error) {
      setError(error)
      return
    }
    toast.success("Password changed")
    setPassword("")
    setConfirm("")
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setPassword("")
          setConfirm("")
          setError(null)
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Takes effect immediately for this account.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="cp-new">New password</Label>
            <Input
              id="cp-new"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cp-confirm">Confirm password</Label>
            <Input
              id="cp-confirm"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AppLayout() {
  const { teacher, signOut } = useAuth()
  const { data: roles } = useRoles()
  const location = useLocation()
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)

  const currentLabel = NAV_SECTIONS.flatMap((s) => s.items).find((item) =>
    location.pathname === item.to || location.pathname.startsWith(item.to + "/"),
  )?.label

  const brand = location.pathname.startsWith("/hod")
    ? { label: "HOD", icon: BarChart3, iconBg: "bg-gradient-to-br from-indigo-600 to-violet-600" }
    : location.pathname.startsWith("/admin")
      ? { label: "Coordinator", icon: ShieldCheck, iconBg: "bg-gradient-to-br from-blue-600 to-cyan-600" }
      : { label: "Teacher Guardian", icon: GraduationCap, iconBg: "bg-primary" }

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div
              className={cn(
                "flex size-7 items-center justify-center rounded-md text-white transition-colors",
                brand.iconBg,
              )}
            >
              <brand.icon className="size-4" />
            </div>
            <span className="font-semibold tracking-tight">{brand.label}</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          {NAV_SECTIONS.map((section) =>
            roles?.[section.key] ? (
              <SidebarGroup key={section.key}>
                <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {section.items.map((item) => {
                      const isActive =
                        location.pathname === item.to || location.pathname.startsWith(item.to + "/")
                      return (
                        <SidebarMenuItem key={item.to}>
                          <SidebarMenuButton asChild isActive={isActive}>
                            <NavLink to={item.to}>
                              <item.icon /> <span>{item.label}</span>
                            </NavLink>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ) : null,
          )}
        </SidebarContent>
        <SidebarFooter>
          <Separator className="mb-2" />
          <div className="flex items-center gap-2 px-2 pb-1">
            <Avatar className="size-8">
              <AvatarFallback className="text-xs">
                {teacher ? initials(teacher.name) : ""}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{teacher?.name}</p>
              <p className="truncate text-xs text-muted-foreground">{teacher?.email}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setChangePasswordOpen(true)}
              title="Change password"
            >
              <KeyRound className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => signOut()} title="Sign out">
              <LogOut className="size-4" />
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>
      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <SidebarTrigger />
          {currentLabel && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <span className="text-sm font-medium text-foreground">{currentLabel}</span>
            </>
          )}
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
