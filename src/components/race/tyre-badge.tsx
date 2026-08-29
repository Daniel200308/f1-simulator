import type { TyreCompound } from "@/domain/race";

const TYRE_CODE: Record<TyreCompound, string> = {
  SOFT: "S",
  MEDIUM: "M",
  HARD: "H",
  INTERMEDIATE: "I",
  WET: "W",
};

export function TyreBadge({ compound, size = "medium", title }: { compound: TyreCompound; size?: "small" | "medium" | "large"; title?: string }) {
  return (
    <span
      aria-label={`${compound} tyre`}
      className={`f1-tyre-badge f1-tyre-badge--size-${size} f1-tyre-badge--${compound.toLowerCase()}`}
      title={title ?? compound}
    >
      <span>{TYRE_CODE[compound]}</span>
    </span>
  );
}
