import { describe, it, expect } from "vitest";
import { judge, measure, runCheckSize, type SizeIO } from "./check-size";

// Spec 44 rule D5 / register row 4: delight pays its weight. A size budget
// gate exists before any delight ships.
function fakeIO(
  files: Record<string, number>,
  html: string,
  budget?: object,
): SizeIO & {
  logs: string[];
} {
  const logs: string[] = [];
  return {
    logs,
    listAssets: () => Object.entries(files).map(([name, bytes]) => ({ name, bytes })),
    readIndexHtml: () => html,
    readBudget: () => (budget === undefined ? undefined : JSON.stringify(budget)),
    log: (l) => logs.push(l),
  };
}

const HTML = `<script type="module" src="/trailward/assets/index-a.js"></script>
<link rel="modulepreload" href="/trailward/assets/vendor-b.js">
<link rel="stylesheet" href="/trailward/assets/index-c.css">`;

const FILES = {
  "index-a.js": 300,
  "vendor-b.js": 200,
  "index-c.css": 50,
  "palette-d.js": 400, // lazy: not referenced by index.html
  "inter-latin-e.woff2": 90,
  "inter-latin-ext-f.woff2": 80,
  "icon.svg": 5, // neither code nor a font
};

describe("measure", () => {
  it("splits what the first paint waits for from what loads later, and counts fonts apart", () => {
    expect(measure(fakeIO(FILES, HTML))).toEqual({
      initialJsCss: 550,
      totalJsCss: 950,
      fonts: 170,
    });
  });

  it("measures apparent bytes as listed, not blocks", () => {
    expect(measure(fakeIO({ "index-a.js": 1 }, HTML)).totalJsCss).toBe(1);
  });
});

describe("judge", () => {
  const usage = { initialJsCss: 550, totalJsCss: 950, fonts: 170 };

  it("passes inside every budget", () => {
    expect(judge(usage, { initialJsCss: 600, totalJsCss: 1000, fonts: 200 })).toEqual([]);
  });

  it("names each budget that is exceeded, with both numbers", () => {
    expect(judge(usage, { initialJsCss: 500, totalJsCss: 1000, fonts: 100 })).toEqual([
      "initialJsCss: 550 B is over the 500 B budget by 50 B",
      "fonts: 170 B is over the 100 B budget by 70 B",
    ]);
  });

  it("refuses a budget file missing a category, rather than passing it unchecked", () => {
    expect(() => judge(usage, { initialJsCss: 600, totalJsCss: 1000 } as never)).toThrow(/fonts/);
  });
});

describe("runCheckSize", () => {
  const budget = { initialJsCss: 600, totalJsCss: 1000, fonts: 200 };

  it("exits 0 inside budget and reports the headroom", () => {
    const io = fakeIO(FILES, HTML, budget);
    expect(runCheckSize(io)).toBe(0);
    expect(io.logs.join("\n")).toMatch(/initialJsCss: 550 B of 600 B/);
  });

  it("exits 1 over budget", () => {
    expect(runCheckSize(fakeIO(FILES, HTML, { ...budget, totalJsCss: 900 }))).toBe(1);
  });

  it("exits 1 when there is no budget file", () => {
    const io = fakeIO(FILES, HTML);
    expect(runCheckSize(io)).toBe(1);
    expect(io.logs.join("\n")).toMatch(/size-budget\.json/);
  });

  it("exits 1 when index.html references no asset: a measure of nothing proves nothing", () => {
    expect(runCheckSize(fakeIO(FILES, "<html></html>", budget))).toBe(1);
  });

  it("exits 1 when index.html references an asset that is not there", () => {
    expect(runCheckSize(fakeIO({ "vendor-b.js": 200 }, HTML, budget))).toBe(1);
  });
});
