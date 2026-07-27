/**
 * The roll code shown for an enrollment: the source file's own roll number
 * when this enrollment was imported with one (kept exactly as given),
 * otherwise our own system-generated roll_code (§4).
 */
export function displayRoll(e: { roll_code: string; external_roll_no?: string | null }): string {
  return e.external_roll_no || e.roll_code
}
