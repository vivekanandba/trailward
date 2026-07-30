/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Project page is served at https://<user>.github.io/trailward/, so assets must
// resolve under the /trailward/ subpath. Switch to "/" if you add a custom domain.
export default defineConfig({
  base: "/trailward/",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // One stable vendor chunk (react + leaflet stacks): app-code edits no
        // longer invalidate the ~300 KB of rarely-changing dependencies in
        // caches. (Separate react/leaflet chunks don't work here — react-dom
        // gets hoisted into the react-leaflet graph, leaving an empty facade.)
        manualChunks: {
          vendor: ["react", "react-dom", "leaflet", "react-leaflet"],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    // Playwright owns e2e/; keep Vitest to unit/component tests only.
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**", "scripts/**"],
      // Ratchet: set just below current levels so the suite can't silently
      // regress; raise as coverage grows. Recalibrated 70 → 68 when the
      // in-app feedback form (≈600 covered lines) was REMOVED in favour of
      // GitHub-issue links (spec 29) — deleting tested code lowers the ratio
      // without any test getting worse. TrekMap stays e2e-only (Leaflet's SVG
      // renderer cannot run in jsdom).
      thresholds: {
        lines: 68,
        branches: 72,
        functions: 60,
        statements: 68,
      },
    },
  },
});
