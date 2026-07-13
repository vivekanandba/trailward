import type { Theme } from "../lib/theme";

interface ThemeToggleProps {
  theme: Theme;
  onToggle(): void;
}

// Header control that flips light/dark (state + persistence live in App).
export default function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="rounded-lg border border-trail-200 px-3 py-2 text-sm font-medium text-trail-700 hover:border-trail-400 hover:bg-trail-50 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800"
    >
      <span aria-hidden>{theme === "dark" ? "☀️" : "🌙"}</span>
    </button>
  );
}
