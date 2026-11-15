// Offline test: starts the MCP server with OSM_MOCK=1, checks every tool, and checks the OSM→GeoJSON and step text helpers.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { instruction } from '../server/osm.js';
import { presetFor } from '../server/usc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.MAP_PORT || '8799';
const client = new Client({ name: 'trojanos-test', version: '0.1.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(here, '..', 'server', 'index.js')], env: { ...process.env, OSM_MOCK: '1', MAP_PORT: port }, stderr: 'pipe' }));
const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); const t = r.content?.[0]?.text || ''; return r.isError ? { error: t } : JSON.parse(t); };
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ✓', m); };

const tools = (await client.listTools()).tools.map(t => t.name);
ok(['load_campus_environment', 'search_nearby', 'geocode', 'walking_route', 'start_walk', 'set_user_location', 'get_user_location', 'show_on_map', 'clear_map', 'reverse_geocode'].every(t => tools.includes(t)), `10 tools registered (${tools.length})`);
const env = await call('load_campus_environment', {});
ok(env.counts.buildings > 5 && env.counts.roads > 5 && env.counts.walkways > 3, `environment loaded: ${JSON.stringify(env.counts)}`);
ok(env.saved_to === 'data/usc-environment.geojson', 'environment saved for the 3D simulator');
ok(presetFor('I want to buy avocados').tags.includes('shop=supermarket'), 'avocados → supermarket/greengrocer tags');
await call('set_user_location', { lat: 34.0200, lon: -118.2898, label: 'RTH' });
const where = await call('get_user_location', {});
ok(Math.abs(where.lat - 34.02) < 1e-6, 'user location stored');
const s = await call('search_nearby', { what: 'I want to buy avocados', radius_m: 3000 });
ok(s.items.length >= 2 && s.items[0].distance_m <= s.items[1].distance_m, `avocado search sorted by distance: ${s.items.map(i => i.name).join(', ')}`);
const g = await call('geocode', { query: 'Leavey Library' });
ok(g.results.length && /Leavey/.test(g.results[0].name), 'geocode finds Leavey Library');
const rt = await call('walking_route', { to: { query: "Trader Joe's" } });
ok(rt.distance_m > 100 && rt.steps.length >= 2, `route to Trader Joe's: ${rt.distance_m} m, ${rt.steps.length} steps`);
const w = await call('start_walk', { speed: 6 });
ok(w.ok, 'walk animation started');
const bad = await call('show_on_map', { geojson: { nope: 1 } });
ok(bad.error && /GeoJSON/.test(bad.error), 'bad GeoJSON is rejected with a clear error');
const cl = await call('clear_map', { what: 'results' });
ok(cl.ok, 'clear_map works');
ok(instruction({ maneuver: { type: 'turn', modifier: 'left' }, name: 'Childs Way' }, 1, 3) === 'Turn left onto Childs Way', 'OSRM step → "Turn left onto Childs Way"');
ok(instruction({ maneuver: { type: 'depart', bearing_after: 0 }, name: 'Trousdale Parkway' }, 0, 3) === 'Head north on Trousdale Parkway', 'OSRM depart → "Head north on Trousdale Parkway"');
// HTTP API used by map clicks
const r = await fetch(`http://localhost:${port}/api/tool/walking_route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: { lat: 34.0231, lon: -118.2837 }, label: 'Leavey' }) });
ok(r.ok && (await r.json()).distance_m > 0, 'map click → /api/tool/walking_route works');
console.log(`\n${n} checks passed`);
if (process.env.KEEP_OPEN) { console.log('Server kept open on port', port); } else { await client.close(); process.exit(0); }
