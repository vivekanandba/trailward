// Encode/decode the shareable app state (origin, filters, selected trek) to and
// from URL query params, so a view is deep-linkable and survives reload. Pure —
// the App wires these to window.history (spec 03/05).
import { DEFAULT_FILTERS, type FilterState } from "./filters";
import type { Difficulty, Origin, TrekType } from "./trek";

const DIFFICULTIES: Difficulty[] = ["Easy", "Moderate", "Hard"];
const TYPES: TrekType[] = ["Hill", "Monolith", "Cave", "Fort", "Pilgrimage"];

export interface UrlState {
  origin?: Origin; // undefined when the URL carries no origin
  filters: FilterState;
  selectedId?: string;
}

/** Serialise state to a query string, omitting anything at its default. */
export function encodeState(origin: Origin, filters: FilterState, selectedId?: string): string {
  const p = new URLSearchParams();
  // Origin: keep all four fields so the exact origin (incl. its id, which
  // selects curated vs discovery data) round-trips.
  p.set("oid", origin.id);
  p.set("olat", origin.lat.toFixed(5));
  p.set("olng", origin.lng.toFixed(5));
  p.set("on", origin.name);

  if (filters.radiusKm !== DEFAULT_FILTERS.radiusKm) p.set("r", String(filters.radiusKm));
  if (filters.difficulties.length) p.set("d", filters.difficulties.join(","));
  if (filters.types.length) p.set("t", filters.types.join(","));
  if (filters.elevation) p.set("e", `${filters.elevation[0]}-${filters.elevation[1]}`);
  if (filters.trailLengthMaxKm !== undefined) p.set("tl", String(filters.trailLengthMaxKm));
  if (filters.durationMaxHrs !== undefined) p.set("du", String(filters.durationMaxHrs));
  if (filters.permitRequired !== undefined) p.set("p", filters.permitRequired ? "1" : "0");
  if (filters.nightOnly) p.set("n", "1");
  if (filters.query.trim()) p.set("q", filters.query.trim());
  if (selectedId) p.set("sel", selectedId);

  return p.toString();
}

/** Parse state back out of query params; unknown/invalid values fall to defaults. */
export function decodeState(params: URLSearchParams): UrlState {
  let origin: Origin | undefined;
  const oid = params.get("oid");
  const on = params.get("on");
  const olat = Number(params.get("olat"));
  const olng = Number(params.get("olng"));
  if (oid && on && Number.isFinite(olat) && Number.isFinite(olng)) {
    origin = { id: oid, name: on, lat: olat, lng: olng };
  }

  const filters: FilterState = { ...DEFAULT_FILTERS, difficulties: [], types: [] };
  const r = Number(params.get("r"));
  if (params.get("r") !== null && Number.isFinite(r) && r > 0) filters.radiusKm = r;

  const d = params.get("d");
  if (d) {
    filters.difficulties = d
      .split(",")
      .filter((x): x is Difficulty => (DIFFICULTIES as string[]).includes(x));
  }
  const t = params.get("t");
  if (t) {
    filters.types = t.split(",").filter((x): x is TrekType => (TYPES as string[]).includes(x));
  }
  const e = params.get("e");
  if (e) {
    const [mn, mx] = e.split("-").map(Number);
    if (Number.isFinite(mn) && Number.isFinite(mx)) filters.elevation = [mn, mx];
  }
  const tl = params.get("tl");
  if (tl !== null && Number.isFinite(Number(tl))) filters.trailLengthMaxKm = Number(tl);
  const du = params.get("du");
  if (du !== null && Number.isFinite(Number(du))) filters.durationMaxHrs = Number(du);
  const p = params.get("p");
  if (p === "1") filters.permitRequired = true;
  else if (p === "0") filters.permitRequired = false;
  if (params.get("n") === "1") filters.nightOnly = true;
  const q = params.get("q");
  if (q) filters.query = q;

  return { origin, filters, selectedId: params.get("sel") ?? undefined };
}
