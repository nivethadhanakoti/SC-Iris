// Map bus: serves the Leaflet page and pushes every tool result to open browser tabs over a WebSocket.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const log = (...a) => console.error('[map]', ...a);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/geo+json' };

export function startBus({ port, webDir, vendor, onApi }) {
  const state = { layers: new Map(), user: null, route: null, results: null };
  const clients = new Set();
  const send = msg => {
    if (msg.op === 'layer') state.layers.set(msg.id, msg);
    else if (msg.op === 'remove') state.layers.delete(msg.id);
    else if (msg.op === 'clear') {
      const w = msg.what || 'all';
      if (w === 'all' || w === 'layers') [...state.layers.keys()].filter(k => !k.startsWith('env:')).forEach(k => state.layers.delete(k));
      if (w === 'all' || w === 'route') state.route = null;
      if (w === 'all' || w === 'results') state.results = null;
    }
    else if (msg.op === 'user') state.user = { lat: msg.lat, lon: msg.lon, label: msg.label || 'You' };
    else if (msg.op === 'route') state.route = msg;
    else if (msg.op === 'results') state.results = msg;
    else if (msg.op === 'banner') state.banner = msg;
    const data = JSON.stringify(msg);
    clients.forEach(ws => { if (ws.readyState === 1) ws.send(data); });
  };
  const serveFile = (res, file) => fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(buf);
  });
  const safeJoin = (root, p) => { const f = path.normalize(path.join(root, p)); return f.startsWith(root) ? f : null; };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/tool/') && req.method === 'POST') {
      let body = ''; req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
      req.on('end', async () => {
        try { const out = await onApi(decodeURIComponent(url.pathname.slice(10)), body ? JSON.parse(body) : {}); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); }
        catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
      });
      return;
    }
    if (url.pathname.startsWith('/data/')) { const f = safeJoin(path.join(webDir, '..', 'data'), url.pathname.slice(6)); return f && /\.geojson$|\.json$/.test(f) ? serveFile(res, f) : (res.writeHead(403), res.end()); }
    if (url.pathname.startsWith('/vendor/leaflet/')) { const f = safeJoin(vendor, url.pathname.slice(16)); return f ? serveFile(res, f) : (res.writeHead(403), res.end()); }
    const f = safeJoin(webDir, url.pathname === '/' ? 'index.html' : url.pathname);
    return f ? serveFile(res, f) : (res.writeHead(403), res.end());
  });
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('error', () => {});
  wss.on('connection', ws => {
    clients.add(ws);
    ws.send(JSON.stringify({ op: 'state', layers: [...state.layers.values()], user: state.user, route: state.route, results: state.results, banner: state.banner || null }));
    ws.on('message', raw => { try { const m = JSON.parse(raw); if (m.op === 'user_moved' && Number.isFinite(m.lat) && Number.isFinite(m.lon)) state.user = { lat: m.lat, lon: m.lon, label: 'You' }; } catch {} });
    ws.on('close', () => clients.delete(ws));
  });
  server.on('error', e => log(`map server not started on port ${port}: ${e.message}. Tools still work; set MAP_PORT to another port.`));
  server.listen(port, '127.0.0.1', () => (log(`SC Iris map → http://localhost:${port}`), log(`SC Iris lens simulation → http://localhost:${port}/lens.html`)));
  return { send, state, close: () => new Promise(r => { wss.close(); server.close(() => r()); }) };
}
