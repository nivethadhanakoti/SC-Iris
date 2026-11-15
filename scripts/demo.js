// Scripted demo: drives the MCP server the same way an agent would, so you can present the map without a live agent.
// Usage: npm run demo   (live OpenStreetMap)   |   npm run demo:offline   (offline demo data)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pause = ms => new Promise(r => setTimeout(r, ms));
const port = process.env.MAP_PORT || '8787';
const client = new Client({ name: 'trojanos-demo', version: '0.1.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(here, '..', 'server', 'index.js')], env: { ...process.env, MAP_PORT: port }, stderr: 'inherit' }));
const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); const t = r.content?.[0]?.text || ''; if (r.isError) throw new Error(t); return JSON.parse(t); };

console.log(`Open http://localhost:${port} now. Starting in 6 seconds…`);
await pause(6000);
console.log('1. Loading USC campus + 2.5 mi neighborhood…');
const env = await call('load_campus_environment', {});
console.log('   ', env.counts, env.errors && Object.keys(env.errors).length ? env.errors : '');
await pause(3000);
await call('set_user_location', { lat: 34.0200, lon: -118.2898, label: 'RTH' });
console.log('2. "I want to buy avocados"');
const found = await call('search_nearby', { what: 'I want to buy avocados', radius_m: 2500, limit: 6 });
found.items.forEach((it, i) => console.log(`    ${i + 1}. ${it.name} · ${it.distance_m} m · ${it.walk_min} min`));
await pause(4000);
if (found.items.length) {
  const it = found.items[0];
  console.log(`3. Walking route to ${it.name}`);
  const rt = await call('walking_route', { to: { lat: it.lat, lon: it.lon }, label: it.name });
  console.log(`    ${rt.distance_m} m · ${rt.duration_min} min`); rt.steps.forEach(s => console.log('    -', s.instruction, s.distance_m ? `(${s.distance_m} m)` : ''));
  await pause(2500);
  await call('start_walk', { speed: 8 });
}
console.log('Demo running. Press Ctrl+C to stop.');
