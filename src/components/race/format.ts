export function formatLapTime(seconds: number | null, placeholder = "—"): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return placeholder;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(3).padStart(6, "0")}`;
}

/**
 * Set numbers come from the allocation id (`ferrari-1-soft-3`), so the label is
 * read from the trailing segment rather than the array position.
 */
export function tyreSetNumber(setId: string): number {
  return Number(setId.split("-").at(-1)) || 1;
}

export function tyreSetLabel(setId: string): string {
  return tyreSetNumber(setId).toString().padStart(2, "0");
}
