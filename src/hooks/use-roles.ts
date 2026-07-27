import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"

export interface Roles {
  isDeptCoordinator: boolean
  isHod: boolean
  isClassTeacher: boolean
  isTg: boolean
  isSubjectTeacher: boolean
}

/**
 * A teacher can hold several role-assignments at once (Dept Coordinator, HOD,
 * class teacher, TG, subject teacher are assignments, not account types —
 * §2). This hook derives which nav sections apply by checking which
 * assignment rows exist for the current teacher.
 */
export function useRoles() {
  const { teacher } = useAuth()

  return useQuery({
    queryKey: ["roles", teacher?.id],
    enabled: !!teacher,
    queryFn: async (): Promise<Roles> => {
      const teacherId = teacher!.id

      const [{ count: divisionCount }, { count: batchCount }, { count: assignmentCount }] =
        await Promise.all([
          supabase
            .from("divisions")
            .select("id", { count: "exact", head: true })
            .eq("class_teacher_id", teacherId),
          supabase
            .from("batches")
            .select("id", { count: "exact", head: true })
            .eq("tg_teacher_id", teacherId),
          supabase
            .from("teaching_assignments")
            .select("id", { count: "exact", head: true })
            .eq("teacher_id", teacherId),
        ])

      return {
        isDeptCoordinator: teacher!.is_dept_coordinator,
        isHod: teacher!.is_hod,
        isClassTeacher: (divisionCount ?? 0) > 0,
        isTg: (batchCount ?? 0) > 0,
        isSubjectTeacher: (assignmentCount ?? 0) > 0,
      }
    },
  })
}
