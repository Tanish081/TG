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

type RGB = readonly [number, number, number]

const GOOD: RGB = [12, 163, 12]
const GOOD_BG: RGB = [230, 247, 230]
const WARNING: RGB = [180, 120, 0]
const WARNING_BG: RGB = [255, 246, 224]
const CRITICAL: RGB = [208, 59, 59]
const CRITICAL_BG: RGB = [253, 232, 232]
const INK: RGB = [30, 41, 59]
const MUTED: RGB = [110, 125, 145]
const FAINT: RGB = [226, 232, 240]
const TEAL: RGB = [13, 108, 101]
const TEAL_BG: RGB = [235, 249, 247]

type Status = "On track" | "Keep an eye" | "Needs attention"

function statusOf(p: number | null): Status {
  if (p === null || p >= 85) return "On track"
  if (p >= 75) return "Keep an eye"
  return "Needs attention"
}

function statusColors(status: Status): { fg: RGB; bg: RGB } {
  if (status === "On track") return { fg: GOOD, bg: GOOD_BG }
  if (status === "Keep an eye") return { fg: WARNING, bg: WARNING_BG }
  return { fg: CRITICAL, bg: CRITICAL_BG }
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
  const { batchLabel, tgName, tgEmail, rangeStart, rangeEnd, students, absenceFlagThreshold } = params

  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 16
  const contentW = pageWidth - margin * 2
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

  function statusPill(x: number, y: number, status: Status, align: "left" | "right" = "left") {
    const { fg, bg } = statusColors(status)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(7.5)
    const w = doc.getTextWidth(status) + 6
    const px = align === "right" ? x - w : x
    doc.setFillColor(...bg)
    doc.roundedRect(px, y, w, 5.5, 1.5, 1.5, "F")
    doc.setTextColor(...fg)
    doc.text(status, px + w / 2, y + 3.9, { align: "center" })
    doc.setTextColor(...INK)
    doc.setFont("helvetica", "normal")
    return w
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

  function subjectBar(x: number, y: number, w: number, code: string, name: string, present: number, total: number) {
    const p = pct(present, total)
    const color = p === null ? MUTED : statusColors(statusOf(p)).fg

    doc.setFont("helvetica", "bold")
    doc.setFontSize(7)
    doc.setTextColor(...TEAL)
    const chipW = doc.getTextWidth(code) + 4
    doc.setFillColor(...TEAL_BG)
    doc.roundedRect(x, y - 3.6, chipW, 4.6, 1, 1, "F")
    doc.text(code, x + chipW / 2, y - 0.6, { align: "center" })

    doc.setFont("helvetica", "normal")
    doc.setFontSize(8.5)
    doc.setTextColor(...INK)
    doc.text(name, x + chipW + 3, y)

    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(...color)
    doc.text(p === null ? "—" : `${Math.round(p)}%`, x + w, y, { align: "right" })
    doc.setFont("helvetica", "normal")

    const barY = y + 2.2
    const barW = w - 18
    doc.setFillColor(...FAINT)
    doc.roundedRect(x, barY, barW, 1.8, 0.9, 0.9, "F")
    if (p !== null && p > 0) {
      doc.setFillColor(...color)
      doc.roundedRect(x, barY, (barW * Math.min(100, p)) / 100, 1.8, 0.9, 0.9, "F")
    }
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(...MUTED)
    doc.text(total > 0 ? `${present}/${total}` : "no sessions", x + w, barY + 3.6, { align: "right" })
    doc.setTextColor(...INK)
  }

  // ---------------------------------------------------------------- cover
  const overallStatuses = students.map((s) => statusOf(pct(s.overallPresent, s.overallTotal)))
  const onTrack = overallStatuses.filter((s) => s === "On track").length
  const keepEye = overallStatuses.filter((s) => s === "Keep an eye").length
  const needsAttn = overallStatuses.filter((s) => s === "Needs attention").length

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
    { label: "ON TRACK", value: String(onTrack), color: GOOD },
    { label: "KEEP AN EYE", value: String(keepEye), color: WARNING },
    { label: "NEEDS ATTENTION", value: String(needsAttn), color: needsAttn > 0 ? CRITICAL : INK },
  ]
  const colW = 34
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
    head: [["Roll", "Name", "This wk", "Overall attendance", "SGPA", "Status"]],
    body: students.map((s) => {
      const w = pct(s.weeklyPresent, s.weeklyTotal)
      const o = pct(s.overallPresent, s.overallTotal)
      return [s.roll, s.name, w === null ? "—" : `${Math.round(w)}%`, o, s.sgpa === null ? "—" : s.sgpa.toFixed(2), statusOf(o)]
    }) as unknown as string[][],
    styles: { fontSize: 8.5, valign: "middle" },
    headStyles: { fillColor: TEAL as unknown as [number, number, number], fontSize: 7.5 },
    columnStyles: { 3: { cellWidth: 42 } },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 5) {
        const status = data.cell.raw as unknown as Status
        const { fg } = statusColors(status)
        data.cell.styles.textColor = fg as unknown as [number, number, number]
        data.cell.styles.fontStyle = "bold"
      }
    },
    didDrawCell: (data) => {
      if (data.section === "body" && data.column.index === 3) {
        const o = data.cell.raw as unknown as number | null
        const color = o === null ? MUTED : statusColors(statusOf(o)).fg
        const barX = data.cell.x + 2
        const barY = data.cell.y + data.cell.height / 2 - 0.8
        const barW = data.cell.width - 18
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
  doc.text(`85%+ on track   75-84% keep an eye   below 75% needs attention`, margin, afterTableY + 8)
  doc.text("Individual sheets follow — one per student, to be sent home.", pageWidth - margin, afterTableY + 8, {
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
      "Dear Parent / Guardian, here is a summary of your ward's attendance and academic standing for the week. Please review and sign the acknowledgement slip below.",
      contentW,
    )
    doc.text(salutation, margin, 34)
    doc.setTextColor(...INK)

    const cardTop = 41
    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(...FAINT)
    doc.roundedRect(margin, cardTop, contentW, 20, 2, 2, "FD")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
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
    const overallPct = pct(student.overallPresent, student.overallTotal)
    const overallStatus = statusOf(overallPct)

    drawRing(margin + 15, ringsY, 12, weekPct, weekPct === null ? MUTED : statusColors(statusOf(weekPct)).fg)
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
    drawRing(ring2X, ringsY, 12, overallPct, statusColors(overallStatus).fg)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    doc.text("Overall attendance", ring2X + 19, ringsY - 4)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text(`${student.overallPresent} / ${student.overallTotal} sessions attended`, ring2X + 19, ringsY + 1)
    doc.setTextColor(...INK)
    statusPill(ring2X + 19, ringsY + 3.5, overallStatus)

    let cursorY = ringsY + 22

    if (student.absenceStreak >= absenceFlagThreshold) {
      doc.setFillColor(...CRITICAL_BG)
      doc.setDrawColor(...CRITICAL)
      doc.roundedRect(margin, cursorY, contentW, 11, 2, 2, "FD")
      doc.setFont("helvetica", "bold")
      doc.setFontSize(8.5)
      doc.setTextColor(...CRITICAL)
      doc.text(
        `Attention: ${student.absenceStreak} consecutive days absent as of the most recent session.`,
        margin + 4,
        cursorY + 7,
      )
      doc.setFont("helvetica", "normal")
      doc.setTextColor(...INK)
      cursorY += 11 + 7
    } else {
      cursorY += 6
    }

    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.text("Attendance by subject", margin, cursorY)
    doc.setDrawColor(...FAINT)
    doc.line(margin + 42, cursorY - 1.5, pageWidth - margin, cursorY - 1.5)
    doc.setFont("helvetica", "normal")
    cursorY += 8

    if (student.subjects.length === 0) {
      doc.setFontSize(8.5)
      doc.setTextColor(...MUTED)
      doc.text("No subjects enrolled.", margin, cursorY)
      doc.setTextColor(...INK)
      cursorY += 6
    } else {
      for (const subj of student.subjects) {
        subjectBar(margin, cursorY, contentW, subj.code, subj.name, subj.present, subj.total)
        cursorY += 9
      }
    }

    cursorY += 4
    const boxW = (contentW - 6) / 2
    const boxH = 24
    doc.setDrawColor(...FAINT)
    doc.roundedRect(margin, cursorY, boxW, boxH, 2, 2, "S")
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(...MUTED)
    doc.text("LAST SEMESTER SGPA", margin + 4, cursorY + 7)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(16)
    doc.setTextColor(...INK)
    doc.text(student.sgpa === null ? "—" : student.sgpa.toFixed(2), margin + 4, cursorY + 16)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(6.5)
    doc.setTextColor(...MUTED)
    doc.text(
      doc.splitTextToSize("Grade-point average for the last completed semester, on a 10-point scale.", boxW - 8),
      margin + 4,
      cursorY + 20,
    )

    const box2X = margin + boxW + 6
    doc.roundedRect(box2X, cursorY, boxW, boxH, 2, 2, "S")
    doc.setFontSize(7)
    doc.setTextColor(...MUTED)
    doc.text("HOW TO READ THE COLOURS", box2X + 4, cursorY + 6)
    const legend: [RGB, string][] = [
      [GOOD, "Green (85%+) — on track"],
      [WARNING, "Amber (75-84%) — approaching the limit"],
      [CRITICAL, "Red (below 75%) — needs attention"],
    ]
    legend.forEach(([color, text], i) => {
      const ly = cursorY + 10.5 + i * 4.2
      doc.setFillColor(...color)
      doc.circle(box2X + 5, ly - 1, 1.1, "F")
      doc.setFontSize(6.8)
      doc.setTextColor(...INK)
      doc.text(text, box2X + 8, ly)
    })

    cursorY += boxH + 8

    doc.setDrawColor(...FAINT)
    doc.roundedRect(margin, cursorY, contentW, 18, 2, 2, "S")
    doc.setFontSize(7)
    doc.setTextColor(...MUTED)
    doc.text("TEACHER GUARDIAN'S REMARKS", margin + 4, cursorY + 6)
    doc.setDrawColor(...FAINT)
    doc.setLineDashPattern([0.6, 0.8], 0)
    doc.line(margin + 4, cursorY + 11, pageWidth - margin - 4, cursorY + 11)
    doc.line(margin + 4, cursorY + 15.5, pageWidth - margin - 4, cursorY + 15.5)
    doc.setLineDashPattern([], 0)
    cursorY += 18 + 10

    doc.setFontSize(7)
    doc.setTextColor(...MUTED)
    doc.text("PARENT / GUARDIAN SIGNATURE", margin, cursorY)
    doc.text("DATE", pageWidth - margin - 40, cursorY)
    cursorY += 10
    doc.setDrawColor(...INK)
    doc.line(margin, cursorY, margin + 90, cursorY)
    doc.line(pageWidth - margin - 40, cursorY, pageWidth - margin, cursorY)
    doc.setFontSize(6.5)
    doc.setTextColor(...MUTED)
    doc.text("Name & signature", margin, cursorY + 4)
    doc.text("DD / MM / YYYY", pageWidth - margin - 40, cursorY + 4)
    doc.setTextColor(...INK)

    drawFooter(student.roll)
  }

  const filenameSafeBatch = batchLabel.replace(/[^a-z0-9]+/gi, "-")
  doc.save(`weekly-progress-report-${filenameSafeBatch}-${rangeEnd}.pdf`)
}
