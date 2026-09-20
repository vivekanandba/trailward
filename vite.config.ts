import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { coverageConfigDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { appJsonLd, jsonLdScript } from "./src/lib/seo";

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
      const ld = `<script type="application/ld+json">${jsonLdScript(appJsonLd(total))}</script>`;
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
      // Excluded ONLY with a stated reason (CON-COV-002), never to flatter
      // the number:
      //  - TrekMap: ~700 lines of Leaflet. jsdom has no layout engine, so it
      //    cannot execute; testing it here would prove a mock works, not the
      //    map. Covered by the e2e suite and 12 visual baselines instead.
      //  - main.tsx: the bootstrap entry point, three lines and a service
      //    worker registration that only runs in a production build.
      //
      // coverageConfigDefaults.exclude is spread in deliberately: vitest
      // REPLACES this array rather than merging it, so setting it bare drops
      // the default `**/*.test.ts` exclusion and instruments the test files
      // themselves. They are ~100% covered by construction, which inflated
      // every number here by about ten points until it was caught in review.
      exclude: [...coverageConfigDefaults.exclude, "src/components/TrekMap.tsx", "src/main.tsx"],
      // Ratchet: set just below current levels so the suite can't silently
      // regress; raise as coverage grows. Recalibrated 70 → 68 when the
      // in-app feedback form (≈600 covered lines) was REMOVED in favour of
      // GitHub-issue links (spec 29) — deleting tested code lowers the ratio
      // without any test getting worse. TrekMap stays e2e-only (Leaflet's SVG
      // renderer cannot run in jsdom).
      // Global floors alone are diluted: the repo is dominated by data-heavy
      // and e2e-only files, so a brand-new untested module in src/lib could
      // land at 0% without moving the global number (spec 37). Per-directory
      // floors close that. Each was MEASURED, then set a few points under, and
      // each was proven to enforce by temporarily setting it to 100.
      // Measured 2026-09-20 with the default exclusions intact, reproduced
      // across two consecutive runs, each floor set just under. They only
      // ratchet up (CON-COV-002) and every one is at or above what main
      // enforced before the build-CLI seams landed (spec 41).
      thresholds: {
        // global measured: 81.67 lines / 79.75 functions, identical run to run.
        // Branches drift slightly (88.27–88.33 observed), so that floor sits
        // below the lowest figure seen rather than below a single reading.
        //
        // The target is 95 and this is 81.7. What remains is named in spec 41
        // rather than excluded: the DEM-walking functions (detectIndia, score,
        // scoreSummits, crossMatchWikidata) and the `import.meta.url === argv[1]`
        // CLI blocks, which cannot execute under vitest by construction.
        lines: 81,
        branches: 87,
        functions: 79,
        statements: 81,
        // measured 95.08 / 89.13 / 97.00 — pure application logic, no excuse
        "src/lib/**": { statements: 95, lines: 95, branches: 89, functions: 96 },
        // measured over the GLOB (which includes components/ui at 75%):
        // 84.88 / 84.96 / 70.00. The per-directory table row reads higher
        // because it excludes the ui/ subtree; the floor follows the glob,
        // because the glob is what enforces.
        "src/components/**": { statements: 84, lines: 84, branches: 84, functions: 69 },
        // measured 98.27 / 94.88 / 96.36 — pure build logic
        "scripts/lib/**": { statements: 98, lines: 98, branches: 94, functions: 96 },
        // measured 91.57 / 88.01 / 88.61 — network adapters, now driven at the
        // http boundary with their failure shapes asserted (spec 41)
        "scripts/sources/**": { statements: 91, lines: 91, branches: 87, functions: 88 },
        // The glob covers scripts/ AND its subtrees, so this number is a
        // blend — lib (98%) and sources (92%) pull it up, and they have their
        // own floors above. The top-level build CLIs it is really about read
        // 62.0% on their own. Kept as a blended backstop because it is what
        // the glob enforces; the CLIs' own progress is tracked in spec 41's
        // table, not here. New floor either way: this tree had none before,
        // which is how it sat at 45% unnoticed.
        "scripts/**": { statements: 76, lines: 76, branches: 89, functions: 82 },
      },
    },
  },
});
