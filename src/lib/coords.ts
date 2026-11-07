/**
 * Coordinates for people, not machines (spec 44 R5): degrees, minutes and
 * whole seconds with a hemisphere letter, as a GPS unit or a paper map reads
 * them. Rounded to the nearest second (about 30 m), carrying 60″ into the next
 * minute and 60′ into the next degree.
 */
function part(value: number, pos: string, neg: string): string {
  let total = Math.round(Math.abs(value) * 3600);
  // From the rounded value: a point that rounds to the equator is N, not S.
  const hemi = value < 0 && total > 0 ? neg : pos;
  const deg = Math.floor(total / 3600);
  total -= deg * 3600;
  const min = Math.floor(total / 60);
  const sec = total - min * 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${deg}°${pad(min)}′${pad(sec)}″${hemi}`;
}

export function toDms(lat: number, lng: number): string {
  return `${part(lat, "N", "S")} ${part(lng, "E", "W")}`;
}
