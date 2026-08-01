import { describe, it, expect, vi, beforeEach } from "vitest";
import { cellKeyFor, cellKeysAround, loadTreksAround, resetCellCache } from "./cells";

beforeEach(resetCellCache);

describe("cell maths", () => {
  it("keys coordinates into 1° cells (floor semantics)", () => {
    expect(cellKeyFor(12.97, 77.59)).toBe("12_77");
    expect(cellKeyFor(12.0, 77.0)).toBe("12_77");
    expect(cellKeyFor(-1.2, 36.8)).toBe("-2_36");
  });

  it("covers the radius conservatively", () => {
    const keys = cellKeysAround(12.97, 77.59, 100);
    expect(keys).toContain("12_77");
    expect(keys).toContain("13_78"); // 100 km reaches the neighbours
    expect(keys.length).toBeGreaterThanOrEqual(6); // 2 lat rows × 3 lng cols here
    // 25 km from a cell centre stays within a 2×2 block at most.
    expect(cellKeysAround(12.5, 77.5, 25).length).toBeLessThanOrEqual(4);
  });
});

describe("loadTreksAround", () => {
  const trek = (id: string, lat: number, lng: number) => ({
    id,
    name: id,
    lat,
    lng,
    tier: "discovery",
    sources: [],
    verified: false,
  });

  it("fetches the index once, then only listed intersecting cells, with caching", async () => {
    const getJson = vi.fn(async (path: string) => {
      if (path.endsWith("index.json")) return { cells: { "12_77": 2, "20_85": 1 } };
      if (path.endsWith("12_77.json")) return [trek("a", 12.9, 77.5), trek("b", 12.1, 77.9)];
      throw new Error(`unexpected fetch ${path}`);
    });
    const first = await loadTreksAround(12.97, 77.59, 100, getJson);
    expect(first.map((t) => t.id)).toEqual(["a", "b"]);
    // Second call, same area: everything served from cache.
    await loadTreksAround(12.5, 77.5, 50, getJson);
    const fetched = getJson.mock.calls.map((c) => String(c[0]));
    expect(fetched.filter((p) => p.endsWith("index.json"))).toHaveLength(1);
    expect(fetched.filter((p) => p.endsWith("12_77.json"))).toHaveLength(1);
    // The far-away listed cell was never requested.
    expect(fetched.some((p) => p.endsWith("20_85.json"))).toBe(false);
  });

  it("skips failed cells without failing the whole load, and retries next time", async () => {
    let fail = true;
    const getJson = vi.fn(async (path: string) => {
      if (path.endsWith("index.json")) return { cells: { "12_77": 1, "12_78": 1 } };
      if (path.endsWith("12_78.json")) {
        if (fail) throw new Error("net");
        return [trek("late", 12.5, 78.1)];
      }
      return [trek("ok", 12.5, 77.5)];
    });
    const first = await loadTreksAround(12.5, 77.9, 60, getJson);
    expect(first.map((t) => t.id)).toEqual(["ok"]);
    fail = false;
    const second = await loadTreksAround(12.5, 77.9, 60, getJson);
    expect(second.map((t) => t.id).sort()).toEqual(["late", "ok"]);
  });
});
