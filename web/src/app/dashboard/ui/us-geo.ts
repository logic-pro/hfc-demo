// A stylized continental-US silhouette for the territory map. The KEY idea: the
// outline is defined in the SAME lat/long space as the territory dots and run
// through the SAME projection — so the silhouette and the city constellation are
// always consistent. No map/GeoJSON dependency; ~40 boundary points read as the US.

export const MAP_W = 1000;
export const MAP_H = 537; // matches the projected aspect of the continental US

const LNG_MIN = -125.5;
const LNG_MAX = -66.0;
const LAT_MIN = 24.0;
const LAT_MAX = 49.6;
const LNG_SCALE = Math.cos((37 * Math.PI) / 180); // latitude compression at mid-US
const PAD = 14;

// Equirectangular projection with longitude compressed for a true-ish aspect.
export function project(lat: number, lng: number): { x: number; y: number } {
  const wRaw = (LNG_MAX - LNG_MIN) * LNG_SCALE;
  const nx = ((lng - LNG_MIN) * LNG_SCALE) / wRaw;
  const ny = (LAT_MAX - lat) / (LAT_MAX - LAT_MIN);
  return {
    x: PAD + nx * (MAP_W - PAD * 2),
    y: PAD + ny * (MAP_H - PAD * 2),
  };
}

// Continental-US perimeter, clockwise from the Pacific NW. [lat, lng].
const BORDER: [number, number][] = [
  [48.4, -124.7], [46.2, -124.1], [43.3, -124.4], [40.4, -124.4], [37.8, -122.5],
  [36.6, -121.9], [34.4, -120.5], [33.0, -117.3], [32.5, -114.8], [31.3, -111.0],
  [31.8, -106.5], [29.3, -100.9], [25.9, -97.4], [29.7, -93.9], [29.2, -90.0],
  [30.4, -88.0], [29.7, -84.9], [27.8, -82.8], [25.2, -80.4], [30.0, -81.3],
  [32.0, -80.9], [34.7, -76.7], [37.0, -75.9], [39.0, -74.8], [40.6, -73.9],
  [41.3, -71.5], [42.0, -70.6], [43.7, -70.1], [44.8, -67.0], [45.0, -71.5],
  [43.0, -82.4], [46.5, -84.4], [47.5, -88.0], [48.0, -89.5], [49.0, -95.2],
  [49.0, -104.0], [49.0, -117.0], [48.4, -124.7],
];

// Smooth the silhouette with a Catmull-Rom → cubic-bezier pass so it reads as a
// designed shape, not a jagged polyline.
export function usOutlinePath(): string {
  const pts = BORDER.map(([lat, lng]) => project(lat, lng));
  const n = pts.length;
  const p = (i: number) => pts[(i + n) % n];
  let d = `M${p(0).x.toFixed(1)},${p(0).y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d + ' Z';
}

// A faint graticule (every 10° lng, 5° lat) to ground the plot as a real map.
export function graticule(): { lng: { x: number }[]; lat: { y: number }[] } {
  const lng: { x: number }[] = [];
  for (let g = -120; g <= -70; g += 10) lng.push({ x: project(40, g).x });
  const lat: { y: number }[] = [];
  for (let l = 25; l <= 49; l += 5) lat.push({ y: project(l, -95).y });
  return { lng, lat };
}
