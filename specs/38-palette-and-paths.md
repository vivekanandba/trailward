# 38 — Command palette and guided paths

## Purpose

Two navigation problems the filter rail does not solve.

**Finding one known thing.** With 19,351 named summits, a user who knows what they want
("Kumara Parvatha") must type into a filter that searches only the ~300 rows currently loaded
around their origin. If the peak is in another state, it simply is not there. A palette that
searches a committed name index finds it and moves the map to it.

**Not knowing what you want.** A first-time visitor sees 600 pins near Bengaluru and no way in.
Curated starting points — "a sunrise trek", "my first hill", "something hard" — answer the
question the filters assume you can already phrase.

## A. Command palette

- Opened with **⌘K / Ctrl-K**, or a visible control (keyboard-only affordances are invisible).
- Searches a **committed index** (`public/data/search-index.json`), built at the same time as
  the cells: `{ id, name, slug, lat, lng, elevationM, state? }` for every NAMED trek, so the
  ~101k "Unnamed" pins never pollute results. Fetched lazily on first open, then cached — it
  must not enter the initial bundle.
- Substring match over a pre-lowercased haystack of name + alternate names, ranked
  prefix-match first, then by terrain score; capped at 8 rows. No search dependency: the
  corpus is one array and the match is predictable.
- Choosing a result sets the origin to that summit's location _and_ selects it, so the map
  moves there — the palette is navigation, not just filtering.
- Full keyboard: ↑↓ move, Enter chooses, Esc closes. Focus is saved on open, trapped while
  open (the input is the only tabbable control) and restored on close — `aria-modal` is a
  claim; those effects are what make it true.
- Renders nothing when closed: no DOM cost, and no behaviour to go wrong without JavaScript.

## B. Guided paths

Curated entry points, authored as data, each a filter preset plus a one-line reason:

| Path           | What it sets                                        |
| -------------- | --------------------------------------------------- |
| Sunrise trek   | night-trek treks, moderate or easier, within 100 km |
| My first hill  | Easy, relief under 300 m, named pins only           |
| Something hard | Hard, relief over 500 m                             |
| Hidden gems    | hidden-gems filter, named pins only                 |

- Shown as chips when the result list is at its default (they are an answer to "where do I
  start", not a permanent fixture).
- Choosing one applies its filters and announces the new count through the existing live
  region; the URL updates as with any other filter change, so a path is shareable.
- Purely a filter preset: nothing a user cannot then adjust, and nothing that hides data.

## Edge cases & error states

- The index fails to load (offline, cold cache): the palette says so and falls back to
  searching the treks already loaded, rather than appearing broken.
- A palette result outside the current radius: choosing it moves the origin, so the result is
  always reachable — never a selection the map cannot show.
- ⌘K must not be swallowed while the user is typing in another input.
- Reduced motion: the palette does not animate.

## Test cases (TDD checklist)

- `searchIndex`: prefix matches rank above substring; alternate names match; "Unnamed" never
  appears; cap respected; empty query returns nothing.
- `pathPresets`: each produces a valid FilterState; applying one is equivalent to setting those
  filters by hand; none hides data irreversibly.
- Palette: opens on ⌘K, closes on Esc, ↑↓ moves the active row, Enter chooses, focus restores
  to the opener, renders nothing when closed.
- Index build: one entry per named trek, no "Unnamed", slug agrees with the static page's slug.
- E2E: ⌘K, type, Enter — the map shows that trek; a guided path changes the result count.

## Out of scope

Fuzzy matching, search-as-you-type over the full 120k set, server search, natural-language
queries, persisting a path across sessions.
