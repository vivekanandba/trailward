---
title: About Trailward
description: What Trailward is, how the summits were found, and what "unverified" means on a pin.
updated: 2026-09-19
---

# About Trailward

Trailward maps the hills and summits within reach of anywhere in India. Type a place, set a
radius, and every peak around it appears — ranked by terrain rather than by popularity, so the
quiet ones are as visible as the famous ones.

It is a static site. There is no account, no tracking of where you search, and no server that
holds your location: the map, the filters and the whole dataset run in your browser.

## Where the summits come from

Three layers, merged and de-duplicated.

- **Curated.** A small number of treks checked by hand, with photographs, fees, permits and
  night-trek guidance.
- **Named places.** Every summit that GeoNames, OpenStreetMap or Wikidata records in India.
  These are real, documented places, but their details are unverified.
- **Detected.** Peaks found by reading the elevation model directly, described below. Most
  have no name anywhere, because no database has ever recorded them.

## How a peak is detected without a name

The elevation tiles that render the terrain basemap also contain the raw heights. Every pixel
that stands above all eight of its neighbours is a candidate summit. Candidates are then
filtered:

- **Non-maximum suppression** keeps only the highest point within roughly 600 metres, so a
  broad massif yields one peak rather than a ridge of hundreds.
- **Local relief** — the drop to the lowest ground within a kilometre — decides whether a
  candidate is a peak, a hill, or noise. Above 150 metres of relief it reads as a peak.
- **In the high Himalaya** the thresholds rise, or every crest above 2,500 metres would qualify.
- Anything within 400 metres of a place a database already names is dropped, because the point
  of this layer is what the databases missed.

What survives is scored for ruggedness and obscurity, and placed on the map.

## What "unverified" means

Most pins carry that badge, and it is meant literally. Elevation, slope and relief are
computed from a 30-metre elevation model and can be wrong on small features. A season is
derived from rainfall, not from local knowledge. A detected peak may sit on private land, in a
restricted zone, or behind a route nobody has walked in years.

**Check locally before you set out.** Trailward tells you a hill is there and what the terrain
looks like. It does not tell you that it is safe, legal or sensible to climb.

## Naming the unnamed

Around a hundred thousand detected summits still have no name. Some genuinely have none; most
have a local name that has simply never been written into an open database. Where a name can
be inferred — from an adjacent reserved forest, a temple, or a village whose own name is a hill
word — it is applied, with the source shown on the pin.

The rest depend on people who know the hills. Every unnamed pin carries a link to suggest its
name, which arrives as an issue on the project's repository and is applied automatically.

## Sources and licences

Every source is listed on the [sources page](/trailward/sources/), with the licence it is used
under.
