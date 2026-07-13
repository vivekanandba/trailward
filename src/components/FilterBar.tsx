import type { Difficulty, TrekType } from "../lib/trek";
import { DEFAULT_FILTERS, type FilterState } from "../lib/filters";
import { DIFFICULTY_COLORS } from "../lib/difficulty";

interface FilterBarProps {
  filters: FilterState;
  onChange(next: FilterState): void;
  resultCount: number;
  // These two controls filter on fields (trailLengthKm / durationHrs) that not
  // every dataset populates. When no trek in view carries the field, dragging
  // the slider would silently empty the list, so App hides it (spec 05). Default
  // true so the control shows unless explicitly suppressed.
  showTrailLength?: boolean;
  showDuration?: boolean;
}

const DIFFICULTIES: Difficulty[] = ["Easy", "Moderate", "Hard"];
const TYPES: TrekType[] = ["Hill", "Monolith", "Cave", "Fort", "Pilgrimage"];

// Bounds for the range controls. The slider maxima double as "no limit": at the
// top of trail-length / duration the constraint is removed entirely, and a full
// elevation span omits the elevation filter (so unknown-elevation treks still
// show — see spec 05).
const ELEV_MIN = 0;
const ELEV_MAX = 2000;
const ELEV_STEP = 50;
const TRAIL_MAX = 30; // km — slider at max means "Any length"
const DURATION_MAX = 12; // h — slider at max means "Any duration"

// Permit tri-state cycles any → required → not-required → any.
const PERMIT_LABEL: Record<"any" | "yes" | "no", string> = {
  any: "Permit: any",
  yes: "Permit: required",
  no: "Permit: not required",
};

function permitKey(v: boolean | undefined): "any" | "yes" | "no" {
  return v === undefined ? "any" : v ? "yes" : "no";
}

export default function FilterBar({
  filters,
  onChange,
  resultCount,
  showTrailLength = true,
  showDuration = true,
}: FilterBarProps) {
  const patch = (p: Partial<FilterState>) => onChange({ ...filters, ...p });

  const toggleDifficulty = (d: Difficulty) =>
    patch({
      difficulties: filters.difficulties.includes(d)
        ? filters.difficulties.filter((x) => x !== d)
        : [...filters.difficulties, d],
    });

  const toggleType = (t: TrekType) =>
    patch({
      types: filters.types.includes(t)
        ? filters.types.filter((x) => x !== t)
        : [...filters.types, t],
    });

  const [elevMin, elevMax] = filters.elevation ?? [ELEV_MIN, ELEV_MAX];
  const setElevation = (min: number, max: number) => {
    // A full span means "no elevation filter": drop the key entirely.
    if (min <= ELEV_MIN && max >= ELEV_MAX) {
      const { elevation: _drop, ...rest } = filters;
      void _drop;
      onChange(rest);
    } else {
      patch({ elevation: [min, max] });
    }
  };

  const setTrailMax = (v: number) => patch({ trailLengthMaxKm: v >= TRAIL_MAX ? undefined : v });

  const setDurationMax = (v: number) =>
    patch({ durationMaxHrs: v >= DURATION_MAX ? undefined : v });

  const cyclePermit = () => {
    const order: (boolean | undefined)[] = [undefined, true, false];
    const i = order.findIndex((v) => v === filters.permitRequired);
    patch({ permitRequired: order[(i + 1) % order.length] });
  };

  const isDefault =
    filters.radiusKm === DEFAULT_FILTERS.radiusKm &&
    filters.difficulties.length === 0 &&
    filters.types.length === 0 &&
    filters.elevation === undefined &&
    filters.trailLengthMaxKm === undefined &&
    filters.durationMaxHrs === undefined &&
    filters.permitRequired === undefined &&
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
          onChange={(e) => patch({ query: e.target.value })}
          placeholder="Search by name or town…"
          className="w-full rounded-lg border border-trail-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm shadow-sm focus:border-trail-500 focus:outline-none focus:ring-2 focus:ring-trail-300"
        />
      </div>

      {/* Radius */}
      <div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-trail-800 dark:text-slate-100">Within radius</span>
          <span className="tabular-nums text-trail-600 dark:text-slate-400">
            {filters.radiusKm} km
          </span>
        </div>
        <input
          type="range"
          min={10}
          max={150}
          step={5}
          value={filters.radiusKm}
          onChange={(e) => patch({ radiusKm: Number(e.target.value) })}
          aria-label="Search radius in kilometres"
          className="mt-2 w-full accent-trail-600"
        />
      </div>

      {/* Difficulty chips */}
      <div>
        <span className="text-sm font-medium text-trail-800 dark:text-slate-100">Difficulty</span>
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
                    : "border-trail-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-trail-700 dark:text-slate-300 hover:border-trail-400 dark:hover:border-slate-500"
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

      {/* Type chips */}
      <div>
        <span className="text-sm font-medium text-trail-800 dark:text-slate-100">Type</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {TYPES.map((t) => {
            const active = filters.types.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                aria-pressed={active}
                className={`rounded-full border px-3 py-1 text-sm transition ${
                  active
                    ? "border-transparent bg-trail-600 text-white shadow-sm"
                    : "border-trail-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-trail-700 dark:text-slate-300 hover:border-trail-400 dark:hover:border-slate-500"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      {/* Elevation range */}
      <div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-trail-800 dark:text-slate-100">Elevation</span>
          <span className="tabular-nums text-trail-600 dark:text-slate-400">
            {elevMin <= ELEV_MIN && elevMax >= ELEV_MAX ? "Any" : `${elevMin}–${elevMax} m`}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="range"
            min={ELEV_MIN}
            max={elevMax}
            step={ELEV_STEP}
            value={elevMin}
            onChange={(e) => setElevation(Math.min(Number(e.target.value), elevMax), elevMax)}
            aria-label="Minimum elevation in metres"
            className="w-full accent-trail-600"
          />
          <input
            type="range"
            min={elevMin}
            max={ELEV_MAX}
            step={ELEV_STEP}
            value={elevMax}
            onChange={(e) => setElevation(elevMin, Math.max(Number(e.target.value), elevMin))}
            aria-label="Maximum elevation in metres"
            className="w-full accent-trail-600"
          />
        </div>
      </div>

      {/* Trail length max — hidden when no trek in view carries trailLengthKm. */}
      {showTrailLength && (
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-trail-800 dark:text-slate-100">Max trail length</span>
            <span className="tabular-nums text-trail-600 dark:text-slate-400">
              {filters.trailLengthMaxKm === undefined ? "Any" : `${filters.trailLengthMaxKm} km`}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={TRAIL_MAX}
            step={1}
            value={filters.trailLengthMaxKm ?? TRAIL_MAX}
            onChange={(e) => setTrailMax(Number(e.target.value))}
            aria-label="Maximum trail length in kilometres"
            className="mt-2 w-full accent-trail-600"
          />
        </div>
      )}

      {/* Duration max — hidden when no trek in view carries durationHrs. */}
      {showDuration && (
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-trail-800 dark:text-slate-100">Max duration</span>
            <span className="tabular-nums text-trail-600 dark:text-slate-400">
              {filters.durationMaxHrs === undefined ? "Any" : `${filters.durationMaxHrs} h`}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={DURATION_MAX}
            step={1}
            value={filters.durationMaxHrs ?? DURATION_MAX}
            onChange={(e) => setDurationMax(Number(e.target.value))}
            aria-label="Maximum duration in hours"
            className="mt-2 w-full accent-trail-600"
          />
        </div>
      )}

      {/* Permit tri-state */}
      <button
        type="button"
        onClick={cyclePermit}
        aria-label={PERMIT_LABEL[permitKey(filters.permitRequired)]}
        className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${
          filters.permitRequired === undefined
            ? "border-trail-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-trail-700 dark:text-slate-300 hover:border-trail-400 dark:hover:border-slate-500"
            : "border-transparent bg-trail-600 text-white shadow-sm"
        }`}
      >
        <span>Permit</span>
        <span className="font-medium">
          {filters.permitRequired === undefined
            ? "Any"
            : filters.permitRequired
              ? "Required"
              : "Not required"}
        </span>
      </button>

      {/* Night trek toggle */}
      <label className="flex cursor-pointer items-center gap-2 text-sm text-trail-800 dark:text-slate-100">
        <input
          type="checkbox"
          checked={filters.nightOnly}
          onChange={(e) => patch({ nightOnly: e.target.checked })}
          className="h-4 w-4 rounded border-trail-300 accent-trail-600"
        />
        Night treks only
      </label>

      {/* Count + reset */}
      <div className="flex items-center justify-between border-t border-trail-100 dark:border-slate-700 pt-3 text-sm">
        <span className="text-trail-700 dark:text-slate-300">
          <span className="font-semibold tabular-nums text-trail-900 dark:text-slate-100">
            {resultCount}
          </span>{" "}
          trek
          {resultCount === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          disabled={isDefault}
          className="rounded-md px-2 py-1 text-trail-600 dark:text-slate-400 hover:bg-trail-50 dark:hover:bg-slate-800 disabled:opacity-40"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
