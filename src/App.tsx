import { Routes, Route } from "react-router-dom"
import { ProtectedRoute } from "@/components/protected-route"
import { AppLayout } from "@/components/app-layout"
import LoginPage from "@/pages/login"
import SetPasswordPage from "@/pages/set-password"
import HomePage from "@/pages/home"
import TeachersPage from "@/pages/admin/teachers"
import StudentsPage from "@/pages/admin/students"
import DivisionStudentsPage from "@/pages/admin/division-students"
import SubjectsPage from "@/pages/admin/subjects"
import DivisionsPage from "@/pages/admin/divisions"
import BatchesPage from "@/pages/admin/batches"
import CohortsPage from "@/pages/admin/cohorts"
import AttendancePage from "@/pages/attendance/index"
import AttendanceSessionPage from "@/pages/attendance/session"
import TgDashboardPage from "@/pages/tg/index"
import TgStudentPage from "@/pages/tg/student"
import TgRecordsPage from "@/pages/tg/records"
import MyDivisionPage from "@/pages/division/index"
import HodStatsPage from "@/pages/hod/index"

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/set-password" element={<SetPasswordPage />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />

          <Route path="/admin/teachers" element={<TeachersPage />} />
          <Route path="/admin/students" element={<StudentsPage />} />
          <Route path="/admin/students/:divisionId" element={<DivisionStudentsPage />} />
          <Route path="/admin/subjects" element={<SubjectsPage />} />
          <Route path="/admin/divisions" element={<DivisionsPage />} />
          <Route path="/admin/batches" element={<BatchesPage />} />
          <Route path="/admin/cohorts" element={<CohortsPage />} />

          <Route path="/attendance" element={<AttendancePage />} />
          <Route path="/attendance/:cohortId" element={<AttendanceSessionPage />} />

          <Route path="/tg" element={<TgDashboardPage />} />
          <Route path="/tg/records" element={<TgRecordsPage />} />
          <Route path="/tg/:enrollmentId" element={<TgStudentPage />} />

          <Route path="/division" element={<MyDivisionPage />} />

          <Route path="/hod" element={<HodStatsPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
