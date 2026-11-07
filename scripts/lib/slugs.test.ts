import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  readRegistry,
  registryFromSlugMap,
  slugsFromRegistry,
  updateRegistry,
  type SlugRegistry,
} from "./slugs";
import { qualifyingTreks } from "./pages";
import type { Trek } from "../../src/lib/trek";
import { memoryIO } from "./buildIO";
import { runBuildSlugs } from "../build-slugs";

// Spec 35 + spec 44 register row 17: a published trek URL must not move or die
// because a rescan regenerated an id or the build order changed.
const mk = (id: string, name: string, lat = 13, lng = 77): Trek => ({
  id,
  name,
  lat,
  lng,
  tier: "discovery",
  sources: [],
  verified: false,
});

describe("updateRegistry", () => {
  it("keeps every registered slug for a record that still has a page", () => {
    const reg: SlugRegistry = { "nandi-hills-gn-2": { id: "gn-2", lat: 13, lng: 77 } };
    // gn-2 now comes first in build order, where slugMap would have given it
    // the bare slug — the registry keeps its published URL.
    const { registry } = updateRegistry([mk("gn-2", "Nandi Hills")], reg);
    expect(registry["nandi-hills-gn-2"].id).toBe("gn-2");
    expect(slugsFromRegistry([mk("gn-2", "Nandi Hills")], registry).get("gn-2")).toBe(
      "nandi-hills-gn-2",
    );
  });

  it("re-attaches a slug to a rescanned record at the same place with the same name", () => {
    const reg: SlugRegistry = {
      "kote-betta-d12-1-2": { id: "d12-1-2", lat: 13.0, lng: 77.0 },
    };
    const rescanned = mk("d12-9-9", "Kote Betta", 13.0005, 77.0005); // ~75 m away
    const { registry, moved } = updateRegistry([rescanned], reg);
    expect(registry["kote-betta-d12-1-2"].id).toBe("d12-9-9");
    expect(moved).toEqual(["kote-betta-d12-1-2"]);
  });

  it("does not re-attach across a different name or more than 120 m", () => {
    const reg: SlugRegistry = { "kote-betta": { id: "d12-1-2", lat: 13.0, lng: 77.0 } };
    const renamed = mk("d12-9-9", "Hulikal Betta", 13.0005, 77.0005);
    const far = mk("d12-8-8", "Kote Betta", 13.01, 77.0); // ~1.1 km
    const { registry } = updateRegistry([renamed, far], reg);
    expect(registry["kote-betta"].id).toBe("d12-1-2");
    expect(registry["hulikal-betta"].id).toBe("d12-9-9");
    expect(registry["kote-betta-d12-8-8"].id).toBe("d12-8-8");
  });

  it("re-attaches only on the same name, not a name the slug merely starts with", () => {
    // "Kote" would take /t/kote-betta/ and "Nandi" /t/nandi-hills-gn-4/ by prefix.
    const reg: SlugRegistry = {
      "kote-betta": { id: "d12-1-2", lat: 13.0, lng: 77.0 },
      "nandi-hills-gn-4": { id: "gn-4", lat: 13.1, lng: 77.1 },
      "nandi-gn-7-2": { id: "gn-7", lat: 13.2, lng: 77.2 },
    };
    const kote = mk("d12-9-9", "Kote", 13.0005, 77.0005);
    const nandi = mk("d12-8-8", "Nandi", 13.1005, 77.1005);
    const { registry, moved } = updateRegistry([kote, nandi], reg);
    expect(moved).toEqual([]);
    expect(registry["kote-betta"].id).toBe("d12-1-2");
    expect(registry["nandi-hills-gn-4"].id).toBe("gn-4");
    // The second-collision form of the same name does re-attach.
    const again = updateRegistry([mk("d12-7-7", "Nandi", 13.2005, 77.2005)], reg);
    expect(again.moved).toEqual(["nandi-gn-7-2"]);
  });

  it("keeps the slug of a record still in the dataset while it has no page", () => {
    // gn-5 dropped below the page bar this build; a same-named rescan nearby
    // must not take its URL, which waits for the page to come back.
    const reg: SlugRegistry = { "kote-betta": { id: "gn-5", lat: 13.0, lng: 77.0 } };
    const dup = mk("d12-1-1", "Kote Betta", 13.0005, 77.0005);
    const { registry, moved } = updateRegistry([dup], reg, new Set(["gn-5", "d12-1-1"]));
    expect(moved).toEqual([]);
    expect(registry["kote-betta"].id).toBe("gn-5");
  });

  it("never hands a retired slug to a different peak", () => {
    // The page for gn-1 is gone this build; its slug stays reserved.
    const reg: SlugRegistry = { "kote-betta": { id: "gn-1", lat: 20, lng: 80 } };
    const { registry, added } = updateRegistry([mk("gn-5", "Kote Betta")], reg);
    expect(registry["kote-betta"].id).toBe("gn-1");
    expect(registry["kote-betta-gn-5"].id).toBe("gn-5");
    expect(added).toEqual(["kote-betta-gn-5"]);
  });

  it("gives a new page its bare slug when it is free", () => {
    const { registry } = updateRegistry([mk("gn-7", "Kumāra Parvatha")], {});
    expect(registry["kumara-parvatha"]).toEqual({ id: "gn-7", lat: 13, lng: 77 });
  });

  it("is idempotent", () => {
    const pages = [mk("a", "X"), mk("b", "X"), mk("c", "Y")];
    const once = updateRegistry(pages, {}).registry;
    const twice = updateRegistry(pages, once);
    expect(twice.registry).toEqual(once);
    expect(twice.added).toEqual([]);
    expect(twice.moved).toEqual([]);
  });
});

describe("slugsFromRegistry", () => {
  it("refuses a page with no registered slug, naming the command that fixes it", () => {
    expect(() => slugsFromRegistry([mk("gn-1", "A")], {})).toThrow(/gn-1.*npm run build:slugs/);
  });

  it("refuses a registry that gives one record two slugs", () => {
    const reg: SlugRegistry = {
      a: { id: "gn-1", lat: 13, lng: 77 },
      b: { id: "gn-1", lat: 13, lng: 77 },
    };
    expect(() => slugsFromRegistry([mk("gn-1", "A")], reg)).toThrow(/gn-1.*two slugs/);
  });

  it("refuses a slug that is not URL-safe", () => {
    const reg: SlugRegistry = { "Bad Slug": { id: "gn-1", lat: 13, lng: 77 } };
    expect(() => slugsFromRegistry([mk("gn-1", "A")], reg)).toThrow(/not a usable slug/);
  });

  it("accepts an upper-case Wikidata suffix, as four live URLs have", () => {
    const reg: SlugRegistry = {
      "bandarpunch-wd-Q4854459": { id: "wd-Q4854459", lat: 31, lng: 78 },
    };
    expect(slugsFromRegistry([mk("wd-Q4854459", "Bandarpunch")], reg).get("wd-Q4854459")).toBe(
      "bandarpunch-wd-Q4854459",
    );
  });
});

describe("readRegistry", () => {
  it("refuses a malformed registry by name", () => {
    expect(() => readRegistry("[{")).toThrow(/slugs\.json is not valid JSON/);
    expect(() => readRegistry("[]")).toThrow(/slugs\.json is not an object/);
    expect(() => readRegistry('{"a": null}')).toThrow(/"a" has no record id/);
  });
});

describe("the committed registry against the committed dataset (CON-COV-003)", () => {
  it("gives every real page exactly one usable slug", () => {
    // Fixtures make their own registries; this is the pair the build reads.
    const root = resolve(__dirname, "../..");
    const treks = JSON.parse(readFileSync(resolve(root, "src/data/treks.json"), "utf8")) as Trek[];
    const reg = readRegistry(readFileSync(resolve(root, "scripts/pages/slugs.json"), "utf8"));
    const pages = qualifyingTreks(treks);
    expect(slugsFromRegistry(pages, reg).size).toBe(pages.length);
  }, 60_000);
});

describe("registryFromSlugMap — the first registry records today's URLs exactly", () => {
  it("maps each slug to its record and position", () => {
    const pages = [mk("a", "X", 12.123456, 77.654321), mk("b", "X")];
    const reg = registryFromSlugMap(
      pages,
      new Map([
        ["a", "x"],
        ["b", "x-b"],
      ]),
    );
    expect(reg).toEqual({
      x: { id: "a", lat: 12.12346, lng: 77.65432 },
      "x-b": { id: "b", lat: 13, lng: 77 },
    });
  });
});

describe("runBuildSlugs", () => {
  const P = { treks: "/repo/src/data/treks.json", slugs: "/repo/scripts/pages/slugs.json" };
  const treks = [
    { ...mk("gn-1", "Kote Betta"), highlights: "A fort." },
    { ...mk("gn-2", "Kote Betta", 14, 78), highlights: "Another fort." },
  ];

  it("writes the first registry from today's URLs exactly", () => {
    const io = memoryIO({ [P.treks]: JSON.stringify(treks) });
    runBuildSlugs(io, "/repo");
    expect(Object.keys(JSON.parse(io.files.get(P.slugs)!))).toEqual([
      "kote-betta",
      "kote-betta-gn-2",
    ]);
  });

  it("refuses to write a registry the build would refuse", () => {
    const io = memoryIO({
      [P.treks]: JSON.stringify(treks),
      [P.slugs]: JSON.stringify({ "Bad Slug": { id: "gn-9", lat: 1, lng: 1 } }),
    });
    const before = io.files.get(P.slugs);
    expect(() => runBuildSlugs(io, "/repo")).toThrow(/not a usable slug/);
    expect(io.files.get(P.slugs)).toBe(before);
  });

  it("adds a new page and leaves every existing slug alone", () => {
    const io = memoryIO({ [P.treks]: JSON.stringify(treks) });
    runBuildSlugs(io, "/repo");
    const before = JSON.parse(io.files.get(P.slugs)!) as SlugRegistry;
    // gn-1's page goes away; a new peak takes the same name.
    io.writeFile(
      P.treks,
      JSON.stringify([treks[1], { ...mk("gn-3", "Kote Betta", 15, 79), highlights: "x" }]),
    );
    const r = runBuildSlugs(io, "/repo");
    const after = JSON.parse(io.files.get(P.slugs)!) as SlugRegistry;
    expect(r.added).toEqual(["kote-betta-gn-3"]);
    for (const [slug, e] of Object.entries(before)) expect(after[slug]).toEqual(e);
  });
});
