import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import treksRaw from "./data/treks.json";
import type { Trek } from "./lib/trek";
import { loadOrigin, saveOrigin } from "./lib/origin";
import { DEFAULT_FILTERS, applyFilters, type FilterState } from "./lib/filters";
import { discoverPeaks } from "./lib/overpass";
import { decodeState, encodeState } from "./lib/urlState";
import { PRESET_ORIGINS } from "./lib/cities";
import type { FeedbackKind } from "./lib/feedback";
import TrekMap from "./components/TrekMap";
import FilterBar from "./components/FilterBar";
import TrekDetail from "./components/TrekDetail";
import OriginSearch from "./components/OriginSearch";
import Panel from "./components/Panel";

// The feedback panel is only mounted on demand, so its code (form, validation,
// Web3Forms client) stays out of the initial bundle.
const FeedbackForm = lazy(() => import("./components/FeedbackForm"));
import ThemeToggle from "./components/ThemeToggle";
import { loadTheme, saveTheme, applyTheme, type Theme } from "./lib/theme";

const ALL_TREKS = treksRaw as Trek[];

export default function App() {
  // Seed from the URL (shareable / reload-restorable), falling back to the
  // persisted origin and defaults (spec 03/05).
  const [initial] = useState(() => decodeState(new URLSearchParams(window.location.search)));
  const [origin, setOrigin] = useState(() => initial.origin ?? loadOrigin());
  const [filters, setFilters] = useState<FilterState>(() => initial.filters);
  const [selectedId, setSelectedId] = useState<string | undefined>(() => initial.selectedId);
  const [discovery, setDiscovery] = useState<Trek[]>([]);
  const [discovering, setDiscovering] = useState(false);
  // When set, the feedback panel is open in the given mode (spec 07).
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind | null>(null);

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

  // Curated treks for this origin; otherwise discover peaks live (spec 03).
  const curated = useMemo(() => ALL_TREKS.filter((t) => t.cityId === origin.id), [origin.id]);

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
      setFeedbackKind(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (curated.length > 0) {
      setDiscovery([]);
      return;
    }
    let active = true;
    setDiscovering(true);
    // Debounce so dragging the radius slider/ring doesn't hammer Overpass; the
    // radius genuinely changes the query, so discovery must re-run on it (the
    // empty-state even tells users to widen the radius).
    const handle = setTimeout(() => {
      discoverPeaks(origin, filters.radiusKm)
        .then((d) => active && setDiscovery(d))
        .finally(() => active && setDiscovering(false));
    }, 500);
    return () => {
      active = false;
      clearTimeout(handle);
    };
    // Re-discover on origin OR radius change (origin.id keys the origin).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin.id, filters.radiusKm]);

  const inDiscovery = curated.length === 0;
  const baseTreks = curated.length > 0 ? curated : discovery;
  const visible = useMemo(
    () => applyFilters(baseTreks, origin, filters),
    [baseTreks, origin, filters],
  );

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
  };

  // Opening the feedback panel closes any open trek detail so the two
  // right-anchored panels never stack over each other.
  const openFeedback = (kind: FeedbackKind) => {
    setSelectedId(undefined);
    setFeedbackKind(kind);
  };

  // When a dialog Panel is open, mark the rest of the app inert so assistive
  // tech and pointer/keyboard can't reach the backdrop behind the modal.
  // (`inert` isn't in this @types/react yet, so toggle the DOM property.)
  const panelOpen = Boolean(selected) || feedbackKind !== null;
  const headerRef = useRef<HTMLElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const el of [headerRef.current, asideRef.current, mapRef.current]) {
      if (el) el.inert = panelOpen;
    }
  }, [panelOpen]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header
        ref={headerRef}
        className="z-[1100] flex flex-wrap items-center gap-3 border-b border-trail-100 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>
            🥾
          </span>
          <h1 className="font-display text-xl font-bold tracking-tight text-trail-800 dark:text-slate-100">
            Trailward
          </h1>
        </div>
        <div className="ml-auto w-full max-w-md sm:w-80">
          <OriginSearch origin={origin} onPick={pickOrigin} />
        </div>
        <button
          type="button"
          onClick={() => openFeedback("feedback")}
          className="rounded-lg border border-trail-200 dark:border-slate-600 px-3 py-2 text-sm font-medium text-trail-700 dark:text-slate-300 hover:border-trail-400 dark:hover:border-slate-500 hover:bg-trail-50 dark:hover:bg-slate-800"
        >
          Feedback
        </button>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Filters + list rail */}
        <aside
          ref={asideRef}
          className="order-2 flex w-full flex-col overflow-y-auto border-trail-100 dark:border-slate-700 lg:order-1 lg:w-80 lg:border-r"
        >
          {/* Preset origin chips — quick jumps to a few regions (spec 03). */}
          <div className="flex flex-wrap gap-2 border-b border-trail-100 p-4 dark:border-slate-700">
            {PRESET_ORIGINS.map((c) => {
              const active = c.id === origin.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pickOrigin(c)}
                  aria-pressed={active}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
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
          <div className="border-b border-trail-100 dark:border-slate-700 p-4">
            <FilterBar
              filters={filters}
              onChange={setFilters}
              resultCount={visible.length}
              showTrailLength={showTrailLength}
              showDuration={showDuration}
            />
          </div>
          {inDiscovery && !discovering && visible.length > 0 && (
            <p className="border-b border-trail-100 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-slate-700 dark:bg-amber-500/10 dark:text-amber-200">
              Showing unverified community peaks near {origin.name} from OpenStreetMap.
            </p>
          )}
          <ul className="flex-1 divide-y divide-trail-50 dark:divide-slate-700">
            {discovering && (
              <li className="p-4 text-sm text-trail-500 dark:text-slate-400">
                Discovering peaks near {origin.name}…
              </li>
            )}
            {!discovering && visible.length === 0 && (
              <li className="p-4 text-sm text-trail-500 dark:text-slate-400">
                No treks match. Try widening the radius or clearing filters.
                <button
                  type="button"
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  className="mt-2 block font-medium text-trail-700 dark:text-slate-300 underline hover:text-trail-900 dark:hover:text-slate-100"
                >
                  Clear filters
                </button>
                <button
                  type="button"
                  onClick={() => openFeedback("suggest-trek")}
                  className="mt-2 block font-medium text-trail-700 dark:text-slate-300 underline hover:text-trail-900 dark:hover:text-slate-100"
                >
                  Know a trek we're missing? Suggest it.
                </button>
              </li>
            )}
            {visible.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-trail-50 dark:hover:bg-slate-800 ${
                    t.id === selectedId ? "bg-trail-50 dark:bg-slate-800" : ""
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
                      {t.difficulty ?? "Unverified"}
                      {t.elevationM ? ` · ${t.elevationM} m` : ""}
                      {t.nearestTown ? ` · ${t.nearestTown}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Map + detail */}
        <main className="relative order-1 h-[55vh] flex-1 lg:order-2 lg:h-auto">
          <div ref={mapRef} className="h-full w-full">
            <TrekMap
              origin={origin}
              radiusKm={filters.radiusKm}
              treks={visible}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRadiusChange={(km) => setFilters((f) => ({ ...f, radiusKm: km }))}
              theme={theme}
            />
          </div>
          {selected && (
            <Panel
              onClose={() => setSelectedId(undefined)}
              labelledBy="trek-detail-title"
              className="fixed inset-0 z-[1200] overflow-hidden bg-white shadow-2xl focus:outline-none dark:bg-slate-900 lg:absolute lg:inset-y-0 lg:left-auto lg:right-0 lg:z-[1000] lg:w-full lg:max-w-sm lg:border-l lg:border-trail-100 dark:lg:border-slate-700"
            >
              <TrekDetail
                trek={selected}
                origin={origin}
                onClose={() => setSelectedId(undefined)}
              />
            </Panel>
          )}
          {feedbackKind && (
            <Panel
              onClose={() => setFeedbackKind(null)}
              labelledBy="feedback-title"
              className="fixed inset-0 z-[1250] overflow-hidden bg-white shadow-2xl focus:outline-none dark:bg-slate-900 lg:absolute lg:inset-y-0 lg:left-auto lg:right-0 lg:z-[1050] lg:w-full lg:max-w-sm lg:border-l lg:border-trail-100 dark:lg:border-slate-700"
            >
              <Suspense
                fallback={
                  <p className="p-4 text-sm text-trail-500 dark:text-slate-400">Loading…</p>
                }
              >
                <FeedbackForm
                  key={feedbackKind}
                  initialKind={feedbackKind}
                  onClose={() => setFeedbackKind(null)}
                />
              </Suspense>
            </Panel>
          )}
        </main>
      </div>
    </div>
  );
}
