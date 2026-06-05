# Trailward

> Toward the trail — an interactive map of treks within a chosen radius of any place. Bangalore by default.

Trailward is a fast, **static** single-page web app. It shows trek pins on a map, lets you set a
**radius** around an origin and **filter** by difficulty, elevation, type and more, and opens a
detail card for each trek (distance, permits, fees, best season, photo, sources). It is built to
be **hosted free on GitHub Pages** with **no backend**.

## Status

🚧 **Phase A — specs under review.** The repo is scaffolded with the full TDD framework and CI,
but feature code is intentionally **not written yet**. Development follows two gates:

1. **Spec gate** — every module is specified in [`specs/`](./specs) before any code.
2. **TDD per spec** — failing test → implement → green → refactor.

See [`specs/README.md`](./specs/README.md) for the spec index, and the approved plan for context.

## Architecture (in one breath)

A **build-time data pipeline** (Node scripts) fetches from free, no-key public APIs and scrapes a
few sources, then commits `src/data/treks.json`. The site ships that JSON statically — visitors
make no API calls except optional live extras (weather, geocoding a custom origin, peak
discovery). A **weekly GitHub Actions cron** re-runs the pipeline and commits changes, which
auto-redeploys. No server, no database.

```
scripts/* (Overpass, Open-Meteo, OSRM, Wikipedia/Commons, scrape)
        → src/data/treks.json  →  React + Leaflet static SPA  →  GitHub Pages
weekly cron (.github/workflows/refresh-data.yml) regenerates the JSON
```

## Data sources (all free, no API key)

- **Overpass / OpenStreetMap** — peak discovery within a radius
- **Open-Meteo** — elevation (Copernicus DEM) and live weather
- **OSRM** — road distance & drive time from the origin
- **Wikipedia / Wikidata** — descriptions; **Wikimedia Commons** — CC-licensed photos
- **Nominatim** — geocoding a custom origin place
- Build-time scraping (Karnataka Forest Dept / reputable trek blogs) for fees/permits/difficulty,
  with per-field source attribution. We do **not** scrape AllTrails or Google (against their ToS).

## Tech stack

Vite · React · TypeScript · Tailwind · Leaflet/react-leaflet · Vitest + React Testing Library ·
Playwright · Node/tsx pipeline scripts.

## Commands

| Command                 | What it does                                            |
| ----------------------- | ------------------------------------------------------- |
| `npm run dev`           | Start the dev server (http://localhost:5173/trailward/) |
| `npm test`              | Run unit/component tests (Vitest)                       |
| `npm run coverage`      | Tests with coverage                                     |
| `npm run e2e`           | Run Playwright end-to-end tests                         |
| `npm run build`         | Type-check + production build to `dist/`                |
| `npm run build:data`    | Regenerate `src/data/treks.json` from sources           |
| `npm run validate:data` | Validate the committed data file                        |
| `npm run quality:check` | Type-check + lint + format check                        |

## Hosting (GitHub Pages)

This repo deploys to GitHub Pages via `.github/workflows/deploy.yml`. The site lives at
`https://<your-user>.github.io/trailward/`, so `vite.config.ts` sets `base: '/trailward/'`.
The **deploy job only runs if `validate-data`, unit tests, and e2e all pass**.

To go live: push to a GitHub repo named `trailward`, then enable **Settings → Pages → Source:
GitHub Actions**. (Adding a custom domain later → set `base: '/'`.)

> Cloudflare Pages is a drop-in alternative if you ever want unlimited bandwidth.

## Feedback

The in-app feedback form uses [Web3Forms](https://web3forms.com) (no backend, free tier). Create a
free access key tied to your email and set `VITE_WEB3FORMS_KEY` (see `.env.example`).
