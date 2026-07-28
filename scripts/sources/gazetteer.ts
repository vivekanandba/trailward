/**
 * Public-domain gazetteer parsing (spec 21). The Imperial Gazetteer of India
 * (1908) is out of copyright and hosted as OCR'd plain text on archive.org. Its
 * entries are structured — `Name.—Description…` — and frequently carry BOTH a
 * coordinate ("situated in 15° 8' N. and 76° 30' E.") and an elevation
 * ("3,256 feet"), plus descriptive detail that exists nowhere else online for
 * small South Indian hills.
 *
 * The coordinate is the whole point: it lets us VERIFY a match against our pin
 * instead of trusting a name, which is what previously caused mislabelling
 * (a neighbouring peak's article attached to the wrong hill). A candidate with
 * no parseable coordinate is never matched on name alone.
 *
 * Everything here is pure: text in, candidates out. The download shell lives in
 * scripts/build-gazetteer.ts.
 */

export interface GazetteerEntry {
  name: string;
  lat: number;
  lng: number;
  elevationFt?: number;
  text: string; // cleaned description
}

/** OCR-tolerant DMS → decimal degrees. Returns undefined if implausible. */
export function parseDms(
  deg: string,
  min: string | undefined,
  hemi: string,
  maxDeg: number,
): number | undefined {
  const d = Number(deg);
  // OCR renders minutes as 8, o, O, l/1 confusions; drop anything non-numeric.
  const m = min === undefined ? 0 : Number(min.replace(/[oO]/g, "0").replace(/[lI]/g, "1"));
  if (!Number.isFinite(d) || d < 0 || d > maxDeg) return undefined;
  const mins = Number.isFinite(m) && m >= 0 && m < 60 ? m : 0;
  const val = d + mins / 60;
  return /[SW]/i.test(hemi) ? -val : val;
}

// "situated in 15° 8' N. and 76° 30' E." — the ° and ' are frequently mangled by
// OCR, so treat any non-alphanumeric run as a possible degree/minute mark. The
// separator between the two halves is prose ("N. and 76"), so it must allow word
// characters — \W here would fail on the " and ".
const COORD_RE =
  /(\d{1,2})\s*[^\w\s]{0,3}\s*(\d{1,2})?\s*[^\w\s]{0,3}\s*([NS])\b[^\d]{1,15}?(\d{1,3})\s*[^\w\s]{0,3}\s*(\d{1,2})?\s*[^\w\s]{0,3}\s*([EW])\b/i;

/** Extract a lat/lng pair from an entry body, if one is present and plausible. */
export function parseCoords(text: string): { lat: number; lng: number } | undefined {
  const m = COORD_RE.exec(text);
  if (!m) return undefined;
  const lat = parseDms(m[1], m[2], m[3], 90);
  const lng = parseDms(m[4], m[5], m[6], 180);
  if (lat === undefined || lng === undefined) return undefined;
  // Guard the OCR: only accept coordinates that fall on the Indian subcontinent.
  if (lat < 6 || lat > 37 || lng < 66 || lng > 98) return undefined;
  return { lat, lng };
}

/** First "N,NNN feet" style elevation in the text, in feet. */
export function parseElevationFt(text: string): number | undefined {
  const m = /(\d{1,2},\d{3}|\d{3,5})\s*(?:feet|ft\b)/i.exec(text);
  if (!m) return undefined;
  const ft = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(ft) && ft > 100 && ft < 30000 ? ft : undefined;
}

// OCR artefacts we can safely repair, plus whitespace normalisation.
function cleanText(s: string): string {
  return (
    s
      .replace(/-\s*\n\s*/g, "") // de-hyphenate across line breaks
      .replace(/\s+/g, " ")
      // Drop the "situated in 12° 55^ N. and 77® 18' E." clause: we already used
      // the coordinate to verify the match, and its OCR (^, ®, mangled ° and ')
      // is pure noise to a reader.
      // The clause itself contains full stops ("N. and 77° 18' E."), so it is
      // bounded by a coordinate-shaped character class rather than [^.].
      // The terminator is often OCR'd as a comma rather than a full stop
      // ("76° 49' E," not "E."), so accept either.
      .replace(/,?\s*situated in\s+[0-9\s°'’`^®.,°NSEWand-]{5,70}?[EW][.,]\s*/i, ", ")
      .replace(/\s+([,.;:])/g, "$1")
      .replace(/,\s*,/g, ",")
      .replace(/,\s*(and\b)/gi, " $1")
      .trim()
  );
}

/**
 * Trim to at most `max` chars, ending on a sentence boundary when there is a
 * reasonable one, else on a word boundary — an excerpt must never end mid-word.
 */
export function excerpt(text: string, max = 320): string {
  const clean = cleanText(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  if (lastStop > 0) return cut.slice(0, lastStop + 1).trim();
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

// Entry heads: a capitalised name at the start of a line followed by ".—".
// Tolerates the em-dash being OCR'd as -, –, or —.
const HEAD_RE = /(?:^|\n)([A-Z][A-Za-zÀ-ɏ' -]{2,40})\.\s*[—–-]\s*/g;

/** Words that mark an entry as a district/administrative unit, not a summit. */
const ADMIN_RE = /\b(District|Tahsil|Taluka|Taluk|Subdivision|Township|State|Village|Town)\b/i;
/** Words that suggest the entry really is a hill/summit. */
const SUMMIT_RE = /\b(hill|hills|peak|mountain|range|summit|rock|ridge|plateau|fort)\b/i;

/**
 * Match gazetteer entries to treks. BOTH must agree: the names must be
 * recognisably the same AND the coordinates must be close. Gazetteer coordinates
 * are arc-minute precision (~2 km at best) and OCR adds error, so the radius is
 * generous — but a name match alone is never enough, and neither is proximity
 * alone (hills cluster). Returns the best (nearest) entry per trek id.
 */
export function matchEntries(
  entries: GazetteerEntry[],
  treks: { id: string; name: string; lat: number; lng: number; elevationM?: number }[],
  maxKm = 5,
): Map<string, GazetteerEntry> {
  const out = new Map<string, GazetteerEntry>();
  const best = new Map<string, number>();
  for (const e of entries) {
    const eKey = nameKey(e.name);
    if (eKey.length < 4) continue; // too short to be a confident name match
    for (const t of treks) {
      if (!namesAgree(eKey, nameKey(t.name))) continue;
      const km = haversineKm(e.lat, e.lng, t.lat, t.lng);
      if (km > maxKm) continue;
      if (!elevationsAgree(e.elevationFt, t.elevationM)) continue;
      if ((best.get(t.id) ?? Infinity) <= km) continue;
      best.set(t.id, km);
      out.set(t.id, e);
    }
  }
  return out;
}

const FT_TO_M = 0.3048;
/** Max metres the 1908 survey may differ from our DEM before we distrust the match. */
export const MAX_ELEV_DISAGREE_M = 150;

/**
 * Third, independent check on a match: when the entry states an elevation, it
 * should agree with our DEM. The 1908 trigonometrical survey is remarkably good
 * (Nandi Hills and Savandurga agree to within 1 m), so a large disagreement means
 * we've matched a *different* hill of a similar name. Unstated elevation → no
 * opinion, so the name+coordinate checks stand alone.
 */
export function elevationsAgree(entryFt?: number, trekM?: number): boolean {
  if (entryFt === undefined || trekM === undefined) return true;
  return Math.abs(entryFt * FT_TO_M - trekM) <= MAX_ELEV_DISAGREE_M;
}

/**
 * Normalise a name for comparison: lowercase, strip diacritics and generic
 * words, drop non-letters. "Śivagaṅga Hill" and "Shivagange" won't be equal —
 * that's deliberate; we prefer missing a match to attaching the wrong note.
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(hill|hills|peak|mountain|range|betta|malai|konda|gudda|fort)\b/g, "")
    .replace(/[^a-z]/g, "");
}

/** Same name, allowing one to be a prefix of the other (e.g. "Nandi"/"Nandidurga"). */
function namesAgree(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && long.startsWith(short);
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Split a gazetteer volume's OCR text into candidate summit entries, keeping
 * only those with a parseable coordinate and summit-ish wording.
 */
export function parseGazetteerEntries(raw: string): GazetteerEntry[] {
  const heads: { name: string; start: number; bodyStart: number }[] = [];
  HEAD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEAD_RE.exec(raw)) !== null) {
    heads.push({ name: m[1].trim(), start: m.index, bodyStart: m.index + m[0].length });
  }

  const out: GazetteerEntry[] = [];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const body = raw.slice(
      h.bodyStart,
      heads[i + 1]?.start ?? Math.min(raw.length, h.bodyStart + 2000),
    );
    // The name itself must not be an administrative unit, and the entry must
    // read like a summit (the volume is mostly districts and villages).
    if (ADMIN_RE.test(h.name)) continue;
    const head = body.slice(0, 400);
    if (!SUMMIT_RE.test(head)) continue;
    const coords = parseCoords(head);
    if (!coords) continue; // no coordinate → cannot verify → skip
    out.push({
      name: h.name,
      lat: coords.lat,
      lng: coords.lng,
      elevationFt: parseElevationFt(body),
      text: excerpt(body),
    });
  }
  return out;
}
