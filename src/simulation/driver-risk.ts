function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Normalizes the supplied 1..10 risk scale without changing baseline pace. */
export function normalizedDriverRisk(risk: number): number {
  return clamp((risk - 1) / 9, 0, 1);
}

/** Intrinsic chance used by qualifying lock-up and track-limit decisions. */
export function qualifyingErrorRisk(risk: number): number {
  return 0.002 + normalizedDriverRisk(risk) * 0.012;
}

/** Mild multiplier for natural driver-error incidents, not mechanical DNFs. */
export function raceIncidentRiskMultiplier(risk: number): number {
  return 0.75 + normalizedDriverRisk(risk) * 0.75;
}

/** Small ordering bias inside the fixed per-race pit-speeding quota. */
export function pitMistakeRiskBias(risk: number): number {
  return normalizedDriverRisk(risk) * 0.2;
}
