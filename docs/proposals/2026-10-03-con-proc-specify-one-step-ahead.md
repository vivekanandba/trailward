<!-- constitution-ok: a proposal names the ID it proposes, so the unknown-rule check must not fire here. The ID becomes real only if a human files this against the constitution repo; until then nothing in this repo may cite it as a rule. -->

# 2026-10-03 · Proposal: CON-PROC-014 — specify one step ahead of the code, not the whole plan

**Status:** proposed, unfiled. Drafted in trailward. The ID is the next free one as of
2026-10-03 (the fleet's last is CON-PROC-013). A human files it, or does not (CON-PROC-007).

## The incident

trailward PR #76 wrote spec 44 for a four-phase feature (delight) before any of it was built,
which CON-PROC-001 asks for. The spec carried 28 requirements, covering the next PR and three
after it.

Five review rounds found **50 defects**, every one confirmed against the code. Most were not
about the feature at all: they were forecasts about code that did not exist yet. For example:

- a camera-ownership rule for a map animation, which an existing effect contradicted;
- a 404 page tested under a preview server that never serves 404 pages;
- a slug history kept by a job that commits nothing;
- a print date promised on a static page that runs no JavaScript.

Each fix gave the next round more detail about the future to get wrong. Rounds 3, 4 and 5 each
found defects that the previous round's fix had introduced.

**The evidence is mixed, and this draft says so.** Cutting the spec to the next PRs did **not**
lower the count: rounds 6, 7 and 8 found ten each. What changed was their kind. After the cut the
findings were about today's code (a sheet that animates on mount, a font without macrons, a
focus rule beaten by specificity) rather than forecasts. Some of those concrete findings were
themselves introduced by the previous round's fix, so CON-PROC-009 applied throughout. The
reviewer also reports up to ten findings a round, so a count that holds at ten may reflect that
cap rather than the spec. Whoever files this should weigh it as one incident with a plausible
mechanism, not as a measured improvement.

## Proposed rule

### CON-PROC-014 · Specify one step ahead of the code, not the whole plan

CON-PROC-001 says to specify before implementing. It does not say how far ahead, and specifying
a whole multi-phase plan at once fails differently. Every requirement about code that does not
exist yet is a prediction, and review can only find out it is wrong, one prediction at a time.

Specify the **next** step's requirements before its code. Record the later steps as a
**register** of what exists today and what is wanted, not as requirements. Record the facts that
review establishes about the codebase as **constraints** for the specs still to be written. Each
later step's requirements land in a spec change **before** its code. CON-PROC-001 still holds at
every step; only the horizon is shorter.

A sign the horizon is too long: a review round's findings are mostly about code that does not
exist, or come from the previous round's fix.

## What would enforce it

Nothing mechanical; this is a review judgement. `/ship` could say it in its spec step: "a spec
change for a multi-PR feature specifies the next PR; later PRs are register rows".
