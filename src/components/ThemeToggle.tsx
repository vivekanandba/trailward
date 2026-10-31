import { useState } from "react";
import type { Theme } from "../lib/theme";
import { MoonIcon, SunIcon } from "./icons";

interface ThemeToggleProps {
  theme: Theme;
  onToggle(): void;
}

// Header control that flips light/dark (state + persistence live in App).
export default function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const next = theme === "dark" ? "light" : "dark";
  // The icon turns in only in answer to a press, never on load: keyed to the
  // press count, so each press remounts it with the animation (spec 44 row 5).
  const [presses, setPresses] = useState(0);
  return (
    <button
      type="button"
      onClick={() => {
        setPresses((n) => n + 1);
        onToggle();
      }}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="rounded-lg border border-trail-200 px-3 py-2 text-sm font-medium text-trail-700 hover:border-trail-400 hover:bg-trail-50 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800"
    >
      <span
        key={presses}
        data-testid="theme-icon"
        className={`inline-flex ${presses > 0 ? "theme-icon-in" : ""}`}
      >
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </span>
    </button>
  );
}
