/**
 * Badge (spec 08/33) — the pill used for difficulty, tier, and heritage tags.
 * Replaces six hand-rolled span variants in TrekDetail.
 */
import type { ReactNode } from "react";
import type { Difficulty } from "../../lib/trek";

const TONES = {
  easy: "bg-difficulty-easy text-white",
  moderate: "bg-difficulty-moderate text-white",
  hard: "bg-difficulty-hard text-white",
  neutral:
    "border border-trail-200 bg-trail-50 text-trail-700 " +
    "dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300",
  slate: "bg-slate-500/90 text-white dark:bg-slate-600",
  amber:
    "border border-amber-300 bg-amber-50 text-amber-900 " +
    "dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200",
} as const;

export type BadgeTone = keyof typeof TONES;

export function difficultyTone(d: Difficulty): BadgeTone {
  return d.toLowerCase() as BadgeTone;
}

export function Badge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium " +
        `${TONES[tone]} ${className}`
      }
    >
      {children}
    </span>
  );
}
