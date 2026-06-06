import type { Difficulty } from "../lib/trek";
import { DEFAULT_FILTERS, type FilterState } from "../lib/filters";
import { DIFFICULTY_COLORS } from "../lib/difficulty";

interface FilterBarProps {
  filters: FilterState;
  onChange(next: FilterState): void;
  resultCount: number;
}

const DIFFICULTIES: Difficulty[] = ["Easy", "Moderate", "Hard"];

export default function FilterBar({ filters, onChange, resultCount }: FilterBarProps) {
  const toggleDifficulty = (d: Difficulty) => {
    const has = filters.difficulties.includes(d);
    onChange({
      ...filters,
      difficulties: has
        ? filters.difficulties.filter((x) => x !== d)
        : [...filters.difficulties, d],
    });
  };

  const isDefault =
    filters.radiusKm === DEFAULT_FILTERS.radiusKm &&
    filters.difficulties.length === 0 &&
    !filters.nightOnly &&
    filters.query.trim() === "";

  return (
    <div className="flex flex-col gap-4">
      {/* Search */}
      <div>
        <label htmlFor="trek-search" className="sr-only">
          Search treks
        </label>
        <input
          id="trek-search"
          type="search"
          value={filters.query}
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
          placeholder="Search by name or town…"
          className="w-full rounded-lg border border-trail-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-trail-500 focus:outline-none focus:ring-2 focus:ring-trail-300"
        />
      </div>

      {/* Radius */}
      <div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-trail-800">Within radius</span>
          <span className="tabular-nums text-trail-600">{filters.radiusKm} km</span>
        </div>
        <input
          type="range"
          min={10}
          max={150}
          step={5}
          value={filters.radiusKm}
          onChange={(e) => onChange({ ...filters, radiusKm: Number(e.target.value) })}
          aria-label="Search radius in kilometres"
          className="mt-2 w-full accent-trail-600"
        />
      </div>

      {/* Difficulty chips */}
      <div>
        <span className="text-sm font-medium text-trail-800">Difficulty</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {DIFFICULTIES.map((d) => {
            const active = filters.difficulties.includes(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleDifficulty(d)}
                aria-pressed={active}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ${
                  active
                    ? "border-transparent text-white shadow-sm"
                    : "border-trail-200 bg-white text-trail-700 hover:border-trail-400"
                }`}
                style={active ? { backgroundColor: DIFFICULTY_COLORS[d] } : undefined}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: DIFFICULTY_COLORS[d] }}
                  aria-hidden
                />
                {d}
              </button>
            );
          })}
        </div>
      </div>

      {/* Night trek toggle */}
      <label className="flex cursor-pointer items-center gap-2 text-sm text-trail-800">
        <input
          type="checkbox"
          checked={filters.nightOnly}
          onChange={(e) => onChange({ ...filters, nightOnly: e.target.checked })}
          className="h-4 w-4 rounded border-trail-300 accent-trail-600"
        />
        Night treks only
      </label>

      {/* Count + reset */}
      <div className="flex items-center justify-between border-t border-trail-100 pt-3 text-sm">
        <span className="text-trail-700">
          <span className="font-semibold tabular-nums text-trail-900">{resultCount}</span> trek
          {resultCount === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          disabled={isDefault}
          className="rounded-md px-2 py-1 text-trail-600 hover:bg-trail-50 disabled:opacity-40"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
