# trailward — working agreement

> Machine-wide engineering rules live in the **engineering constitution**
> (`~/.claude/CLAUDE.md`, versioned at `~/data-dash/constitution`) and are already loaded in
> this session. Cite a rule ID (e.g. `CON-VER-001`) rather than restating it — copies drift,
> citations don't. This file holds only what is specific to this repo.

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
