// Parent-facing weekly progress report — one full page per student
// ("their ward"), all bundled into a single PDF per batch, plus a cover
// page with the whole class at a glance. jsPDF pulls in html2canvas/
// dompurify (its unused HTML-rendering feature) as dependencies, so it's
// loaded on demand here rather than at app startup — same pattern already
// used for the xlsx roster/attendance parsers.

export interface StudentSubjectAttendance {
  code: string
  name: string
  present: number
  total: number
}

export interface StudentReportData {
  roll: string
  name: string
  prn: string | null
  weeklyPresent: number
  weeklyTotal: number
  overallPresent: number
  overallTotal: number
  sgpa: number | null
  absenceStreak: number
  subjects: StudentSubjectAttendance[]
}

export interface WeeklyReportParams {
  batchLabel: string
  tgName: string
  tgEmail: string | null
  rangeStart: string
  rangeEnd: string
  students: StudentReportData[]
  absenceFlagThreshold: number
}

// Same status color language used for attendance elsewhere in the app
// (HOD dashboard) — good/warning/critical, fixed hex, not decorative.
const GOOD = [12, 163, 12] as const
const WARNING = [201, 133, 0] as const
const CRITICAL = [208, 59, 59] as const
const INK = [30, 41, 59] as const
const MUTED = [100, 116, 139] as const
const TEAL = [15, 118, 110] as const
const TEAL_BG = [240, 253, 250] as const

function pct(present: number, total: number): number | null {
  return total > 0 ? (present / total) * 100 : null
}

function statusColor(p: number | null): readonly [number, number, number] {
  if (p === null) return MUTED
  if (p >= 75) return GOOD
  if (p >= 60) return WARNING
  return CRITICAL
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

export async function generateWeeklyReportPdf(params: WeeklyReportParams) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ])
  const { batchLabel, tgName, tgEmail, rangeStart, rangeEnd, students, absenceFlagThreshold } = params

  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 16

  function drawHeader(title: string, subtitle: string) {
    doc.setFillColor(...TEAL)
    doc.rect(0, 0, pageWidth, 28, "F")
    doc.setTextColor(255, 255, 255)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(15)
    doc.text("Teacher Guardian", margin, 12)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.text(title, margin, 20)
    doc.setFontSize(8)
    doc.text(subtitle, pageWidth - margin, 20, { align: "right" })
    doc.setTextColor(...INK)
  }

  function drawFooter() {
    const totalPages = (doc.internal as unknown as { getNumberOfPages: () => number }).getNumberOfPages()
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i)
      doc.setFontSize(7.5)
      doc.setTextColor(...MUTED)
      doc.text(
        `Generated ${fmtDate(new Date().toISOString())} · Teacher Guardian System — not an official transcript`,
        margin,
        pageHeight - 8,
      )
      doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: "right" })
      doc.setTextColor(...INK)
    }
  }

  // ---------------------------------------------------------------- cover
  const weeklyPctValues = students.map((s) => pct(s.weeklyPresent, s.weeklyTotal)).filter((p): p is number => p !== null)
  const classAvg = weeklyPctValues.length > 0 ? Math.round(weeklyPctValues.reduce((a, b) => a + b, 0) / weeklyPctValues.length) : null
  const flaggedCount = students.filter((s) => s.absenceStreak >= absenceFlagThreshold).length

  drawHeader("Weekly Progress Report", `Week of ${fmtDate(rangeStart)} - ${fmtDate(rangeEnd)}`)

  doc.setFontSize(18)
  doc.setFont("helvetica", "bold")
  doc.text(batchLabel, margin, 42)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.setTextColor(...MUTED)
  doc.text(`TG: ${tgName}${tgEmail ? `  ·  ${tgEmail}` : ""}`, margin, 49)
  doc.setTextColor(...INK)

  const summaryY = 58
  const boxW = (pageWidth - margin * 2 - 8 * 2) / 3
  const summaryBoxes: [string, string, readonly [number, number, number]][] = [
    ["Students", String(students.length), TEAL],
    ["Class avg. this week", classAvg === null ? "—" : `${classAvg}%`, statusColor(classAvg)],
    [`${absenceFlagThreshold}+ day absence flags`, String(flaggedCount), flaggedCount > 0 ? CRITICAL : GOOD],
  ]
  summaryBoxes.forEach(([label, value, color], i) => {
    const x = margin + i * (boxW + 8)
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(x, summaryY, boxW, 22, 2, 2, "S")
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text(label, x + 4, summaryY + 8)
    doc.setFontSize(15)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(...color)
    doc.text(value, x + 4, summaryY + 17)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(...INK)
  })

  autoTable(doc, {
    startY: summaryY + 30,
    head: [["Roll", "Name", "This week", "Overall", "SGPA", "Flag"]],
    body: students.map((s) => {
      const w = pct(s.weeklyPresent, s.weeklyTotal)
      const o = pct(s.overallPresent, s.overallTotal)
      return [
        s.roll,
        s.name,
        w === null ? "—" : `${Math.round(w)}%`,
        o === null ? "—" : `${Math.round(o)}%`,
        s.sgpa === null ? "—" : s.sgpa.toFixed(2),
        s.absenceStreak >= absenceFlagThreshold ? `${s.absenceStreak}d` : "",
      ]
    }),
    styles: { fontSize: 9 },
    headStyles: { fillColor: TEAL as unknown as [number, number, number] },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 5 && data.cell.raw) {
        data.cell.styles.textColor = CRITICAL as unknown as [number, number, number]
        data.cell.styles.fontStyle = "bold"
      }
    },
  })

  // ------------------------------------------------------- per-student pages
  for (const student of students) {
    doc.addPage()
    drawHeader("Weekly Progress Report", `Week of ${fmtDate(rangeStart)} - ${fmtDate(rangeEnd)}`)

    doc.setFontSize(18)
    doc.setFont("helvetica", "bold")
    doc.text(student.name, margin, 42)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(10)
    doc.setTextColor(...MUTED)
    doc.text(`Roll ${student.roll}${student.prn ? `  ·  PRN ${student.prn}` : ""}  ·  ${batchLabel}`, margin, 49)
    doc.setTextColor(...INK)

    // Two stat cards: this week / overall
    const cardY = 58
    const cardW = (pageWidth - margin * 2 - 8) / 2
    const weekPct = pct(student.weeklyPresent, student.weeklyTotal)
    const overallPct = pct(student.overallPresent, student.overallTotal)
    const statCards: { label: string; present: number; total: number; p: number | null }[] = [
      { label: "This week", present: student.weeklyPresent, total: student.weeklyTotal, p: weekPct },
      { label: "Overall attendance", present: student.overallPresent, total: student.overallTotal, p: overallPct },
    ]
    statCards.forEach(({ label, present, total, p }, i) => {
      const x = margin + i * (cardW + 8)
      const color = statusColor(p)
      doc.setDrawColor(226, 232, 240)
      doc.roundedRect(x, cardY, cardW, 30, 2, 2, "S")
      doc.setFontSize(9)
      doc.setTextColor(...MUTED)
      doc.text(label, x + 6, cardY + 9)
      doc.setFontSize(20)
      doc.setFont("helvetica", "bold")
      doc.setTextColor(...color)
      doc.text(p === null ? "—" : `${Math.round(p)}%`, x + 6, cardY + 22)
      doc.setFont("helvetica", "normal")
      doc.setFontSize(9)
      doc.setTextColor(...MUTED)
      doc.text(`${present}/${total} sessions`, x + cardW - 6, cardY + 22, { align: "right" })
      doc.setTextColor(...INK)
      // mini bar
      const barX = x + 6
      const barY = cardY + 25
      const barW = cardW - 12
      doc.setFillColor(238, 240, 242)
      doc.rect(barX, barY, barW, 2, "F")
      if (p !== null) {
        doc.setFillColor(...color)
        doc.rect(barX, barY, (barW * Math.max(0, Math.min(100, p))) / 100, 2, "F")
      }
    })

    let cursorY = cardY + 30 + 8

    if (student.absenceStreak >= absenceFlagThreshold) {
      doc.setFillColor(254, 242, 242)
      doc.setDrawColor(...CRITICAL)
      doc.roundedRect(margin, cursorY, pageWidth - margin * 2, 12, 2, 2, "FD")
      doc.setFontSize(9.5)
      doc.setFont("helvetica", "bold")
      doc.setTextColor(...CRITICAL)
      doc.text(
        `Attention: ${student.absenceStreak} consecutive days absent as of the most recent session.`,
        margin + 5,
        cursorY + 7.5,
      )
      doc.setFont("helvetica", "normal")
      doc.setTextColor(...INK)
      cursorY += 12 + 8
    }

    if (student.sgpa !== null) {
      doc.setFontSize(9.5)
      doc.setTextColor(...MUTED)
      doc.text("Latest SGPA", margin, cursorY + 4)
      doc.setFontSize(13)
      doc.setFont("helvetica", "bold")
      doc.setTextColor(...INK)
      doc.text(student.sgpa.toFixed(2), margin + 32, cursorY + 5)
      doc.setFont("helvetica", "normal")
      cursorY += 14
    }

    doc.setFontSize(10.5)
    doc.setFont("helvetica", "bold")
    doc.text("Attendance by subject — this week", margin, cursorY + 4)
    doc.setFont("helvetica", "normal")

    autoTable(doc, {
      startY: cursorY + 8,
      head: [["Subject", "Present / Total", "%"]],
      body:
        student.subjects.length > 0
          ? student.subjects.map((s) => {
              const p = pct(s.present, s.total)
              return [`${s.name} (${s.code})`, s.total > 0 ? `${s.present}/${s.total}` : "—", p === null ? "—" : `${Math.round(p)}%`]
            })
          : [["No subjects enrolled", "—", "—"]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: TEAL_BG as unknown as [number, number, number], textColor: TEAL as unknown as [number, number, number] },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 2) {
          const raw = String(data.cell.raw)
          if (raw.endsWith("%")) {
            const v = Number(raw.replace("%", ""))
            const c = statusColor(v)
            data.cell.styles.textColor = c as unknown as [number, number, number]
            data.cell.styles.fontStyle = "bold"
          }
        }
      },
    })
  }

  drawFooter()

  const filenameSafeBatch = batchLabel.replace(/[^a-z0-9]+/gi, "-")
  doc.save(`weekly-progress-report-${filenameSafeBatch}-${rangeEnd}.pdf`)
}
