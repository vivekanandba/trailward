import { useEffect, useMemo, useRef, useState } from "react";
import type { Trek } from "./lib/trek";
import { loadOrigin, saveOrigin } from "./lib/origin";
import { DEFAULT_FILTERS, applyFilters, type FilterState } from "./lib/filters";
import { decodeState, encodeState } from "./lib/urlState";
import { PRESET_ORIGINS } from "./lib/cities";
import TrekMap from "./components/TrekMap";
import FilterBar from "./components/FilterBar";
import TrekDetail from "./components/TrekDetail";
import OriginSearch from "./components/OriginSearch";
import Panel from "./components/Panel";
import ThemeToggle from "./components/ThemeToggle";
import { loadTheme, saveTheme, applyTheme, type Theme } from "./lib/theme";
import { regionStats, type RegionStats } from "./lib/regionStats";
import { feedbackUrl } from "./lib/github";
import { loadTreksAround } from "./lib/cells";
import { difficultyColor } from "./lib/difficulty";
import { FilterIcon, MountainIcon } from "./components/icons";
import TrekList from "./components/TrekList";
import { Sheet } from "./components/ui/Sheet";
import { Scrim } from "./components/ui/Scrim";
import { IconButton } from "./components/ui/Button";
import { DESKTOP_QUERY, useMediaQuery } from "./lib/useMediaQuery";
import { geolocationGranted, locateMe, nudgeSnoozed, snoozeNudge } from "./lib/locate";

// Compact overview of the peaks in view (spec 15): count, a difficulty-spread
// bar (single-purpose micro-chart), highest, most-rugged, top hidden-gem.
function RegionStatsCard({ stats }: { stats: RegionStats }) {
  const { spread } = stats;
  const graded = spread.Easy + spread.Moderate + spread.Hard;
  return (
    <div className="border-b border-trail-100 px-4 py-3 text-xs dark:border-slate-700">
      <div className="flex items-center justify-between">
        <span className="font-medium text-trail-800 dark:text-slate-100">
          {stats.count} peak{stats.count === 1 ? "" : "s"} in view
        </span>
        {stats.topGem && (
          <span className="truncate pl-2 text-trail-600 dark:text-slate-400">
            top gem: {stats.topGem.name}
          </span>
        )}
      </div>
      {graded > 0 && (
        <div
          className="mt-2 flex h-2 gap-px overflow-hidden rounded-full"
          role="img"
          aria-label={`Difficulty spread: ${spread.Easy} easy, ${spread.Moderate} moderate, ${spread.Hard} hard`}
        >
          {(["Easy", "Moderate", "Hard"] as const).map((d) =>
            spread[d] > 0 ? (
              <span
                key={d}
                style={{
                  width: `${(spread[d] / graded) * 100}%`,
                  backgroundColor: difficultyColor(d),
                }}
              />
            ) : null,
          )}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-3 text-trail-600 dark:text-slate-400">
        {stats.highestM !== undefined && <span>highest {stats.highestM} m</span>}
        {stats.maxReliefM !== undefined && <span>max relief {stats.maxReliefM} m</span>}
      </div>
    </div>
  );
}

// The dataset is nationwide (spec 30) — every origin gets the same reach.
const MAX_RADIUS_KM = 500;

export default function App() {
  // Seed from the URL (shareable / reload-restorable), falling back to the
  // persisted origin and defaults (spec 03/05).
  const [initial] = useState(() => decodeState(new URLSearchParams(window.location.search)));
  const [origin, setOrigin] = useState(() => initial.origin ?? loadOrigin());
  const [filters, setFilters] = useState<FilterState>(() => initial.filters);
  const [selectedId, setSelectedId] = useState<string | undefined>(() => initial.selectedId);

  // Light/dark theme (spec 08). The initial class is set pre-paint by an inline
  // script in index.html; here we own the runtime toggle + persistence.
  const [theme, setTheme] = useState<Theme>(loadTheme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  // Persist ONLY on an explicit toggle, so a first-time visitor keeps following
  // their OS light/dark preference until they actually choose.
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    saveTheme(next);
  };

  // Live-location origin (spec 34). The persisted origin goes stale the
  // moment the user travels — refresh it from the device, but never steal a
  // shared view: a URL that carries an origin or selection always wins.
  // Silent path: only when geolocation permission is ALREADY granted (no
  // prompt possible). Otherwise a dismissible nudge offers one tap to the
  // native permission flow.
  const [locationNudge, setLocationNudge] = useState(false);
  const [nudgeError, setNudgeError] = useState<string | null>(null);
  useEffect(() => {
    if (initial.origin || initial.selectedId) return; // deep link wins
    let active = true;
    void geolocationGranted().then(async (granted) => {
      if (!active) return;
      if (granted) {
        try {
          const here = await locateMe();
          if (active) pickOrigin(here);
        } catch {
          // Silent path stays silent: keep the persisted origin.
        }
      } else if (typeof navigator !== "undefined" && navigator.geolocation && !nudgeSnoozed()) {
        setLocationNudge(true);
      }
    });
    return () => {
      active = false;
    };
    // Mount-only: this is a load-time refresh, not a tracker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const useNudgeLocation = async () => {
    try {
      setNudgeError(null);
      const here = await locateMe(); // user-initiated → native prompt is fine
      pickOrigin(here);
      setLocationNudge(false);
    } catch (err) {
      setNudgeError((err as Error).message);
    }
  };

  // Nationwide, region-free data (spec 30): fetch exactly the 1° cells the
  // current origin+radius touches — ANY searched place works, not just the
  // presets — cached per session, streamed in behind a loading state.
  const [nearbyTreks, setNearbyTreks] = useState<Trek[] | null>(null);
  const [loadingCells, setLoadingCells] = useState(true);
  useEffect(() => {
    let active = true;
    setLoadingCells(true);
    loadTreksAround(origin.lat, origin.lng, filters.radiusKm)
      .then((t) => {
        if (active) setNearbyTreks(t);
      })
      .catch(() => active && setNearbyTreks([]))
      .finally(() => active && setLoadingCells(false));
    return () => {
      active = false;
    };
  }, [origin.lat, origin.lng, filters.radiusKm]);

  // Mirror origin/filters/selection into the URL so the view is shareable and
  // survives reload. Opening the detail panel pushes a history entry (so Back
  // closes it); everything else replaces, to avoid spamming history on every
  // filter nudge.
  const prevSelectedRef = useRef(selectedId);
  const poppingRef = useRef(false); // set while applying a browser back/forward
  useEffect(() => {
    const qs = encodeState(origin, filters, selectedId);
    const url = `${window.location.pathname}?${qs}`;
    // Only a genuine user-initiated open pushes; a state change caused by
    // popstate must replace, or Forward-navigation would re-push a duplicate.
    const opening =
      !poppingRef.current && prevSelectedRef.current === undefined && selectedId !== undefined;
    prevSelectedRef.current = selectedId;
    poppingRef.current = false;
    if (opening) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, [origin, filters, selectedId]);

  // Back/forward restores the encoded view and closes any open panel.
  useEffect(() => {
    const onPop = () => {
      poppingRef.current = true;
      const s = decodeState(new URLSearchParams(window.location.search));
      if (s.origin) setOrigin(s.origin);
      setFilters(s.filters);
      setSelectedId(s.selectedId);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // A selection made on the MAP must answer in the list too: scroll its row
  // into view (spec 33). Depends on loadingCells so a DEEP-LINKED selection
  // scrolls once the rows actually exist, not before. Rows beyond the 300-row
  // cap have no row — accepted.
  useEffect(() => {
    if (!selectedId || loadingCells) return;
    document
      .getElementById(`trek-row-${selectedId}`)
      ?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [selectedId, loadingCells]);

  // Cells arrive in arbitrary order — restore the canonical ranking the list
  // cap depends on: curated first, then hidden-gem score, then relief.
  const baseTreks = useMemo(() => {
    const t = [...(nearbyTreks ?? [])];
    t.sort(
      (a, b) =>
        Number(b.tier === "curated") - Number(a.tier === "curated") ||
        (b.discoveryScore ?? -1) - (a.discoveryScore ?? -1) ||
        (b.reliefM ?? -1) - (a.reliefM ?? -1),
    );
    return t;
  }, [nearbyTreks]);
  const visible = useMemo(
    () => applyFilters(baseTreks, origin, filters),
    [baseTreks, origin, filters],
  );
  // Curated vs discovery split of what's currently on screen, so the banner can
  // say "N lesser-known peaks" whether they stand alone (a preset region) or
  // supplement curated treks (Bangalore).
  const discoveryCount = useMemo(
    () => visible.filter((t) => t.tier === "discovery").length,
    [visible],
  );
  const hasCurated = useMemo(() => visible.some((t) => t.tier === "curated"), [visible]);
  const maxRadiusKm = MAX_RADIUS_KM;
  // Terrain filters (hidden-gems / min-relief) only make sense where peaks carry
  // a score/relief; the region-stats card summarises what's in view (spec 15).
  const showTerrainFilters = useMemo(
    () => baseTreks.some((t) => t.discoveryScore !== undefined || t.reliefM !== undefined),
    [baseTreks],
  );
  const stats = useMemo(() => regionStats(visible), [visible]);
  // GeoNames listed summits can push a region past several thousand pins. The map
  // culls to the viewport, but the list rail would choke rendering them all — so
  // cap the rows (data order is curated → ranked discovery → listed, so the top
  // stays the most relevant) and tell the user the rest are on the map / behind
  // filters.
  const LIST_CAP = 300;
  const shown = useMemo(() => visible.slice(0, LIST_CAP), [visible]);
  const overflow = visible.length - shown.length;

  // Look up the selection among the currently-visible treks so the detail panel
  // closes automatically when active filters exclude the selected trek (#6).
  const selected = useMemo(() => visible.find((t) => t.id === selectedId), [visible, selectedId]);

  // Only offer the trail-length / duration filters when at least one trek in the
  // current set actually carries the field; otherwise the slider would silently
  // empty the list (spec 05). Curated Bangalore treks currently have neither.
  const showTrailLength = useMemo(
    () => baseTreks.some((t) => t.trailLengthKm !== undefined),
    [baseTreks],
  );
  const showDuration = useMemo(
    () => baseTreks.some((t) => t.durationHrs !== undefined),
    [baseTreks],
  );

  const pickOrigin = (o: typeof origin) => {
    setOrigin(o);
    saveOrigin(o);
    setSelectedId(undefined);
    if (filters.radiusKm > MAX_RADIUS_KM) setFilters((f) => ({ ...f, radiusKm: MAX_RADIUS_KM }));
  };

  // Breakpoint split is JS-driven (spec 33): the FilterBar's input ids can't
  // render twice, so mobile and desktop compose DIFFERENT trees from the same
  // pieces. Defaults to desktop where matchMedia is absent (jsdom).
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  // Mobile sheets (spec 33): results always present (non-modal), filters and
  // detail as modal layers above it.
  const [resultsSnap, setResultsSnap] = useState(1); // 0 peek · 1 half · 2 full
  const [detailSnap, setDetailSnap] = useState(0); // 0 half · 1 full
  // Every trek opens at HALF (spec 33) — a full-drag on one must not leak
  // into the next.
  useEffect(() => {
    setDetailSnap(0);
  }, [selectedId]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.difficulties.length) n++;
    if (filters.types.length) n++;
    if (filters.elevation) n++;
    if (filters.trailLengthMaxKm !== undefined) n++;
    if (filters.durationMaxHrs !== undefined) n++;
    if (filters.permitRequired !== undefined) n++;
    if (filters.nightOnly) n++;
    if (filters.hiddenGemsOnly) n++;
    if (filters.namedOnly) n++;
    if (filters.minReliefM !== undefined) n++;
    if (filters.query.trim()) n++;
    return n;
  }, [filters]);

  // When a MODAL layer is open on mobile, inert the rest of the app so
  // assistive tech / pointer can't reach the backdrop. Desktop detail stays
  // non-modal (clicking another peak switches the open detail).
  const panelOpen = Boolean(selected);
  const headerRef = useRef<HTMLElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const inert = !isDesktop && (panelOpen || filtersOpen);
    for (const el of [headerRef.current, asideRef.current, mapRef.current]) {
      if (el) el.inert = inert;
    }
  }, [panelOpen, filtersOpen, isDesktop]);
  // Reset transient mobile layers when the breakpoint flips.
  useEffect(() => {
    if (isDesktop) setFiltersOpen(false);
  }, [isDesktop]);

  const filterBar = (
    <FilterBar
      filters={filters}
      onChange={setFilters}
      resultCount={visible.length}
      showTrailLength={showTrailLength}
      showDuration={showDuration}
      maxRadiusKm={maxRadiusKm}
      showTerrainFilters={showTerrainFilters}
    />
  );

  const presetChips = (
    <div className="flex gap-2 overflow-x-auto p-3 lg:flex-wrap lg:border-b lg:border-trail-100 lg:p-4 dark:lg:border-slate-700">
      {PRESET_ORIGINS.map((c) => {
        const active = c.id === origin.id;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => pickOrigin(c)}
            aria-pressed={active}
            className={`flex-none rounded-full border px-3 py-1 text-xs transition ${
              active
                ? "border-transparent bg-trail-600 text-white shadow-sm"
                : "border-trail-200 bg-white text-trail-700 hover:border-trail-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500"
            }`}
          >
            {c.name}
          </button>
        );
      })}
    </div>
  );

  const statsAndBanner = (
    <>
      {locationNudge && (
        <div className="flex flex-wrap items-center gap-2 border-b border-trail-100 bg-trail-50 px-4 py-2 text-xs text-trail-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          <span className="min-w-0 flex-1">
            Seeing treks near <strong>{origin.name}</strong>
            {nudgeError ? ` — ${nudgeError}` : "."}
          </span>
          <button
            type="button"
            onClick={() => void useNudgeLocation()}
            className="rounded-full bg-trail-600 px-3 py-1 font-medium text-white hover:bg-trail-700"
          >
            Use my location
          </button>
          <button
            type="button"
            onClick={() => {
              snoozeNudge(); // a week of quiet — the header pin stays available
              setLocationNudge(false);
            }}
            aria-label="Dismiss location suggestion"
            className="rounded-full px-2 py-1 text-trail-500 hover:bg-trail-100 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            Not now
          </button>
        </div>
      )}
      {loadingCells && (
        // Reserve the stats card's slot so the rail doesn't jump when the
        // real card arrives (spec 33).
        <div aria-hidden className="border-b border-trail-100 px-4 py-3 dark:border-slate-700">
          <div className="h-4 w-2/3 animate-pulse rounded bg-trail-100 dark:bg-slate-700" />
          <div className="mt-2 h-2 animate-pulse rounded bg-trail-100 dark:bg-slate-700" />
        </div>
      )}
      {!loadingCells && visible.length > 0 && <RegionStatsCard stats={stats} />}
      {discoveryCount > 0 && !loadingCells && (
        <p className="border-b border-trail-100 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-slate-700 dark:bg-amber-500/10 dark:text-amber-200">
          {hasCurated
            ? `Plus ${discoveryCount} lesser-known ${discoveryCount === 1 ? "peak" : "peaks"} near ${origin.name}, ranked by terrain (relief, steepness) and how off-the-beaten-path they are — community, unverified.`
            : `Peaks near ${origin.name} ranked by terrain (relief, steepness) and how off-the-beaten-path they are — community, unverified.`}
        </p>
      )}
    </>
  );

  const trekList = (
    <TrekList
      treks={shown}
      loading={loadingCells}
      originName={origin.name}
      selectedId={selectedId}
      onSelect={setSelectedId}
      overflow={overflow}
      empty={!loadingCells && visible.length === 0}
      onClearFilters={() => setFilters(DEFAULT_FILTERS)}
    />
  );

  const trekMap = (
    <TrekMap
      origin={origin}
      radiusKm={filters.radiusKm}
      treks={visible}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onRadiusChange={(km) => setFilters((f) => ({ ...f, radiusKm: km }))}
      maxRadiusKm={maxRadiusKm}
      theme={theme}
    />
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header
        ref={headerRef}
        className="flex flex-wrap items-center gap-3 border-b border-trail-100 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-center gap-2">
          <MountainIcon className="text-2xl text-trail-600 dark:text-trail-400" aria-hidden />
          <h1 className="font-display text-xl font-bold tracking-tight text-trail-800 dark:text-slate-100">
            Trailward
          </h1>
        </div>
        <div className="ml-auto w-full max-w-md sm:w-80">
          <OriginSearch origin={origin} onPick={pickOrigin} />
        </div>
        {/* Feedback lives in GitHub Issues (spec 29) — prefilled, zero infra.
            On mobile it moves into the results sheet footer to keep one row. */}
        {isDesktop && (
          <a
            href={feedbackUrl()}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-trail-200 px-3 py-2 text-sm font-medium text-trail-700 hover:border-trail-400 hover:bg-trail-50 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800"
          >
            Feedback
          </a>
        )}
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </header>

      {isDesktop ? (
        /* Desktop: rail + map, detail as a non-modal slide-over with a visual scrim. */
        <div className="flex min-h-0 flex-1 flex-row">
          <aside
            ref={asideRef}
            className="flex min-h-0 w-80 flex-none flex-col overflow-y-auto border-r border-trail-100 dark:border-slate-700"
          >
            {presetChips}
            <div className="border-b border-trail-100 p-4 dark:border-slate-700">{filterBar}</div>
            {statsAndBanner}
            {trekList}
          </aside>

          <main className="relative min-h-0 flex-1">
            <div ref={mapRef} className="h-full w-full">
              {trekMap}
            </div>
            {selected && (
              <>
                {/* Visual-only frosting over the MAP (spec 33): the panel reads
                    as a layer, while pins stay clickable to switch the detail. */}
                <Scrim pointerEvents={false} className="absolute inset-0 z-[1001]" />
                <Panel
                  onClose={() => setSelectedId(undefined)}
                  labelledBy="trek-detail-title"
                  modal={false}
                  className="panel-enter absolute inset-y-0 right-0 z-[1010] w-full max-w-sm overflow-hidden border-l border-trail-100 bg-white shadow-2xl focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                >
                  <TrekDetail
                    trek={selected}
                    origin={origin}
                    onClose={() => setSelectedId(undefined)}
                  />
                </Panel>
              </>
            )}
          </main>
        </div>
      ) : (
        /* Mobile: full-height map behind a results sheet; filters and detail
           are modal sheet layers (spec 33 / spec 08's bottom-sheet contract). */
        <div className="relative min-h-0 flex-1">
          <div ref={mapRef} className="h-full w-full">
            {trekMap}
          </div>

          <Sheet
            snapPoints={[0.22, 0.55, 0.92]}
            snap={resultsSnap}
            onSnapChange={setResultsSnap}
            labelledBy="results-sheet-title"
          >
            <div className="flex items-center justify-between gap-2 border-b border-trail-100 px-4 pb-2 dark:border-slate-700">
              <h2
                id="results-sheet-title"
                className="text-sm font-semibold text-trail-800 dark:text-slate-100"
              >
                {loadingCells ? `Searching near ${origin.name}…` : `${visible.length} treks`}
              </h2>
              <IconButton
                aria-label={`Filters${activeFilterCount ? ` (${activeFilterCount} active)` : ""}`}
                variant="secondary"
                onClick={() => setFiltersOpen(true)}
                className="relative"
              >
                <FilterIcon />
                {activeFilterCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-trail-600 px-1 text-[11px] font-bold text-white">
                    {activeFilterCount}
                  </span>
                )}
              </IconButton>
            </div>
            {presetChips}
            {statsAndBanner}
            {trekList}
            <div className="border-t border-trail-100 p-4 text-center dark:border-slate-700">
              <a
                href={feedbackUrl()}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-trail-700 underline dark:text-slate-300"
              >
                Feedback
              </a>
            </div>
          </Sheet>

          {filtersOpen && (
            <Sheet
              snapPoints={[0.92]}
              snap={0}
              onSnapChange={() => {}}
              modal
              onClose={() => setFiltersOpen(false)}
              labelledBy="filters-sheet-title"
            >
              <div className="px-4 pb-6">
                <h2
                  id="filters-sheet-title"
                  className="pb-3 text-sm font-semibold text-trail-800 dark:text-slate-100"
                >
                  Filters
                </h2>
                {filterBar}
              </div>
            </Sheet>
          )}

          {selected && (
            <Sheet
              snapPoints={[0.55, 0.92]}
              snap={detailSnap}
              onSnapChange={setDetailSnap}
              modal
              onClose={() => setSelectedId(undefined)}
              labelledBy="trek-detail-title"
            >
              <TrekDetail
                trek={selected}
                origin={origin}
                onClose={() => setSelectedId(undefined)}
              />
            </Sheet>
          )}
        </div>
      )}
    </div>
  );
}
