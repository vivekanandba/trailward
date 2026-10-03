#!/usr/bin/env python3
# Vendored from the `spec-check` skill v1.2.4 so CI (which cannot read
# ~/.claude/skills) can run it. Do not edit here — edit the skill and re-run
# `/spec-check --install` to refresh this copy.
"""Validate a spec registry so spec-driven development is enforced, not aspirational.

Project-agnostic. Supports two conventions, auto-detected:

**strict** — specs carry YAML frontmatter with an `id:` like `WW-SPEC-0014` / `KS-SPEC-0001`.
Full contract checking: id/filename agreement, requirement→criterion mapping with no orphans,
a traceability row per criterion, referenced tests actually existing, and no `Planned`
evidence in a `Verified` spec.

**lightweight** — specs are prose with headings and no frontmatter (numbered files, a
Purpose/Acceptance-criteria structure). Only structural checks apply; the strict ones are
reported as not-applicable rather than failed.

Stdlib only, so CI needs nothing installed.

    check_specs.py                          # auto-detect everything from the cwd
    check_specs.py --specs-dir docs/specs
    check_specs.py --mode strict --prefix ACME-SPEC
    check_specs.py --tests 'tests/**/*.py' --tests 'app/**/*.swift'
    check_specs.py --json
    check_specs.py --install .              # vendor a copy at ./tools/check_specs.py for CI

Exit 0 = clean, 1 = problems, 2 = misconfiguration (no specs found).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

VERSION = "1.2.4"

VALID_STATUS = {"Draft", "Approved", "Verified", "Released", "Superseded", "Retired"}
VALID_RISK = {"low", "material", "critical"}
REQUIRED_KEYS = ("id", "title", "status")
EXCLUDED_NAMES = {"README.md", "_template.md", "TEMPLATE.md", "index.md", "CHANGELOG.md"}

#: Companion documents in a feature directory. They carry the how and the
#: steps; the acceptance criteria live in spec.md, so warning that these lack
#: a criteria section is noise — and noise is how a checker teaches people to
#: stop reading it.
COMPANION_NAMES = {"plan.md", "tasks.md", "design.md", "notes.md", "research.md"}

#: Sub-directories never scanned. Templates are skeletons with placeholder
#: headings; checking them reports problems nobody can fix.
EXCLUDED_DIRS = {"templates", "_templates", "template", "archive", "_archive",
                 "node_modules", "__pycache__", ".git"}

#: Where tests usually live, by language. Used when --tests isn't given.
DEFAULT_TEST_GLOBS = (
    "tests/**/*.py", "test/**/*.py", "**/test_*.py", "**/*_test.py",
    "**/*Tests/**/*.swift", "**/*Tests.swift",
    "**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx",
    "**/*.test.js", "**/*_test.go", "**/*_spec.rb",
)

#: How to pull test identifiers out of each language.
TEST_NAME_PATTERNS = (
    r"def (test_\w+)",                    # python / ruby
    r"^\s*class (\w*Test\w*)\b",          # python classes
    r"func (test\w+)",                    # swift
    r"^\s*(?:final )?class (\w*Tests)\b", # swift classes
    r"func (Test\w+)",                    # go
    r"""(?:it|test|describe)\(\s*['"`]([^'"`]+)['"`]""",  # js/ts
)

SKIP_EVIDENCE_WORDS = {"planned", "n/a", "na", "todo", "pending", "not started"}


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.notes: list[str] = []

    def error(self, where: str, msg: str) -> None:
        self.errors.append(f"{where}: {msg}")

    def warn(self, where: str, msg: str) -> None:
        self.warnings.append(f"{where}: {msg}")

    @property
    def ok(self) -> bool:
        return not self.errors


# --------------------------------------------------------------------------- parsing

def frontmatter(text: str) -> dict:
    """Parse the leading `---` block. Deliberately minimal: flat `key: value` only."""
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    out: dict = {}
    for line in text[3:end].strip().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, value = line.partition(":")
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def _rel_or_abs(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def spec_files(specs_dir: Path) -> list[Path]:
    """Specs directly in specs_dir, plus one level down.

    Many houses keep a directory per feature — specs/012-thing/spec.md — which
    a flat glob misses entirely. Five of twelve projects in this fleet use that
    layout, and on one of them a flat scan examined a single file out of forty
    and reported the registry sound. A checker that silently inspects a fifth
    of the registry is worse than no checker, because its green is believed.
    """
    flat = {p for p in specs_dir.glob("*.md") if p.name not in EXCLUDED_NAMES}
    nested = {
        p for p in specs_dir.glob("*/*.md")
        if p.name not in EXCLUDED_NAMES and p.parent.name not in EXCLUDED_DIRS
    }
    return sorted(flat | nested)


def label(spec: Path, specs_dir: Path) -> str:
    """How a spec is named in output.

    Nested layouts have ten files called spec.md; reporting a bare name would
    leave the reader guessing which one is broken.
    """
    try:
        return str(spec.relative_to(specs_dir))
    except ValueError:
        return spec.name


def spec_number(spec: Path) -> str:
    """Leading digits of the filename, falling back to the parent directory.

    Covers both `012-thing.md` and `012-thing/spec.md`.
    """
    head = spec.name.split("-", 1)[0]
    if head.isdigit():
        return head
    parent = spec.parent.name.split("-", 1)[0]
    return parent if parent.isdigit() else head


def detect_prefix(specs: list[Path]) -> str | None:
    """Infer the contract-ID prefix (e.g. `KS-SPEC`) from the specs themselves."""
    counts: dict[str, int] = {}
    for spec in specs:
        meta = frontmatter(spec.read_text(errors="replace"))
        spec_id = meta.get("id", "")
        m = re.fullmatch(r"([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)-(\d+)", spec_id)
        if m:
            counts[m.group(1)] = counts.get(m.group(1), 0) + 1
    if not counts:
        return None
    return max(counts, key=lambda k: counts[k])


def collect_test_names(root: Path, globs: tuple[str, ...]) -> set[str]:
    """Every test identifier defined anywhere matching `globs`."""
    names: set[str] = set()
    seen: set[Path] = set()
    for pattern in globs:
        for path in root.glob(pattern):
            if not path.is_file() or path in seen:
                continue
            if any(part in {"node_modules", ".git", "build", ".venv", "venv", "DerivedData"}
                   for part in path.parts):
                continue
            seen.add(path)
            text = path.read_text(errors="replace")
            for rx in TEST_NAME_PATTERNS:
                names.update(re.findall(rx, text, re.M))
    return names


# --------------------------------------------------------------------------- checks

def section(text: str, heading: str) -> str:
    """Body of a `## heading` section (case-insensitive, prefix match), or ''."""
    pattern = re.compile(r"^##\s+(.*)$", re.M)
    matches = list(pattern.finditer(text))
    for i, m in enumerate(matches):
        if m.group(1).strip().lower().startswith(heading.lower()):
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            return text[m.end():end]
    return ""


def check_strict(spec: Path, text: str, prefix: str, known_tests: set[str],
                 report: Report, require_traceability: bool = False,
                 specs_dir: Path | None = None) -> None:
    where = label(spec, specs_dir) if specs_dir else spec.name
    meta = frontmatter(text)

    for key in REQUIRED_KEYS:
        if not meta.get(key):
            report.error(where, f"frontmatter missing '{key}'")

    status = meta.get("status", "")
    if status and status not in VALID_STATUS:
        report.error(where, f"invalid status {status!r} (expected one of {sorted(VALID_STATUS)})")
    risk = meta.get("risk")
    if risk and risk not in VALID_RISK:
        report.error(where, f"invalid risk {risk!r} (expected one of {sorted(VALID_RISK)})")

    # id ↔ filename
    number = spec_number(spec)
    if number.isdigit():
        expected = f"{prefix}-{number}"
        if meta.get("id") and meta["id"] != expected:
            report.error(where, f"id {meta['id']!r} does not match filename (expected {expected!r})")
    spec_id = meta.get("id") or f"{prefix}-{number}"

    # Approval / verification dates
    if status in {"Approved", "Verified", "Released"} and not meta.get("approved_at"):
        report.error(where, f"status is {status} but 'approved_at' is empty")
    if status in {"Verified", "Released"} and not meta.get("verified_at"):
        report.error(where, f"status is {status} but 'verified_at' is empty")

    # Requirements ↔ acceptance criteria
    esc = re.escape(spec_id)
    reqs = set(re.findall(rf"{esc}\.(REQ-\d+)", text))
    # Different houses define criteria as headings, bullets, or table rows. Accept all
    # three: the point is that the criterion is *stated somewhere*, not its markup.
    acs_defined = set(re.findall(rf"^#{{2,4}}\s+`?{esc}\.(AC-\d+)`?", text, re.M))
    acs_defined |= set(re.findall(rf"^\s*[-*]\s+`?{esc}\.(AC-\d+)`?\s*[:—-]", text, re.M))
    acs_defined |= set(re.findall(rf"^\s*\|\s*`?{esc}\.(AC-\d+)`?\s*\|", text, re.M))
    acs_referenced = set(re.findall(rf"{esc}\.(AC-\d+)", text))

    if not reqs:
        report.warn(where, "no requirements found (expected at least one REQ-###)")
    if not acs_defined:
        report.warn(where, "no acceptance criteria defined as headings")

    for ac in sorted(acs_referenced - acs_defined):
        report.error(where, f"{ac} is referenced but has no heading definition")
    for ac in sorted(acs_defined - acs_referenced):
        report.error(where, f"{ac} is defined but never referenced by a requirement or table")

    # A requirement row must name a criterion. Any criterion kind the house uses
    # counts, not only AC: wealth-weave's WW-SPEC-0059.REQ-003 and WW-SPEC-0060.REQ-003
    # are covered by `SEC-001`, defined under "Privacy, security and logging" and traced
    # to a test, and `SEC-`/`INV-`/`OPS-` are the convention across that repo and
    # vital-mosaic. Demanding `AC-\d+` reported both correct specs as broken
    # (2026-10-03) and would have turned their CI red the moment the gate was wired in
    # (CON-VER-005). Whether the criterion is *defined* is a separate check: the
    # "referenced but has no heading definition" error above already makes it for ACs.
    CRITERION = re.compile(r"\b(?:AC|SEC|INV|OPS)-\d+\b")
    for line in text.splitlines():
        m = re.search(rf"\|\s*`{esc}\.(REQ-\d+)`\s*\|", line)
        if m and not CRITERION.search(line):
            report.error(where, f"{m.group(1)} names no criterion in its row")

    # Traceability
    trace = section(text, "Test plan and traceability") or section(text, "Traceability")
    if not trace:
        if require_traceability:
            report.error(where, "missing a 'Test plan and traceability' section")
        else:
            report.warn(where, "no traceability section "
                               "(set require_traceability in .spec-check.json to enforce)")
        return

    for ac in sorted(acs_defined):
        if ac not in trace:
            report.error(where, f"{ac} has no traceability row")

    # Rows that claim evidence must name tests that exist. `Planned` rows are exempt —
    # that exemption is what allows a spec to be written before its tests.
    referenced: set[str] = set()
    for line in trace.splitlines():
        if not line.strip().startswith("|"):
            continue
        if any(w in line.lower() for w in SKIP_EVIDENCE_WORDS):
            continue
        for token in re.findall(r"`([^`]+)`", line):
            token = re.sub(r"\b[\w/.-]+\.(py|swift|ts|tsx|js|go|rb)\b", " ", token)
            for part in re.split(r"::|\.(?=[A-Za-z_])|,|\s+", token):
                part = part.strip().rstrip("*,.").strip()
                if part.endswith("_"):
                    continue  # e.g. `test_ww_spec_0000_ac_001_…` — a naming pattern, not a test
                if re.fullmatch(r"test_\w+|test[A-Z]\w*|Test\w+|\w*Tests", part):
                    referenced.add(part)
    for name in sorted(referenced - known_tests):
        # A spec that names a unique *prefix* of a real test is a documentation shortening,
        # not drift — warn so it can be tidied, but don't fail the build for it.
        matches = [t for t in known_tests if t.startswith(name)]
        if len(matches) == 1:
            report.warn(where, f"traceability names `{name}`, a prefix of "
                               f"`{matches[0]}` — use the full test name")
        elif matches:
            report.warn(where, f"traceability names `{name}`, which matches "
                               f"{len(matches)} tests ambiguously")
        else:
            report.error(where, f"traceability claims evidence from `{name}`, "
                                f"which is not defined in any discovered test file")

    if status in {"Verified", "Released"}:
        for line in trace.splitlines():
            if line.strip().startswith("|") and re.search(r"\bPlanned\b", line):
                cell = line.strip().split("|")[1].strip() or "(row)"
                report.error(where, f"status is {status} but {cell} is still 'Planned'")


# Criteria may be stated at any heading depth. Houses that carry one criteria
# block per spec put them at `## Acceptance criteria`; houses that state an
# obligation per contract nest them under the contract, at `### `/`#### `. Both
# state the criteria, which is what this checks — matching only `##` reported a
# per-contract house style as having no criteria at all.
CRITERIA_HEADING = re.compile(
    # A heading, or a bold run-in label. Spec Kit's own template uses the latter
    # ("**Acceptance criteria**" under a "## User Scenarios" heading), which read as
    # 24 spurious warnings on a repo whose specs were perfectly well formed. The
    # check is that criteria are *stated*, not how a house marks them up.
    r"^(?:#{2,6}\s+|\*\*)(Acceptance|Requirements|Behaviour|Behavior)", re.M | re.I
)


def check_lightweight(spec: Path, text: str, report: Report,
                      specs_dir: Path | None = None) -> None:
    """Structural checks only, for prose specs with no frontmatter."""
    where = label(spec, specs_dir) if specs_dir else spec.name
    if not re.search(r"^#\s+\S", text, re.M):
        report.error(where, "no top-level '# ' title heading")
    if not CRITERIA_HEADING.search(text) and spec.name not in COMPANION_NAMES:
        report.warn(where, "no Acceptance criteria / Requirements section found")


def check_registry(specs_dir: Path, specs: list[Path], report: Report) -> None:
    readme = specs_dir / "README.md"
    if not readme.exists():
        report.warn("specs/README.md", "no registry file; consider listing specs here")
        return
    text = readme.read_text(errors="replace")
    for spec in specs:
        rel = label(spec, specs_dir)
        # A nested spec may be listed by its directory (the common convention)
        # rather than by each file inside it — accept either.
        listed = spec.name in text or rel in text
        if not listed and spec.parent != specs_dir:
            listed = f"{spec.parent.name}/" in text or spec.parent.name in text
        if not listed:
            report.error("specs/README.md", f"registry does not list {rel}")
    names = {s.name for s in specs}
    for linked in re.findall(r"\(([\w.-]+\.md)\)", text):   # sibling files only
        if linked in EXCLUDED_NAMES or linked == "README.md":
            continue
        if linked not in names:
            report.error("specs/README.md", f"links {linked}, which does not exist")


# --------------------------------------------------------------------------- driver

CONFIG_NAME = ".spec-check.json"


def load_config(root: Path) -> dict:
    """Optional per-project `.spec-check.json`. CLI flags override it.

    Keys mirror the flags: specs_dir, prefix, mode, tests (list),
    require_traceability (bool), warnings_as_errors (bool).
    """
    path = root / CONFIG_NAME
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError as exc:
        print(f"{CONFIG_NAME}: invalid JSON ({exc})", file=sys.stderr)
        return {}


def find_specs_dir(root: Path, explicit: str | None) -> Path | None:
    if explicit:
        p = (root / explicit) if not os.path.isabs(explicit) else Path(explicit)
        return p if p.is_dir() else None
    for candidate in ("specs", "docs/specs", "spec", "doc/specs"):
        p = root / candidate
        if p.is_dir():
            return p
    return None


def install(root: Path, dest_rel: str = "tools/check_specs.py") -> int:
    dest = root / dest_rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    source = Path(__file__).resolve()
    header = (
        "#!/usr/bin/env python3\n"
        f"# Vendored from the `spec-check` skill v{VERSION} so CI (which cannot read\n"
        "# ~/.claude/skills) can run it. Do not edit here — edit the skill and re-run\n"
        "# `/spec-check --install` to refresh this copy.\n"
    )
    body = source.read_text()
    body = body.split("\n", 1)[1] if body.startswith("#!") else body
    dest.write_text(header + body)
    dest.chmod(0o755)
    print(f"installed {dest_rel} (spec-check v{VERSION})")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Validate a spec registry.")
    ap.add_argument("--root", default=".", help="project root (default: cwd)")
    ap.add_argument("--specs-dir", default=None, help="spec directory (default: auto-detect)")
    ap.add_argument("--prefix", default=None, help="contract-ID prefix (default: auto-detect)")
    ap.add_argument("--mode", choices=("auto", "strict", "lightweight"), default="auto")
    ap.add_argument("--tests", action="append", default=None,
                    help="glob for test files (repeatable; default: common layouts)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--warnings-as-errors", action="store_true")
    ap.add_argument("--install", metavar="REPO", default=None,
                    help="vendor this checker into REPO/tools/ for CI use")
    ap.add_argument("--version", action="version", version=f"spec-check {VERSION}")
    args = ap.parse_args(argv)

    root = Path(args.root).resolve()
    cfg = load_config(root)

    if args.install:
        return install(Path(args.install).resolve())

    specs_dir = find_specs_dir(root, args.specs_dir or cfg.get("specs_dir"))
    if specs_dir is None:
        print(f"no specs directory found under {root} "
              f"(looked for specs/, docs/specs/; use --specs-dir)", file=sys.stderr)
        return 2

    specs = spec_files(specs_dir)
    if not specs:
        print(f"no spec files in {specs_dir}", file=sys.stderr)
        return 2

    prefix = args.prefix or cfg.get("prefix") or detect_prefix(specs)
    mode = args.mode if args.mode != "auto" else cfg.get("mode", "auto")
    if mode == "auto":
        mode = "strict" if prefix else "lightweight"

    report = Report()
    globs = tuple(args.tests or cfg.get("tests") or DEFAULT_TEST_GLOBS)
    require_traceability = bool(cfg.get("require_traceability", False))
    known_tests = collect_test_names(root, globs) if mode == "strict" else set()

    for spec in specs:
        text = spec.read_text(errors="replace")
        if mode == "strict":
            check_strict(spec, text, prefix or "SPEC", known_tests, report,
                         specs_dir=specs_dir,
                         require_traceability=require_traceability)
        else:
            check_lightweight(spec, text, report, specs_dir=specs_dir)
    check_registry(specs_dir, specs, report)

    if args.warnings_as_errors or cfg.get("warnings_as_errors"):
        report.errors.extend(report.warnings)
        report.warnings = []

    if args.json:
        print(json.dumps({
            "version": VERSION, "mode": mode, "prefix": prefix,
            # Path.is_relative_to is 3.9+; this runs on 3.8 boxes too.
            "specs_dir": _rel_or_abs(specs_dir, root),
            "specs_checked": len(specs), "tests_discovered": len(known_tests),
            "errors": report.errors, "warnings": report.warnings,
        }, indent=2))
        return 0 if report.ok else 1

    label = f"{mode} mode" + (f", prefix {prefix}" if prefix else "")
    if report.warnings:
        print(f"{len(report.warnings)} warning(s):", file=sys.stderr)
        for w in report.warnings:
            print(f"  ~ {w}", file=sys.stderr)
    if report.errors:
        print(f"{len(report.errors)} spec problem(s):", file=sys.stderr)
        for e in report.errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    extra = f", {len(known_tests)} test names discovered" if known_tests else ""
    print(f"specs OK ({len(specs)} checked, {label}{extra})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
