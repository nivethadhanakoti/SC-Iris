// Free OpenStreetMap services: Overpass (map data), Nominatim (geocoding), OSRM foot profile (walking routes).
// Every call is cached on disk and Nominatim is throttled to 1 request/second, per the OSM usage policies.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import osmtogeojson from 'osmtogeojson';
import { USC, CORE_BBOX, AREA_BBOX, RADIUS_M, presetFor, haversineM, walkMinutes } from './usc.js';
import * as mock from './mock.js';

export const MOCK = process.env.OSM_MOCK === '1';
const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = process.env.CACHE_DIR || path.join(here, '..', 'data', 'cache');
const UA = `SC-Iris-hackathon/0.1 (${process.env.OSM_CONTACT || 'set OSM_CONTACT to your email'})`;
const OVERPASS = (process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter,https://overpass.private.coffee/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter').split(',').map(s => s.trim()).filter(Boolean);
const NOMINATIM = (process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
// FOSSGIS public OSRM with a foot profile. Its path keeps "driving" in the URL; the profile is chosen by "routed-foot".
const OSRM_FOOT = (process.env.OSRM_FOOT_URL || 'https://routing.openstreetmap.de/routed-foot').replace(/\/$/, '');
const DAY = 864e5;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.error('[osm]', ...a);

async function cached(key, ttl, fn) {
  const file = path.join(CACHE_DIR, crypto.createHash('sha1').update(key).digest('hex') + '.json');
  try { const st = await fs.stat(file); if (Date.now() - st.mtimeMs < ttl) return JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
  const val = await fn();
  try { await fs.mkdir(CACHE_DIR, { recursive: true }); await fs.writeFile(file, JSON.stringify(val)); } catch (e) { log('cache write failed', e.message); }
  return val;
}
async function getJSON(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) }, signal: AbortSignal.timeout(opts.timeout || 60000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return res.json();
}
let lastNominatim = 0;
async function nominatim(pathAndQuery) {
  return cached('nom:' + pathAndQuery, 7 * DAY, async () => {
    const wait = 1100 - (Date.now() - lastNominatim); if (wait > 0) await sleep(wait); lastNominatim = Date.now();
    return getJSON(`${NOMINATIM}${pathAndQuery}`, { timeout: 20000 });
  });
}
async function overpass(query) {
  return cached('ovp:' + query, 7 * DAY, async () => {
    let err;
    for (const ep of OVERPASS) {
      try { return await getJSON(ep, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 120000 }); }
      catch (e) { err = e; log('overpass endpoint failed', ep, e.message); }
    }
    throw err;
  });
}
const bbox = b => b.join(',');
const KEEP = ['name', 'building', 'highway', 'footway', 'leisure', 'landuse', 'amenity', 'shop', 'railway', 'public_transport', 'university', 'tourism', 'operator', 'height', 'building:levels', 'roof:shape', 'addr:housenumber', 'addr:street', 'opening_hours', 'website'];
export function toGeo(osmJson) {
  const fc = osmtogeojson(osmJson);
  fc.features = fc.features.map(f => {
    const p = f.properties || {}, t = p.tags || p, props = { id: f.id || p.id };
    KEEP.forEach(k => { if (t[k] != null) props[k] = t[k]; });
    return { type: 'Feature', id: props.id, properties: props, geometry: roundGeom(f.geometry) };
  }).filter(f => f.geometry);
  return fc;
}
function roundGeom(g) {
  if (!g) return g;
  const r = c => Array.isArray(c[0]) ? c.map(r) : [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6];
  return { type: g.type, coordinates: g.type === 'GeometryCollection' ? undefined : r(g.coordinates), ...(g.type === 'GeometryCollection' ? { geometries: g.geometries.map(roundGeom) } : {}) };
}

/* ---------- campus + neighborhood environment ---------- */
export async function campusEnvironment({ radius_m = RADIUS_M, include } = {}) {
  if (MOCK) return mock.campusEnvironment({ radius_m, include });
  const R = Math.min(4500, Math.max(500, radius_m)), C = `${USC.lat},${USC.lon}`, B = bbox(CORE_BBOX);
  const Q = {
    campus: `[out:json][timeout:60];(way["amenity"="university"]["name"~"University of Southern California"](around:2500,${C});relation["amenity"="university"]["name"~"University of Southern California"](around:2500,${C}););out geom;`,
    buildings: `[out:json][timeout:120];(way["building"](${B});relation["building"](${B}););out geom;`,
    walkways: `[out:json][timeout:90];way["highway"~"^(footway|pedestrian|path|steps|living_street|cycleway)$"](${B});out geom;`,
    roads: `[out:json][timeout:120];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](around:${R},${C});way["highway"~"^(residential|unclassified)$"](around:${Math.min(R, 1800)},${C}););out geom;`,
    green: `[out:json][timeout:90];(way["leisure"~"^(park|garden|pitch|stadium)$"](around:${Math.min(R, 2600)},${C});relation["leisure"="park"](around:${Math.min(R, 2600)},${C});way["landuse"~"^(grass|recreation_ground)$"](${B}););out geom;`,
    transit: `[out:json][timeout:60];(way["railway"="light_rail"](around:${R},${C});node["railway"="station"](around:${R},${C});node["public_transport"="station"](around:${R},${C}););out geom;`
  };
  const want = include && include.length ? include : Object.keys(Q);
  const layers = {}, counts = {}, errors = {};
  for (const k of want) {
    if (!Q[k]) continue;
    try { layers[k] = toGeo(await overpass(Q[k])); counts[k] = layers[k].features.length; }
    catch (e) { errors[k] = e.message; }
  }
  return { center: USC, radius_m: R, layers, counts, errors, source: 'OpenStreetMap via Overpass API' };
}

/* ---------- places ---------- */
export function osmItem(el, origin) {
  const t = el.tags || {}, lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  if (lat == null) return null;
  const d = haversineM(origin, { lat, lon });
  const cat = ['shop', 'amenity', 'leisure', 'tourism', 'railway', 'public_transport', 'highway', 'craft'].find(k => t[k]);
  return { id: `${el.type}/${el.id}`, name: t.name || (cat ? `${t[cat]} (unnamed)` : 'Unnamed place'), lat, lon, category: cat ? `${cat}=${t[cat]}` : '', address: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null, opening_hours: t.opening_hours || null, website: t.website || null, distance_m: Math.round(d), walk_min: walkMinutes(d) };
}
export async function searchNearby({ what = '', tags, lat, lon, radius_m = 1600, limit = 8 }) {
  const origin = { lat: lat ?? USC.lat, lon: lon ?? USC.lon };
  const preset = !tags || !tags.length ? presetFor(what) : null, useTags = tags && tags.length ? tags : preset ? preset.tags : [];
  if (MOCK) return mock.searchNearby({ what, tags: useTags, origin, radius_m, limit, label: preset?.label });
  const R = Math.min(RADIUS_M, Math.max(100, radius_m)), A = `around:${R},${origin.lat},${origin.lon}`;
  const parts = useTags.map(tg => { const [k, v] = tg.split('='); return v ? `nwr["${k}"="${v}"](${A});` : `nwr["${k}"](${A});`; });
  if (!parts.length && what.trim()) { const safe = what.replace(/["\\]/g, '').slice(0, 60); parts.push(`nwr["name"~"${safe}",i]["shop"](${A});`, `nwr["name"~"${safe}",i]["amenity"](${A});`); }
  if (!parts.length) return { origin, items: [], note: 'Say what to look for, or pass OSM tags like shop=supermarket.' };
  const data = await overpass(`[out:json][timeout:60];(${parts.join('')});out center tags 200;`);
  const items = (data.elements || []).map(e => osmItem(e, origin)).filter(Boolean).sort((a, b) => a.distance_m - b.distance_m).slice(0, Math.min(25, limit));
  return { origin, label: preset?.label || null, tags: useTags, items, source: 'OpenStreetMap via Overpass API', note: 'Opening hours and stock come from OSM tags when mapped; they are not live.' };
}
export async function geocode({ query, near_usc = true, limit = 5 }) {
  if (MOCK) return mock.geocode({ query, limit });
  const [s, w, n, e] = AREA_BBOX;
  const base = `/search?format=jsonv2&addressdetails=1&limit=${limit}&q=${encodeURIComponent(query)}`;
  let res = await nominatim(base + (near_usc ? `&viewbox=${w},${n},${e},${s}&bounded=1` : ''));
  if (!res.length && near_usc) res = await nominatim(base + '&countrycodes=us');
  return { query, results: res.map(r => ({ name: r.name || r.display_name.split(',')[0], display_name: r.display_name, lat: +r.lat, lon: +r.lon, type: `${r.category || r.class}=${r.type}`, osm: `${r.osm_type}/${r.osm_id}`, distance_from_usc_m: Math.round(haversineM(USC, { lat: +r.lat, lon: +r.lon })) })), source: 'OpenStreetMap Nominatim' };
}
export async function reverseGeocode({ lat, lon }) {
  if (MOCK) return mock.reverseGeocode({ lat, lon });
  const r = await nominatim(`/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lon}`);
  return { lat, lon, name: r.name || null, display_name: r.display_name, source: 'OpenStreetMap Nominatim' };
}

/* ---------- walking route ---------- */
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
export function instruction(step, i, n) {
  const m = step.maneuver || {}, name = step.name || (step.ref || ''), mod = m.modifier || '', onto = name ? ` onto ${name}` : '';
  switch (m.type) {
    case 'depart': return `Head ${COMPASS[Math.round(((m.bearing_after || 0) % 360) / 45) % 8]}${name ? ` on ${name}` : ''}`;
    case 'arrive': return i === n - 1 ? 'Arrive at your destination' : 'Reach the waypoint';
    case 'turn': case 'end of road': case 'fork': return mod === 'straight' ? `Continue straight${onto}` : `Turn ${mod}${onto}`;
    case 'new name': case 'continue': return `Continue${onto || ' straight'}`;
    case 'roundabout': case 'rotary': return `At the roundabout, take exit ${m.exit || 1}${onto}`;
    default: return mod ? `Go ${mod}${onto}` : `Continue${onto}`;
  }
}
export async function walkingRoute({ from, to, via = [] }) {
  if (MOCK) return mock.walkingRoute({ from, to, via });
  const pts = [from, ...via, to].map(p => `${(+p.lon).toFixed(6)},${(+p.lat).toFixed(6)}`).join(';');
  const url = `${OSRM_FOOT}/route/v1/driving/${pts}?overview=full&geometries=geojson&steps=true`;
  const r = await cached('osrm:' + url, DAY, () => getJSON(url, { timeout: 30000 }));
  if (r.code !== 'Ok' || !r.routes?.length) throw new Error(`No walking route found (${r.code || 'unknown'})`);
  const rt = r.routes[0], steps = [];
  rt.legs.forEach(leg => leg.steps.forEach(s => steps.push(s)));
  return {
    distance_m: Math.round(rt.distance), duration_min: Math.max(1, Math.round(rt.duration / 60)),
    geometry: rt.geometry,
    steps: steps.map((s, i) => ({ instruction: instruction(s, i, steps.length), street: s.name || null, distance_m: Math.round(s.distance), location: { lat: s.maneuver.location[1], lon: s.maneuver.location[0] } })),
    source: 'OSRM foot profile (routing.openstreetmap.de) on OpenStreetMap data'
  };
}
