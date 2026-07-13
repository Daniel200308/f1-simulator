export function formatLapTime(seconds: number | null, placeholder = "—"): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return placeholder;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(3).padStart(6, "0")}`;
}
