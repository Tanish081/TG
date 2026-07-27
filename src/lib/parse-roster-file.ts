import Papa from "papaparse"

export interface ParsedRosterRow {
  prn: string | null
  /** The source system's own roll-code string, kept as-is (e.g. "TY2526AIDB101"). */
  externalRollNo: string | null
  name: string
  email: string | null
  phone: string | null
  rollSeq: number
}

// Real college exports (e.g. a "subject-wise students report") aren't clean
// tables — they lead with several metadata rows (institute name, course,
// term, subject) before the actual header row, and use their own header
// wording. So instead of assuming row 1 is the header, scan for the row that
// actually looks like one, then map columns by meaning by fuzzy-matching
// header text.
const FIELD_ALIASES: Record<string, string[]> = {
  seq: ["srno", "sno", "sr", "slno", "rollseq"],
  extRoll: ["rollno", "rollnumber"],
  prn: ["prn"],
  name: ["name", "studentname", "fullname"],
  email: ["emailid", "email", "emailaddress"],
  phone: ["mobilenumber", "mobile", "mobileno", "phone", "phonenumber", "contactnumber"],
}

function normalize(cell: unknown): string {
  return String(cell ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}

function matchField(header: unknown): string | null {
  const n = normalize(header)
  if (!n) return null
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(n)) return field
  }
  return null
}

function parseRows(rows: unknown[][]): ParsedRosterRow[] {
  let headerIdx = -1
  let columnMap = new Map<number, string>()

  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const row = rows[i]
    if (!row) continue
    const map = new Map<number, string>()
    let hasName = false
    let hasPrn = false
    row.forEach((cell, idx) => {
      const field = matchField(cell)
      if (!field) return
      map.set(idx, field)
      if (field === "name") hasName = true
      if (field === "prn") hasPrn = true
    })
    if ((hasName || hasPrn) && map.size >= 2) {
      headerIdx = i
      columnMap = map
      break
    }
  }
  if (headerIdx === -1) return []

  const get = (row: unknown[], field: string): string => {
    for (const [idx, f] of columnMap) {
      if (f === field) return String(row[idx] ?? "").trim()
    }
    return ""
  }

  const parsed: ParsedRosterRow[] = []
  let counter = 0
  for (const row of rows.slice(headerIdx + 1)) {
    if (!row) continue
    const name = get(row, "name")
    const prn = get(row, "prn")
    if (!name && !prn) continue

    counter++
    // The file's own roll number wins when present — it's the number the
    // institution actually assigned and uses. A "Sr.No." column is just the
    // report's row count, not necessarily the real roll number (they only
    // happen to correlate 1:1 in some exports), so it's the fallback.
    const extRoll = get(row, "extRoll") || null
    const trailing = extRoll?.match(/(\d+)\s*$/)
    let rollSeq = trailing ? Number(trailing[1]) : NaN
    if (!Number.isFinite(rollSeq) || rollSeq <= 0) {
      const seqRaw = Number(get(row, "seq"))
      rollSeq = Number.isFinite(seqRaw) && seqRaw > 0 ? seqRaw : counter
    }

    parsed.push({
      prn: prn || null,
      externalRollNo: extRoll,
      name,
      email: get(row, "email") || null,
      phone: get(row, "phone") || null,
      rollSeq,
    })
  }
  return parsed
}

/** Parses a roster CSV or Excel file, tolerant of metadata rows before the real header. */
export async function parseRosterFile(file: File): Promise<ParsedRosterRow[]> {
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
