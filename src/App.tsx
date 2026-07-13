import { useEffect, useMemo, useRef, useState } from "react";
import treksRaw from "./data/treks.json";
import type { Trek } from "./lib/trek";
import { loadOrigin, saveOrigin } from "./lib/origin";
import { DEFAULT_FILTERS, applyFilters, type FilterState } from "./lib/filters";
import { discoverPeaks } from "./lib/overpass";
import { decodeState, encodeState } from "./lib/urlState";
import type { FeedbackKind } from "./lib/feedback";
import TrekMap from "./components/TrekMap";
import FilterBar from "./components/FilterBar";
import TrekDetail from "./components/TrekDetail";
import OriginSearch from "./components/OriginSearch";
import FeedbackForm from "./components/FeedbackForm";
import Panel from "./components/Panel";
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
    saveTheme(theme);
  }, [theme]);

  // Curated treks for this origin; otherwise discover peaks live (spec 03).
  const curated = useMemo(() => ALL_TREKS.filter((t) => t.cityId === origin.id), [origin.id]);

  // Track the current radius without re-querying Overpass on every slider nudge;
  // discovery re-runs on origin change and reads the latest radius from the ref.
  const radiusRef = useRef(filters.radiusKm);
  useEffect(() => {
    radiusRef.current = filters.radiusKm;
  }, [filters.radiusKm]);

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
    discoverPeaks(origin, radiusRef.current)
      .then((d) => active && setDiscovery(d))
      .finally(() => active && setDiscovering(false));
    return () => {
      active = false;
    };
    // Re-discover when the origin changes (not on every radius nudge).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin.id]);

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
        <ThemeToggle
          theme={theme}
          onToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        />
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Filters + list rail */}
        <aside
          ref={asideRef}
          className="order-2 flex w-full flex-col overflow-y-auto border-trail-100 dark:border-slate-700 lg:order-1 lg:w-80 lg:border-r"
        >
          <div className="border-b border-trail-100 dark:border-slate-700 p-4">
            <FilterBar
              filters={filters}
              onChange={setFilters}
              resultCount={visible.length}
              showTrailLength={showTrailLength}
              showDuration={showDuration}
            />
          </div>
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
              theme={theme}
            />
          </div>
          {selected && (
            <Panel
              onClose={() => setSelectedId(undefined)}
              labelledBy="trek-detail-title"
              className="absolute inset-y-0 right-0 z-[1000] w-full max-w-sm border-l border-trail-100 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl focus:outline-none"
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
              className="absolute inset-y-0 right-0 z-[1050] w-full max-w-sm border-l border-trail-100 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl focus:outline-none"
            >
              <FeedbackForm
                key={feedbackKind}
                initialKind={feedbackKind}
                onClose={() => setFeedbackKind(null)}
              />
            </Panel>
          )}
        </main>
      </div>
    </div>
  );
}
