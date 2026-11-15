#!/usr/bin/env node
// SC Iris map MCP server. Tools fetch OpenStreetMap data; every result is also drawn on the Leaflet map at http://localhost:8787.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as osm from './osm.js';
import { USC, CORE_BBOX, RADIUS_M } from './usc.js';
import { startBus } from './bus.js';
import { engageEvents } from './engage.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PORT = +(process.env.MAP_PORT || 8787);
const bus = startBus({ port: PORT, webDir: path.join(here, '..', 'web'), vendor: path.dirname(require.resolve('leaflet/dist/leaflet.js')), onApi: (name, args) => run(name, args) });
const log = (...a) => console.error('[mcp]', ...a);

const Point = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
const PlaceRef = z.union([Point, z.object({ query: z.string().min(2).describe('A place name or address to geocode, e.g. "Leavey Library"') })]);
const here_ = () => bus.state.user || { lat: USC.lat, lon: USC.lon, label: 'Tommy Trojan' };
async function resolve(ref, fallback) {
  if (!ref) return fallback;
  if (ref.query) { const g = await osm.geocode({ query: ref.query, limit: 1 }); if (!g.results.length) throw new Error(`Could not find "${ref.query}" near USC`); const r = g.results[0]; return { lat: r.lat, lon: r.lon, label: r.name }; }
  return { lat: ref.lat, lon: ref.lon, label: ref.label };
}

const handlers = {
  async load_campus_environment({ radius_m = RADIUS_M, layers } = {}) {
    const env = await osm.campusEnvironment({ radius_m, include: layers });
    const all = [];
    for (const [k, fc] of Object.entries(env.layers)) { bus.send({ op: 'layer', id: 'env:' + k, kind: k, geojson: fc }); fc.features.forEach(f => all.push({ ...f, properties: { ...f.properties, layer: k } })); }
    // keep layers from the saved file that were not (re)loaded this time, e.g. after an Overpass outage
    try {
      const prev = JSON.parse(await fs.readFile(path.join(here, '..', 'data', 'usc-environment.geojson'), 'utf8'));
      const fresh = new Set(Object.keys(env.layers));
      (prev.features || []).forEach(f => { const k = f.properties && f.properties.layer; if (k && !fresh.has(k)) { all.push(f); env.counts[k] = (env.counts[k] || 0) + 1; } });
    } catch { }
    bus.send({ op: 'fit', bbox: CORE_BBOX });
    if (env.mock) bus.send({ op: 'banner', text: env.note });
    const out = path.join(here, '..', 'data', 'usc-environment.geojson');
    await fs.mkdir(path.dirname(out), { recursive: true }); await fs.writeFile(out, JSON.stringify({ type: 'FeatureCollection', features: all }));
    const named = env.layers.buildings ? env.layers.buildings.features.map(f => f.properties.name).filter(Boolean).slice(0, 25) : [];
    return { counts: env.counts, errors: env.errors, radius_m: env.radius_m, named_buildings_sample: named, saved_to: 'data/usc-environment.geojson', source: env.source, note: env.note };
  },
  async search_nearby({ what = '', tags, near, radius_m = 1600, limit = 8 } = {}) {
    const o = near ? await resolve(near) : here_();
    const res = await osm.searchNearby({ what, tags, lat: o.lat, lon: o.lon, radius_m, limit });
    bus.send({ op: 'results', title: res.label || what || 'Results', items: res.items, origin: o, note: res.note });
    return res;
  },
  async geocode({ query, near_usc = true, limit = 5 }) {
    const res = await osm.geocode({ query, near_usc, limit });
    bus.send({ op: 'results', title: `“${query}”`, items: res.results.map((r, i) => ({ id: r.osm + i, name: r.name, lat: r.lat, lon: r.lon, category: r.type, address: r.display_name, distance_m: r.distance_from_usc_m })), origin: here_() });
    return res;
  },
  async reverse_geocode({ lat, lon }) { return osm.reverseGeocode({ lat, lon }); },
  async walking_route({ from, to, via = [], label } = {}) {
    const a = await resolve(from, here_()), b = await resolve(to);
    if (!b) throw new Error('Give a destination: {lat, lon} or {query}');
    const res = await osm.walkingRoute({ from: a, to: b, via });
    bus.send({ op: 'route', geometry: res.geometry, steps: res.steps, distance_m: res.distance_m, duration_min: res.duration_min, from: a, to: { ...b, label: label || b.label }, source: res.source, mock: !!res.mock });
    return { ...res, from: a, to: b, note: res.note || 'Route drawn on the map. Call start_walk to animate walking it.' };
  },
  async set_user_location({ lat, lon, label = 'You' }) { bus.send({ op: 'user', lat, lon, label }); return { ok: true, lat, lon }; },
  async get_user_location() { return here_(); },
  async start_walk({ speed = 4 } = {}) {
    if (!bus.state.route) throw new Error('No route yet. Call walking_route first.');
    bus.send({ op: 'walk', speed }); return { ok: true, speed, distance_m: bus.state.route.distance_m };
  },
  async show_on_map({ id = 'custom', geojson, label, color = '#ffc72c', fit = true }) {
    if (!geojson || typeof geojson !== 'object' || !geojson.type) throw new Error('geojson must be a GeoJSON object');
    bus.send({ op: 'layer', id: 'custom:' + id, kind: 'custom', geojson, label, style: { color }, fit }); return { ok: true, id };
  },
  async engage_events({ query = '', hours = 72, limit = 30, near } = {}) {
    const o = near ? await resolve(near) : here_();
    const res = await engageEvents({ query, hours, limit, near: o });
    const pins = res.items.filter(e => e.lat != null);
    if (pins.length) bus.send({ op: 'results', title: 'EngageSC events', items: pins.map(e => ({ id: 'engage/' + e.id, name: e.name, lat: e.lat, lon: e.lon, category: 'event=' + e.when, address: e.location, distance_m: e.distance_m, walk_min: e.walk_min })), origin: o, note: res.source });
    return res;
  },
  async clear_map({ what = 'all' } = {}) { bus.send({ op: 'clear', what }); return { ok: true, cleared: what }; }
};
export async function run(name, args) {
  if (!handlers[name]) throw new Error(`Unknown tool ${name}`);
  return handlers[name](args || {});
}

const text = v => ({ content: [{ type: 'text', text: JSON.stringify(v, null, 1) }] });
const wrap = name => async args => { try { return text(await run(name, args)); } catch (e) { log(name, e.message); return { isError: true, content: [{ type: 'text', text: `Error: ${e.message}` }] }; } };

if (!process.argv.includes('--map-only')) {
  const server = new McpServer({ name: 'trojanos-osm', version: '0.1.0' });
  server.registerTool('load_campus_environment', {
    title: 'Load USC campus + neighborhood map',
    description: 'Fetches the USC University Park campus outline, building footprints, walkways, green spaces, transit, and roads out to ~2.5 miles from OpenStreetMap, draws them on the SC Iris map, and saves data/usc-environment.geojson. Call once at the start.',
    inputSchema: { radius_m: z.number().int().min(500).max(4500).optional().describe('Road/transit radius in meters around campus. 2.5 miles = 4023.'), layers: z.array(z.enum(['campus', 'buildings', 'walkways', 'roads', 'green', 'transit'])).optional() }
  }, wrap('load_campus_environment'));
  server.registerTool('search_nearby', {
    title: 'Find places near the student',
    description: 'Finds real places from OpenStreetMap near the student (or near a given place) and pins them, numbered, on the map. Pass what the student asked for in plain words (e.g. "I want to buy avocados"), or explicit OSM tags such as ["shop=supermarket","shop=greengrocer"]. Results are sorted by distance with walking minutes. Hours come from OSM tags when mapped and are not live.',
    inputSchema: { what: z.string().optional(), tags: z.array(z.string().regex(/^[a-z_:]+(=[^"\\]+)?$/i)).optional(), near: PlaceRef.optional(), radius_m: z.number().int().min(100).max(4023).optional(), limit: z.number().int().min(1).max(25).optional() }
  }, wrap('search_nearby'));
  server.registerTool('geocode', {
    title: 'Look up a place or address', description: 'Finds a named place or address with OpenStreetMap Nominatim, biased to within ~2.5 miles of USC, and pins the results.',
    inputSchema: { query: z.string().min(2), near_usc: z.boolean().optional(), limit: z.number().int().min(1).max(10).optional() }
  }, wrap('geocode'));
  server.registerTool('reverse_geocode', { title: 'What is at this point', description: 'Returns the nearest address/place name for a coordinate.', inputSchema: { lat: z.number(), lon: z.number() } }, wrap('reverse_geocode'));
  server.registerTool('walking_route', {
    title: 'Walking directions', description: 'Computes a walking route on OpenStreetMap paths (OSRM foot profile), draws it with turn-by-turn steps, and returns distance, minutes and steps. "from" defaults to the student\'s current location. Endpoints are {lat, lon} or {query: "Leavey Library"}.',
    inputSchema: { from: PlaceRef.optional(), to: PlaceRef, via: z.array(Point).max(5).optional(), label: z.string().optional() }
  }, wrap('walking_route'));
  server.registerTool('start_walk', { title: 'Animate walking the route', description: 'Moves the student marker along the last route on the map, with live turn prompts like the glasses HUD. speed is a multiplier of real walking pace.', inputSchema: { speed: z.number().min(1).max(30).optional() } }, wrap('start_walk'));
  server.registerTool('set_user_location', { title: 'Set the student location', description: 'Moves the "You" marker. Later searches and routes start here.', inputSchema: { lat: z.number(), lon: z.number(), label: z.string().optional() } }, wrap('set_user_location'));
  server.registerTool('get_user_location', { title: 'Where is the student', description: 'Returns the current "You" position (updates while a walk is animating).', inputSchema: {} }, wrap('get_user_location'));
  server.registerTool('show_on_map', { title: 'Draw GeoJSON', description: 'Draws any GeoJSON on the map as its own layer.', inputSchema: { id: z.string().optional(), geojson: z.record(z.any()), label: z.string().optional(), color: z.string().optional(), fit: z.boolean().optional() } }, wrap('show_on_map'));
  server.registerTool('engage_events', { title: 'Upcoming EngageSC events', description: 'Lists upcoming USC events from EngageSC (engage.usc.edu): name, host org, time, location, perks like free food, the event link, and the building on the map with distance and walking minutes from the student. Use for "what is happening on campus", free-time suggestions and event plans.', inputSchema: { query: z.string().optional().describe('Words to match, e.g. "AI", "career", "free food"'), hours: z.number().min(1).max(336).optional().describe('How far ahead to look, default 72'), limit: z.number().min(1).max(100).optional(), near: PlaceRef.optional() } }, wrap('engage_events'));
  server.registerTool('clear_map', { title: 'Clear the map', description: 'Removes results, routes, custom layers, or everything except the campus environment.', inputSchema: { what: z.enum(['all', 'route', 'results', 'layers']).optional() } }, wrap('clear_map'));
  await server.connect(new StdioServerTransport());
  log(`ready${osm.MOCK ? ' (OFFLINE DEMO DATA)' : ''} · map at http://localhost:${PORT}`);
}
