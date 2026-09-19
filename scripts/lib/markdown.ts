/**
 * A deliberately small markdown renderer (spec 36).
 *
 * Why not remark/unified: this project ships no markdown dependency, and the
 * corpus is three hand-written pages of headings, paragraphs, lists, links,
 * tables and inline code — all reviewed. A full CommonMark stack would be a
 * large new dependency and a much larger attack surface for that.
 *
 * The rules that matter more than feature coverage:
 *  - text is ESCAPED by default; raw HTML in source is rendered inert, because
 *    this is the only injection path into pages nobody reads line by line;
 *  - a link or image that violates policy throws AT BUILD TIME — a live page
 *    with a broken link is worse than a build that stops.
 */

export interface Frontmatter {
  title: string;
  description: string;
  /** The content's own date, never the build's. */
  updated?: string;
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function parseFrontmatter(src: string, file: string): { data: Frontmatter; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src);
  if (!m) throw new Error(`[content] ${file}: missing frontmatter block`);
  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  for (const key of ["title", "description"]) {
    if (!data[key]) throw new Error(`[content] ${file}: frontmatter is missing '${key}'`);
  }
  return { data: data as unknown as Frontmatter, body: m[2] };
}

/** Links must be site-relative or https; images must carry alt text. */
function checkLink(href: string, file: string, what: string): void {
  if (href.startsWith("/trailward/") || href.startsWith("#")) return;
  if (href.startsWith("https://")) return;
  if (href.startsWith("http://")) {
    throw new Error(`[content] ${file}: insecure http link '${href}' — use https`);
  }
  throw new Error(
    `[content] ${file}: ${what} '${href}' must be site-relative (/trailward/…) or https — ` +
      "a bare relative path breaks under the base path",
  );
}

/**
 * Inline spans: code, images, links, emphasis. Everything else is escaped.
 *
 * Rendered spans are parked behind a sentinel while the surrounding text is
 * escaped, then restored. The sentinel is a Unicode private-use character —
 * it cannot occur in prose — and restoration SPLITS on it rather than matching
 * a regex, so there is no escaping surface to get wrong.
 */
function inline(src: string, file: string): string {
  const SENTINEL = String.fromCharCode(0xe000);
  const placeholders: string[] = [];
  const keep = (html: string): string => {
    placeholders.push(html);
    return `${SENTINEL}${placeholders.length - 1}${SENTINEL}`;
  };

  let s = src;
  // Code first: its contents must not be interpreted as anything else.
  s = s.replace(/`([^`]+)`/g, (_m, code: string) => keep(`<code>${esc(code)}</code>`));
  // Images before links — the syntaxes overlap.
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, href: string) => {
    if (!alt.trim()) throw new Error(`[content] ${file}: image '${href}' has no alt text`);
    checkLink(href, file, "image");
    return keep(`<img src="${esc(href)}" alt="${esc(alt)}" loading="lazy" />`);
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, href: string) => {
    checkLink(href, file, "link");
    const external = href.startsWith("https://");
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : "";
    return keep(`<a href="${esc(href)}"${attrs}>${esc(text)}</a>`);
  });

  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Odd segments are placeholder indices by construction.
  return s
    .split(SENTINEL)
    .map((part, i) => (i % 2 === 1 ? placeholders[Number(part)] : part))
    .join("");
}

function renderTable(rows: string[], file: string): string {
  const cells = (line: string) =>
    line
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  const head = cells(rows[0])
    .map((c) => `<th>${inline(c, file)}</th>`)
    .join("");
  const body = rows
    .slice(2) // row 1 is the --- separator
    .map(
      (r) =>
        `<tr>${cells(r)
          .map((c) => `<td>${inline(c, file)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function renderMarkdown(src: string, file: string): string {
  const out: string[] = [];
  const lines = src.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = inline(heading[2], file);
      out.push(`<h${level} id="${slugify(heading[2])}">${text}</h${level}>`);
      i++;
      continue;
    }

    if (line.trimStart().startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("|")) rows.push(lines[i++]);
      out.push(renderTable(rows, file));
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""), file)}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*[-*]\s|\s*\|)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    out.push(`<p>${inline(para.join(" ").trim(), file)}</p>`);
  }

  return out.join("\n");
}
