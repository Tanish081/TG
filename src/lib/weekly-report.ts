// Parent-facing weekly progress report — one full page per student
// ("their ward"), all bundled into a single PDF per batch, plus a cover
// page with the whole class at a glance and clickable rows jumping
// straight to each student's page. jsPDF pulls in html2canvas/dompurify
// (its unused HTML-rendering feature) as dependencies, so it's loaded on
// demand here rather than at app startup — same pattern already used for
// the xlsx roster/attendance parsers.

export interface DailyMark {
  date: string
  present: boolean
}

export interface StudentSubjectStreak {
  code: string
  name: string
  daily: DailyMark[]
}

export interface StudentReportData {
  roll: string
  name: string
  prn: string | null
  weeklyPresent: number
  weeklyTotal: number
  overallPresent: number
  overallTotal: number
  overallDaily: DailyMark[]
  subjects: StudentSubjectStreak[]
}

export interface WeeklyReportParams {
  batchLabel: string
  tgName: string
  tgEmail: string | null
  rangeStart: string
  rangeEnd: string
  students: StudentReportData[]
  lowAttendanceThreshold: number
}

type RGB = readonly [number, number, number]

const GOOD: RGB = [12, 163, 12]
const CRITICAL: RGB = [208, 59, 59]
const CRITICAL_BG: RGB = [253, 232, 232]
const INK: RGB = [30, 41, 59]
const MUTED: RGB = [110, 125, 145]
const FAINT: RGB = [226, 232, 240]
const TEAL: RGB = [13, 108, 101]
const TEAL_BG: RGB = [235, 249, 247]
const EMPTY_CELL: RGB = [235, 238, 242]
const WHITE: RGB = [255, 255, 255]
const DAY_LETTERS = ["M", "T", "W", "T", "F", "S"]

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function pct(present: number, total: number): number | null {
  return total > 0 ? (present / total) * 100 : null
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

export async function generateWeeklyReportPdf(params: WeeklyReportParams) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ])
  const { batchLabel, tgName, tgEmail, rangeStart, rangeEnd, students, lowAttendanceThreshold } = params

  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 16
  const contentW = pageWidth - margin * 2
  const bottomLimit = pageHeight - 16
  const weekLabel = `${fmtDate(rangeStart)} - ${fmtDate(rangeEnd)}`

  // ------------------------------------------------------------- helpers

  function drawHeader() {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(13)
    doc.setTextColor(...TEAL)
    doc.text("Teacher Guardian", margin, 16)

    doc.setFillColor(...TEAL_BG)
    doc.roundedRect(margin, 19, 46, 6, 1.5, 1.5, "F")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(7)
    doc.setTextColor(...TEAL)
    doc.text("WEEKLY PROGRESS REPORT", margin + 3, 23)

    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text("Week of", pageWidth - margin, 15, { align: "right" })
    doc.setFont("helvetica", "bold")
    doc.setFontSize(9.5)
    doc.setTextColor(...INK)
    doc.text(weekLabel, pageWidth - margin, 20, { align: "right" })

    doc.setDrawColor(...FAINT)
    doc.setLineWidth(0.3)
    doc.line(margin, 27, pageWidth - margin, 27)
    doc.setTextColor(...INK)
  }

  function drawFooter(rightLabel: string) {
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.text("Teacher Guardian System · Not an official transcript", margin, pageHeight - 10)
    doc.text(rightLabel, pageWidth - margin, pageHeight - 10, { align: "right" })
    doc.setTextColor(...INK)
  }

  /** Filled donut ring with a centered percentage label. */
  function drawRing(cx: number, cy: number, r: number, p: number | null, color: RGB) {
    const lineWidth = 3.2
    doc.setLineWidth(lineWidth)
    doc.setLineCap("round")
    doc.setDrawColor(...FAINT)
    doc.circle(cx, cy, r, "S")
    if (p !== null && p > 0) {
      doc.setDrawColor(...color)
      const sweep = 360 * Math.min(1, p / 100)
      const steps = Math.max(2, Math.round(sweep / 3))
      let prevX = cx
      let prevY = cy - r
      for (let i = 1; i <= steps; i++) {
        const angle = (-90 + (sweep * i) / steps) * (Math.PI / 180)
        const x = cx + r * Math.cos(angle)
        const y = cy + r * Math.sin(angle)
        doc.line(prevX, prevY, x, y)
        prevX = x
        prevY = y
      }
    }
    doc.setLineCap("butt")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(12)
    doc.setTextColor(...(p === null ? MUTED : color))
    doc.text(p === null ? "—" : `${Math.round(p)}%`, cx, cy + 2, { align: "center" })
    doc.setFont("helvetica", "normal")
    doc.setTextColor(...INK)
  }

  /** GitHub/LeetCode-style streak row: label + name on the left, a strip of
   * small present/absent squares on the right (most recent cell rightmost),
   * capped to however many fit the available width. */
  function drawStreakRow(x: number, y: number, w: number, label: string, sublabel: string | null, daily: DailyMark[]) {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(...INK)
    doc.text(label, x, y)
    if (sublabel) {
      const labelW = doc.getTextWidth(label)
      doc.setFont("helvetica", "normal")
      doc.setFontSize(7)
      doc.setTextColor(...MUTED)
      doc.text(sublabel, x + labelW + 3, y)
    }

    const cellsY = y + 2.5
    const pitch = 4.2
    const cellSize = 3.2
    const maxCells = Math.max(1, Math.floor(w / pitch))
    const shown = daily.slice(-maxCells)
    const startX = x + w - shown.length * pitch

    doc.setFont("helvetica", "normal")
    doc.setTextColor(...INK)
    shown.forEach((d, i) => {
      const cx = startX + i * pitch
      doc.setFillColor(...(d.present ? GOOD : CRITICAL))
      doc.roundedRect(cx, cellsY, cellSize, cellSize, 0.7, 0.7, "F")
    })
    if (shown.length === 0) {
      doc.setFillColor(...EMPTY_CELL)
      doc.roundedRect(x + w - pitch, cellsY, cellSize, cellSize, 0.7, 0.7, "F")
    }
  }

  /** This week's own Mon-Sat calendar — 6 labeled day boxes, separate from
   * the long streak history (which only shows the most recent N sessions,
   * not calendar days), so the current academic week reads at a glance. */
  function drawWeekGrid(x: number, y: number, title: string, weekStart: string, daily: DailyMark[]) {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(...INK)
    doc.text(title, x, y)

    const boxSize = 9
    const pitch = 12
    const boxesY = y + 4
    const byDate = new Map(daily.map((d) => [d.date, d.present]))

    for (let i = 0; i < 6; i++) {
      const date = addDaysISO(weekStart, i)
      const present = byDate.get(date)
      const color = present === undefined ? EMPTY_CELL : present ? GOOD : CRITICAL
      const bx = x + i * pitch

      doc.setFont("helvetica", "normal")
      doc.setFontSize(6.5)
      doc.setTextColor(...MUTED)
      doc.text(DAY_LETTERS[i], bx + boxSize / 2, boxesY - 1.5, { align: "center" })

      doc.setFillColor(...color)
      doc.roundedRect(bx, boxesY, boxSize, boxSize, 1.4, 1.4, "F")

      doc.setFont("helvetica", "bold")
      doc.setFontSize(7)
      doc.setTextColor(...(present === undefined ? MUTED : WHITE))
      doc.text(String(Number(date.slice(8, 10))), bx + boxSize / 2, boxesY + boxSize / 2 + 1.3, { align: "center" })
    }
    doc.setTextColor(...INK)
    doc.setFont("helvetica", "normal")
  }

  const streakRowHeight = 9

  /** Advances to a new page (redrawing the header) if the next block of
   * `need` mm wouldn't fit above the footer — student pages have a
   * variable number of subjects, so this is the only way to guarantee
   * nothing gets silently clipped off the bottom of the page. */
  function ensureSpace(need: number, footerLabel: string) {
    if (cursorY + need > bottomLimit) {
      drawFooter(footerLabel)
      doc.addPage()
      drawHeader()
      cursorY = 34
    }
  }

  let cursorY = 0

  // ---------------------------------------------------------------- cover
  const lowCount = students.filter((s) => {
    const o = pct(s.overallPresent, s.overallTotal)
    return o !== null && o < lowAttendanceThreshold
  }).length

  drawHeader()

  doc.setFont("helvetica", "bold")
  doc.setFontSize(6.5)
  doc.setTextColor(...MUTED)
  doc.text("OFFICE / TG COPY — CLASS SUMMARY", margin, 34)

  doc.setFontSize(15)
  doc.setTextColor(...INK)
  doc.text(`Batch ${batchLabel} — Class Overview`, margin, 42)

  const statCols: { label: string; value: string; color: RGB }[] = [
    { label: "STUDENTS", value: String(students.length), color: INK },
    { label: `BELOW ${lowAttendanceThreshold}%`, value: String(lowCount), color: lowCount > 0 ? CRITICAL : INK },
  ]
  const colW = 38
  statCols.forEach((c, i) => {
    const x = margin + i * colW
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(...MUTED)
    doc.text(c.label, x, 50)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(16)
    doc.setTextColor(...c.color)
    doc.text(c.value, x, 58)
  })
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.text("TEACHER GUARDIAN", margin + statCols.length * colW + 4, 50)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(10)
  doc.setTextColor(...INK)
  doc.text(tgName, margin + statCols.length * colW + 4, 57)

  autoTable(doc, {
    startY: 65,
    head: [["Roll", "Name", "This wk", "Overall attendance", ""]],
    body: students.map((s) => {
      const w = pct(s.weeklyPresent, s.weeklyTotal)
      const o = pct(s.overallPresent, s.overallTotal)
      return [s.roll, s.name, w === null ? "—" : `${Math.round(w)}%`, o, "View"]
    }) as unknown as string[][],
    styles: { fontSize: 8.5, valign: "middle" },
    headStyles: { fillColor: TEAL as unknown as [number, number, number], fontSize: 7.5 },
    columnStyles: { 3: { cellWidth: 46 }, 4: { cellWidth: 18, halign: "right" } },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 4) {
        data.cell.styles.textColor = TEAL as unknown as [number, number, number]
        data.cell.styles.fontStyle = "bold"
      }
      // Column 3 carries the raw % for didDrawCell to read below, but its
      // own auto-rendered text must be suppressed — otherwise autoTable
      // draws that raw number as plain text underneath the bar+label this
      // hook paints on top, producing overlapping "100% 100 100%" text.
      if (data.section === "body" && data.column.index === 3) {
        data.cell.text = []
      }
    },
    didDrawCell: (data) => {
      if (data.section !== "body") return
      // Whole row jumps to that student's page — added once per cell so
      // the entire row is clickable, not just one column.
      const pageNumber = 2 + data.row.index
      doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { pageNumber })

      if (data.column.index === 3) {
        const o = data.cell.raw as unknown as number | null
        const color = o !== null && o < lowAttendanceThreshold ? CRITICAL : GOOD
        const barX = data.cell.x + 2
        const barY = data.cell.y + data.cell.height / 2 - 0.8
        const barW = data.cell.width - 20
        doc.setFillColor(...FAINT)
        doc.rect(barX, barY, barW, 1.6, "F")
        if (o !== null) {
          doc.setFillColor(...color)
          doc.rect(barX, barY, (barW * Math.min(100, o)) / 100, 1.6, "F")
        }
        doc.setFont("helvetica", "bold")
        doc.setFontSize(8)
        doc.setTextColor(...color)
        doc.text(o === null ? "—" : `${Math.round(o)}%`, data.cell.x + data.cell.width - 2, data.cell.y + data.cell.height / 2 + 1.2, {
          align: "right",
        })
        doc.setTextColor(...INK)
        doc.setFont("helvetica", "normal")
      }
    },
  })

  const afterTableY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? 65
  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.text(`Rows in red are below ${lowAttendanceThreshold}% overall attendance.`, margin, afterTableY + 8)
  doc.text("Click a row to jump to that student's page. Sheets follow, one per student.", pageWidth - margin, afterTableY + 8, {
    align: "right",
  })
  drawFooter("Class summary")

  // ------------------------------------------------------- per-student pages
  for (const student of students) {
    doc.addPage()
    drawHeader()

    doc.setFontSize(8.5)
    doc.setTextColor(...MUTED)
    const salutation = doc.splitTextToSize(
      "Dear Parent / Guardian, here is a summary of your ward's attendance for the week.",
      contentW,
    )
    doc.text(salutation, margin, 34)
    doc.setTextColor(...INK)

    const cardTop = 40
    const overallPct = pct(student.overallPresent, student.overallTotal)
    const isLow = overallPct !== null && overallPct < lowAttendanceThreshold
    const cardBg: RGB = isLow ? CRITICAL_BG : [248, 250, 252]
    doc.setFillColor(...cardBg)
    doc.setDrawColor(...(isLow ? CRITICAL : FAINT))
    doc.roundedRect(margin, cardTop, contentW, 20, 2, 2, "FD")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    doc.setTextColor(...INK)
    doc.text(student.name, margin + 5, cardTop + 9)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8.5)
    doc.setTextColor(...MUTED)
    doc.text(
      `Roll ${student.roll}${student.prn ? `  ·  PRN ${student.prn}` : ""}  ·  ${batchLabel}`,
      margin + 5,
      cardTop + 15,
    )
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7.5)
    doc.text("Teacher Guardian", pageWidth - margin - 5, cardTop + 7, { align: "right" })
    doc.setFont("helvetica", "bold")
    doc.setFontSize(9)
    doc.setTextColor(...INK)
    doc.text(tgName, pageWidth - margin - 5, cardTop + 12, { align: "right" })
    if (tgEmail) {
      doc.setFont("helvetica", "normal")
      doc.setFontSize(7.5)
      doc.setTextColor(...MUTED)
      doc.text(tgEmail, pageWidth - margin - 5, cardTop + 16.5, { align: "right" })
    }
    doc.setTextColor(...INK)

    // Two donut rings: this week / overall
    const ringsY = cardTop + 20 + 20
    const weekPct = pct(student.weeklyPresent, student.weeklyTotal)

    drawRing(margin + 15, ringsY, 12, weekPct, weekPct !== null && weekPct < lowAttendanceThreshold ? CRITICAL : GOOD)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    doc.text("This week", margin + 34, ringsY - 4)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text(`${student.weeklyPresent} / ${student.weeklyTotal} sessions attended`, margin + 34, ringsY + 1)
    doc.text(weekLabel, margin + 34, ringsY + 6)
    doc.setTextColor(...INK)

    const ring2X = margin + contentW / 2 + 15
    drawRing(ring2X, ringsY, 12, overallPct, isLow ? CRITICAL : GOOD)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    doc.text("Overall attendance", ring2X + 19, ringsY - 4)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text(`${student.overallPresent} / ${student.overallTotal} sessions attended`, ring2X + 19, ringsY + 1)
    if (isLow) {
      doc.setFont("helvetica", "bold")
      doc.setTextColor(...CRITICAL)
      doc.text(`Below ${lowAttendanceThreshold}% — needs attention`, ring2X + 19, ringsY + 6)
      doc.setFont("helvetica", "normal")
    }
    doc.setTextColor(...INK)

    cursorY = ringsY + 20

    // This week's own Mon-Sat calendar — separate from the long streak
    // history below, so the current week reads at a glance day-by-day.
    ensureSpace(18, student.roll)
    drawWeekGrid(margin, cursorY, "This week, day by day", rangeStart, student.overallDaily)
    cursorY += 18

    ensureSpace(10, student.roll)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.text("Attendance streak", margin, cursorY)
    doc.setDrawColor(...FAINT)
    doc.line(margin + 36, cursorY - 1.5, pageWidth - margin, cursorY - 1.5)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(6.5)
    doc.setTextColor(...MUTED)
    doc.text("green = present · red = absent", pageWidth - margin, cursorY, { align: "right" })
    doc.setTextColor(...INK)
    cursorY += 8

    ensureSpace(streakRowHeight, student.roll)
    drawStreakRow(margin, cursorY, contentW, "Overall", null, student.overallDaily)
    cursorY += streakRowHeight

    for (const subj of student.subjects) {
      ensureSpace(streakRowHeight, student.roll)
      drawStreakRow(margin, cursorY, contentW, subj.code, subj.name, subj.daily)
      cursorY += streakRowHeight
    }

    drawFooter(student.roll)
  }

  const filenameSafeBatch = batchLabel.replace(/[^a-z0-9]+/gi, "-")
  doc.save(`weekly-progress-report-${filenameSafeBatch}-${rangeEnd}.pdf`)
}
