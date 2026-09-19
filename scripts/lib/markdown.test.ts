import { describe, it, expect } from "vitest";
import { parseFrontmatter, renderMarkdown } from "./markdown";

describe("parseFrontmatter (spec 36)", () => {
  it("reads title, description and updated, returning the body", () => {
    const { data, body } = parseFrontmatter(
      [
        "---",
        "title: About",
        "description: What this is",
        "updated: 2026-09-19",
        "---",
        "",
        "# Hi",
      ].join("\n"),
      "about.md",
    );
    expect(data.title).toBe("About");
    expect(data.description).toBe("What this is");
    expect(data.updated).toBe("2026-09-19");
    expect(body.trim()).toBe("# Hi");
  });

  it("throws naming the file when a required key is missing", () => {
    expect(() => parseFrontmatter("---\ntitle: X\n---\nbody", "sources.md")).toThrow(
      /sources\.md.*description/s,
    );
    expect(() => parseFrontmatter("no frontmatter at all", "about.md")).toThrow(/about\.md/);
  });
});

describe("renderMarkdown (spec 36)", () => {
  const md = (s: string) => renderMarkdown(s, "t.md");

  it("renders headings, paragraphs, lists and inline code", () => {
    const out = md("## Heading\n\nSome *text*.\n\n- one\n- two\n\nUse `npm run build`.");
    expect(out).toContain("<h2");
    expect(out).toContain("<p>Some <em>text</em>.</p>");
    expect(out).toContain("<li>one</li>");
    expect(out).toContain("<code>npm run build</code>");
  });

  it("renders tables (the sources page is a table)", () => {
    const out = md("| Source | Licence |\n| --- | --- |\n| GeoNames | CC-BY 4.0 |");
    expect(out).toContain("<table>");
    expect(out).toContain("<th>Source</th>");
    expect(out).toContain("<td>GeoNames</td>");
  });

  it("hardens external links and leaves site-relative ones alone", () => {
    const ext = md("[OSM](https://www.openstreetmap.org/copyright)");
    expect(ext).toContain('rel="noopener noreferrer"');
    expect(ext).toContain('target="_blank"');
    const rel = md("[map](/trailward/)");
    expect(rel).not.toContain("noopener");
  });

  it("ESCAPES text — raw HTML in source is inert, never markup", () => {
    const out = md("Hello <script>alert(1)</script> & <b>bold</b>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&amp;");
  });

  describe("policy — a broken page must fail the BUILD, not ship", () => {
    it("rejects a relative link that would break under the base path", () => {
      expect(() => md("[about](about.html)")).toThrow(/t\.md.*link/is);
    });

    it("rejects an insecure external link", () => {
      expect(() => md("[x](http://example.com)")).toThrow(/t\.md.*http/is);
    });

    it("rejects an image without alt text", () => {
      expect(() => md("![](/trailward/icon.svg)")).toThrow(/t\.md.*alt/is);
      expect(() => md("![a hill](/trailward/icon.svg)")).not.toThrow();
    });
  });
});

describe("renderMarkdown — inline placeholders must not collide with prose", () => {
  it("leaves ordinary numbers in text alone", () => {
    // The restore pass uses a sentinel; a naive one collides with any bare
    // number in the copy, which is everywhere in this project's prose.
    const out = renderMarkdown("There are 3 sources and 1 licence.", "t.md");
    expect(out).toBe("<p>There are 3 sources and 1 licence.</p>");
    expect(out).not.toContain("undefined");
  });

  it("restores real inline spans alongside numbers", () => {
    const out = renderMarkdown("See [OSM](https://osm.org) for 2 of the 5 layers.", "t.md");
    expect(out).toContain(">OSM</a>");
    expect(out).toContain("for 2 of the 5 layers.");
    expect(out).not.toContain("undefined");
  });
});

describe("renderMarkdown policy — document structure (spec 36)", () => {
  it("throws on a second h1: page structure must fail the BUILD, not a later test", () => {
    expect(() => renderMarkdown("# One\n\ntext\n\n# Two", "about.md")).toThrow(/about\.md.*h1/is);
  });

  it("allows one h1 with any number of lower headings", () => {
    expect(() => renderMarkdown("# One\n\n## A\n\n### B\n\n## C", "about.md")).not.toThrow();
  });
});
