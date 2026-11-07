import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  nameKey,
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
const upd = (pages: Trek[], reg: SlugRegistry, dataset?: Trek[]) =>
  updateRegistry(pages, reg, dataset ?? pages);

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
    const reg: SlugRegistry = {
      "d12-1-1": { id: "d12-1-1", lat: 13.0, lng: 77.0, name: "~ಕೋಟೆ" },
    };
    const r = upd([mk("d12-7-7", "ಕೋಟೆ", 13.0003, 77.0003)], reg);
    expect(r.moved).toEqual(["d12-1-1"]);
  });

  it("re-attaches a page whose id equals its slug, on its recorded name", () => {
    // 15 curated ids are their slugified names (kunti-betta, nandi-hills, …).
    const reg: SlugRegistry = {
      "kunti-betta-d12-1-2": { id: "d12-1-2", lat: 13.0, lng: 77.0, name: "kunti-betta" },
      "d12-5-5": { id: "d12-5-5", lat: 13.0, lng: 77.0, name: "~ಕೋಟೆ" },
    };
    const curated = mk("kunti-betta", "Kunti Betta", 13.0003, 77.0003);
    const r = upd([curated], reg);
    expect(r.moved).toEqual(["kunti-betta-d12-1-2"]);
    expect(r.registry["d12-5-5"].id).toBe("d12-5-5"); // a nameless page's URL is not taken
  });

  it("re-attaches nothing when two same-named orphans could be the page", () => {
    const reg: SlugRegistry = {
      "kote-betta": { id: "a", lat: 13.0, lng: 77.0, name: "kote-betta" },
      "kote-betta-gn-2": { id: "b", lat: 13.0008, lng: 77.0, name: "kote-betta" },
    };
    const r = upd([mk("d12-9-9", "Kote Betta", 13.0005, 77.0)], reg);
    expect(r.moved).toEqual([]);
    expect(r.added).toEqual(["kote-betta-d12-9-9"]);
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

  it("never gives a URL to a different peak when two same-named summits are rescanned", () => {
    // Nearest-first gave A (x rescanned) y's URL here and orphaned x's.
    const reg: SlugRegistry = {
      "kote-betta": { id: "x", lat: 13.0, lng: 77.0, name: "kote-betta" },
      "kote-betta-y": { id: "y", lat: 13.0009, lng: 77.0, name: "kote-betta" },
    };
    for (const order of [
      ["A", "B"],
      ["B", "A"],
    ]) {
      const at = { A: 13.0005, B: 13.00135 } as Record<string, number>;
      const pages = order.map((id) => mk(`d12-${id}`, "Kote Betta", at[id], 77.0));
      const { moved, registry } = upd(pages, reg);
      expect(moved, order.join()).toEqual([]);
      expect(registry["kote-betta"].id).toBe("x"); // retired, not handed over
      expect(registry["kote-betta-y"].id).toBe("y");
    }
  });

  it("re-attaches each of two same-named summits when each match is unambiguous", () => {
    const reg: SlugRegistry = {
      "kote-betta": { id: "x", lat: 13.0, lng: 77.0, name: "kote-betta" },
      "kote-betta-y": { id: "y", lat: 13.01, lng: 77.0, name: "kote-betta" }, // 1.1 km apart
    };
    const r = upd(
      [mk("d12-1", "Kote Betta", 13.0003, 77), mk("d12-2", "Kote Betta", 13.0103, 77)],
      reg,
    );
    expect(r.registry["kote-betta"].id).toBe("d12-1");
    expect(r.registry["kote-betta-y"].id).toBe("d12-2");
  });

  it("tallies slugs and ids separately, so a slug equal to an id is not a false tie", () => {
    const reg: SlugRegistry = {
      "d12-5-5": { id: "d12-7-7", lat: 13, lng: 77, name: "~" },
      "kote-betta": { id: "gone", lat: 14, lng: 77, name: "kote-betta" },
    };
    const r = upd([mk("d12-9-9", "", 13.0002, 77), mk("d12-5-5", "Kote Betta", 14.0002, 77)], reg);
    expect(r.moved.sort()).toEqual(["d12-5-5", "kote-betta"]);
  });

  it("counts a same-named new record without a page as a rival candidate", () => {
    // d12-R is 11 m from the orphan, the page d12-P ~100 m: nobody can tell.
    const reg: SlugRegistry = {
      "kote-betta": { id: "x", lat: 13.0, lng: 77.0, name: "kote-betta" },
    };
    const page = mk("d12-P", "Kote Betta", 13.0009, 77);
    const rival = mk("d12-R", "Kote Betta", 13.0001, 77);
    const r = upd([page], reg, [page, rival]);
    expect(r.moved).toEqual([]);
  });

  it("follows a rename of a record that has no page", () => {
    const reg: SlugRegistry = {
      "kote-betta": { id: "gn-1", lat: 13, lng: 77, name: "kote-betta" },
    };
    const r = upd([], reg, [mk("gn-1", "Kote Betta Fort", 13, 77)]);
    expect(r.registry["kote-betta"].name).toBe("kote-betta-fort");
    expect(r.followed).toEqual(["kote-betta"]);
  });

  it("keys a name with any non-Latin letter by itself, digits and all", () => {
    expect(nameKey(mk("a", "ಕೋಟೆ 2"))).toBe("~ಕೋಟೆ 2");
    expect(nameKey(mk("a", "ಬೆಟ್ಟ 2"))).not.toBe(nameKey(mk("a", "ಕೋಟೆ 2")));
    expect(nameKey(mk("a", "ಕೋಟೆ 2A"))).not.toBe(nameKey(mk("a", "ಬೆಟ್ಟ 2A")));
    expect(nameKey(mk("a", "ಕೋಟೆ Hill"))).not.toBe(nameKey(mk("a", "ಬೆಟ್ಟ Hill")));
    // Spacing is not identity; a digits-only name keys by its fold.
    expect(nameKey(mk("a", " ಕೋಟೆ  2 "))).toBe(nameKey(mk("a", "ಕೋಟೆ 2")));
    expect(nameKey(mk("a", "1075 "))).toBe("1075");
    // No letter at all: keyed by the name, so different ones never match.
    expect(nameKey(mk("a", "१०७५"))).not.toBe(nameKey(mk("a", "२३४")));
    expect(nameKey(mk("a", ""))).toBe("~");
    expect(() =>
      readRegistry(JSON.stringify({ "gn-77": { id: "gn-77", lat: 1, lng: 1, name: "~" } })),
    ).not.toThrow();
  });

  it("follows a rename, so the next rescan matches the new name", () => {
    const reg: SlugRegistry = {
      "kote-betta": { id: "gn-1", lat: 13, lng: 77, name: "kote-betta" },
    };
    const renamed = upd([mk("gn-1", "Kote Betta Fort", 13, 77)], reg).registry;
    expect(renamed["kote-betta"].name).toBe("kote-betta-fort");
    const r = upd([mk("d12-9-9", "Kote Betta Fort", 13.0003, 77)], renamed);
    expect(r.moved).toEqual(["kote-betta"]);
  });

  it("never matches two different names with no Latin letters", () => {
    const reg: SlugRegistry = { "d12-1-1": { id: "d12-1-1", lat: 13, lng: 77, name: "~ಬೆಟ್ಟ" } };
    const r = upd([mk("d12-7-7", "ಕೋಟೆ", 13.0003, 77)], reg);
    expect(r.moved).toEqual([]);
  });

  it("keeps the slug of a record still in the dataset while it has no page", () => {
    // gn-5 dropped below the page bar this build; a same-named rescan nearby
    // must not take its URL, which waits for the page to come back.
    const reg: SlugRegistry = {
      "kote-betta": { id: "gn-5", lat: 13.0, lng: 77.0, name: "kote-betta" },
    };
    const dup = mk("d12-1-1", "Kote Betta", 13.0005, 77.0005);
    const { registry, moved } = upd([dup], reg, [mk("gn-5", "Kote Betta", 13.0, 77.0), dup]);
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
    // A hand edit that is not folded would never match a rescan.
    expect(() =>
      readRegistry('{"a": {"id": "gn-1", "lat": 1, "lng": 77, "name": "Kote Betta"}}'),
    ).toThrow(/"a" has no recorded name in folded form/);
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
    // Each entry's recorded name is its record's (CON-COV-003: the migration's gate).
    const byId = new Map(treks.map((t) => [t.id, t]));
    const wrong = Object.entries(reg).filter(([, e]) => {
      const t = byId.get(e.id);
      return t !== undefined && e.name !== nameKey(t);
    });
    expect(wrong.slice(0, 5)).toEqual([]);
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
      [P.slugs]: JSON.stringify({ "Bad Slug": { id: "gn-9", lat: 1, lng: 1, name: "bad-slug" } }),
    });
    const before = io.files.get(P.slugs);
    expect(() => runBuildSlugs(io, "/repo")).toThrow(/not a usable slug/);
    expect(io.files.get(P.slugs)).toBe(before);
  });

  it("passes the whole dataset, so a page-less record's rename is followed", () => {
    const io = memoryIO({ [P.treks]: JSON.stringify(treks) });
    runBuildSlugs(io, "/repo");
    // gn-2 is renamed to an unnamed placeholder, which earns no page.
    const renamed = mk("gn-2", "Unnamed peak (~900 m)", 14, 78);
    io.writeFile(P.treks, JSON.stringify([treks[0], renamed]));
    const r = runBuildSlugs(io, "/repo");
    const after = JSON.parse(io.files.get(P.slugs)!) as SlugRegistry;
    expect(after["kote-betta-gn-2"].id).toBe("gn-2"); // kept while it has no page
    expect(after["kote-betta-gn-2"].name).toBe("unnamed-peak-900-m");
    expect(r.followed).toEqual(["kote-betta-gn-2"]);
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
