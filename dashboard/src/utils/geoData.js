// Deterministic (fast) "geo" mapping for high-frequency traffic visualization.

export const SERVER_LOCATION = {
  name: 'Bangalore, IN',
  lat: 12.9716,
  lng: 77.5946,
};

// Map labels (approximate centroids). Used for persistent globe text overlays.
export const CONTINENT_LABELS = [
  { name: 'North America', lat: 44.0, lng: -102.0 },
  { name: 'South America', lat: -15.0, lng: -60.0 },
  { name: 'Europe', lat: 54.0, lng: 15.0 },
  { name: 'Africa', lat: 4.0, lng: 20.0 },
  { name: 'Asia', lat: 34.0, lng: 90.0 },
  { name: 'Australia', lat: -25.0, lng: 134.0 },
  { name: 'Antarctica', lat: -82.0, lng: 0.0 },
];

export const MAJOR_COUNTRY_LABELS = [
  { name: 'United States', lat: 39.8283, lng: -98.5795 },
  { name: 'India', lat: 22.9734, lng: 78.6569 },
  { name: 'Russia', lat: 61.524, lng: 105.3188 },
  { name: 'China', lat: 35.8617, lng: 104.1954 },
  { name: 'Brazil', lat: -14.235, lng: -51.9253 },
  { name: 'Australia', lat: -25.2744, lng: 133.7751 },
];

// ~10 major regions/countries (approximate centroids)
export const COUNTRY_COORDS = [
  { name: 'United States', lat: 39.8283, lng: -98.5795 },
  { name: 'Canada', lat: 56.1304, lng: -106.3468 },
  { name: 'Brazil', lat: -14.235, lng: -51.9253 },
  { name: 'United Kingdom', lat: 55.3781, lng: -3.436 },
  { name: 'Germany', lat: 51.1657, lng: 10.4515 },
  { name: 'Russia', lat: 61.524, lng: 105.3188 },
  { name: 'China', lat: 35.8617, lng: 104.1954 },
  { name: 'Japan', lat: 36.2048, lng: 138.2529 },
  { name: 'Australia', lat: -25.2744, lng: 133.7751 },
  { name: 'South Africa', lat: -30.5595, lng: 22.9375 },
];

// Fixed set of "hotspot" origins used during attack/anomaly bursts.
// These rotate sequentially to create a clear, cinematic set of sources.
export const ATTACK_HOTSPOTS = [
  { name: 'Russia', lat: 61.524, lng: 105.3188 },
  { name: 'China', lat: 35.8617, lng: 104.1954 },
  { name: 'Germany', lat: 51.1657, lng: 10.4515 },
  { name: 'United States', lat: 39.8283, lng: -98.5795 },
  { name: 'Brazil', lat: -14.235, lng: -51.9253 },
  { name: 'South Africa', lat: -30.5595, lng: 22.9375 },
];

/**
 * Deterministically map an IP -> a country coordinate object, using first octet.
 * Same IP => same "origin", with O(1) cost and no external API calls.
 */
export function getCoordsFromIP(ip) {
  const s = (ip || '').trim();
  const firstPart = s.split('.')[0];
  const firstOctet = Number.parseInt(firstPart, 10);

  // Fallback for malformed inputs
  if (!Number.isFinite(firstOctet) || firstOctet < 0) return COUNTRY_COORDS[0];

  // Deterministic mapping (simple + stable)
  const idx = Math.abs(firstOctet) % COUNTRY_COORDS.length;
  return COUNTRY_COORDS[idx];
}
