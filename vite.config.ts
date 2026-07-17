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
      // Gate below current levels (≈76% lines / 80% branch / 66% funcs) so the
      // suite can't silently regress; raise as coverage grows.
      thresholds: {
        lines: 70,
        branches: 72,
        functions: 60,
        statements: 70,
      },
    },
  },
});
