# Engineering constitution

Loaded in **every** project on this machine (`~/.claude/CLAUDE.md` is a symlink to this
file). A project's own `CLAUDE.md` adds specifics and wins on anything project-specific;
these are the transferable rules.

Every rule exists because it was learned the hard way. **None is aspirational.** A rule
with no incident behind it does not belong here — put it in the project that wants it.

Rules are numbered so they can be cited (`CON-VER-001`) instead of restated. **A project
`CLAUDE.md` must not copy text from this file** — cite the ID. Copies drift; citations
don't. `tools/harvest.py` reports duplication.

Every rule ends with an **Enforced by** line naming the check that fails when the rule is
broken, or saying `review-enforced` where no machine can tell (CON-PROC-011). A rule that
names a gate not yet built says so.

---

## CON-VER — Verification

### CON-VER-001 · Gate on exit codes, never on reading output
A test run once printed `Tests 19 passed` *and*, separately, `Errors 1 error`, then exited 1.
A grep for "passed" saw only the first and reported green. Capture `$?` and report it:

```bash
cmd >/tmp/out 2>&1; echo "exit=$?"; tail -3 /tmp/out
```

Watch for suites that report failures on a channel separate from the summary line (vitest
`Errors`), and gates that don't change the summary at all (pytest `--cov-fail-under`).

**Enforced by:** review-enforced. house-gates `scan_shell` refuses the commonest way a
script loses an exit code (CON-VER-014).

### CON-VER-002 · Run every suite, especially the slow one
The suite most often skipped is the one that most often catches a real regression — usually
end-to-end, because it's slow and needs a server. Skipping it is how the same class of bug
reached CI twice in one project.

Give each suite — the code, the data, a person's journey, security, delivery — its own
command and its own CI job, so a red build says which question failed. portfolio once ran
373 tests in one lane where the largest group asserted publication rules rather than code,
so "tests failed" never said what kind of thing had broken (2026-09-20).

**Enforced by:** per-repo pre-push hooks that run the full suite (resumefit, keepsake,
wealth-weave, cloudsweep `make prepush`) and per-suite CI jobs; review-enforced elsewhere.

### CON-VER-003 · Verify the outcome, not the command's exit code
Many CLIs exit 0 having done nothing. `gcloud run jobs update --image repo/x:latest` is a
no-op when the spec already says `:latest`, so a deploy "succeeded" while the job kept
running old code. Read the state back and compare it to what you intended.

A step that passes extra arguments verifies they reached the command that needed them:
`npm run x -- <args>` appends to the **last** command of a compound script only. trailward's
"app" and "static" e2e jobs both ran the wrong projects, green and named for what they did
not do, from #75 until #80 (2026-10-31). Call a named script that states the whole command.

**Enforced by:** deploy gates that read state back (viveka `assert-cloud-state.sh`,
landseer's version-equality assert, vital-mosaic's "merged PR was green and current");
trailward `workflows.test.ts` refuses `npm run <x> --`. Review-enforced elsewhere.

### CON-VER-004 · Run a check where it will actually run
Passing locally proves nothing if CI has a different working directory, shell, or
environment. Corollary: a checker that lives outside the repo (a skill, `~/.claude/…`)
cannot be a CI gate — CI only gets the repository.

**Enforced by:** shared checkers are vendored into each repo (`tools/check_specs.py`,
`tools/check_hygiene.py`) so CI can run them; `tools/harvest.py` reports a vendored copy
that falls behind its skill.

### CON-VER-005 · A check that misdiagnoses is worse than no check
Distinguish "could not determine the value" from "the values differ". Reporting the wrong
cause sends whoever reads the log after a problem that doesn't exist.

**Enforced by:** review-enforced.

### CON-VER-006 · Don't re-derive facts you can execute
If a claim is checkable, check it. Writing an assertion from memory is how a broken one
shipped *after* the correct form had already been discovered earlier the same session.

**Enforced by:** review-enforced.

### CON-VER-007 · Never claim an unverifiable thing is verified
Say "compiles in CI", "review-verified", or "unverified" — never "works" for something you
could not run. If a language or tool is absent from the machine you are on, say so plainly
and name where the real gate is.

**Enforced by:** review-enforced.

### CON-VER-008 · A test that fails only in the full run is a defect in the suite, not noise
If a suite fails on different tests across runs while each passes in isolation, the suite
has an ordering, timing or shared-state defect and the gate is **red** — not amber. Do not
re-run until green and do not reach for the bypass: both convert an unreliable gate into an
ignored one. Fix the isolation (or quarantine the offending test explicitly, named and
tracked), and record the flakiness where the next person will see it. A timing assertion
that depends on machine load belongs in a benchmark, not a merge gate.

Incident (wealth-weave, 2026-09-02): a docs-only change could not pass `pre-push` — three
full-suite runs, three different outcomes, each failing test green in isolation; the
run-2 error was pytest's own fixture-teardown assertion, and wall-clock varied 4× between
runs. resumefit's two-seed `PYTHONHASHSEED` matrix is the in-house precedent for making
ordering defects fail loudly instead of intermittently.

A CI retry that turns a failure green hides exactly this: if a suite retries, it must fail
the run when a test passed only on retry (Playwright `failOnFlakyTests`). Wait for a state
that can only hold once the thing is ready (`aria-busy="false"`), never for an indicator to
be absent — absence is also true before it appeared — and act on an app only once it is
listening. trailward retried twice and reported green; its "Loading" wait passed before the
indicator had mounted, and a keystroke sent before the listener existed was lost
(2026-10-10, 2026-10-31).

**Enforced by:** resumefit's two-seed matrix; trailward `workflows.test.ts` asserts
`failOnFlakyTests`. Review-enforced elsewhere.

### CON-VER-009 · "Answered, with nothing" is a third outcome, not a kind of absence
A command that exits 0 and prints nothing has told you something, and it is rarely "the
thing does not exist". Classify success-with-empty-output on its own and let the caller
decide what blank means — it is "no labels" for one read and "no such job" for another.
Collapsing it into absent reports a healthy resource as missing, which is CON-VER-005's
failure wearing the shape of a correct check.

Incident (viveka, 2026-10-10): `assert-cloud-state.sh` classified gcloud reads as
`ok | denied | absent`, where `ok` required non-empty output. A resource that exists but
carries no labels returns exit 0 and an empty string, so the script printed "Artifact
Registry viveka does not exist" for a registry that was present and healthy. Cloud Run always
carries a location label and so could never produce the empty case — the resource looked at
most often was the one that could not show the bug.

**Enforced by:** review-enforced; viveka's `assert-cloud-state.sh` classifies
`ok | denied | absent | empty`, and `tools/cost-audit.sh` gains the same with tests (carried
from fleet #45, 2026-11-07).

### CON-VER-010 · Pin the floor your CI hands the script: the interpreter and the image
A script run by a bare `python3`, `node` or `ruby` in CI is run by whatever that runner has,
which is not what your project pins. Establish the floor version, and gate on compiling every
such script with a real interpreter *at that version* — not a newer one, and not a static
parser's compatibility flag, both of which accept syntax the floor rejects. Where no
interpreter at the floor is installed, report "cannot tell" rather than passing.

The runner image is the same kind of floor. `runs-on: ubuntu-latest` is whatever GitHub ships
today, so a job that installs a browser, a system package or an interpreter onto it is
pinned to nothing. A check whose result depends on its environment — browser tests,
screenshot diffs — runs on a named, versioned image (`mcr.microsoft.com/playwright:v<lockfile
version>-noble`), every job that makes or checks the same artefact uses the same one, and a
test asserts the image tag and the lockfile agree. Regenerating such baselines rewrites all of
them (`--update-snapshots=all`) in the change that moves the image, because a tolerance absorbs
drift silently. Key caches on the real image read in a step: `env.ImageOS` is empty in a
GitHub expression.

Incidents: (viveka, 2026-10-10) `deploy.yml` ran `tools/*.py` with the VM's bare `python3`
**3.8.10**; a PEP 701 f-string passed every local gate and would have aborted mid-deploy with
the new revision already serving — `ast.parse(..., feature_version=(3, 8))` was tried as the
gate and passes that exact file. (2026-10-30 → 11-07) `ubuntu-latest` became 26.04, where
Playwright cannot install Chromium; e2e broke with no code change in gadjoy (#40), trailward
(#80) and portfolio (#96), each diagnosed and fixed separately — folio had moved to a pinned
container days earlier for another reason (#69) — and trailward's baselines turned out six
weeks stale inside the tolerance.

**Enforced by:** viveka `check_py_floor.py` (a real 3.8); portfolio
`tests/contract/workflows.test.ts` and trailward `workflows.test.ts` assert pinned images.
Fleet-wide: house-gates 1.7.0 (fleet #57) refuses a browser install without a pinned
container or versioned label; it reaches a project when that project's copy is re-vendored.

### CON-VER-011 · A cached or vendored copy of shared tooling says what it is and how old it is
Any mirror, cache or vendored copy prints its version and when it last synced, on every run.
A copy that cannot report its own age is indistinguishable from the current one and will be
read as authoritative. The refresher records when it last *succeeded*, because "it runs
hourly" is a claim about the crontab, not about the last run.

Incident (keepsake, 2026-10-03): the `spec-check` mirror served v1.1.0 while `main` was on
v1.2.4, and nothing said so. A fleet-wide measurement built on it led to fleet #35, which
would have downgraded the checker for twelve projects and reverted a deliberate decision; it
was caught only by an unrelated merge conflict.

**Enforced by:** `tools/harvest.py` reports vendored copies behind their skill. Not yet
built: a `.last-sync` stamp in `tools/refresh.sh` and a version line on every vendored tool's
first output — until then, review-enforced.

### CON-VER-012 · An infrastructure limit is not a signal about the software
When a shared, exhaustible resource runs out — artifact storage, a registry quota, a rate
limit — say so under that name. Do not let it fail a check whose name claims something about
the application, and do not weaken the real assertion to route around it. Split the claim:
gate on what your build produced, and report separately on whether somewhere else accepted it.

Incident (2026-10-30): the account-wide Actions artifact storage filled, mostly from sibling
repositories. viveka's e2e job ran thirteen tests green and failed uploading screenshots,
which surfaced as "the `frontend` check failed"; the deploy gate then refused the merge as
"not green". Two unrelated PRs blocked for a day. The same diagnosis was made separately the
same day in resumefit (#54), and keepsake hit it too — the work was done twice.

**Enforced by:** review-enforced; viveka and resumefit upload with `continue-on-error` and
**fail** the job if the report is missing or empty.

### CON-VER-013 · A conformance tool passing is not the property you need
A linter, an accessibility scanner, a schema validator or a security scanner encodes a general
standard written for everyone. Your requirement is usually narrower, and the tool is entitled
to be silent about the difference. Where the difference matters, assert your property
**directly and separately**, next to the tool. Find out which case you are in by planting the
defect you most fear and watching what the tool says.

Incident (artbypriti, 2026-10-31): the axe-core gate reported zero violations with `alt=""` on
a painting — on a gallery, the whole content of the page — because an empty `alt` is the
specified way to mark an image decorative. CON-SEC-003 is the same lesson arriving from
dependency audits.

**Enforced by:** review-enforced; proving each new gate red on a planted defect
(CON-PROC-009).

### CON-VER-014 · A pipeline that ends in `grep -q` under `pipefail` is a race, not a test
`grep -q` exits at the first match and whatever feeds it can die of SIGPIPE; with `pipefail`
that is reported as the pipeline failing, so the check flips with timing and load. Test a
string with a here-string (`grep -q … <<< "$x"`), a file with a path argument, and a
command's output by capturing it first. If the writer is known to survive EPIPE, say so on
the line (`# pipefail-ok: <why>`).

Incident (resumefit, 2026-09-27): the fleet's own hygiene hook was built this way and its
waiver was a coin flip for two weeks before a loaded runner made it fail three times in a
morning; the same shape made the "migration deletes lines" check fail open.

**Enforced by:** house-gates `scan_shell` (1.5.0) refuses it in a staged script; 1.6.1 stops
it matching comments.

### CON-VER-015 · A pixel baseline captures a state the page reaches by construction, never by timing
Anything a screenshot depends on — hydration, scroll-triggered reveals, entrance animations,
count-ups, lazy media, fonts, the clock, a service worker — is driven to its final state by an
explicit step the test performs and can assert, never left to have happened by the time the
pixels are read. A baseline that passes by timing records whatever the capture happened to
catch. When a baseline fails on one branch and not another with no visible cause, open the
committed image before touching the tolerance: the image may be the defect.

Incident (portfolio, 2026-10-02, #83): a committed baseline was a page whose whole body below
the header was **blank**, approved by the gate on every PR for twelve days; `reducedMotion` in
`test.use` had never reached `matchMedia` in the container. The month after, the same class
was fixed separately four more times: date-dependent baselines (portfolio #96, folio #71/#73,
trailward #93), webfont races (gadjoy #44, trailward #92), and service-worker tests sharing a
browser with screenshot tests (gadjoy #41, folio #73).

**Enforced by:** per-repo visual suites (portfolio SPEC-0003 R9: hydration wait plus explicit
`emulateMedia`). review-enforced fleet-wide.

---

## CON-COV — Coverage tells you less than you think

### CON-COV-001 · Application coverage says nothing about whether software ships
In one project pytest sat at 97% while *every* production incident lived in code no suite
touched: the Dockerfile, the deploy script, the container's contents.

If the delivery path isn't tested, test it:
- build every container image in CI (build-only is enough to catch a broken `COPY`)
- assert the image *contains* what its entrypoint needs
- after deploying, assert the running version equals the version just built
- smoke-check that dependencies are reachable and that auth is still enforced
- pin deployments to immutable digests, never mutable tags

The post-deploy check lives in the repository and fails the deploy job; one typed by hand
when someone remembers is not a check. The 2026-09-02 billing mis-wiring — four per-app
budgets each able to take every sibling offline — was found by looking, not by a gate.

**Enforced by:** `fleet-audit.sh` DELIVERY and POSTDEPLOY columns; per-repo image and
post-deploy jobs.

### CON-COV-002 · A coverage floor only ratchets up
Raise it as coverage grows. Never lower it to make a red build green — fix the test or the
code. Exclude a file from the gate only with a stated reason (interactive OAuth, hardware),
never to flatter the number.

**Enforced by:** per-repo coverage floors in CI (`fleet-audit.sh` COVER column); keepsake's
`tools/check_coverage.py` ratchet refuses a lowered floor in its own repo. Raising the floor is
review-enforced.

### CON-COV-003 · Cover the boundary between components, not just inside them
Where two things agree on a format — two languages, a producer and a reader, a writer and a
parser — that agreement is the most likely defect and the least likely to be tested. Assert
it from *both* sides.

When the other side is someone else's — an API, a tool's output, a file another program
writes — the fixture is **captured from the real thing, never written from memory or from the
documentation**, and records where and when it was captured. An invented fixture tests the
parser against the author's belief about the format, which is exactly the belief that is
wrong: landseer #60's Earthdata client parsed invented field names, passed every test, and
returned nothing for all 83 live granules; keepsake #12's espeak voice parser was written
against a made-up table. CON-DATA-006 forbids inventing content a user reads; this forbids
inventing the input a test feeds.

**Enforced by:** review-enforced.

### CON-COV-004 · A vendored artifact is exempted from the host's style gates by whatever installs it
Code copied into a repo by a shared installer cannot satisfy every host's style
configuration — line length alone splits this fleet, and a file formatted for one half is
unformatted for the other. The installer registers the exclusion in the host's linter
configuration at install time, with the reason inline, and the artifact is linted **once, in
the repository that generates it**. This is the narrow, stated exemption CON-COV-002 allows.

Incident (viveka #8, 2026-08-29): the vendored `tools/check_hygiene.py` failed viveka's
`ruff check`/`ruff format`, and the PR sat red for three weeks, blocking the constitution
rollout — only viveka linted the path, so five other repos carried the same latent block.

**Enforced by:** not yet — `house_gates.py --install` and `check_specs.py --install` do not
register the exclusion. Recorded as unenforced until they do.

### CON-COV-005 · When two code paths build the same artifact, test the one that ships
A fixture that builds a database from model metadata, an image built differently from the one
deployed, a config assembled by the harness rather than the entrypoint: in each case the tested
artifact is not the delivered one, and coverage reports both paths as covered. Exercise the
shipping path, or assert in CI that the two agree; where no comparison is possible, test the
shipping path and delete the other.

Incident (viveka, 2026-10-31): every test built tables with `create_all()` while production
ran Alembic migrations, and nothing compared them; a migration missing a column or declaring a
different `ON DELETE` would have passed 149 tests at 99% coverage. landseer and vital-mosaic
have the same gap.

**Enforced by:** per-repo — viveka `backend/tests/test_migrations.py` (migrate, then
`compare_metadata`; in review in the viveka #33–#35 stack, not yet on main). No fleet-level
check: unenforced in landseer and vital-mosaic until each adds one.

---

## CON-DATA — Data and records

### CON-DATA-001 · Record observations, never inferences
A field left blank because nobody looked is information. A field filled by inference is a
fabrication that later reads as fact. If a classification *implies* something, that
implication is not an observation — leave it empty and say why.

**Enforced by:** review-enforced.

### CON-DATA-002 · Use tri-state wherever "unknown" differs from "no"
A boolean conflates "checked, and fine" with "never looked" — usually the exact distinction
the user needs.

**Enforced by:** review-enforced.

### CON-DATA-003 · Report contradictions; never silently reconcile them
When two records disagree, surfacing the disagreement is the feature. Picking one is data
loss disguised as tidiness.

**Enforced by:** review-enforced.

### CON-DATA-004 · Never overwrite a human judgement from a derived signal
Suggest, label it a suggestion, and leave the decision alone. Someone's conclusion recorded
after consulting an expert must not be silently replaced by a computation.

**Enforced by:** review-enforced.

### CON-DATA-005 · Prefer `ON DELETE SET NULL` to `CASCADE` when the child records a decision
Deleting an attachment should not erase the finding that cited it. Losing evidence visibly
beats losing work silently.

**Enforced by:** review-enforced; viveka asserts `ondelete` in the migrated schema
(CON-COV-005).

### CON-DATA-006 · Never fabricate domain content
Automation may format, move, validate and report. It must not invent the things a human is
the source of — a measurement, a person's words, a citation, a record. When a value is
unknown, say it is unknown and stop; a gap that blocks is cheaper than a plausible invention
that ships.

Incident (2026-08-08): resumefit ("never fabricate resume content"), gadjoy ("no fabricated
data") and artbypriti wrote this rule for themselves independently; artbypriti's validator
then found three artworks with no dimensions and two measured in inches, each trivially
"fixable" by guessing under an artist's name.

**Enforced by:** per-repo validators that report absent values as warnings rather than fill
them (artbypriti `scripts/check-content.py`). Whether a value was invented cannot be detected
after the fact, so the act is review-enforced.

---

## CON-PROC — Process

### CON-PROC-001 · Specify before implementing
The specification is where a requirement can still be argued about cheaply. Once code
exists, the conversation drifts to whether the code is correct rather than whether the
behaviour is wanted.

**Enforced by:** per-repo "a behaviour change needs a spec" CI steps (resumefit `spec
present`, gadjoy's `feat/*` gate); the vendored spec-check validates the registry.
Review-enforced where neither exists.

### CON-PROC-002 · Keeping a suite green is not keeping it current
Seven features once shipped with zero new scenarios while the suite stayed green — the
letter of "both suites must pass" satisfied, its intent dropped. A new user-visible
behaviour needs a new *specification*, not only unit tests. Put the **guarantees** in specs
("deleting a scan must not erase the verification"), because those are the properties nobody
thinks to test later.

**Enforced by:** spec-check strict mode refuses a criterion that claims a test which does not
exist; whether the spec is current is review-enforced.

### CON-PROC-003 · When a bug escapes, extend the layer that should have caught it
The fix isn't done until that happens. Otherwise the pattern is incident → apology, instead
of incident → gate.

Build the gate so it survives. A gate that blocks on something only a human can supply, or
that costs more than the mistake, gets disabled wholesale — and then protects nothing. Prefer
warn-not-block for anything a person is the source of, and give a block a legitimate exit
that is **recorded** (a written reason in history, such as `No-Spec: <reason>`), never a
removable label. This is not CON-VER-008's bypass: a flaky gate is fixed, not exited.
(artbypriti, 2026-08-08: a validator that blocked a deploy on an unwritten painting
description would have been switched off within the week.)

**Enforced by:** review-enforced — "what happens the first time this fires on something
legitimate?"

### CON-PROC-004 · Ship through a reviewed change, and review adversarially
Try to break your own diff with deliberately malformed input; don't confirm it works. Report
findings even when you're the author.

**Enforced by:** resumefit `ship.sh merge` refuses a PR with no review evidence. Private
repos on this plan have no server-side branch protection, so elsewhere it is review-enforced.

### CON-PROC-005 · Write the test first and watch it fail
A test that has never been red proves nothing. If a spec is written after the code, say so
in its record rather than back-dating the order.

**Enforced by:** review-enforced.

### CON-PROC-006 · Guard destructive actions by construction, not by convention
Anything that deletes, moves or overwrites user data must be constrained by a check the code
enforces — a path prefix, an allow-list — not by a caller remembering to pass the right
argument. Test the refusal, not just the success.

**Enforced by:** review-enforced; each such guard carries a test of its refusal.

### CON-PROC-007 · Automation proposes; humans dispose
A scheduled or generated change may open a proposal, never amend a rule, a spec, or another
project on its own. One project's local quirk must not silently become a global standard.

**Enforced by:** `tools/harvest.py` has no code path that edits this file — it writes a
report and opens a pull request.

### CON-PROC-008 · Never commit directly to a protected branch
Work goes on a branch and lands through review (CON-PROC-004). This is a rule because it was
broken: three commits went straight to `main` in resumefit — one of them *while building that
repo's own hooks*. Discipline did not hold; the `house-gates` pre-commit hook does.

**Enforced by:** house-gates `check_protected_branch` in the pre-commit hook, in every repo
whose `.house-gates.json` lists the branch — an empty list switches the gate off.

### CON-PROC-009 · A review loop ends on a clean round, not on a green suite
The likeliest place for the next defect is the fix for the last one, so re-review after every
fix and stop only when a round finds nothing. This is a rule because five rounds across three
trailward PRs (#67, #69, #70) each found real defects, and rounds 3–5 each found defects
*introduced by the previous round's fix* — a data-loss guard that counted removed records when
the incident it cited removed none, and then its replacement, whose shared denominator let one
unrelated failure excuse a total wipe. Every one of those rounds began with every gate green.
CON-PROC-004 gets you the first round; this one tells you when to stop. Trust a new assertion
only after mutating the code it guards and watching it fail (CON-PROC-005 applied to a test
written after the code) — several that could not fail were found exactly that way.

"Finds nothing" means **no correctness finding in the change's core**: what the PR exists to
do and what its fixes touched. Minor findings are answered on the PR — fixed, declined with a
reason, or filed — not looped on. After the first full review, re-review **the fix commits**,
not the whole PR: a fresh reviewer over the whole diff finds something every round (trailward
#79 and #80 ran thirteen rounds that way), while a delta review still finds the defects fixes
introduce (#87, #89, #98).

**A mutation result is evidence only if the mutant ran.** Before reading a survivor as "this test
cannot fail", show the mutant applied: `git diff --stat` on the mutated file is non-empty, or the
script asserts its anchor matched exactly once. A `sed` whose pattern no longer matched — after a
formatter re-wrapped the line — changes nothing and reports a survivor that does not exist
(vital-mosaic #84; twice in fleet sessions in October 2026; and on 2026-11-07 while writing
viveka #42, where a test edit silently did not apply). For Python, run mutation checks with `PYTHONDONTWRITEBYTECODE=1` (or `-B`): CPython
trusts a cached `.pyc` whose source mtime and size match, at one-second granularity, so a
same-size mutant restored within a second leaves the mutated bytecode live and the next run
measures the wrong code (keepsake #11).

**Enforced by:** review-enforced; resumefit `ship.sh round` records each round on the PR.

### CON-PROC-010 · History is additive; archive by reference
Prefer adding over rewriting. Do not force-push a shared branch or rewrite published history:
it buys disk and costs every existing clone. When something must leave the working tree, leave
a reference that still resolves — a tag, a release, a documented path — and verify the
reference works before deleting anything.

**Exception — security remediation.** A credential, key or personal-data exposure is the one
case where rewriting published history can be correct. Purge it, rotate what leaked
(CON-SEC-001), and tell every clone holder. Whether to purge or accept the risk is the owner's
decision, recorded either way: "we decided to live with it" is a valid outcome, "nobody
looked" is not.

Incident (artbypriti, 2026-08-08): 1.38 GB of dead migration files — 92% of every CI checkout
— were removed from the tree and left reachable at an annotated tag; checkout fell from 1497 MB
to 118 MB with no history rewrite. resumefit reached the same rule independently.

**Enforced by:** review-enforced. A pre-push guard refusing `--force` against `main` is
proposed for house-gates, not built.

### CON-PROC-011 · A rule with no enforcing mechanism is a wish
Any rule worth stating is worth wiring to a gate. When you write a principle, name the
check that fails when it is broken; if none exists, build it or record the rule as
unenforced — never leave the reader to infer which. Ported from the fleet constitution's
Article I (2026-10-03), whose own incident was that rules kept being restated in project
after project rather than checked. Every rule here names what enforces it for this reason.

Until 2026-11-07 that last sentence was false: 31 of 35 rules named nothing, and lessons sat
in `proposals/` for up to 91 days with nothing failing.

**Enforced by:** the **Enforced by** line on every rule, checked in the PR that adds one;
`tools/harvest.py` reports proposals older than 30 days and projects citing IDs that do not
exist here (harvest PR of 2026-11-07).

### CON-PROC-012 · Partial is not done
A contract four-fifths met stays `planned`. Do not mark something shipped because most of
the sentence is true; if the remainder is separable, split the contract deliberately in the
spec rather than softening what it said. Incident (viveka): `VIV-MEDIA-003` requires an
experience to record "status, rating, feelings, notes and journal relationships" — the
first four exist, there is no journal relationship field, and it stays planned. A spec gate
can check that a contract *has* evidence, never that the evidence is honest, so this one is
enforced by review. Ported from Article III (2026-10-03).

**Enforced by:** review-enforced.

### CON-PROC-013 · A learning in one project is promoted to the fleet
This is the rule the others depend on. When something is learned that is not specific to
one codebase, write it **here**, in the same change that acts on it locally: act in the
project that surfaced it, amend this document citing the incident, and note in the
project's own guide that it inherits the rule. A learning left in one repository has to be
re-taught by hand in every other. Incident: viveka's contract-registry gate was designed
and built from scratch in August 2026, weeks after wealth-weave had shipped the same idea
as `WW-SPEC-0001`; neither repository knew about the other and the work was done twice.
Enforced by `~/data-dash/fleet-audit.sh` and the weekly `tools/harvest.py`, which report
which projects carry the rules and whether their specs pass the shared checker. Ported from
Article X (2026-10-03).

**Enforced by:** `fleet-audit.sh` and `tools/harvest.py`, as above.

### CON-PROC-014 · A gate that cannot run is not a gate
A check whose identity lacks the access it needs does not fail — it abstains, and an
abstention reads as green. Give the check the *least* access that lets it answer, and assert
that it answered. If the access cannot be granted, delete the check and record the gap
honestly; a permanent SKIP is CON-PROC-011's wish with a tick beside it. Never widen the
permission past what the question needs.

A trigger filter can remove a gate without removing the sign that it is missing.
`on: pull_request: branches: [main]` means a pull request based on any other branch matches
nothing, no workflow starts, and the page shows an empty check list — the same as a repo with
no CI. State triggers so that every pull request is gated, and prefer a job that runs and
decides it has nothing to do over a job that never starts.

Incidents (viveka, 2026-10-31): secret-label assertions merged green and then printed
`SKIP ... unreadable from this identity` on every deploy, because the deploy service account
held no Secret Manager role. The same day viveka #34, stacked on a feature branch, ran **no**
workflow at all; 9 of 15 pull-request workflows in the fleet were narrowed the same way.

**Enforced by:** `tools/workflow-trigger-audit.sh` (narrowed `pull_request` triggers;
carried from fleet #47 in the companion tools PR); viveka's bootstrap test that the deploy
identity holds metadata access only.

### CON-PROC-015 · Verify from the commit, and commit before testing a destructive path
After committing, confirm what actually landed with `git show HEAD:<path>` or the commit's
file list — not from the working tree, which may hold changes that never made it in. Commit
before exercising anything that discards state (`reset --hard`, `checkout <file>`, `clean`).

Incident (artbypriti, 2026-08-08): a hook test ran `git reset --hard HEAD~1` and destroyed two
verified, unstaged files; PR #19 merged and was reported as "deploy-time gates added" while
the deploy stayed ungated for three further merges.

**Enforced by:** review-enforced — quote `git show HEAD:` output as verification evidence.

### CON-PROC-016 · A test that runs from a git hook runs in git's environment
git exports `GIT_DIR` and its siblings to every hook, and `GIT_DIR` overrides the working
directory; in a linked worktree it is always set. A test that creates its own git repository
must strip every `GIT_*` variable — at the hook's entry point, so every suite it runs is
covered — and so must any code under test that runs git. Passing `cwd=` is not isolation. A
sandbox test that passes from the main checkout and fails from a worktree is this defect.

Incidents: (resumefit, 2026-09-26, twice the same day) a pre-push run from a worktree rewrote
the shared config to `core.bare=true`, replaced the developer's identity and moved a live
worktree onto a fixture branch. The lesson was proposed that day and not adopted, so
(keepsake, 2026-11-07, #13) it happened again: the coverage-gate fixtures rewrote the checkout
to bare, blanked its hook path, replaced the branch being pushed with fixture commits, moved
`origin/main`, and pushed a junk branch to GitHub.

**Enforced by:** house-gates 1.7.0 (fleet #57): managed hooks unset git's repository-local
environment before any project line, and staged test code that runs `git init`, `commit`,
`config` or `update-ref` without a scrub is refused. It reaches a project when that project's
copy is re-vendored. resumefit `scripts/preflight.sh` and keepsake's
`FixtureGitNeverTouchesTheRealRepository` test reproduce the incident.

### CON-PROC-017 · A pipeline is a budgeted resource
Every job declares `timeout-minutes`. Every workflow declares a `concurrency` group — cancel
superseded CI runs; queue, never cancel, deploys. One commit is not tested twice by two
triggers. In a private repo every Linux job runs on the self-hosted runner; a job on a hosted
image is a defect. A runner billed at a multiple (macOS bills 10×) runs only on a deliberate,
per-run human decision — since 2026-11-07 the repository variable `MACOS_CI=on` **and**, for
CI jobs, a manual dispatch; never a label, a tag or a push alone. Usage is measured against
the allowance on a schedule, and a projected overrun is a red finding: when the allowance is
exhausted every gate in every private repo goes dark at once.

Incidents: (2026-09-23) 2,197 billed minutes against the 2,000 free, unknown to anyone, with
no job in any private repo declaring a timeout; (2026-11-07) jobs written after the move to
self-hosted runners (resumefit `images`, vital-mosaic `specs`) defaulted to hosted minutes for
five weeks.

**Enforced by:** house-gates `scan_workflow` (timeouts, concurrency, `# macos-ok`, double
runs); `tools/actions-usage.py` daily from the VM cron; the harvest's CI-hygiene column.
house-gates 1.7.0 (fleet #57) also flags a private-repo job on hosted Linux, once `--install`
has recorded the repo as private.

### CON-PROC-018 · An in-place edit reads to a variable, then writes — and verifies
Never write a file from an expression that also reads it: the write handle truncates before
the read is evaluated. Read into a variable, assert the thing you are replacing was there,
write, and assert the file is non-empty afterwards.

Incident (folio, 2026-09-19/20): `open(p,'w').write(open(p).read().replace(...))` committed
two spec files as zero bytes, and three later PRs' "update the task list" edits ran against an
empty string and reported success; content lint, 122 unit tests, e2e and the coverage floor
stayed green throughout.

**Enforced by:** spec-check fails an empty spec (no title heading) wherever it runs in CI;
folio `tests/delivery.test.ts` asserts no record is empty. Review-enforced for the idiom.

### CON-PROC-019 · A write path without a repair path is an unfinished feature
Shipping something that creates a record includes the ways a person finds it again, corrects
it, and withdraws it. They are the rest of the same feature, not follow-ups. Assert it per
entity from the data model, not a hand-kept list: each persisted entity has a route to find,
correct and withdraw it, or a written argument why not. Prefer withdrawal to deletion where
another record cites the one removed (CON-DATA-005).

Incident (viveka, 2026-11-07): sixteen gaps — four of five authored entities could not be
corrected, nothing could be deleted, and two endpoints were served for months with no UI
calling them — under ten specs, fifty-three contracts and a 95% coverage floor, all green.

**Enforced by:** per-repo — viveka `backend/tests/test_lifecycle.py` reads the ORM mapper
registry (in review in viveka #37/#39, not yet on main). Review-enforced in every other CRUD
app until each adds one.

### CON-PROC-020 · A guarantee the registry cannot express is a guarantee nobody writes down
Where a project records contracts against harnesses, the set of harnesses bounds what it can
promise. Before concluding a layer has no guarantees worth stating, check whether the registry
could express one; add the harness rather than omit the guarantee. Map harness to evidence
with a table, not a two-case conditional.

Incident (viveka, 2026-11-07): `KNOWN_HARNESSES = ("pytest", "script")` made browser
guarantees unrecordable, and the evidence lookup's `if pytest else script` would have
silently checked the wrong evidence for a third harness. wealth-weave's registry has the same
two-harness shape.

**Enforced by:** review-enforced. viveka's `tests/test_spec_contracts.py` gains an `e2e`
harness in its open PRs; on main it still knows two.

---

## CON-SEC — Secrets and security

### CON-SEC-001 · A credential in a conversation is compromised
Say so, decline to use it, and advise rotation — building on a leaked credential normalises
the leak. Secrets live in a secret manager and are injected by name; never in a repo, never
in chat.

**Enforced by:** house-gates `scan_secrets` refuses a staged secret; per-repo gitleaks over
full history (CON-SEC-002). Rotation is review-enforced.

### CON-SEC-002 · Dependency and secret scanning are CI gates, not dashboards
Every project scans its dependencies, and its **full git history** for secrets, in CI, failing
the build at a stated severity. Ten of twelve projects here scanned nothing until 2026-09-20 —
including a deployed service handling uploaded documents — while portfolio carried 26 known
advisories that surfaced only because someone thought to ask. An alert nobody is required to
read is not a control.

**Enforced by:** per-repo CI scan jobs. Not measured fleet-wide — no audit column reports
which repos scan; recorded as a gap.

### CON-SEC-003 · Audit the shipped tree and the build tree separately, and trace what actually ships
A single vulnerability count misleads, and so does the tool's own split. portfolio had 26
advisories; `npm audit --omit=dev` called 6 of them production, but two of those were dev-only
packages it failed to exclude, and tracing the rest into the built output found **none** — the
apparent hits were the English word "sharp" in the site's prose and Zod's `.nanoid()` validator.
Every one of the 26 was build-time or server-only, so the entire real risk was supply chain,
executing with credentials in CI. Report the trees separately, trace the shipped one into the
artifact rather than trusting the flag (CON-VER-005), and never wave away a build-tree advisory
as "not shipped".

**Enforced by:** review-enforced; per-repo CI runs two audit invocations with separate
thresholds.

### CON-SEC-004 · A deployed surface declares its security headers, or records why it cannot
State the Content-Security-Policy, Referrer-Policy and X-Content-Type-Options a deployed
project sends, and assert them against the running site after deploy. Where the host cannot set
headers — GitHub Pages cannot — record that and use what the platform does allow. portfolio
served none of them, and nothing anywhere said whether that was a decision or an oversight.

**Enforced by:** per-repo post-deploy header assertions (resumefit `scripts/smoke.sh`,
viveka `scripts/assert-live-headers.sh`, landseer's deploy smoke; vital-mosaic's once #32
lands). Not measured fleet-wide.

### CON-SEC-005 · A security pass is part of done, not a later project
Shipping a feature includes an adversarial read of what it exposes: what it publishes, what it
stores, what it now trusts. On 2026-07-23 a full personal-data export reached portfolio's git
history and had to be purged; the review that would have caught it happened only because the
data was already public. This is CON-PROC-004's adversarial review, applied to security.

**Enforced by:** review-enforced. house-gates 1.7.0 (fleet #57) refuses to stage any value
listed in a repo's gitignored `.house-gates.denylist` — the owner's real personal data reached
vital-mosaic test fixtures in five PRs in October, three of them merged.

---

## CON-OBS — Delivered is not the same as still up

### CON-OBS-001 · Every public surface has an external probe, and a human is told when it fails
A deployed service or site has an uptime check from outside its own platform and an alert that
reaches a person. The post-deploy check proves the deploy; the probe proves the interval
between deploys, which is where most of the time is.

Incident (2026-09-23): six Cloud Run services and five Pages sites, and `gcloud monitoring
uptime list-configs` returned nothing; two specs had scoped uptime out explicitly.

**Enforced by:** `tools/observability-audit.sh` §Surfaces; `fleet-audit.sh` UPTIME and ALERT
columns.

### CON-OBS-002 · A scheduled job proves it ran; silence is a failure, not a success
A scheduled job is alerted on *absence* as well as failure: a last-success age against a
stated window, and a scheduler that has never fired is red. A failed scheduled run reaches a
person by a path that does not depend on who last edited the cron — one issue per job,
commented on each failure, closed by the next success — and a `cancelled` run counts as
failed. A checker may be advisory about what it finds, never about whether it ran: a crash
exits non-zero.

Incidents: (2026-09-23) a viveka scheduler sat `ENABLED` with no `lastAttemptTime` for days.
(trailward, 2026-08-10 → 10-26) the weekly data refresh failed **twelve** weeks running; GitHub
emails a failed scheduled run only to the last editor of the cron line. In the same month
gadjoy's nightly secret scan failed 25 days running and artbypriti's weekly health job four
Mondays, unread.

**Enforced by:** `tools/observability-audit.sh` §Jobs for Cloud Scheduler jobs; house-gates
1.7.0 (fleet #57) refuses an `on: schedule` workflow with no failure reporter — trailward's
`report-failure.yml` is the worked example. Cancelled-counts-as-failed and crash-exits-non-zero
are review-enforced.

### CON-OBS-003 · An alert path is verified by firing it once, and the delivery is recorded
Configured is not working. Every new alert path is proven with a deliberate failure and the
time the notification arrived is written into the change that created it.

Incident (2026-09-23): the billing guard, wired to five budgets, had rejected 500 invocations a
day for lack of `run.routes.invoke`, in a log nobody read — it had never executed.

**Enforced by:** `tools/setup-monitoring.sh --canary` (fleet channel proven 2026-09-26).

### CON-OBS-004 · Logs carry a severity, or errors are invisible
A deployed service writes structured log lines with `severity`, the request id it already
mints, and the app and version. Unstructured text at DEFAULT severity cannot be queried,
alerted on or grouped.

Incident (2026-09-23): a fleet-wide `severity>=ERROR` query returned nothing — not because
nothing had failed.

**Enforced by:** `tools/observability-audit.sh` §Errors; `fleet-audit.sh` JSONLOG column.

---

## CON-REP — Reporting

### CON-REP-001 · State what was verified and how
If tests fail, say so with the output. If a step was skipped, say that. When something is
done and checked, say it plainly without hedging — and when it isn't, don't imply it is.
"All green" must mean every gate returned 0.

**Enforced by:** review-enforced.

### CON-REP-002 · Report the cost of what you didn't do
Name what is untested, unverified or deferred, and why. A summary that lists only successes
is a misleading summary.

**Enforced by:** review-enforced.

---

## Amending this file

1. A rule needs **an incident**. Cite what went wrong, in which project.
2. Propose it: `/lesson` writes a dated amendment proposal under `proposals/`, or edit
   directly on a branch. **A proposal does not claim a number** — it writes
   `ID: assigned at merge`. Numbers are assigned by the reviewer in the PR that adopts the
   rule, against `main`, because a draft cannot see what will be adopted while it waits:
   by 2026-11-07 CON-PROC-009 had been claimed three times and adopted for a fourth rule.
   A project that cites a rule still in proposal marks the citation as proposed.
3. Amendments land through a reviewed PR (CON-PROC-004). The diff is the history of why the
   rule exists. Every new rule carries an **Enforced by** line (CON-PROC-011).
4. New IDs are append-only within their section. **Never renumber or redefine an existing
   ID** — a project may cite it. To retire a rule, mark it retired in place with the reason.
5. If a rule applies to exactly one project, it belongs in that project's `CLAUDE.md`, not
   here.
6. An adopted proposal moves to `proposals/applied/`. A proposal open longer than 30 days is
   a harvest finding: decide it, don't let it wait.

`tools/harvest.py` runs on a schedule and writes proposals; it never edits this file
(CON-PROC-007).
