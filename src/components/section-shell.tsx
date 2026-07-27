import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type Accent = "indigo" | "blue" | "teal"

const ACCENT_STYLES: Record<Accent, { bg: string; iconBg: string; iconShadow: string; border: string }> = {
  indigo: {
    bg: "from-indigo-50/80 via-slate-50/60 to-slate-50",
    iconBg: "from-indigo-600 to-violet-600",
    iconShadow: "shadow-indigo-500/25",
    border: "border-indigo-100",
  },
  blue: {
    bg: "from-blue-50/80 via-slate-50/60 to-slate-50",
    iconBg: "from-blue-600 to-cyan-600",
    iconShadow: "shadow-blue-500/25",
    border: "border-blue-100",
  },
  teal: {
    bg: "from-teal-50/80 via-slate-50/60 to-slate-50",
    iconBg: "from-teal-600 to-emerald-600",
    iconShadow: "shadow-teal-500/25",
    border: "border-teal-100",
  },
}

/**
 * Premium page shell shared across sections — a tinted gradient page
 * background plus a glass-morphism hero header. Each role gets a distinct
 * accent (indigo/violet = HOD, blue/cyan = Dept Coordinator, teal/emerald =
 * teacher-facing screens) so sections read as visually distinct while
 * sharing the same polish. Teal is deliberately not pure green, so it never
 * gets confused with the present/absent/late status colors used elsewhere.
 */
export function SectionShell({
  icon: Icon,
  title,
  subtitle,
  accent,
  action,
  maxWidth = "max-w-5xl",
  children,
}: {
  icon: LucideIcon
  title: string
  subtitle?: string
  accent: Accent
  action?: ReactNode
  maxWidth?: string
  children: ReactNode
}) {
  const s = ACCENT_STYLES[accent]
  return (
    <div className={cn("-m-6 min-h-[calc(100vh-3.5rem)] bg-gradient-to-b p-6", s.bg)}>
      <div className={cn("mx-auto", maxWidth)}>
        <div
          className={cn(
            "mb-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur-sm",
            s.border,
          )}
        >
          <div className="flex items-center gap-4">
            <div
              className={cn(
                "flex size-12 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg",
                s.iconBg,
                s.iconShadow,
              )}
            >
              <Icon className="size-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
              {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
            </div>
          </div>
          {action}
        </div>
        {children}
      </div>
    </div>
  )
}
