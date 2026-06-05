import { describe, it, expect } from "vitest";
import { APP_NAME, TAGLINE } from "./app-info";

// Sample unit test — confirms Vitest runs. Replaced by real specs in Phase B.
describe("app-info", () => {
  it("exposes the app name", () => {
    expect(APP_NAME).toBe("Trailward");
  });

  it("exposes a tagline", () => {
    expect(TAGLINE).toMatch(/trail/i);
  });
});
