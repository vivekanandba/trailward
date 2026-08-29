# 34 — Live-location origin & stale-origin honesty

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
  Never auto-prompts.
- **Directions route from the device, not the search origin.** The Google Maps URL omits the
  origin parameter — Maps starts from the user's live position. Browsing Himachal from a
  Bengaluru search must not produce a 2,400 km route.

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
