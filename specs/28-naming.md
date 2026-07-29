# 28 — Naming the terrain-detected summits

## Purpose

Spec 27 found 28k summits no database lists — as "Unnamed peak (~x m)". Users want their names.
The obvious shortcut (Google Places API) is **prohibited**: Google's ToS forbids using Places
content to create or augment your own dataset, and a name in `treks.json` is exactly that. Three
legitimate mechanisms replace it.

## A. Inference from adjacent named features (779 named at build time)

A hill's name leaks into the features around it: **"Godumalai Reserved Forest" covers the summit
of Godumalai.** The cached GeoNames dump carries those features with coordinates.

`scripts/sources/nameinfer.ts` (pure, tested): only feature kinds that sit ON the hill qualify —
reserved forest, temple, shrine, pass, ridge, slope, cliff — each with its own trust radius
(0.5–0.8 km). **Villages never name a summit** (they sit at the base and share names across a
taluk). `stripFeatureSuffix` removes stacked feature-type suffixes ("X Reserved Forest Extension"
→ "X") and rejects generic remainders ("Reserved", "New").

`build:names` (hand-run, **zero network** — reads the cached dump) renames matching summits in the
committed detected subset and patches baked records; provenance always ships with the name, as
`highlights`: _"Name inferred from the adjacent 'Godumalai Reserved Forest' (GeoNames, ~0.7 km);
unverified."_ A name that no longer starts with "Unnamed" (e.g. human-supplied later) is never
overwritten. Result: **779 summits named (955 baked records)**.

## B. "Look up on Google Maps" — the ToS-clean version of the user's ask

A plain **Maps URL** (`google.com/maps/search/?api=1&query=lat,lng`) on every detected pin. No
API, no key, nothing fetched or stored: the user reads the name in Google's own product. Their
data never enters ours.

## C. "Know this hill's name?" — the loop that names the rest

A button on detected pins opening the existing feedback form (`suggest-trek`) **prefilled** with
the pin's id, coordinates and current placeholder name. People who climb these hills are the real
naming authority; each submission can be added to the manual naming path, and `build:names` will
never clobber it. This is how OSM itself got built.

## Verification

Unit: suffix stripping (stacked suffixes, generic rejection, ghat handling), `inferName` (nearest
qualifying feature, per-code radius, villages rejected), the Maps URL and suggest-button render
(and their absence on ordinary pins). Data: `validate:data` on the patched dataset.
