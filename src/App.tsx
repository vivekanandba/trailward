import { useEffect, useMemo, useState } from "react";
import treksRaw from "./data/treks.json";
import type { Trek } from "./lib/trek";
import { loadOrigin, saveOrigin } from "./lib/origin";
import { DEFAULT_FILTERS, applyFilters, type FilterState } from "./lib/filters";
import { discoverPeaks } from "./lib/overpass";
import TrekMap from "./components/TrekMap";
import FilterBar from "./components/FilterBar";
import TrekDetail from "./components/TrekDetail";
import OriginSearch from "./components/OriginSearch";

const ALL_TREKS = treksRaw as Trek[];

export default function App() {
  const [origin, setOrigin] = useState(loadOrigin);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [discovery, setDiscovery] = useState<Trek[]>([]);
  const [discovering, setDiscovering] = useState(false);

  // Curated treks for this origin; otherwise discover peaks live (spec 03).
  const curated = useMemo(() => ALL_TREKS.filter((t) => t.cityId === origin.id), [origin.id]);

  useEffect(() => {
    if (curated.length > 0) {
      setDiscovery([]);
      return;
    }
    let active = true;
    setDiscovering(true);
    discoverPeaks(origin, filters.radiusKm)
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

  const selected = useMemo(
    () => baseTreks.find((t) => t.id === selectedId),
    [baseTreks, selectedId],
  );

  const pickOrigin = (o: typeof origin) => {
    setOrigin(o);
    saveOrigin(o);
    setSelectedId(undefined);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="z-[1100] flex flex-wrap items-center gap-3 border-b border-trail-100 bg-white px-4 py-3 shadow-sm">
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
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Filters + list rail */}
        <aside className="order-2 flex w-full flex-col border-trail-100 lg:order-1 lg:w-80 lg:border-r">
          <div className="border-b border-trail-100 p-4">
            <FilterBar filters={filters} onChange={setFilters} resultCount={visible.length} />
          </div>
          <ul className="flex-1 divide-y divide-trail-50 overflow-y-auto">
            {discovering && (
              <li className="p-4 text-sm text-trail-500">Discovering peaks near {origin.name}…</li>
            )}
            {!discovering && visible.length === 0 && (
              <li className="p-4 text-sm text-trail-500">
                No treks match. Try widening the radius or clearing filters.
              </li>
            )}
            {visible.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={`block w-full px-4 py-3 text-left hover:bg-trail-50 ${
                    t.id === selectedId ? "bg-trail-50" : ""
                  }`}
                >
                  <span className="font-medium text-trail-900">{t.name}</span>
                  <span className="block text-xs text-trail-500">
                    {t.difficulty ?? "Unverified"}
                    {t.elevationM ? ` · ${t.elevationM} m` : ""}
                    {t.nearestTown ? ` · ${t.nearestTown}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Map + detail */}
        <main className="relative order-1 h-[55vh] flex-1 lg:order-2 lg:h-auto">
          <TrekMap
            origin={origin}
            radiusKm={filters.radiusKm}
            treks={visible}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          {selected && (
            <div className="absolute inset-y-0 right-0 z-[1000] w-full max-w-sm border-l border-trail-100 bg-white shadow-xl">
              <TrekDetail
                trek={selected}
                origin={origin}
                onClose={() => setSelectedId(undefined)}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
