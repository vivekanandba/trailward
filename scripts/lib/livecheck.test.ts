import { describe, it, expect } from "vitest";
import {
  PROBES,
  checkOverpass,
  checkRainfall,
  checkElevations,
  checkTopoData,
  checkAddress,
  checkMagic,
  checkTiff,
  expectArrayAt,
  summariseProbes,
  rangeIgnored,
  driftIssueBody,
  DRIFT_ISSUE_TITLE,
  PNG_MAGIC,
  type ProbeResult,
} from "./livecheck";
import { ALLOWED_HOSTS } from "../sources/http";

/**
 * Every probe is exercised offline against a real-shaped body AND against the
 * drift it exists to catch (spec 42). Without the second half these are just
 * happy-path assertions about payloads we wrote ourselves.
 */

describe("Overpass — 200 with a remark is the failure that has bitten twice", () => {
  it("accepts a normal element list", () => {
    expect(checkOverpass('{"elements":[{"id":1}]}')).toMatchObject({ state: "ok" });
    expect(checkOverpass('{"elements":[]}')).toMatchObject({ state: "ok" });
  });

  it("reports a 200-with-remark as DRIFT, not as 'no peaks here'", () => {
    const body = JSON.stringify({
      version: 0.6,
      elements: [],
      remark: "runtime error: Query timed out in queryures",
    });
    const v = checkOverpass(body);
    expect(v.state).toBe("drift");
    expect(v.detail).toMatch(/remark/);
  });

  it("reports a missing elements array as drift", () => {
    expect(checkOverpass("{}")).toMatchObject({ state: "drift" });
  });

  it("reports an HTML error page served with a 200 as drift", () => {
    expect(checkOverpass("<html>too many requests</html>")).toMatchObject({ state: "drift" });
  });
});

describe("Open-Meteo rainfall", () => {
  it("accepts a daily precipitation series", () => {
    expect(checkRainfall('{"daily":{"precipitation_sum":[0,1.4,22]}}')).toMatchObject({
      state: "ok",
    });
  });

  it("reports a renamed or missing field as drift", () => {
    expect(checkRainfall('{"daily":{"rain_sum":[1]}}')).toMatchObject({ state: "drift" });
    expect(checkRainfall("{}")).toMatchObject({ state: "drift" });
  });

  it("reports an all-null series as drift — nulls are not rainfall", () => {
    expect(checkRainfall('{"daily":{"precipitation_sum":[null,null]}}')).toMatchObject({
      state: "drift",
    });
  });
});

describe("elevation — the LENGTH is the contract", () => {
  it("accepts exactly as many elevations as were asked for", () => {
    expect(checkElevations(2)('{"elevation":[900,910]}')).toMatchObject({ state: "ok" });
  });

  it("reports a SHORT answer as drift — it misaligns every later point", () => {
    expect(checkElevations(2)('{"elevation":[900]}')).toMatchObject({ state: "drift" });
  });

  it("reports a missing array as drift", () => {
    expect(checkElevations(2)('{"elevations":[900,910]}')).toMatchObject({ state: "drift" });
  });
});

describe("OpenTopoData — the failover must be alive or the failover is fiction", () => {
  it("accepts a results list carrying numeric elevations", () => {
    expect(checkTopoData('{"results":[{"elevation":905}]}')).toMatchObject({ state: "ok" });
  });

  it("reports results with no numeric elevation as drift", () => {
    expect(checkTopoData('{"results":[{"elevation":null}]}')).toMatchObject({ state: "drift" });
    expect(checkTopoData('{"status":"error"}')).toMatchObject({ state: "drift" });
  });
});

describe("Nominatim", () => {
  it("accepts an address object", () => {
    expect(checkAddress('{"address":{"town":"Nandi"}}')).toMatchObject({ state: "ok" });
  });

  it("reports a missing or non-object address as drift", () => {
    expect(checkAddress('{"error":"Unable to geocode"}')).toMatchObject({ state: "drift" });
    expect(checkAddress('{"address":[]}')).toMatchObject({ state: "drift" });
  });
});

describe("expectArrayAt — the MediaWiki and SPARQL shape", () => {
  it("finds a nested array", () => {
    expect(expectArrayAt('{"query":{"geosearch":[1,2]}}', "query.geosearch")).toMatchObject({
      state: "ok",
      detail: "2 row(s)",
    });
    expect(expectArrayAt('{"results":{"bindings":[]}}', "results.bindings")).toMatchObject({
      state: "ok",
    });
  });

  it("reports a missing path as drift, naming the path", () => {
    const v = expectArrayAt('{"query":{}}', "query.geosearch");
    expect(v.state).toBe("drift");
    expect(v.detail).toContain("query.geosearch");
  });

  it("reports a value that is present but not an array as drift", () => {
    expect(expectArrayAt('{"query":{"geosearch":{}}}', "query.geosearch")).toMatchObject({
      state: "drift",
    });
  });
});

describe("binary probes", () => {
  const png = Buffer.from([...PNG_MAGIC, 0x0d, 0x0a, 0x1a, 0x0a]);

  it("accepts a PNG tile", () => {
    expect(checkMagic("PNG", PNG_MAGIC)(png)).toMatchObject({ state: "ok" });
  });

  it("reports a TRUNCATED tile as drift rather than reading past the end", () => {
    expect(checkMagic("PNG", PNG_MAGIC)(Buffer.from([0x89]))).toMatchObject({ state: "drift" });
  });

  it("reports an error page served where a tile was expected as drift", () => {
    // S3 answers some failures with XML, which would otherwise be decoded as
    // elevation and produce plausible-looking nonsense.
    const v = checkMagic("PNG", PNG_MAGIC)(Buffer.from('<?xml version="1.0"?><Error/>'));
    expect(v.state).toBe("drift");
    expect(v.detail).toMatch(/not a PNG/);
  });

  it("accepts a TIFF COG in either byte order", () => {
    expect(checkTiff(Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08]))).toMatchObject({ state: "ok" });
    expect(checkTiff(Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x08]))).toMatchObject({ state: "ok" });
  });

  it("reports a non-TIFF body as drift", () => {
    expect(checkTiff(Buffer.from("<html>"))).toMatchObject({ state: "drift" });
    expect(checkTiff(Buffer.from([0x49]))).toMatchObject({ state: "drift" });
  });
});

describe("the probe list itself", () => {
  it("covers every source the pipeline depends on", () => {
    const names = PROBES.map((p) => p.name).join(" ");
    for (const source of [
      "Overpass",
      "rainfall",
      "elevation",
      "OpenTopoData",
      "Nominatim",
      "Wikipedia",
      "Commons",
      "Wikidata",
      "Terrarium",
      "WorldCover",
    ]) {
      expect(names, source).toMatch(new RegExp(source, "i"));
    }
  });

  it("only probes hosts on the allowlist — the check cannot go where the build may not", () => {
    for (const p of PROBES) {
      expect(ALLOWED_HOSTS.has(new URL(p.url).hostname), p.name).toBe(true);
    }
  });

  it("asks for a tiny result from each source — one request, nothing bulk", () => {
    for (const p of PROBES.filter((x) => !x.binary)) {
      expect(
        /limit|LIMIT|out 1|end_date|elevation|reverse|locations=/.test(p.url + (p.body ?? "")),
        p.name,
      ).toBe(true);
    }
  });
});

describe("summariseProbes and the issue it files", () => {
  const results: ProbeResult[] = [
    { name: "A", verdict: { state: "ok", detail: "3 row(s)" } },
    { name: "B", verdict: { state: "drift", detail: "no 'elements' array" } },
    { name: "C", verdict: { state: "unverified", detail: "ETIMEDOUT" } },
  ];

  it("separates drift from unverified — unknown is not the same as changed", () => {
    const s = summariseProbes(results);
    expect(s.drifted.map((r) => r.name)).toEqual(["B"]);
    expect(s.unverified.map((r) => r.name)).toEqual(["C"]);
    expect(s.text).toContain("1 ok · 1 drifted · 1 unverified");
  });

  it("names every source in the report, with its reason", () => {
    const text = summariseProbes(results).text;
    for (const n of ["A", "B", "C"]) expect(text).toContain(n);
    expect(text).toContain("no 'elements' array");
  });

  it("writes an issue body that says what drifted and that it is advisory", () => {
    const body = driftIssueBody(results, "https://example/run/1");
    expect(body).toContain("advisory");
    expect(body).toContain("no 'elements' array");
    expect(body).toContain("https://example/run/1");
  });

  it("uses a STABLE title so a persistent outage stays one thread", () => {
    // The title is how the filer finds an already-open issue. If it carried a
    // date or a count it would file a fresh issue every Tuesday.
    expect(DRIFT_ISSUE_TITLE).not.toMatch(/\d/);
    expect(driftIssueBody(results)).not.toContain("undefined");
  });
});

describe("every shipped probe's check actually runs", () => {
  // The probe list holds inline closures that nothing else exercises. Feeding
  // each one a body it must reject proves the check is wired to a real
  // assertion rather than being, say, `() => ok()`.
  const nonsense = ["<html>503 Service Unavailable</html>", "{}", '{"unexpected":true}'];

  for (const probe of PROBES) {
    it(`${probe.name} rejects a body that is not its contract`, () => {
      for (const body of nonsense) {
        const verdict = probe.check(probe.binary ? Buffer.from(body) : body);
        expect(verdict.state, `${probe.name} accepted ${body}`).toBe("drift");
        expect(verdict.detail, probe.name).toBeTruthy();
      }
    });
  }

  it("no probe throws on an empty body — it reports, it never crashes the run", () => {
    for (const probe of PROBES) {
      expect(() => probe.check(probe.binary ? Buffer.alloc(0) : ""), probe.name).not.toThrow();
    }
  });
});

describe("probe cost — a contract check must not pull a whole object", () => {
  it("range-requests the COG rather than downloading ~128 MB for four bytes", () => {
    // Measured in the first real run: the WorldCover probe fetched
    // 127,650,362 bytes off a free public bucket to read a magic number.
    const cog = PROBES.find((p) => p.name.includes("WorldCover"))!;
    expect(cog.rangeBytes).toBeGreaterThan(0);
    expect(cog.rangeBytes).toBeLessThanOrEqual(64 * 1024);
  });

  it("leaves small objects alone — a DEM tile is already tiny", () => {
    const tile = PROBES.find((p) => p.name.includes("Terrarium"))!;
    expect(tile.rangeBytes).toBeUndefined();
  });

  it("notices when a server IGNORES the range and sends the whole object", () => {
    const cog = PROBES.find((p) => p.name.includes("WorldCover"))!;
    expect(rangeIgnored(cog, 206)).toBe(false); // honoured
    expect(rangeIgnored(cog, 200)).toBe(true); // ignored — 128 MB incoming
  });

  it("says nothing about range for a probe that never asked for one", () => {
    const tile = PROBES.find((p) => p.name.includes("Terrarium"))!;
    expect(rangeIgnored(tile, 200)).toBe(false);
  });

  it("still validates a TIFF header from only the first bytes", () => {
    // The range has to be enough for the check to work at all.
    const cog = PROBES.find((p) => p.name.includes("WorldCover"))!;
    expect(cog.check(Buffer.from([0x49, 0x49, 0x2a, 0x00]))).toMatchObject({ state: "ok" });
  });
});
