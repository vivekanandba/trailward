import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Circle,
  CircleMarker,
  Marker,
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
  onRadiusChange?(km: number): void;
  maxRadiusKm?: number;
  theme?: "light" | "dark";
}

const RADIUS_MIN = 10;
const RADIUS_STEP = 5;

// A draggable handle sitting on the ring's east edge; dragging it resizes the
// radius (snapped to the slider's step + bounds). Uses a divIcon so it needs no
// Leaflet marker-image assets. Radius commits on dragend to avoid a refit storm.
function RadiusHandle({
  origin,
  radiusKm,
  onChange,
  maxKm,
}: {
  origin: Origin;
  radiusKm: number;
  onChange(km: number): void;
  maxKm: number;
}) {
  const lngPerKm = 1 / (111.32 * Math.cos((origin.lat * Math.PI) / 180));
  const edge: [number, number] = [origin.lat, origin.lng + radiusKm * lngPerKm];
  const icon = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: '<div style="width:16px;height:16px;border-radius:9999px;background:#2f6b3f;border:3px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:grab"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    [],
  );
  return (
    <Marker
      position={edge}
      draggable
      icon={icon}
      keyboard={false}
      eventHandlers={{
        dragend: (e) => {
          const p = (e.target as L.Marker).getLatLng();
          const raw = distanceFrom(origin, { lat: p.lat, lng: p.lng });
          const snapped = Math.round(raw / RADIUS_STEP) * RADIUS_STEP;
          onChange(Math.max(RADIUS_MIN, Math.min(maxKm, snapped)));
        },
      }}
    >
      <Tooltip direction="right" offset={[10, 0]}>
        Drag to set radius ({radiusKm} km)
      </Tooltip>
    </Marker>
  );
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

// Leaflet caches its container size at init and only recomputes on window
// `resize`. On mobile the container also resizes without a window resize —
// orientation changes, the dvh viewport shifting as the address bar hides, and
// our own flex layout settling — which leaves tiles grey or half-rendered until
// an interaction. Observe the container and invalidate on any size change.
function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
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
  const isDiscovery = trek.tier === "discovery";
  // Colour discovery peaks by their terrain-estimated difficulty when we have
  // one; only truly unknown peaks stay hollow white.
  const shownDifficulty = trek.difficulty ?? trek.estimatedDifficulty;
  const color = difficultyColor(shownDifficulty);
  const km = Math.round(trek.distanceKm ?? distanceFrom(origin, trek));
  // Size discovery pins by their hidden-gem score so top picks read first.
  const baseRadius =
    isDiscovery && trek.discoveryScore !== undefined ? 6 + Math.round(trek.discoveryScore * 5) : 8;
  const label = trek.difficulty
    ? difficultyLabel(trek.difficulty)
    : trek.estimatedDifficulty
      ? `est. ${trek.estimatedDifficulty}`
      : "Unverified";
  return (
    <CircleMarker
      center={[trek.lat, trek.lng]}
      radius={selected ? 11 : baseRadius}
      pathOptions={{
        color: selected ? "#1c3927" : "#ffffff",
        weight: selected ? 3 : 1.5,
        fillColor: shownDifficulty ? color : "#ffffff",
        fillOpacity: isDiscovery ? 0.75 : 0.95,
        // Dashed outline keeps discovery pins visually "unverified" even when coloured.
        dashArray: isDiscovery ? "2 3" : undefined,
      }}
      eventHandlers={{ click: () => onSelect(trek.id) }}
    >
      <Tooltip direction="top" offset={[0, -6]}>
        <span className="font-semibold">{trek.name}</span>
        <br />
        {label} · ~{km} km
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
  const [bounds, setBounds] = useState(() => map.getBounds());
  useMapEvents({
    zoomend: () => {
      setZoom(map.getZoom());
      setBounds(map.getBounds());
    },
    moveend: () => setBounds(map.getBounds()),
  });

  // Viewport culling: only markers within the current view (padded) are drawn,
  // so an uncapped set (spec 11 — filters, not a top-N, do the capping) costs
  // only what's on screen. The full set still drives the list + filters.
  const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
  const inView = useMemo(() => {
    const padded = bounds.pad(0.25);
    return treks.filter((t) => padded.contains([t.lat, t.lng]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treks, bbox]);

  const clustered = inView.length > CLUSTER_THRESHOLD && zoom < CLUSTER_MAX_ZOOM;
  // Grid cell shrinks as you zoom in, so clusters break apart naturally.
  const step = 0.7 / Math.pow(2, Math.max(0, zoom - 7));
  const groups = useMemo(
    () =>
      clustered
        ? clusterByGrid(inView, step)
        : inView.map((t) => ({ lat: t.lat, lng: t.lng, members: [t] })),
    [inView, clustered, step],
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
  onRadiusChange,
  maxRadiusKm = 150,
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

      <InvalidateOnResize />
      <FitToResults origin={origin} radiusKm={radiusKm} treks={treks} />

      {/* Radius ring + origin marker */}
      <Circle
        center={[origin.lat, origin.lng]}
        radius={radiusKm * 1000}
        pathOptions={{ color: "#2f6b3f", weight: 1.5, fillColor: "#2f6b3f", fillOpacity: 0.06 }}
      />
      {onRadiusChange && (
        <RadiusHandle
          origin={origin}
          radiusKm={radiusKm}
          onChange={onRadiusChange}
          maxKm={maxRadiusKm}
        />
      )}
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
