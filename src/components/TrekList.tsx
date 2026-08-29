/**
 * The result list (spec 33) — rows, loading skeletons, empty state, and the
 * overflow footer — extracted from App so the desktop rail and the mobile
 * results sheet compose the same list without duplication.
 */
import type { Trek } from "../lib/trek";
import { suggestTrekUrl } from "../lib/github";
import { MountainIcon } from "./icons";

interface TrekListProps {
  treks: Trek[]; // capped, ranked rows
  loading: boolean;
  originName: string;
  selectedId?: string;
  onSelect(id: string): void;
  overflow: number;
  empty: boolean; // true when filters matched nothing (and not loading)
  onClearFilters(): void;
}

export default function TrekList({
  treks,
  loading,
  originName,
  selectedId,
  onSelect,
  overflow,
  empty,
  onClearFilters,
}: TrekListProps) {
  return (
    <ul className="flex-1 divide-y divide-trail-50 dark:divide-slate-700">
      {loading && (
        <>
          <li className="sr-only" role="status">
            Loading peaks near {originName}…
          </li>
          {Array.from({ length: 6 }, (_, i) => (
            <li key={`skeleton-${i}`} aria-hidden className="flex items-center gap-3 px-4 py-3">
              <div className="h-9 w-9 flex-none animate-pulse rounded bg-trail-100 dark:bg-slate-700" />
              <div className="min-w-0 flex-1">
                <div className="h-4 w-1/2 animate-pulse rounded bg-trail-100 dark:bg-slate-700" />
                <div className="mt-1.5 h-3 w-3/4 animate-pulse rounded bg-trail-100 dark:bg-slate-700" />
              </div>
            </li>
          ))}
        </>
      )}
      {empty && (
        <li className="px-4 py-8 text-center text-sm text-trail-500 dark:text-slate-400">
          <MountainIcon
            className="mx-auto mb-2 text-3xl text-trail-300 dark:text-slate-600"
            aria-hidden
          />
          No treks match. Try widening the radius or clearing filters.
          <button
            type="button"
            onClick={onClearFilters}
            className="mt-3 block w-full font-medium text-trail-700 underline hover:text-trail-900 dark:text-slate-300 dark:hover:text-slate-100"
          >
            Clear filters
          </button>
          <a
            href={suggestTrekUrl()}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block font-medium text-trail-700 underline hover:text-trail-900 dark:text-slate-300 dark:hover:text-slate-100"
          >
            Know a trek we're missing? Suggest it.
          </a>
        </li>
      )}
      {/* Skeletons REPLACE results while loading — stale rows mixed under a
          loading indicator read as current data (spec 33). */}
      {!loading &&
        treks.map((t) => (
          <li key={t.id} id={`trek-row-${t.id}`}>
            <button
              type="button"
              onClick={() => onSelect(t.id)}
              aria-current={t.id === selectedId || undefined}
              className={`flex w-full items-center gap-3 border-l-4 px-4 py-3 text-left hover:bg-trail-50 dark:hover:bg-slate-800 ${
                t.id === selectedId
                  ? "border-trail-600 bg-trail-50 dark:border-trail-400 dark:bg-slate-800"
                  : "border-transparent"
              }`}
            >
              {t.image && (
                <img
                  src={t.image.url}
                  alt=""
                  loading="lazy"
                  className="h-10 w-10 flex-none rounded object-cover"
                />
              )}
              <span className="min-w-0">
                <span className="block truncate font-medium text-trail-900 dark:text-slate-100">
                  {t.name}
                </span>
                <span className="block text-xs text-trail-500 dark:text-slate-400">
                  {t.difficulty ??
                    (t.estimatedDifficulty ? `est. ${t.estimatedDifficulty}` : "Unverified")}
                  {t.elevationM ? ` · ${t.elevationM} m` : ""}
                  {t.reliefM !== undefined
                    ? ` · ${t.reliefM} m relief`
                    : t.nearestTown
                      ? ` · ${t.nearestTown}`
                      : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      {!loading && overflow > 0 && (
        <li className="px-4 py-3 text-xs text-trail-500 dark:text-slate-400">
          +{overflow.toLocaleString()} more on the map. Zoom in, search, or filter (relief, hidden
          gems, difficulty) to narrow the list.
        </li>
      )}
    </ul>
  );
}
