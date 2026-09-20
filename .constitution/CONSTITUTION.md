# Engineering constitution

Loaded in **every** project on this machine (`~/.claude/CLAUDE.md` is a symlink to this
file). A project's own `CLAUDE.md` adds specifics and wins on anything project-specific;
these are the transferable rules.

Every rule exists because it was learned the hard way. **None is aspirational.** A rule
with no incident behind it does not belong here — put it in the project that wants it.

Rules are numbered so they can be cited (`CON-VER-001`) instead of restated. **A project
`CLAUDE.md` must not copy text from this file** — cite the ID. Copies drift; citations
don't. `tools/harvest.py` reports duplication.

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

### CON-VER-002 · Run every suite, especially the slow one
The suite most often skipped is the one that most often catches a real regression — usually
end-to-end, because it's slow and needs a server. Skipping it is how the same class of bug
reached CI twice in one project.

### CON-VER-003 · Verify the outcome, not the command's exit code
Many CLIs exit 0 having done nothing. `gcloud run jobs update --image repo/x:latest` is a
no-op when the spec already says `:latest`, so a deploy "succeeded" while the job kept
running old code. Read the state back and compare it to what you intended.

### CON-VER-004 · Run a check where it will actually run
Passing locally proves nothing if CI has a different working directory, shell, or
environment. Corollary: a checker that lives outside the repo (a skill, `~/.claude/…`)
cannot be a CI gate — CI only gets the repository.

### CON-VER-005 · A check that misdiagnoses is worse than no check
Distinguish "could not determine the value" from "the values differ". Reporting the wrong
cause sends whoever reads the log after a problem that doesn't exist.

### CON-VER-006 · Don't re-derive facts you can execute
If a claim is checkable, check it. Writing an assertion from memory is how a broken one
shipped *after* the correct form had already been discovered earlier the same session.

### CON-VER-007 · Never claim an unverifiable thing is verified
Say "compiles in CI", "review-verified", or "unverified" — never "works" for something you
could not run. If a language or tool is absent from the machine you are on, say so plainly
and name where the real gate is.

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

### CON-COV-002 · A coverage floor only ratchets up
Raise it as coverage grows. Never lower it to make a red build green — fix the test or the
code. Exclude a file from the gate only with a stated reason (interactive OAuth, hardware),
never to flatter the number.

### CON-COV-003 · Cover the boundary between components, not just inside them
Where two things agree on a format — two languages, a producer and a reader, a writer and a
parser — that agreement is the most likely defect and the least likely to be tested. Assert
it from *both* sides.

---

## CON-DATA — Data and records

### CON-DATA-001 · Record observations, never inferences
A field left blank because nobody looked is information. A field filled by inference is a
fabrication that later reads as fact. If a classification *implies* something, that
implication is not an observation — leave it empty and say why.

### CON-DATA-002 · Use tri-state wherever "unknown" differs from "no"
A boolean conflates "checked, and fine" with "never looked" — usually the exact distinction
the user needs.

### CON-DATA-003 · Report contradictions; never silently reconcile them
When two records disagree, surfacing the disagreement is the feature. Picking one is data
loss disguised as tidiness.

### CON-DATA-004 · Never overwrite a human judgement from a derived signal
Suggest, label it a suggestion, and leave the decision alone. Someone's conclusion recorded
after consulting an expert must not be silently replaced by a computation.

### CON-DATA-005 · Prefer `ON DELETE SET NULL` to `CASCADE` when the child records a decision
Deleting an attachment should not erase the finding that cited it. Losing evidence visibly
beats losing work silently.

---

## CON-PROC — Process

### CON-PROC-001 · Specify before implementing
The specification is where a requirement can still be argued about cheaply. Once code
exists, the conversation drifts to whether the code is correct rather than whether the
behaviour is wanted.

### CON-PROC-002 · Keeping a suite green is not keeping it current
Seven features once shipped with zero new scenarios while the suite stayed green — the
letter of "both suites must pass" satisfied, its intent dropped. A new user-visible
behaviour needs a new *specification*, not only unit tests. Put the **guarantees** in specs
("deleting a scan must not erase the verification"), because those are the properties nobody
thinks to test later.

### CON-PROC-003 · When a bug escapes, extend the layer that should have caught it
The fix isn't done until that happens. Otherwise the pattern is incident → apology, instead
of incident → gate.

### CON-PROC-004 · Ship through a reviewed change, and review adversarially
Try to break your own diff with deliberately malformed input; don't confirm it works. Report
findings even when you're the author.

### CON-PROC-005 · Write the test first and watch it fail
A test that has never been red proves nothing. If a spec is written after the code, say so
in its record rather than back-dating the order.

### CON-PROC-006 · Guard destructive actions by construction, not by convention
Anything that deletes, moves or overwrites user data must be constrained by a check the code
enforces — a path prefix, an allow-list — not by a caller remembering to pass the right
argument. Test the refusal, not just the success.

### CON-PROC-007 · Automation proposes; humans dispose
A scheduled or generated change may open a proposal, never amend a rule, a spec, or another
project on its own. One project's local quirk must not silently become a global standard.

### CON-PROC-008 · Never commit directly to a protected branch
Work goes on a branch and lands through review (CON-PROC-004). This is a rule because it was
broken: three commits went straight to `main` in resumefit — one of them *while building that
repo's own hooks*. Discipline did not hold; the `house-gates` pre-commit hook does.

---

## CON-SEC — Secrets

### CON-SEC-001 · A credential in a conversation is compromised
Say so, decline to use it, and advise rotation — building on a leaked credential normalises
the leak. Secrets live in a secret manager and are injected by name; never in a repo, never
in chat.

---

## CON-REP — Reporting

### CON-REP-001 · State what was verified and how
If tests fail, say so with the output. If a step was skipped, say that. When something is
done and checked, say it plainly without hedging — and when it isn't, don't imply it is.
"All green" must mean every gate returned 0.

### CON-REP-002 · Report the cost of what you didn't do
Name what is untested, unverified or deferred, and why. A summary that lists only successes
is a misleading summary.

---

## Amending this file

1. A rule needs **an incident**. Cite what went wrong, in which project.
2. Propose it: `/lesson` writes a dated amendment proposal under `proposals/`, or edit
   directly on a branch.
3. Amendments land through a reviewed PR (CON-PROC-004). The diff is the history of why the
   rule exists.
4. New IDs are append-only within their section. **Never renumber or redefine an existing
   ID** — a project may cite it. To retire a rule, mark it retired in place with the reason.
5. If a rule applies to exactly one project, it belongs in that project's `CLAUDE.md`, not
   here.

`tools/harvest.py` runs on a schedule and writes proposals; it never edits this file
(CON-PROC-007).
