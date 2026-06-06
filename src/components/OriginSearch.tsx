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
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced geocode (Nominatim policy: ≥400 ms between calls).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      const r = await geocode(q);
      setResults(r);
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
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder={`Origin: ${origin.name} — search another place…`}
        aria-label="Search for an origin place"
        className="w-full rounded-lg border border-trail-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-trail-500 focus:outline-none focus:ring-2 focus:ring-trail-300"
      />
      {open && (results.length > 0 || (!loading && query.trim().length >= 3)) && (
        <ul className="absolute z-[1000] mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-trail-200 bg-white shadow-lg">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-trail-500">No place found.</li>
          ) : (
            results.map((r) => (
              <li key={r.displayName}>
                <button
                  type="button"
                  onClick={() => pick(r)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-trail-50"
                >
                  <span className="font-medium text-trail-900">{r.name}</span>
                  <span className="block truncate text-xs text-trail-500">{r.displayName}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
