import { useEffect } from "react";
import { MapContainer, TileLayer, Circle, CircleMarker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import type { Origin, Trek } from "../lib/trek";
import { difficultyColor, difficultyLabel } from "../lib/difficulty";
import { distanceFrom } from "../lib/distance";

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

// Reframe the map whenever the origin or radius changes so the ring stays in
// view. Honour prefers-reduced-motion: this fires on every radius-slider nudge,
// so an animated pan each time is jarring for motion-sensitive users.
function FitToRadius({ origin, radiusKm }: { origin: Origin; radiusKm: number }) {
  const map = useMap();
  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const bounds = L.latLng(origin.lat, origin.lng).toBounds(radiusKm * 2 * 1000);
    map.fitBounds(bounds, { padding: [24, 24], animate: !reduceMotion });
  }, [map, origin.lat, origin.lng, radiusKm]);
  return null;
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

      <FitToRadius origin={origin} radiusKm={radiusKm} />

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

      {/* Trek markers, coloured by difficulty; discovery treks are hollow grey */}
      {treks.map((t) => {
        const selected = t.id === selectedId;
        const color = difficultyColor(t.difficulty);
        const isDiscovery = t.tier === "discovery";
        const km = Math.round(t.distanceKm ?? distanceFrom(origin, t));
        return (
          <CircleMarker
            key={t.id}
            center={[t.lat, t.lng]}
            radius={selected ? 11 : 8}
            pathOptions={{
              color: selected ? "#1c3927" : "#ffffff",
              weight: selected ? 3 : 1.5,
              fillColor: isDiscovery ? "#ffffff" : color,
              fillOpacity: isDiscovery ? 0.5 : 0.95,
            }}
            eventHandlers={{ click: () => onSelect(t.id) }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <span className="font-semibold">{t.name}</span>
              <br />
              {difficultyLabel(t.difficulty)} · ~{km} km
              {t.elevationM ? ` · ${t.elevationM} m` : ""}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
