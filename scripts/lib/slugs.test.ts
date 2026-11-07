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

/** The pages are the whole dataset unless a test says otherwise. */
const upd = (pages: Trek[], reg: SlugRegistry, ids?: Set<string>) =>
  updateRegistry(pages, reg, ids ?? new Set(pages.map((t) => t.id)));

describe("updateRegistry", () => {
  it("keeps every registered slug for a record that still has a page", () => {
    const reg: SlugRegistry = {
      "nandi-hills-gn-2": { id: "gn-2", lat: 13, lng: 77, name: "nandi-hills" },
    };
    // gn-2 now comes first in build order, where slugMap would have given it
    // the bare slug — the registry keeps its published URL.
    const { registry } = upd([mk("gn-2", "Nandi Hills")], reg);
    expect(registry["nandi-hills-gn-2"].id).toBe("gn-2");
    expect(slugsFromRegistry([mk("gn-2", "Nandi Hills")], registry).get("gn-2")).toBe(
      "nandi-hills-gn-2",
    );
  });

  it("re-attaches a slug to a rescanned record at the same place with the same name", () => {
    const reg: SlugRegistry = {
      "kote-betta-d12-1-2": { id: "d12-1-2", lat: 13.0, lng: 77.0, name: "kote-betta" },
    };
    const rescanned = mk("d12-9-9", "Kote Betta", 13.0005, 77.0005); // ~75 m away
    const { registry, moved } = upd([rescanned], reg);
    expect(registry["kote-betta-d12-1-2"].id).toBe("d12-9-9");
    expect(moved).toEqual(["kote-betta-d12-1-2"]);
  });

  it("does not re-attach across a different name or more than 120 m", () => {
    const reg: SlugRegistry = {
      "kote-betta": { id: "d12-1-2", lat: 13.0, lng: 77.0, name: "kote-betta" },
    };
    const renamed = mk("d12-9-9", "Hulikal Betta", 13.0005, 77.0005);
    const far = mk("d12-8-8", "Kote Betta", 13.01, 77.0); // ~1.1 km
    const { registry } = upd([renamed, far], reg);
    expect(registry["kote-betta"].id).toBe("d12-1-2");
    expect(registry["hulikal-betta"].id).toBe("d12-9-9");
    expect(registry["kote-betta-d12-8-8"].id).toBe("d12-8-8");
  });

  it("re-attaches only on the same name, not a name the slug merely starts with", () => {
    // "Kote" would take /t/kote-betta/ and "Nandi" /t/nandi-hills-gn-4/ by prefix.
    const reg: SlugRegistry = {
      "kote-betta": { id: "d12-1-2", lat: 13.0, lng: 77.0, name: "kote-betta" },
      "nandi-hills-gn-4": { id: "gn-4", lat: 13.1, lng: 77.1, name: "nandi-hills" },
      "nandi-gn-7-2": { id: "gn-7", lat: 13.2, lng: 77.2, name: "nandi" },
    };
    const kote = mk("d12-9-9", "Kote", 13.0005, 77.0005);
    const nandi = mk("d12-8-8", "Nandi", 13.1005, 77.1005);
    const { registry, moved } = upd([kote, nandi], reg);
    expect(moved).toEqual([]);
    expect(registry["kote-betta"].id).toBe("d12-1-2");
    expect(registry["nandi-hills-gn-4"].id).toBe("gn-4");
    // The second-collision form of the same name does re-attach.
    const again = upd([mk("d12-7-7", "Nandi", 13.2005, 77.2005)], reg);
    expect(again.moved).toEqual(["nandi-gn-7-2"]);
  });

  it("keeps re-attaching across repeated rescans, whatever id the slug was first given", () => {
    // The slug keeps its first id suffix while the record's id moves on.
    let reg: SlugRegistry = {
      "kote-betta-d12-1-2": { id: "d12-1-2", lat: 13.0, lng: 77.0, name: "kote-betta" },
    };
    for (const id of ["d12-5-5", "d12-9-9", "d12-3-3"]) {
      const r = upd([mk(id, "Kote Betta", 13.0003, 77.0003)], reg);
      expect(r.moved, id).toEqual(["kote-betta-d12-1-2"]);
      expect(r.added, id).toEqual([]);
      reg = r.registry;
    }
  });

  it("re-attaches a page whose name has no Latin letters, whose slug is an id", () => {
    const reg: SlugRegistry = { "d12-1-1": { id: "d12-1-1", lat: 13.0, lng: 77.0, name: "" } };
    const r = upd([mk("d12-7-7", "ಕೋಟೆ", 13.0003, 77.0003)], reg);
    expect(r.moved).toEqual(["d12-1-1"]);
  });

  it("re-attaches a page whose id equals its slug, on its recorded name", () => {
    // 15 curated ids are their slugified names (kunti-betta, nandi-hills, …).
    const reg: SlugRegistry = {
      "kunti-betta-d12-1-2": { id: "d12-1-2", lat: 13.0, lng: 77.0, name: "kunti-betta" },
      "d12-5-5": { id: "d12-5-5", lat: 13.0, lng: 77.0, name: "" },
    };
    const curated = mk("kunti-betta", "Kunti Betta", 13.0003, 77.0003);
    const r = upd([curated], reg);
    expect(r.moved).toEqual(["kunti-betta-d12-1-2"]);
    expect(r.registry["d12-5-5"].id).toBe("d12-5-5"); // a nameless page's URL is not taken
  });

  it("gives the slug to the nearest same-named record when two qualify", () => {
    const reg: SlugRegistry = {
      "kote-betta": { id: "a", lat: 13.0, lng: 77.0, name: "kote-betta" },
      "kote-betta-gn-2": { id: "b", lat: 13.0008, lng: 77.0, name: "kote-betta" },
    };
    // ~56 m from a (which sorts first) and ~33 m from b.
    const r = upd([mk("d12-9-9", "Kote Betta", 13.0005, 77.0)], reg);
    expect(r.moved).toEqual(["kote-betta-gn-2"]);
  });

  it("never mints a slug that differs only in case from one already held", () => {
    // The bare slug is held in another case, so a case-blind check is needed.
    const reg: SlugRegistry = {
      Foo: { id: "gn-2", lat: 20, lng: 80, name: "foo" },
      "foo-wd-q1": { id: "gn-1", lat: 21, lng: 81, name: "foo" },
    };
    const r = upd([mk("wd-Q1", "Foo")], reg);
    expect(r.added).toEqual(["foo-wd-Q1-2"]);
    expect(() => slugsFromRegistry([mk("wd-Q1", "Foo")], r.registry)).not.toThrow();
  });

  it("keeps the slug of a record still in the dataset while it has no page", () => {
    // gn-5 dropped below the page bar this build; a same-named rescan nearby
    // must not take its URL, which waits for the page to come back.
    const reg: SlugRegistry = {
      "kote-betta": { id: "gn-5", lat: 13.0, lng: 77.0, name: "kote-betta" },
    };
    const dup = mk("d12-1-1", "Kote Betta", 13.0005, 77.0005);
    const { registry, moved } = upd([dup], reg, new Set(["gn-5", "d12-1-1"]));
    expect(moved).toEqual([]);
    expect(registry["kote-betta"].id).toBe("gn-5");
  });

  it("never hands a retired slug to a different peak", () => {
    // The page for gn-1 is gone this build; its slug stays reserved.
    const reg: SlugRegistry = {
      "kote-betta": { id: "gn-1", lat: 20, lng: 80, name: "kote-betta" },
    };
    const { registry, added } = upd([mk("gn-5", "Kote Betta")], reg);
    expect(registry["kote-betta"].id).toBe("gn-1");
    expect(registry["kote-betta-gn-5"].id).toBe("gn-5");
    expect(added).toEqual(["kote-betta-gn-5"]);
  });

  it("gives a new page its bare slug when it is free", () => {
    const { registry } = upd([mk("gn-7", "Kumāra Parvatha")], {});
    expect(registry["kumara-parvatha"]).toEqual({
      id: "gn-7",
      lat: 13,
      lng: 77,
      name: "kumara-parvatha",
    });
  });

  it("is idempotent", () => {
    const pages = [mk("a", "X"), mk("b", "X"), mk("c", "Y")];
    const once = upd(pages, {}).registry;
    const twice = upd(pages, once);
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
      a: { id: "gn-1", lat: 13, lng: 77, name: "a" },
      b: { id: "gn-1", lat: 13, lng: 77, name: "a" },
    };
    expect(() => slugsFromRegistry([mk("gn-1", "A")], reg)).toThrow(/gn-1.*two slugs/);
  });

  it("refuses a slug that is not URL-safe", () => {
    const reg: SlugRegistry = { "Bad Slug": { id: "gn-1", lat: 13, lng: 77, name: "Bad Slug" } };
    expect(() => slugsFromRegistry([mk("gn-1", "A")], reg)).toThrow(/not a usable slug/);
  });

  it("refuses two slugs that differ only in case (one directory on macOS)", () => {
    const reg: SlugRegistry = {
      "foo-wd-Q1": { id: "wd-Q1", lat: 1, lng: 1, name: "foo" },
      "foo-wd-q1": { id: "wd-q1", lat: 1, lng: 1, name: "foo" },
    };
    expect(() => slugsFromRegistry([mk("wd-Q1", "Foo")], reg)).toThrow(/differ only in case/);
  });

  it("accepts an upper-case Wikidata suffix, as four live URLs have", () => {
    const reg: SlugRegistry = {
      "bandarpunch-wd-Q4854459": { id: "wd-Q4854459", lat: 31, lng: 78, name: "bandarpunch" },
    };
    expect(slugsFromRegistry([mk("wd-Q4854459", "Bandarpunch")], reg).get("wd-Q4854459")).toBe(
      "bandarpunch-wd-Q4854459",
    );
  });
});

describe("readRegistry", () => {
  it("refuses a malformed registry by name", () => {
    expect(() => readRegistry('{"a": {"id": "gn-1", "lng": 77}}')).toThrow(/"a" has no position/);
    expect(() => readRegistry('{"a": {"id": "gn-1", "lat": 1, "lng": 77}}')).toThrow(
      /"a" has no recorded name/,
    );
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
      x: { id: "a", lat: 12.12346, lng: 77.65432, name: "x" },
      "x-b": { id: "b", lat: 13, lng: 77, name: "x" },
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
      [P.slugs]: JSON.stringify({ "Bad Slug": { id: "gn-9", lat: 1, lng: 1, name: "Bad Slug" } }),
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
