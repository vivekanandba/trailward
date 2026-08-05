import { describe, it, expect, vi } from "vitest";
import { fetchOverpass } from "./overpass";
import type { fetchText } from "./http";

// Error-path contract (spec 31): fetch failures fail over to the mirror, and a
// 200-with-remark server-side error is a FAILURE, never a silent empty result.
describe("fetchOverpass error paths", () => {
  const ok = JSON.stringify({ elements: [{ type: "node", id: 1, lat: 1, lon: 2 }] });

  it("fails over to the mirror when the primary endpoint throws", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("HTTP 504"))
      .mockResolvedValueOnce(ok) as unknown as typeof fetchText;
    const json = (await fetchOverpass("q", fetchImpl)) as { elements: unknown[] };
    expect(json.elements).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("treats a 200 + runtime-error remark as a failure, not an empty result", async () => {
    const timedOut = JSON.stringify({
      elements: [],
      remark: 'runtime error: Query timed out in "query" at line 1 after 181 seconds.',
    });
    const fetchImpl = vi.fn().mockResolvedValue(timedOut) as unknown as typeof fetchText;
    await expect(fetchOverpass("q", fetchImpl)).rejects.toThrow(/remark/);
    // It tried the mirror too before giving up.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws when every endpoint fails — callers must never see undefined", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error("HTTP 429")) as unknown as typeof fetchText;
    await expect(fetchOverpass("q", fetchImpl)).rejects.toThrow("429");
  });
});
