export interface WeeklyReportRow {
  roll: string
  name: string
  weeklyPresent: number
  weeklyTotal: number
  overallPct: number | null
  sgpa: number | null
  absenceStreak: number
}

export interface WeeklyReportParams {
  batchLabel: string
  tgName: string
  rangeStart: string
  rangeEnd: string
  rows: WeeklyReportRow[]
  absenceFlagThreshold: number
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

/**
 * Builds a one-page-per-batch weekly attendance PDF and triggers a download.
 * jsPDF pulls in html2canvas/dompurify (its HTML-rendering feature, unused
 * here) as dependencies, which is a lot of dead weight to ship to every
 * visitor for a button only TGs click — loaded on demand instead, same
 * pattern already used for the xlsx roster/attendance parsers.
 */
export async function generateWeeklyReportPdf(params: WeeklyReportParams) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ])

  const { batchLabel, tgName, rangeStart, rangeEnd, rows, absenceFlagThreshold } = params
  const doc = new jsPDF()

  doc.setFontSize(16)
  doc.text("Weekly Attendance Report", 14, 18)
  doc.setFontSize(10)
  doc.setTextColor(90)
  doc.text(`Batch: ${batchLabel}`, 14, 26)
  doc.text(`TG: ${tgName}`, 14, 32)
  doc.text(`Week: ${fmtDate(rangeStart)} - ${fmtDate(rangeEnd)}`, 14, 38)
  doc.text(`Generated: ${fmtDate(new Date().toISOString())}`, 14, 44)
  doc.setTextColor(0)

  const weeklyPctValues = rows
    .filter((r) => r.weeklyTotal > 0)
    .map((r) => (r.weeklyPresent / r.weeklyTotal) * 100)
  const classAvg =
    weeklyPctValues.length > 0
      ? Math.round(weeklyPctValues.reduce((a, b) => a + b, 0) / weeklyPctValues.length)
      : null
  const flaggedCount = rows.filter((r) => r.absenceStreak >= absenceFlagThreshold).length

  autoTable(doc, {
    startY: 50,
    head: [["Roll", "Name", "This week", "Weekly %", "Overall %", "SGPA", "Flag"]],
    body: rows.map((r) => [
      r.roll,
      r.name,
      r.weeklyTotal > 0 ? `${r.weeklyPresent}/${r.weeklyTotal}` : "—",
      r.weeklyTotal > 0 ? `${Math.round((r.weeklyPresent / r.weeklyTotal) * 100)}%` : "—",
      r.overallPct === null ? "—" : `${Math.round(r.overallPct)}%`,
      r.sgpa === null ? "—" : r.sgpa.toFixed(2),
      r.absenceStreak >= absenceFlagThreshold ? `${r.absenceStreak}d absent` : "",
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [15, 118, 110] },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 6 && data.cell.raw) {
        data.cell.styles.textColor = [185, 28, 28]
        data.cell.styles.fontStyle = "bold"
      }
    },
  })

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? 50
  doc.setFontSize(10)
  doc.text(
    `Class average this week: ${classAvg === null ? "—" : `${classAvg}%`}  ·  Absence streak flags: ${flaggedCount}`,
    14,
    finalY + 10,
  )

  const filenameSafeBatch = batchLabel.replace(/[^a-z0-9]+/gi, "-")
  doc.save(`weekly-report-${filenameSafeBatch}-${rangeEnd}.pdf`)
}
