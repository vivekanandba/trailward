/**
 * ⌘K command palette (spec 38). Finds any of the ~19k NAMED summits, not just
 * the rows loaded around the current origin, and moves the map there.
 *
 * The index is fetched lazily on first open and cached for the session — it is
 * ~450 KB gzipped and has no business in the initial bundle. Renders nothing
 * when closed.
 */
import { useEffect, useRef, useState } from "react";
import { searchIndex, type IndexEntry } from "../lib/search";
import { useDialogFocus } from "../lib/useDialogFocus";
import { Scrim } from "./ui/Scrim";

interface CommandPaletteProps {
  open: boolean;
  onClose(): void;
  onChoose(entry: IndexEntry): void;
  /** Injectable for tests; defaults to fetching the committed index. */
  loadIndex?: () => Promise<IndexEntry[]>;
}

const base = (): string => {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  return (env?.BASE_URL ?? "/").replace(/\/$/, "");
};

let cached: IndexEntry[] | null = null;

async function defaultLoad(): Promise<IndexEntry[]> {
  if (cached) return cached;
  const res = await fetch(`${base()}/data/search-index.json`);
  if (!res.ok) throw new Error(`index ${res.status}`);
  const body: unknown = await res.json();
  // Validate BEFORE caching: a truncated or unexpected response would
  // otherwise be cached as a success for the rest of the session, and the
  // retry path (remounting the palette) could never recover from it.
  if (!Array.isArray(body) || body.length === 0 || typeof body[0]?.name !== "string") {
    throw new Error("search index is malformed");
  }
  cached = body as IndexEntry[];
  return cached;
}

export default function CommandPalette({
  open,
  onClose,
  onChoose,
  loadIndex = defaultLoad,
}: CommandPaletteProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<IndexEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);

  useDialogFocus(ref, { trap: true, onClose });

  // useDialogFocus focuses the dialog container; for a palette the caret
  // belongs in the input, or the user must Tab before they can type.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Lazy: the index is only worth its bytes once somebody actually searches.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadIndex()
      .then((i) => alive && setIndex(i))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const results = index ? searchIndex(index, query) : [];
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      onChoose(results[active]);
    }
  };

  const message = failed
    ? "Couldn't load the search index — check your connection."
    : query.trim() && index && results.length === 0
      ? "Nothing matches — try a name like 'Savandurga' or 'Kumara'."
      : "";

  return (
    <>
      <Scrim onClick={onClose} className="fixed inset-0 z-[1290]" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Search summits"
        tabIndex={-1}
        className="fixed left-1/2 top-[12vh] z-[1300] w-[min(36rem,92vw)] -translate-x-1/2 overflow-hidden rounded-xl bg-white shadow-2xl focus:outline-none dark:bg-slate-900"
      >
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="palette-results"
          aria-label="Search summits by name"
          aria-autocomplete="list"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search any summit in India…"
          className="w-full border-b border-trail-100 bg-transparent px-4 py-3.5 text-base outline-none dark:border-slate-700"
        />
        {results.length > 0 && (
          <ul id="palette-results" role="listbox" className="max-h-80 overflow-y-auto">
            {results.map((e, i) => (
              <li key={e.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onChoose(e)}
                  className={`flex w-full items-baseline justify-between gap-3 px-4 py-2.5 text-left ${
                    i === active ? "bg-trail-50 dark:bg-slate-800" : ""
                  }`}
                >
                  <span className="truncate font-medium text-trail-900 dark:text-slate-100">
                    {e.name}
                  </span>
                  {e.elevationM !== undefined && (
                    <span className="flex-none text-xs tabular-nums text-trail-500 dark:text-slate-400">
                      {e.elevationM} m
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {message && (
          <p role="status" className="px-4 py-3 text-sm text-trail-500 dark:text-slate-400">
            {message}
          </p>
        )}
        <p className="border-t border-trail-100 px-4 py-2 text-xs text-trail-400 dark:border-slate-700 dark:text-slate-500">
          ↑↓ navigate · enter open · esc close
        </p>
      </div>
    </>
  );
}
