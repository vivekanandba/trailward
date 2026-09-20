# trailward — working agreement

> Machine-wide engineering rules live in the **engineering constitution**, whose source of
> truth is the remote repository <https://github.com/vivekanandba/constitution>. This repo
> pins the exact version it was verified against in `constitution.lock`, keeps a read-only
> copy under `.constitution/`, and `npm run check:constitution` fails the build if the two
> disagree or if anything here points at a working copy instead of the remote (spec 39).
> Update the pin with `npm run sync:constitution`, which fetches from the remote and never
> from a local checkout.
>
> Cite a rule ID (e.g. `CON-VER-001`) rather than restating it — copies drift, citations
> don't, and the gate rejects pasted rule text. This file holds only what is specific to this
> repo.

## What this is

Interactive map of treks within a chosen radius of any place; Bangalore by default.

## Commands

```sh
npm test  ·  npm run e2e  ·  scripts/ship.sh
```

## Gates

- Hooks: `.githooks/` via `core.hooksPath` (installed by the `house-gates` skill) — secret
  scanning, protected branch (CON-PROC-008), commit message.
- CI: apply-suggestions.yml, ci.yml, deploy.yml, refresh-data.yml — the authority; hooks are the fast loop and are bypassable.

## Project notes

Four workflows incl. refresh-data.yml and apply-suggestions.yml. /ship drives the PR loop here.

## Layout

specs/ (33, lightweight style) · e2e/ · scripts/ · dist/

---

_This file was created when the constitution was introduced, from what the repo shows rather
than from a template. It is deliberately short: grow it from incidents, not from boilerplate,
and put anything transferable in the constitution via `/lesson`._
