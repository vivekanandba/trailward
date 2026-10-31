/**
 * The 404 page's wiring (spec 44 R10); the decisions live in notFound.ts.
 */
import { routeFor, slugsFromSitemap, suggestionFor } from "./notFound";

const route = routeFor(window.location.pathname, window.location.search, window.location.hash);

if (route.kind === "redirect") {
  window.location.replace(route.to);
} else {
  const status = document.getElementById("suggestion");
  fetch("/trailward/sitemap.xml")
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then((xml) => {
      const match = suggestionFor(route.slug, slugsFromSitemap(xml));
      if (!match || !status) return;
      const a = document.createElement("a");
      a.href = `/trailward/t/${match}/`;
      a.textContent = `/t/${match}/`;
      status.replaceChildren("Did you mean ", a, "?");
    })
    // Offline or no sitemap: the page already says what it can, honestly.
    .catch(() => undefined);
}
