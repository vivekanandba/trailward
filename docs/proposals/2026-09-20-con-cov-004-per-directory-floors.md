<!-- constitution-ok: a proposal names the ID it proposes, so the unknown-rule check must not fire here. The ID becomes real only if a human files this against the constitution repo; until then nothing in this repo may cite it as a rule. -->

# 2026-09-20 · Proposal: CON-COV-004 — a coverage floor is per-directory, not just global

**Status:** proposed, unfiled. Drafted in trailward; handed over rather than
opened as a PR, because another session is mid-migration on this repo
(CON-PROC-007 — automation proposes, humans dispose).

## The incident

trailward carried a single global coverage floor. Two things went wrong under it,
both verified by measurement rather than argued:

1. **The floor was diluted by size, not by risk.** The repo's largest files are
   data-shaped and trivially covered; its riskiest are the build tools that write
   committed artefacts. A whole new module — the command palette — landed at 0%
   without moving the global number enough to fail. It was only caught the day
   per-directory floors were added.

2. **An unenforced floor reads as protection.** When per-directory thresholds went
   in, one glob (`scripts/sources/**`) was written in a form that matched no files.
   The build stayed green. A threshold that matches nothing does not warn — it
   passes. It was found by deliberately setting it to 100 and noticing the build
   still exited 0.

## Proposed rule

### CON-COV-004 · Set coverage floors per directory, and prove each one enforces

A single global floor measures the wrong thing: it lets an untested new module hide
behind a large well-covered one. Set a floor per logical directory — application
logic, build logic, I/O adapters — each at the value that directory actually
measures, so it can only ratchet up (CON-COV-002).

Then **prove every floor enforces** before trusting it: set it to 100, run the
build, and confirm it exits non-zero. A glob that matches no file passes silently,
and a floor that cannot fail is documentation, not a gate.

Note that a per-directory _report_ row and a _glob_ can disagree — `src/components/**`
also matches `src/components/ui/**`. Set the floor from what the glob measures,
because the glob is what enforces.

## Why it belongs in the constitution rather than one project

Nothing above is specific to trailward's stack: it is about what a coverage number
means when a repo has directories of unequal risk, which is every repo in the fleet.
The second half — prove the gate fails — is CON-VER-001's "gate on exit codes"
applied to coverage, and the same mistake is available in any project that writes a
threshold glob.

## Cost of adopting

Each project must measure its own directories and set floors at measured values;
copying trailward's numbers would be wrong. Roughly one sitting per repo.
