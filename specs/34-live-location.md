# 34 — Live-location origin & stale-persistence honesty

## Purpose

The persisted origin goes stale the moment the user travels: the app kept showing "treks near
Bengaluru" from last week's session, and Directions routed from that old origin rather than
from wherever the user actually stood. The origin should follow the user — without ever
ambushing them with a permission prompt.

## Behaviour

- **A shared URL always wins.** A deep link carrying an origin (`oid`/`olat`/…) or a selection
  (`sel`) shows exactly what was shared; no location logic runs.
- **Silent refresh, only when already trusted.** On load, if the Permissions API reports
  geolocation `granted` (the user said yes at some point), the origin is refreshed from the
  device silently. Any failure keeps the persisted origin, silently — the silent path never
  surfaces errors or prompts.
- **Soft nudge otherwise.** When permission is not granted, a dismissible banner reads
  "Seeing treks near {origin} — [Use my location] [Not now]". The button runs the same
  user-initiated flow as the header 📍 (native browser prompt allowed, errors shown inline).
  Never auto-prompts. "Not now" snoozes the nudge for 7 days (localStorage) — it must not
  re-nag every visit; the header 📍 remains the always-available path.
- **Directions route from the device, not the search origin.** The Google Maps URL omits the
  origin parameter — Maps starts from the user's live position. Browsing Himachal from a
  Bengaluru search must not produce a 2,400 km route.

## Stale data: the service worker (same complaint, other half)

The SW cached `/data/cells/*.json` cache-first — but cell names are STABLE, not hashed, and
the weekly cron rewrites them in place, so returning visitors kept their first visit's dataset
forever. Cells now use **stale-while-revalidate**: the cached cell answers instantly (offline
trailheads still work), a background refetch updates the cache, and the next load is fresh —
data is at most one visit behind. SW `VERSION` bumped to v2 to flush the old cache.
Verified live against a production build: mutate cell on disk → next load serves stale +
revalidates → following load shows the new data.

## Interfaces

- `lib/locate.ts`: `locateMe(geolocation?) → Promise<Origin>` (id `geo:<lat>,<lng>`, name
  "My location"); `geolocationGranted() → Promise<boolean>` — true ONLY for `granted`
  (missing API / `prompt` / `denied` / throw ⇒ false).
- `googleMapsDirectionsUrl(trek)` — destination-only.
- OriginSearch's 📍 button and the nudge share `locateMe`.

## Edge cases & error states

- Permissions API missing (older Safari): treated as not-granted → nudge, never silent.
- Silent locate failing (timeout, airplane mode): persisted origin stands, no error shown.
- Nudge locate failing: error inline in the banner; banner stays dismissible.
- `pickOrigin` semantics unchanged: persists the new origin, clears selection, clamps radius.

## Test cases (TDD checklist)

- Unit: `locateMe` resolves/rejects; `geolocationGranted` truth table incl. missing/throwing
  API; directions URL omits origin.
- E2E: with granted permission + faked coordinates, the app re-centres on load without any
  click; without permission, the nudge appears and "Not now" dismisses it.

## Out of scope

Continuous tracking (a one-shot load-time refresh only), reverse-geocoding the "My location"
label into a place name (Nominatim call — the 📍 flow shows the same label today), IP-based
fallback geolocation.
