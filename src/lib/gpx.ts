// GPX 1.1 export (spec 13). Pure string builder — no dependency. Produces a
// waypoint for the summit and, when a trail is attached (spec 12/Phase C), a
// track of its path, so the file drops straight into any phone/GPS app.
import type { Trek } from "./trek";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Serialise a trek to a GPX 1.1 document. */
export function toGpx(trek: Trek): string {
  const wpt = [`  <wpt lat="${trek.lat}" lon="${trek.lng}">`, `    <name>${esc(trek.name)}</name>`];
  if (trek.elevationM !== undefined) wpt.push(`    <ele>${trek.elevationM}</ele>`);
  wpt.push(`  </wpt>`);

  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx version="1.1" creator="Trailward" xmlns="http://www.topografix.com/GPX/1/1">`,
    ...wpt,
  ];

  const coords = trek.trail?.coords;
  if (coords && coords.length > 0) {
    lines.push(`  <trk>`, `    <name>${esc(trek.name)} — trail</name>`, `    <trkseg>`);
    for (const [lat, lng] of coords) lines.push(`      <trkpt lat="${lat}" lon="${lng}" />`);
    lines.push(`    </trkseg>`, `  </trk>`);
  }

  lines.push(`</gpx>`, ``);
  return lines.join("\n");
}
