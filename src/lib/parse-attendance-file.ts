import Papa from "papaparse"
import type { AttendanceStatus } from "@/types/database"

export interface ParsedLecture {
  date: string | null
  slot: string
  label: string
  statuses: { rollNo: string; status: AttendanceStatus }[]
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
}

function normalize(cell: unknown): string {
  return String(cell ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function isRollNoHeader(header: unknown): boolean {
  return normalize(header) === "rollno"
}

function isLectureHeader(header: unknown): boolean {
  return /lecture/i.test(String(header ?? ""))
}

// e.g. "Jul 21,2026 LECTURE(04:15 PM - 05:15 PM)(1)" -> { date: "2026-07-21", slot: "1" }
function extractDateAndSlot(header: string): { date: string | null; slot: string } {
  const dateMatch = header.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})/)
  let date: string | null = null
  if (dateMatch) {
    const mm = MONTHS[dateMatch[1].toLowerCase()]
    if (mm) date = `${dateMatch[3]}-${mm}-${dateMatch[2].padStart(2, "0")}`
  }
  const lectureNumMatch = header.match(/\((\d+)\)\s*$/)
  return { date, slot: lectureNumMatch ? lectureNumMatch[1] : "1" }
}

function mapStatus(raw: string): AttendanceStatus | null {
  const v = raw.trim().toUpperCase()
  if (v === "P") return "present"
  if (v === "A") return "absent"
  if (v === "L") return "late"
  return null
}

function parseRows(rows: unknown[][]): ParsedLecture[] {
  let headerIdx = -1
  let rollNoCol = -1
  const lectureCols: number[] = []

  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const row = rows[i]
    if (!row) continue
    let rn = -1
    const lectures: number[] = []
    row.forEach((cell, idx) => {
      if (isRollNoHeader(cell)) rn = idx
      else if (isLectureHeader(cell)) lectures.push(idx)
    })
    if (rn !== -1 && lectures.length > 0) {
      headerIdx = i
      rollNoCol = rn
      lectureCols.push(...lectures)
      break
    }
  }
  if (headerIdx === -1) return []

  const headerRow = rows[headerIdx]
  const lectures: ParsedLecture[] = lectureCols.map((col) => {
    const header = String(headerRow[col] ?? "")
    const { date, slot } = extractDateAndSlot(header)
    return { date, slot, label: header, statuses: [] }
  })

  for (const row of rows.slice(headerIdx + 1)) {
    if (!row) continue
    const rollNo = String(row[rollNoCol] ?? "").trim()
    if (!rollNo) continue
    lectureCols.forEach((col, li) => {
      const status = mapStatus(String(row[col] ?? ""))
      if (status) lectures[li].statuses.push({ rollNo, status })
    })
  }

  return lectures.filter((l) => l.statuses.length > 0)
}

/** Parses a faculty-wise daily attendance export into one entry per lecture column. */
export async function parseAttendanceFile(file: File): Promise<ParsedLecture[]> {
  if (/\.xlsx?$/i.test(file.name)) {
    const XLSX = await import("xlsx")
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: "array" })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" })
    return parseRows(rows)
  }

  const rows = await new Promise<unknown[][]>((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (result) => resolve(result.data),
      error: (err) => reject(err),
    })
  })
  return parseRows(rows)
}
