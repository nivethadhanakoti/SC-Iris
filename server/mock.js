// Offline demo data, used only when OSM_MOCK=1 (for testing, or as a fallback if venue Wi-Fi blocks OSM).
// Shapes are hand-approximated, NOT OpenStreetMap data, and every response says so.
import { USC, haversineM, walkMinutes } from './usc.js';

const KX = Math.cos(USC.lat * Math.PI / 180) * 111320, KY = 110574;
const LL = (x, z) => [Math.round((USC.lon + x / KX) * 1e6) / 1e6, Math.round((USC.lat - z / KY) * 1e6) / 1e6]; // [lon, lat]
const NOTE = 'OFFLINE DEMO DATA: hand-approximated shapes, not OpenStreetMap. Unset OSM_MOCK to use live OSM.';

export const PLACES = [
  ["Trader Joe's", 34.0259, -118.2846, 'shop=supermarket', '3131 S Hoover St'], ['Target', 34.0262, -118.2855, 'shop=department_store', 'USC Village'],
  ['CVS Pharmacy', 34.0258, -118.2850, 'amenity=pharmacy', 'USC Village'], ['Ralphs', 34.0331, -118.2918, 'shop=supermarket', '2600 S Vermont Ave'],
  ['Superior Grocers', 34.0036, -118.2918, 'shop=supermarket', '4373 S Vermont Ave'], ['USC Farmers Market', 34.0199, -118.2829, 'amenity=marketplace', 'Wednesdays'],
  ['Starbucks', 34.0258, -118.2858, 'amenity=cafe', 'USC Village'], ['Dulce', 34.0259, -118.2862, 'amenity=cafe', 'USC Village'],
  ['Mercado La Paloma', 34.0152, -118.2775, 'amenity=food_court', '3655 S Grand Ave'], ['La Taquiza', 34.0272, -118.2769, 'amenity=restaurant', '3009 S Figueroa St'],
  ['Leavey Library', 34.0231, -118.2837, 'amenity=library', ''], ['Doheny Memorial Library', 34.0204, -118.2840, 'amenity=library', ''],
  ['Lyon Center', 34.0242, -118.2882, 'leisure=fitness_centre', ''], ['Exposition Park Rose Garden', 34.0179, -118.2857, 'leisure=garden', ''],
  ['Expo Park/USC', 34.0183, -118.2855, 'railway=station', 'E Line'], ['Expo/Vermont', 34.0182, -118.2916, 'railway=station', 'E Line'],
  ['Natural History Museum', 34.0171, -118.2888, 'tourism=museum', ''], ['California Science Center', 34.0157, -118.2860, 'tourism=museum', ''],
  ['LA Memorial Coliseum', 34.0141, -118.2879, 'leisure=stadium', ''], ['Bank of America', 34.0261, -118.2848, 'amenity=bank', 'USC Village'],
  ['FedEx Office', 34.0259, -118.2852, 'shop=copyshop', 'USC Village'], ['Tommy Trojan', 34.0206, -118.2856, 'tourism=attraction', 'Childs Way & Trousdale Pkwy']
];
const ROADS = [
  ['S Figueroa St', 'primary', [[34.000, -118.2828], [34.0185, -118.2810], [34.0250, -118.2786], [34.0330, -118.2745], [34.0400, -118.2702], [34.0470, -118.2655]]],
  ['S Vermont Ave', 'primary', [[33.990, -118.2917], [34.0600, -118.2917]]], ['S Western Ave', 'primary', [[33.990, -118.3090], [34.0600, -118.3090]]],
  ['S Hoover St', 'secondary', [[34.0255, -118.2845], [34.0330, -118.2852], [34.0450, -118.2862]]], ['S Normandie Ave', 'secondary', [[33.990, -118.3003], [34.0600, -118.3003]]],
  ['W Jefferson Blvd', 'secondary', [[34.0255, -118.3150], [34.0255, -118.2780], [34.0240, -118.2650]]], ['Exposition Blvd', 'tertiary', [[34.0185, -118.3150], [34.0185, -118.2812]]],
  ['Martin Luther King Jr Blvd', 'primary', [[34.0105, -118.3150], [34.0105, -118.2650]]], ['W Adams Blvd', 'secondary', [[34.0330, -118.3150], [34.0325, -118.2750], [34.0300, -118.2600]]],
  ['W Washington Blvd', 'primary', [[34.0400, -118.3150], [34.0400, -118.2700], [34.0380, -118.2580]]], ['W Vernon Ave', 'secondary', [[34.0035, -118.3150], [34.0035, -118.2650]]]
];
const WALKS = [['Trousdale Pkwy', [[11, 232], [11, -542]]], ['Childs Way', [[-221, 0], [230, 0]]], ['Downey Way', [[-572, 150], [11, 150]]], ['W 34th St', [[-572, -260], [230, -260]]],
  ['Watt Way', [[-150, 232], [-150, -260]]], ['Bloom Walk', [[-380, 232], [-380, -260]]], ['McCarthy Way', [[230, -542], [230, 0]]], ['McClintock Ave', [[-221, 232], [-221, -542]]]];
const BUILDINGS = [['Mudd Hall', -55, -16, 140, 215], ['Von KleinSmid Center', -62, -16, 58, 125], ['Bovard Auditorium', -64, -22, -78, -14], ['Ronald Tutor Campus Center', -72, -18, -178, -92],
  ['Taper Hall', -60, -18, -322, -200], ['Doheny Memorial Library', 125, 200, -28, 72], ['Leavey Library', 120, 222, -332, -250], ['Galen Center', 500, 600, -130, -30],
  ['Shrine Auditorium', 380, 462, -365, -268], ['RTH', -410, -360, 40, 95], ['SGM', -345, -300, -100, -55], ['SAL', -385, -335, 105, 140], ['Lyon Center', -270, -210, -430, -370],
  ['USC Village', -212, 92, -765, -560], ['California Science Center', -70, -2, 505, 580], ['Natural History Museum', -340, -250, 360, 415]];

const feat = (geometry, props) => ({ type: 'Feature', id: props.id, properties: props, geometry });
const rect = (x0, x1, z0, z1) => [[LL(x0, z0), LL(x1, z0), LL(x1, z1), LL(x0, z1), LL(x0, z0)]];

export function campusEnvironment() {
  const L = {
    campus: { type: 'FeatureCollection', features: [feat({ type: 'Polygon', coordinates: [[[-118.2917, 34.0255], [-118.2786, 34.0255], [-118.2810, 34.0185], [-118.2917, 34.0185], [-118.2917, 34.0255]]] }, { id: 'mock/campus', name: 'University of Southern California', amenity: 'university' })] },
    buildings: { type: 'FeatureCollection', features: BUILDINGS.map(([n, x0, x1, z0, z1], i) => feat({ type: 'Polygon', coordinates: rect(x0, x1, z0, z1) }, { id: 'mock/b' + i, name: n, building: 'university' })) },
    walkways: { type: 'FeatureCollection', features: WALKS.map(([n, pts], i) => feat({ type: 'LineString', coordinates: pts.map(([x, z]) => LL(x, z)) }, { id: 'mock/w' + i, name: n, highway: 'pedestrian' })) },
    roads: { type: 'FeatureCollection', features: ROADS.map(([n, cls, pts], i) => feat({ type: 'LineString', coordinates: pts.map(([la, lo]) => [lo, la]) }, { id: 'mock/r' + i, name: n, highway: cls })) },
    green: { type: 'FeatureCollection', features: [feat({ type: 'Polygon', coordinates: [[[-118.2917, 34.0182], [-118.2825, 34.0182], [-118.2825, 34.0110], [-118.2917, 34.0110], [-118.2917, 34.0182]]] }, { id: 'mock/g0', name: 'Exposition Park', leisure: 'park' }), feat({ type: 'Polygon', coordinates: rect(22, 120, -48, 48) }, { id: 'mock/g1', name: 'Alumni Park', leisure: 'park' }), feat({ type: 'Polygon', coordinates: rect(22, 225, -238, -108) }, { id: 'mock/g2', name: 'McCarthy Quad', leisure: 'park' })] },
    transit: { type: 'FeatureCollection', features: [feat({ type: 'LineString', coordinates: [[-118.3150, 34.0182], [-118.2810, 34.0182], [-118.2783, 34.0215], [-118.2735, 34.0330], [-118.2690, 34.0420]] }, { id: 'mock/t0', name: 'Metro E Line', railway: 'light_rail' }),
      ...PLACES.filter(p => p[3] === 'railway=station').map((p, i) => feat({ type: 'Point', coordinates: [p[2], p[1]] }, { id: 'mock/s' + i, name: p[0], railway: 'station' }))] }
  };
  const counts = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, v.features.length]));
  return { center: USC, radius_m: 4023, layers: L, counts, errors: {}, source: 'offline demo data', mock: true, note: NOTE };
}
export function searchNearby({ what, tags, origin, radius_m, limit, label }) {
  const t = (tags || []).map(s => s.toLowerCase());
  const items = PLACES.filter(p => (t.length ? t.includes(p[3]) || (t.includes('shop=supermarket') && p[3] === 'shop=department_store') : new RegExp(what.replace(/[^\w ]/g, ''), 'i').test(p[0])))
    .map(([name, lat, lon, category, address], i) => { const d = haversineM(origin, { lat, lon }); return { id: 'mock/p' + i + name.length, name, lat, lon, category, address: address || null, opening_hours: null, website: null, distance_m: Math.round(d), walk_min: walkMinutes(d) }; })
    .filter(x => x.distance_m <= Math.max(radius_m, 4023)).sort((a, b) => a.distance_m - b.distance_m).slice(0, limit);
  return { origin, label: label || null, tags, items, source: 'offline demo data', mock: true, note: NOTE };
}
export function geocode({ query, limit }) {
  const q = query.toLowerCase().replace(/[^\w ]/g, '');
  const res = PLACES.filter(p => p[0].toLowerCase().replace(/[^\w ]/g, '').includes(q) || q.includes(p[0].toLowerCase().replace(/[^\w ]/g, '').split(' ')[0]))
    .slice(0, limit).map(p => ({ name: p[0], display_name: `${p[0]}, ${p[4] || 'Los Angeles'}`, lat: p[1], lon: p[2], type: p[3], osm: 'mock', distance_from_usc_m: Math.round(haversineM(USC, { lat: p[1], lon: p[2] })) }));
  return { query, results: res, source: 'offline demo data', mock: true, note: NOTE };
}
export function reverseGeocode({ lat, lon }) {
  let best = PLACES[0], bd = Infinity; PLACES.forEach(p => { const d = haversineM({ lat, lon }, { lat: p[1], lon: p[2] }); if (d < bd) { bd = d; best = p; } });
  return { lat, lon, name: `Near ${best[0]}`, display_name: `${Math.round(bd)} m from ${best[0]}, Los Angeles`, source: 'offline demo data', mock: true };
}
export function walkingRoute({ from, to }) {
  const corner = { lat: to.lat, lon: from.lon }, pts = [from, corner, to];
  const d1 = haversineM(from, corner), d2 = haversineM(corner, to), turn = (to.lon > from.lon) === (to.lat > from.lat) ? 'right' : 'left';
  return {
    distance_m: Math.round(d1 + d2), duration_min: walkMinutes(d1 + d2),
    geometry: { type: 'LineString', coordinates: pts.map(p => [p.lon, p.lat]) },
    steps: [{ instruction: `Head ${to.lat > from.lat ? 'north' : 'south'}`, street: null, distance_m: Math.round(d1), location: from }, { instruction: `Turn ${turn}`, street: null, distance_m: Math.round(d2), location: corner }, { instruction: 'Arrive at your destination', street: null, distance_m: 0, location: to }],
    source: 'offline demo data (straight-line legs, not a real route)', mock: true, note: NOTE
  };
}
