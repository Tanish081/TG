// One-page meeting minutes PDF — date/time, agenda, and the batch's
// attendance for that meeting. jsPDF is loaded on demand (same reasoning as
// weekly-report.ts: its html2canvas/dompurify deps are dead weight for
// everyone who never clicks the button).

export interface MeetingMinutesParams {
  batchLabel: string
  tgName: string
  meetingDate: string
  meetingTime: string
  agenda: string
  minutes: string | null
  attendees: { roll: string; name: string; present: boolean }[]
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

function fmtTime(time: string) {
  const [h, m] = time.split(":").map(Number)
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, "0")} ${period}`
}

export async function generateMeetingMinutesPdf(params: MeetingMinutesParams) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ])
  const { batchLabel, tgName, meetingDate, meetingTime, agenda, minutes, attendees } = params

  const TEAL: [number, number, number] = [13, 108, 101]
  const TEAL_BG: [number, number, number] = [235, 249, 247]
  const INK: [number, number, number] = [30, 41, 59]
  const MUTED: [number, number, number] = [110, 125, 145]
  const FAINT: [number, number, number] = [226, 232, 240]
  const GOOD: [number, number, number] = [12, 163, 12]
  const CRITICAL: [number, number, number] = [208, 59, 59]

  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 16

  doc.setFont("helvetica", "bold")
  doc.setFontSize(13)
  doc.setTextColor(...TEAL)
  doc.text("Teacher Guardian", margin, 16)
  doc.setFillColor(...TEAL_BG)
  doc.roundedRect(margin, 19, 34, 6, 1.5, 1.5, "F")
  doc.setFontSize(7)
  doc.text("MEETING MINUTES", margin + 3, 23)
  doc.setDrawColor(...FAINT)
  doc.setLineWidth(0.3)
  doc.line(margin, 27, pageWidth - margin, 27)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(15)
  doc.setTextColor(...INK)
  doc.text(`Batch ${batchLabel}`, margin, 38)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8.5)
  doc.setTextColor(...MUTED)
  doc.text(`Conducted by ${tgName}`, margin, 44)

  // Date/time called out as its own highlighted box, not buried in a plain
  // muted line — this is the one fact someone skimming for "when was this"
  // needs to find instantly.
  const infoBoxY = 49
  const infoBoxW = (pageWidth - margin * 2 - 6) / 2
  const infoBoxH = 16
  doc.setFillColor(...TEAL_BG)
  doc.roundedRect(margin, infoBoxY, infoBoxW, infoBoxH, 2, 2, "F")
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7)
  doc.setTextColor(...TEAL)
  doc.text("DATE", margin + 5, infoBoxY + 6)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.setTextColor(...INK)
  doc.text(fmtDate(meetingDate), margin + 5, infoBoxY + 13)

  const timeBoxX = margin + infoBoxW + 6
  doc.setFillColor(...TEAL_BG)
  doc.roundedRect(timeBoxX, infoBoxY, infoBoxW, infoBoxH, 2, 2, "F")
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7)
  doc.setTextColor(...TEAL)
  doc.text("TIME", timeBoxX + 5, infoBoxY + 6)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.setTextColor(...INK)
  doc.text(fmtTime(meetingTime), timeBoxX + 5, infoBoxY + 13)

  const agendaY = infoBoxY + infoBoxH + 10
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9.5)
  doc.setTextColor(...INK)
  doc.text("Agenda", margin, agendaY)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.setTextColor(...INK)
  const agendaLines = doc.splitTextToSize(agenda, pageWidth - margin * 2)
  doc.text(agendaLines, margin, agendaY + 6)

  let cursorY = agendaY + 6 + agendaLines.length * 4.5 + 8

  if (minutes) {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(9.5)
    doc.setTextColor(...INK)
    doc.text("Minutes of meeting", margin, cursorY)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    const minutesLines = doc.splitTextToSize(minutes, pageWidth - margin * 2)
    doc.text(minutesLines, margin, cursorY + 6)
    cursorY += 6 + minutesLines.length * 4.5 + 8
  }

  const presentCount = attendees.filter((a) => a.present).length
  const afterAgendaY = cursorY

  doc.setFont("helvetica", "bold")
  doc.setFontSize(9.5)
  doc.setTextColor(...INK)
  doc.text(`Attendance — ${presentCount}/${attendees.length} present`, margin, afterAgendaY)

  autoTable(doc, {
    startY: afterAgendaY + 4,
    head: [["Roll", "Name", "Status"]],
    body: attendees
      .slice()
      .sort((a, b) => a.roll.localeCompare(b.roll))
      .map((a) => [a.roll, a.name, a.present ? "Present" : "Absent"]),
    styles: { fontSize: 8.5 },
    headStyles: { fillColor: TEAL },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 2) {
        data.cell.styles.textColor = data.cell.raw === "Present" ? GOOD : CRITICAL
        data.cell.styles.fontStyle = "bold"
      }
    },
  })

  doc.setFontSize(7.5)
  doc.setTextColor(...MUTED)
  doc.text(
    `Generated ${fmtDate(new Date().toISOString())} · Teacher Guardian System`,
    margin,
    doc.internal.pageSize.getHeight() - 10,
  )

  const safeBatch = batchLabel.replace(/[^a-z0-9]+/gi, "-")
  doc.save(`meeting-minutes-${safeBatch}-${meetingDate}.pdf`)
}
