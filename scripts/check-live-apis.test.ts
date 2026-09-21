import { describe, it, expect } from "vitest";
import { runLiveCheck } from "./check-live-apis";
import { memoryIO } from "./lib/buildIO";
import { DRIFT_ISSUE_TITLE, type Probe } from "./lib/livecheck";

const probe = (name: string, check: Probe["check"]): Probe => ({
  name,
  url: "https://overpass-api.de/api/interpreter",
  check,
});

const passing = probe("Good", () => ({ state: "ok", detail: "3 row(s)" }));
const drifting = probe("Changed", () => ({ state: "drift", detail: "no 'elements' array" }));

const filer = () => {
  const filed: Array<{ title: string; body: string }> = [];
  return { filed, fileIssue: (title: string, body: string) => filed.push({ title, body }) };
};

describe("runLiveCheck (spec 42 §A)", () => {
  it("reports every probe and files nothing when all are healthy", async () => {
    const io = memoryIO();
    const { filed, fileIssue } = filer();
    const out = await runLiveCheck(io, { fetchOne: async () => "{}", fileIssue }, [passing]);

    expect(out.drifted).toBe(0);
    expect(out.filed).toBe(false);
    expect(filed).toHaveLength(0);
    expect(io.logs.join("\n")).toContain("Good");
  });

  it("files ONE issue when a source has drifted, under the stable title", async () => {
    const { filed, fileIssue } = filer();
    const out = await runLiveCheck(memoryIO(), { fetchOne: async () => "{}", fileIssue }, [
      passing,
      drifting,
    ]);

    expect(out.drifted).toBe(1);
    expect(out.filed).toBe(true);
    expect(filed).toHaveLength(1);
    expect(filed[0].title).toBe(DRIFT_ISSUE_TITLE);
    expect(filed[0].body).toContain("no 'elements' array");
  });

  it("files a SINGLE issue even when several sources drift at once", async () => {
    // An outage that takes out three sources is one thing to look at, not
    // three threads.
    const { filed, fileIssue } = filer();
    await runLiveCheck(memoryIO(), { fetchOne: async () => "{}", fileIssue }, [
      drifting,
      probe("AlsoChanged", () => ({ state: "drift", detail: "no bindings" })),
      probe("ThirdChanged", () => ({ state: "drift", detail: "not a PNG" })),
    ]);
    expect(filed).toHaveLength(1);
    expect(filed[0].body).toContain("3 source(s)");
  });

  it("records a transport failure as UNVERIFIED and does not file", async () => {
    // "Could not tell" is not "changed". Filing an issue for a timeout trains
    // everyone to close them unread (CON-DATA-002, CON-VER-005).
    const io = memoryIO();
    const { filed, fileIssue } = filer();
    const out = await runLiveCheck(
      io,
      {
        fetchOne: async () => {
          throw new Error("ETIMEDOUT");
        },
        fileIssue,
      },
      [passing],
    );

    expect(out.drifted).toBe(0);
    expect(filed).toHaveLength(0);
    expect(io.logs.join("\n")).toContain("ETIMEDOUT");
    expect(io.logs.join("\n")).toContain("1 unverified");
  });

  it("keeps going after one source fails — a single outage hides nothing else", async () => {
    const io = memoryIO();
    let calls = 0;
    const out = await runLiveCheck(
      io,
      {
        fetchOne: async () => {
          calls++;
          if (calls === 1) throw new Error("ECONNRESET");
          return "{}";
        },
      },
      [passing, drifting, passing],
    );
    expect(out.results).toHaveLength(3);
    expect(calls).toBe(3);
  });

  it("reports drift but does not file when no filer is wired (no token)", async () => {
    const out = await runLiveCheck(memoryIO(), { fetchOne: async () => "{}" }, [drifting]);
    expect(out.drifted).toBe(1);
    expect(out.filed).toBe(false);
  });

  it("passes the run URL through so the issue links back to the evidence", async () => {
    const { filed, fileIssue } = filer();
    await runLiveCheck(
      memoryIO(),
      { fetchOne: async () => "{}", fileIssue },
      [drifting],
      "https://example/run/9",
    );
    expect(filed[0].body).toContain("https://example/run/9");
  });

  it("hands each probe its own body — one source's answer never judges another", async () => {
    const seen: string[] = [];
    await runLiveCheck(
      memoryIO(),
      {
        fetchOne: async (p) => {
          seen.push(p.name);
          return `body-for-${p.name}`;
        },
      },
      [
        probe("A", (b) => ({ state: b === "body-for-A" ? "ok" : "drift", detail: String(b) })),
        probe("B", (b) => ({ state: b === "body-for-B" ? "ok" : "drift", detail: String(b) })),
      ],
    );
    expect(seen).toEqual(["A", "B"]);
  });
});
