/** Card (spec 08/33) — the soft panel block TrekDetail repeats for facts,
 *  rainfall, terrain, and wildlife sections. */
import type { ReactNode } from "react";

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-lg bg-trail-50 p-3 dark:bg-slate-800 ${className}`}>{children}</div>
  );
}
