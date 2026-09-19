/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { appJsonLd } from "./src/lib/seo";

/**
 * Inject the app-shell structured data at BUILD time (spec 35). JSON-LD added
 * by client JS is crawled far less reliably than markup that is already in the
 * served HTML — and this app's whole point is a dataset a search engine should
 * be able to understand. The record count comes from the cell index (a few KB)
 * rather than treks.json (41 MB).
 */
function structuredData(): Plugin {
  return {
    name: "trailward-structured-data",
    apply: "build",
    transformIndexHtml(html) {
      let total = 0;
      try {
        const idx = JSON.parse(readFileSync("public/data/cells/index.json", "utf8")) as {
          cells: Record<string, number>;
        };
        total = Object.values(idx.cells).reduce((a, b) => a + b, 0);
      } catch {
        return html; // no data yet (fresh clone): ship the shell unannotated
      }
      const ld = `<script type="application/ld+json">${JSON.stringify(appJsonLd(total))}</script>`;
      return html.replace("</head>", `    ${ld}\n  </head>`);
    },
  };
}

// Project page is served at https://<user>.github.io/trailward/, so assets must
// resolve under the /trailward/ subpath. Switch to "/" if you add a custom domain.
export default defineConfig({
  base: "/trailward/",
  plugins: [react(), structuredData()],
  server: {
    watch: {
      // Build-tool artifacts, not app inputs. scripts/.cache alone holds >100k
      // DEM tiles — watching them exhausts the kernel inotify limit (ENOSPC)
      // and kills the dev server.
      ignored: ["**/scripts/.cache/**", "**/public/data/**", "**/scripts/detected/**"],
    },
  },
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
