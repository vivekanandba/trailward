# 43 — The PWA: provable, installable, and honest about offline

## Purpose

Trailward has shipped a manifest and a hand-written service worker since spec 00, and neither
has ever been executed by a test. No spec describes them, no unit test touches them, no e2e
loads the manifest — and `src/main.tsx`, which holds the registration, is one of only two
files excluded from coverage. After specs 39–42 made the build tools, the sources and the
delivery path provable, this is the one subsystem where a regression is silent.

It is also the subsystem a user notices first: an installed app that opens blank offline is
worse than no app at all.

## A. What the worker does, and why

Unchanged from the existing design, recorded here because it was never written down:

| Request           | Strategy                     | Why                                                                                                                                                     |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigations       | network-first → cached shell | a deploy propagates on the next online visit; the app still opens at a signal-less trailhead                                                            |
| Hashed `assets/*` | cache-first                  | the hash makes them immutable                                                                                                                           |
| `data/**`         | stale-while-revalidate       | filenames are **stable** and the weekly cron rewrites them in place, so cache-first would pin the first visit's dataset forever                         |
| the app ROOT only | becomes the offline shell    | caching _every_ navigation made a generated trek page the shell, and a trek page references no bundled assets — so the next prune deleted the whole app |
| `version.json`    | network-first                | it exists to say which build is live; a cached one answers the wrong question                                                                           |
| Cross-origin      | untouched                    | see §D                                                                                                                                                  |

## B. The update path

A worker must **not** call `skipWaiting()` here. The activate handler prunes hashed assets the
current shell no longer references, so a worker that takes over immediately prunes assets a
page still running may need — offline, that is a dead app rather than a re-fetch.

An earlier draft of this spec justified it with "the app lazy-loads the command palette". **That
was wrong**: there are no lazy chunks, the palette is imported statically, and the build emits
three hashed assets plus two fonts, all referenced from the shell. The real exposure is the
two `.woff2` files, which are referenced from the CSS and not the HTML — and, until the fix
below, _everything_, because any navigation could become the cached shell.

So: a new worker **waits**, the page notices one is waiting and offers to reload, and the swap
happens on the user's terms. The old page keeps the cache that matches it for as long as it
lives.

## C. Installability

The manifest must carry a stable `id` — without one, identity derives from `start_url`, and
changing that later produces a second installed app rather than an update. Every icon the
manifest names must exist: a manifest that promises an icon which 404s is an install dialog
with a broken image, and nothing checked this.

**Not yet implemented — phase 2.** The app should offer its own install control rather than
relying on the browser's heuristics, hidden once `display-mode: standalone` matches, and the
manifest should carry `screenshots` for a richer Android install dialog.

## D. Offline, and its honest limit — **not yet implemented, phase 3**

Recorded here as the agreed design; none of it is in the code today. What ships now is the
opportunistic caching in §A plus a precached cell index, so a first visit leaves something
usable behind.

Downloading an area caches **our data** — the cells for the current radius — and not the
basemap. Tiles come from CARTO and OpenTopoMap, whose usage policies exist to forbid exactly
the bulk pyramid fetch that "download the map" would mean. This project already declines to
fetch AllTrails and Google Maps on those grounds (spec 02); the same standard applies to a
provider that is generously serving us tiles for free.

So offline gives the full trek list, every detail, search, and correctly positioned pins on an
empty canvas. Tiles already viewed remain in the browser's own cache. **The UI says this
plainly** rather than letting someone discover it on a hill (CON-DATA-001: state what is
known, do not let an absence read as a promise).

A deliberately downloaded area lives in its **own cache**, because the activate handler deletes
every cache but the current one — an area downloaded before a deploy must survive it.

## Edge cases & error states

- The prune must do **nothing** when it cannot see a shell that references anything. An empty
  live set means a missing or unreadable shell, and pruning on that basis deletes the entire
  app — offline, a blank screen.
- The precached cell index must be verified to be JSON. A static host answers an unknown path
  with the SPA shell (200 `text/html`), so a drifted path would otherwise store HTML under a
  `.json` URL and an offline first visit would get a 200 that `JSON.parse` rejects.
- The page reloads on `controllerchange` **only when it asked for the swap**. Keying it on
  "was a controller present at startup" is broken: a first install's `clients.claim()` fires
  `controllerchange` too, and a one-shot guard spent there leaves the real update unable to
  reload for the life of that page.
- _(phase 3)_ A quota error mid-download leaves a **partial** area, and it must report as
  partial. An area that says "ready" and is not is the failure that feature exists to prevent.
- _(phase 3)_ Storage usage is read from `navigator.storage.estimate()`, not from our own
  arithmetic — our sum is what we asked for, not what the browser kept.
- A worker that fails to register (unsupported, blocked, private mode) degrades to a normal
  web app. It must never block first paint.
- `dev` must never register a worker; a stale cache in development wastes hours.

## Test cases (TDD checklist)

Exercised in the **`static`** Playwright project, against a real production build under
`vite preview` — a service worker cannot be tested honestly against the dev server:

- the manifest parses, and **every icon URL it names returns 200**;
- the worker reaches `activated`, and `dev` registers none;
- **offline reload renders the app** — load, go offline, reload;
- a `data/` cell viewed online is served offline from cache;
- `version.json` is _not_ served from cache after it changes;
  The worker's **policy** is unit-tested by loading the real `public/sw.js` into a fake
  `ServiceWorkerGlobalScope` and driving its handlers. That is not belt-and-braces: review
  proved that re-adding `skipWaiting()` — reverting the one change §B is about — and deleting
  the `SKIP_WAITING` handler were both invisible to the browser-level gate, because the
  page-side test asserts only that we _post_ the message and nothing asserted the worker acts on
  it (CON-COV-003 from one side only). Asserted there: no `skipWaiting` on install, `skipWaiting`
  on the message and only that message, `claim` on activate, root-only shell caching, prune
  keeps CSS-referenced fonts, prune does nothing on an empty live set, `version.json` untouched,
  cross-origin untouched.

_(phase 3)_ Unit-tested as pure functions, outside the worker: which cells a radius needs, the
size estimate, the budget cap, and the partial-on-quota outcome.

## Out of scope

Caching basemap tiles (§D). Background sync. Push notifications. A worker build plugin — the
worker is ~200 lines of deliberate policy and a plugin would hide it.
