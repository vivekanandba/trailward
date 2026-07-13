import { useEffect, useMemo, useRef, useState } from "react";
import treksRaw from "./data/treks.json";
import type { Trek } from "./lib/trek";
import { loadOrigin, saveOrigin } from "./lib/origin";
import { DEFAULT_FILTERS, applyFilters, type FilterState } from "./lib/filters";
import { discoverPeaks } from "./lib/overpass";
import type { FeedbackKind } from "./lib/feedback";
import TrekMap from "./components/TrekMap";
import FilterBar from "./components/FilterBar";
import TrekDetail from "./components/TrekDetail";
import OriginSearch from "./components/OriginSearch";
import FeedbackForm from "./components/FeedbackForm";
import Panel from "./components/Panel";

const ALL_TREKS = treksRaw as Trek[];

export default function App() {
  const [origin, setOrigin] = useState(loadOrigin);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [discovery, setDiscovery] = useState<Trek[]>([]);
  const [discovering, setDiscovering] = useState(false);
  // When set, the feedback panel is open in the given mode (spec 07).
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind | null>(null);

  // Curated treks for this origin; otherwise discover peaks live (spec 03).
  const curated = useMemo(() => ALL_TREKS.filter((t) => t.cityId === origin.id), [origin.id]);

  // Track the current radius without re-querying Overpass on every slider nudge;
  // discovery re-runs on origin change and reads the latest radius from the ref.
  const radiusRef = useRef(filters.radiusKm);
  useEffect(() => {
    radiusRef.current = filters.radiusKm;
  }, [filters.radiusKm]);

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
        className="z-[1100] flex flex-wrap items-center gap-3 border-b border-trail-100 bg-white px-4 py-3 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>
            🥾
          </span>
          <h1 className="font-display text-xl font-bold tracking-tight text-trail-800">
            Trailward
          </h1>
        </div>
        <div className="ml-auto w-full max-w-md sm:w-80">
          <OriginSearch origin={origin} onPick={pickOrigin} />
        </div>
        <button
          type="button"
          onClick={() => openFeedback("feedback")}
          className="rounded-lg border border-trail-200 px-3 py-2 text-sm font-medium text-trail-700 hover:border-trail-400 hover:bg-trail-50"
        >
          Feedback
        </button>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Filters + list rail */}
        <aside
          ref={asideRef}
          className="order-2 flex w-full flex-col overflow-y-auto border-trail-100 lg:order-1 lg:w-80 lg:border-r"
        >
          <div className="border-b border-trail-100 p-4">
            <FilterBar
              filters={filters}
              onChange={setFilters}
              resultCount={visible.length}
              showTrailLength={showTrailLength}
              showDuration={showDuration}
            />
          </div>
          <ul className="flex-1 divide-y divide-trail-50">
            {discovering && (
              <li className="p-4 text-sm text-trail-500">Discovering peaks near {origin.name}…</li>
            )}
            {!discovering && visible.length === 0 && (
              <li className="p-4 text-sm text-trail-500">
                No treks match. Try widening the radius or clearing filters.
                <button
                  type="button"
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  className="mt-2 block font-medium text-trail-700 underline hover:text-trail-900"
                >
                  Clear filters
                </button>
                <button
                  type="button"
                  onClick={() => openFeedback("suggest-trek")}
                  className="mt-2 block font-medium text-trail-700 underline hover:text-trail-900"
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
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-trail-50 ${
                    t.id === selectedId ? "bg-trail-50" : ""
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
                    <span className="block truncate font-medium text-trail-900">{t.name}</span>
                    <span className="block text-xs text-trail-500">
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
            />
          </div>
          {selected && (
            <Panel
              onClose={() => setSelectedId(undefined)}
              labelledBy="trek-detail-title"
              className="absolute inset-y-0 right-0 z-[1000] w-full max-w-sm border-l border-trail-100 bg-white shadow-xl focus:outline-none"
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
              className="absolute inset-y-0 right-0 z-[1050] w-full max-w-sm border-l border-trail-100 bg-white shadow-xl focus:outline-none"
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
