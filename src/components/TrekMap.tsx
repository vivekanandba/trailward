import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Circle,
  CircleMarker,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import type { Origin, Trek } from "../lib/trek";
import { difficultyColor, difficultyLabel } from "../lib/difficulty";
import { distanceFrom } from "../lib/distance";
import { clusterByGrid } from "../lib/cluster";

interface TrekMapProps {
  origin: Origin;
  radiusKm: number;
  treks: Trek[]; // already filtered (→ 05)
  selectedId?: string;
  onSelect(id: string): void;
  theme?: "light" | "dark";
}

// CARTO basemaps: Voyager in light, Dark Matter in dark.
const TILES = {
  light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
} as const;

// Cluster only dense sets (live discovery can return up to 100 peaks) and only
// while zoomed out; curated sets (≈16) never cluster.
const CLUSTER_THRESHOLD = 24;
const CLUSTER_MAX_ZOOM = 11;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

// Frame the radius ring AND every result marker, so treks just outside the ring
// aren't off-screen and a lopsided result set isn't wasted to one corner.
function FitToResults({
  origin,
  radiusKm,
  treks,
}: {
  origin: Origin;
  radiusKm: number;
  treks: Trek[];
}) {
  const map = useMap();
  const hasResults = treks.length > 0;
  useEffect(() => {
    const bounds = L.latLng(origin.lat, origin.lng).toBounds(radiusKm * 2 * 1000);
    for (const t of treks) bounds.extend([t.lat, t.lng]);
    map.fitBounds(bounds, { padding: [24, 24], animate: !prefersReducedMotion() });
    // Refit on origin/radius change and when results first appear (e.g. discovery
    // loading) — NOT on every filter tweak, which would yank the map mid-typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, origin.lat, origin.lng, radiusKm, hasResults]);
  return null;
}

function TrekPin({
  trek,
  origin,
  selected,
  onSelect,
}: {
  trek: Trek;
  origin: Origin;
  selected: boolean;
  onSelect(id: string): void;
}) {
  const color = difficultyColor(trek.difficulty);
  const isDiscovery = trek.tier === "discovery";
  const km = Math.round(trek.distanceKm ?? distanceFrom(origin, trek));
  return (
    <CircleMarker
      center={[trek.lat, trek.lng]}
      radius={selected ? 11 : 8}
      pathOptions={{
        color: selected ? "#1c3927" : "#ffffff",
        weight: selected ? 3 : 1.5,
        fillColor: isDiscovery ? "#ffffff" : color,
        fillOpacity: isDiscovery ? 0.5 : 0.95,
      }}
      eventHandlers={{ click: () => onSelect(trek.id) }}
    >
      <Tooltip direction="top" offset={[0, -6]}>
        <span className="font-semibold">{trek.name}</span>
        <br />
        {difficultyLabel(trek.difficulty)} · ~{km} km
        {trek.elevationM ? ` · ${trek.elevationM} m` : ""}
      </Tooltip>
    </CircleMarker>
  );
}

// Trek markers with proximity clustering for dense sets. Lives inside the map so
// it can read zoom; selected pin renders last so it sits above its neighbours.
function Markers({
  origin,
  treks,
  selectedId,
  onSelect,
}: Omit<TrekMapProps, "radiusKm" | "theme">) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  const clustered = treks.length > CLUSTER_THRESHOLD && zoom < CLUSTER_MAX_ZOOM;
  // Grid cell shrinks as you zoom in, so clusters break apart naturally.
  const step = 0.7 / Math.pow(2, Math.max(0, zoom - 7));
  const groups = useMemo(
    () =>
      clustered
        ? clusterByGrid(treks, step)
        : treks.map((t) => ({ lat: t.lat, lng: t.lng, members: [t] })),
    [treks, clustered, step],
  );

  const clusters = groups.filter((g) => g.members.length > 1);
  const singles = groups.filter((g) => g.members.length === 1).map((g) => g.members[0]);
  // Render the selected pin last (SVG paint order = z-order for CircleMarkers).
  const orderedSingles = [...singles].sort(
    (a, b) => Number(a.id === selectedId) - Number(b.id === selectedId),
  );

  return (
    <>
      {clusters.map((c) => {
        const bounds = L.latLngBounds(c.members.map((m) => [m.lat, m.lng] as [number, number]));
        return (
          <CircleMarker
            key={`cluster:${c.members.map((m) => m.id).join(",")}`}
            center={[c.lat, c.lng]}
            radius={Math.min(24, 12 + c.members.length)}
            pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#2f6b3f", fillOpacity: 0.9 }}
            eventHandlers={{
              click: () =>
                map.fitBounds(bounds, {
                  padding: [40, 40],
                  maxZoom: CLUSTER_MAX_ZOOM + 2,
                  animate: !prefersReducedMotion(),
                }),
            }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              {c.members.length} treks — zoom in
            </Tooltip>
          </CircleMarker>
        );
      })}
      {orderedSingles.map((t) => (
        <TrekPin
          key={t.id}
          trek={t}
          origin={origin}
          selected={t.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

export default function TrekMap({
  origin,
  radiusKm,
  treks,
  selectedId,
  onSelect,
  theme = "light",
}: TrekMapProps) {
  return (
    <MapContainer
      center={[origin.lat, origin.lng]}
      zoom={9}
      scrollWheelZoom
      className="h-full w-full"
      aria-label="Map of treks"
    >
      <TileLayer
        key={theme}
        url={theme === "dark" ? TILES.dark : TILES.light}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
      />

      <FitToResults origin={origin} radiusKm={radiusKm} treks={treks} />

      {/* Radius ring + origin marker */}
      <Circle
        center={[origin.lat, origin.lng]}
        radius={radiusKm * 1000}
        pathOptions={{ color: "#2f6b3f", weight: 1.5, fillColor: "#2f6b3f", fillOpacity: 0.06 }}
      />
      <CircleMarker
        center={[origin.lat, origin.lng]}
        radius={7}
        pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#1c3927", fillOpacity: 1 }}
      >
        <Tooltip direction="top" offset={[0, -6]}>
          {origin.name} (origin)
        </Tooltip>
      </CircleMarker>

      <Markers origin={origin} treks={treks} selectedId={selectedId} onSelect={onSelect} />
    </MapContainer>
  );
}
