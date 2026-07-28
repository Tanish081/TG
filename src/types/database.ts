export type YearLevel = "FE" | "SE" | "TE" | "BE"
export type CohortType = "core" | "elective"
export type AttendanceStatus = "present" | "absent" | "late"
export type ExamType = "insem" | "endsem"
export type StudentStatus = "active" | "yd" | "left"

// Minimal shape of @supabase/postgrest-js's GenericTable — declared locally
// so this hand-written schema doesn't depend on postgrest-js's internal types.
interface Tbl<Row, Insert, Update> {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export interface Database {
  public: {
    Tables: {
      teachers: Tbl<
        {
          id: string
          name: string
          email: string
          is_dept_coordinator: boolean
          is_hod: boolean
          created_at: string
        },
        never,
        { name?: string; is_dept_coordinator?: boolean; is_hod?: boolean }
      >
      students: Tbl<
        {
          id: string
          prn: string | null
          name: string
          email: string | null
          phone: string | null
          status: StudentStatus
          created_by: string | null
          created_at: string
        },
        {
          id?: string
          prn?: string | null
          name: string
          email?: string | null
          phone?: string | null
          status?: StudentStatus
          created_by?: string | null
        },
        {
          prn?: string | null
          name?: string
          email?: string | null
          phone?: string | null
          status?: StudentStatus
          created_by?: string | null
        }
      >
      student_enrollments: Tbl<
        {
          id: string
          student_id: string
          academic_year: string
          year_level: YearLevel
          branch_code: string
          division: string
          roll_seq: number
          roll_code: string
          external_roll_no: string | null
          created_at: string
        },
        {
          id?: string
          student_id: string
          academic_year: string
          year_level: YearLevel
          branch_code: string
          division: string
          roll_seq: number
          external_roll_no?: string | null
        },
        {
          student_id?: string
          academic_year?: string
          year_level?: YearLevel
          branch_code?: string
          division?: string
          roll_seq?: number
          external_roll_no?: string | null
        }
      >
      divisions: Tbl<
        {
          id: string
          academic_year: string
          year_level: YearLevel
          branch_code: string
          division: string
          class_teacher_id: string | null
          created_at: string
        },
        {
          id?: string
          academic_year: string
          year_level: YearLevel
          branch_code: string
          division: string
          class_teacher_id?: string | null
        },
        {
          academic_year?: string
          year_level?: YearLevel
          branch_code?: string
          division?: string
          class_teacher_id?: string | null
        }
      >
      subjects: Tbl<
        { id: string; name: string; code: string; year_level: YearLevel; semester: number; created_at: string },
        { id?: string; name: string; code: string; year_level: YearLevel; semester: number },
        { name?: string; code?: string; year_level?: YearLevel; semester?: number }
      >
      batches: Tbl<
        {
          id: string
          academic_year: string
          year_level: YearLevel
          branch_code: string
          division: string
          roll_start: number
          roll_end: number
          tg_teacher_id: string
          created_at: string
        },
        {
          id?: string
          academic_year: string
          year_level: YearLevel
          branch_code: string
          division: string
          roll_start: number
          roll_end: number
          tg_teacher_id: string
        },
        {
          academic_year?: string
          year_level?: YearLevel
          branch_code?: string
          division?: string
          roll_start?: number
          roll_end?: number
          tg_teacher_id?: string
        }
      >
      cohorts: Tbl<
        {
          id: string
          subject_id: string
          academic_year: string
          type: CohortType
          label: string
          year_level: YearLevel | null
          branch_code: string | null
          division: string | null
          created_at: string
        },
        {
          id?: string
          subject_id: string
          academic_year: string
          type: CohortType
          label: string
          year_level?: YearLevel | null
          branch_code?: string | null
          division?: string | null
        },
        {
          subject_id?: string
          academic_year?: string
          type?: CohortType
          label?: string
          year_level?: YearLevel | null
          branch_code?: string | null
          division?: string | null
        }
      >
      cohort_members: Tbl<
        { cohort_id: string; enrollment_id: string },
        { cohort_id: string; enrollment_id: string },
        never
      >
      teaching_assignments: Tbl<
        { id: string; teacher_id: string; cohort_id: string; academic_year: string; created_at: string },
        { id?: string; teacher_id: string; cohort_id: string; academic_year: string },
        never
      >
      attendance_sessions: Tbl<
        {
          id: string
          teacher_id: string
          cohort_id: string
          subject_id: string
          date: string
          slot: string
          topic: string | null
          created_at: string
        },
        {
          id?: string
          teacher_id: string
          cohort_id: string
          subject_id: string
          date: string
          slot: string
          topic?: string | null
        },
        never
      >
      attendance_records: Tbl<
        { id: string; session_id: string; enrollment_id: string; status: AttendanceStatus },
        { id?: string; session_id: string; enrollment_id: string; status: AttendanceStatus },
        { status?: AttendanceStatus }
      >
      assessments: Tbl<
        {
          id: string
          subject_id: string
          exam_type: ExamType
          max_marks: number
          semester: number
          academic_year: string
          created_at: string
        },
        {
          id?: string
          subject_id: string
          exam_type: ExamType
          max_marks: number
          semester: number
          academic_year: string
        },
        never
      >
      assessment_results: Tbl<
        { id: string; assessment_id: string; enrollment_id: string; marks: number; created_at: string },
        { id?: string; assessment_id: string; enrollment_id: string; marks: number },
        { marks?: number }
      >
      semester_results: Tbl<
        {
          id: string
          enrollment_id: string
          semester: number
          sgpa: number | null
          cgpa: number | null
          academic_year: string
          created_at: string
        },
        {
          id?: string
          enrollment_id: string
          semester: number
          sgpa?: number | null
          cgpa?: number | null
          academic_year: string
        },
        {
          semester?: number
          sgpa?: number | null
          cgpa?: number | null
          academic_year?: string
        }
      >
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}
