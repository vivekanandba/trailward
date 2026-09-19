/**
 * A small, dependency-free accessibility audit (spec 37).
 *
 * Why not jest-axe: this machine has no registry access, so a new dependency
 * cannot enter package-lock.json and `npm ci` in CI would fail on a
 * package.json that names one. What follows is the subset of rules that
 * matter for this app AND that jsdom can actually decide.
 *
 * It is a FLOOR, not a certificate. It cannot see colour contrast (see
 * assertContrast below), focus-visible styling, or real focus order — those
 * are covered by the token test and the e2e/visual suites. If registry access
 * appears, adding jest-axe alongside is the obvious upgrade.
 */

export interface A11yViolation {
  rule: string;
  detail: string;
}

const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';

/** The accessible name of an element, by the paths jsdom can resolve. */
function accessibleName(el: Element): string {
  const label = el.getAttribute("aria-label");
  if (label?.trim()) return label.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const names = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim() ?? "")
      .join(" ")
      .trim();
    if (names) return names;
  }
  if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") {
    const id = el.getAttribute("id");
    if (id) {
      const lab = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lab?.textContent?.trim()) return lab.textContent.trim();
    }
    if (el.closest("label")?.textContent?.trim()) return el.closest("label")!.textContent!.trim();
    const title = el.getAttribute("title");
    if (title?.trim()) return title.trim();
    return "";
  }
  // An image inside a control contributes its alt text.
  const text = (el.textContent ?? "").trim();
  if (text) return text;
  const img = el.querySelector("img[alt]");
  return img?.getAttribute("alt")?.trim() ?? "";
}

export function auditA11y(root: ParentNode): A11yViolation[] {
  const v: A11yViolation[] = [];
  const push = (rule: string, detail: string) => v.push({ rule, detail });

  // Interactive elements need a name a screen reader can announce.
  for (const el of root.querySelectorAll("button,a[href],[role='button']")) {
    if (el.closest('[aria-hidden="true"]')) continue;
    if (!accessibleName(el)) {
      push("name", `<${el.tagName.toLowerCase()}> has no accessible name`);
    }
  }

  // Images: alt is required; empty alt is a valid "decorative" declaration.
  for (const img of root.querySelectorAll("img")) {
    if (!img.hasAttribute("alt")) push("alt", `<img src="${img.getAttribute("src")}"> has no alt`);
  }

  // Form controls need a label.
  for (const el of root.querySelectorAll("input,select,textarea")) {
    const type = el.getAttribute("type");
    if (type === "hidden" || el.closest('[aria-hidden="true"]')) continue;
    if (!accessibleName(el)) push("label", `<${el.tagName.toLowerCase()}> has no label`);
  }

  // One h1, and heading levels must not skip.
  const headings = [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")];
  const h1s = headings.filter((h) => h.tagName === "H1");
  if (h1s.length > 1) push("one-h1", `${h1s.length} <h1> elements — a document has one`);
  let previous = 0;
  for (const h of headings) {
    const level = Number(h.tagName[1]);
    if (previous && level > previous + 1) {
      push("heading-order", `h${previous} is followed by h${level}`);
    }
    previous = level;
  }

  // A focusable element inside aria-hidden is reachable by keyboard but
  // invisible to assistive tech — the worst of both.
  for (const hidden of root.querySelectorAll('[aria-hidden="true"]')) {
    const focusable = hidden.querySelector(FOCUSABLE);
    if (focusable) {
      push(
        "aria-hidden-focusable",
        `<${focusable.tagName.toLowerCase()}> is focusable inside aria-hidden`,
      );
    }
  }

  return v;
}

// ---------------------------------------------------------------- contrast

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Throws unless the pair meets `min` — the gate must enforce, not decorate. */
export function assertContrast(fg: string, bg: string, min: number): void {
  const ratio = contrastRatio(fg, bg);
  if (ratio < min) {
    throw new Error(
      `contrast ${ratio.toFixed(2)}:1 between ${fg} and ${bg} is below the required ${min}:1`,
    );
  }
}
