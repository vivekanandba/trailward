import { useEffect, useRef, useState } from "react";
import type { Origin } from "../lib/trek";
import { geocode, type GeocodeResult } from "../lib/geocode";

interface OriginSearchProps {
  origin: Origin;
  onPick(origin: Origin): void;
}

export default function OriginSearch({ origin, onPick }: OriginSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1); // highlighted option for keyboard nav
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced geocode (Nominatim policy: ≥400 ms between calls).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      const r = await geocode(q);
      setResults(r);
      setActive(-1);
      setOpen(true);
      setLoading(false);
    }, 450);
    return () => clearTimeout(handle);
  }, [query]);

  // Close the dropdown on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const pick = (r: GeocodeResult) => {
    onPick({
      id: `geo:${r.lat.toFixed(4)},${r.lng.toFixed(4)}`,
      name: r.name,
      lat: r.lat,
      lng: r.lng,
    });
    setQuery("");
    setResults([]);
    setActive(-1);
    setOpen(false);
  };

  // Keyboard navigation for the results listbox (arrow keys / Enter / Escape).
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open && active >= 0) {
      e.preventDefault();
      pick(results[active]);
    }
  };

  // Geolocation origin — "peaks near me" (spec 13). Reuses the arbitrary-origin
  // path (live discovery); handles denial/unsupported/timeout inline.
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setGeoError("Location isn't available on this device.");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude: lat, longitude: lng } = pos.coords;
        onPick({ id: `geo:${lat.toFixed(4)},${lng.toFixed(4)}`, name: "My location", lat, lng });
        setQuery("");
        setOpen(false);
      },
      () => {
        setLocating(false);
        setGeoError("Couldn't get your location.");
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  };

  const listboxId = "origin-listbox";

  return (
    <div ref={boxRef} className="relative">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={`Origin: ${origin.name} — search another place…`}
        aria-label="Search for an origin place"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `origin-opt-${active}` : undefined}
        className="w-full rounded-lg border border-trail-200 dark:border-slate-600 bg-white dark:bg-slate-900 py-2 pl-3 pr-11 text-sm shadow-sm focus:border-trail-500 focus:outline-none focus:ring-2 focus:ring-trail-300"
      />
      <button
        type="button"
        onClick={useMyLocation}
        disabled={locating}
        aria-label="Use my location"
        title="Use my location"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-base leading-none text-trail-600 hover:bg-trail-50 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        {locating ? "…" : "📍"}
      </button>
      {geoError && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
          {geoError}
        </p>
      )}
      {open && (results.length > 0 || (!loading && query.trim().length >= 3)) && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-[1200] mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-trail-200 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-lg"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-trail-500 dark:text-slate-400">
              No place found.
            </li>
          ) : (
            results.map((r, i) => (
              <li
                key={r.displayName}
                role="option"
                id={`origin-opt-${i}`}
                aria-selected={i === active}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => pick(r)}
                  onMouseEnter={() => setActive(i)}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-trail-50 dark:hover:bg-slate-800 ${
                    i === active ? "bg-trail-50 dark:bg-slate-800" : ""
                  }`}
                >
                  <span className="font-medium text-trail-900 dark:text-slate-100">{r.name}</span>
                  <span className="block truncate text-xs text-trail-500 dark:text-slate-400">
                    {r.displayName}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
