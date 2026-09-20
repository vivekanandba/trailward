# Constitution proposals drafted here, filed elsewhere

The engineering constitution lives in its own remote repository
(`https://github.com/vivekanandba/constitution`), pinned by `constitution.lock`
and enforced by `npm run check:constitution`. Nothing in this repo may edit it.

When work here produces a learning that is **not specific to this codebase**, the
rule is to write it back rather than re-teach it by hand in every sibling project.
But automation proposes and humans dispose (CON-PROC-007), and a rule needs an
incident behind it — so the draft lands here first, as a dated file naming the
incident, and a human files it against the constitution repo.

These are drafts awaiting that step. They are **not** rules, and nothing in this
repo cites them.

| File                                             | Proposes                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `2026-09-20-con-cov-004-per-directory-floors.md` | Coverage floors are per directory, and each must be proven to enforce |
| `2026-09-20-con-cov-005-e2e-covers-ui-ux-api.md` | A web app's end-to-end suite covers UI, UX _and_ API                  |

Both came out of the work in `specs/40-testability-and-floors.md`, and both cite
incidents from this repo rather than arguing from first principles.
