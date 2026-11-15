/* SC Iris map view: draws whatever the MCP tools send over the WebSocket, and lets you click to walk. */
(() => {
  const $ = id => document.getElementById(id);
  const USC = [34.0206, -118.2856];
  const map = L.map('map', { preferCanvas: true, zoomSnap: .5 }).setView(USC, 16);
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hav = (a, b) => { const R = 6371008.8, r = d => d * Math.PI / 180, dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]), s = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
  const fmt = m => m < 160 ? `${Math.round(m / 5) * 5} m` : `${(m / 1609.34).toFixed(m < 1609 ? 2 : 1)} mi`;

  /* ---------- layer styles ---------- */
  const CAMPUSY = /^(university|college|school|dormitory|library|stadium|sports_centre)$/;
  const ROADW = { motorway: 6, trunk: 6, primary: 5, secondary: 4, tertiary: 3.5, residential: 2, unclassified: 2 };
  const ROADC = { motorway: '#e8a64a', trunk: '#e8a64a', primary: '#f2c14e', secondary: '#f6dd8f', tertiary: '#ffffff', residential: '#ffffff', unclassified: '#ffffff' };
  const KINDS = {
    campus: { label: 'Campus outline', color: '#c8102e', style: () => ({ color: '#c8102e', weight: 2.5, dashArray: '6 4', fillColor: '#c8102e', fillOpacity: .05 }) },
    green: { label: 'Parks & green', color: '#5d9a4a', style: () => ({ color: '#4c8a3c', weight: 1, fillColor: '#5d9a4a', fillOpacity: .32 }) },
    buildings: { label: 'Buildings', color: '#a8442f', style: f => { const p = f.properties || {}, uni = CAMPUSY.test(p.building || '') || /USC|University|Hall|Library|Center/i.test(p.name || ''); return { color: uni ? '#7e2f20' : '#6f6c66', weight: .6, fillColor: uni ? '#b04a33' : '#9d9890', fillOpacity: uni ? .62 : .35 }; } },
    roads: { label: 'Roads', color: '#f2c14e', style: f => { const h = (f.properties || {}).highway; return { color: ROADC[h] || '#fff', weight: ROADW[h] || 2, opacity: .75 }; } },
    walkways: { label: 'Walkways', color: '#b5651d', style: () => ({ color: '#b5651d', weight: 2, dashArray: '3 3', opacity: .9 }) },
    transit: { label: 'Metro & stations', color: '#e05a7a', style: () => ({ color: '#e05a7a', weight: 4, opacity: .9 }) },
    custom: { label: 'Custom', color: '#ffc72c', style: (f, s) => ({ color: (s && s.color) || '#ffc72c', weight: 3, fillOpacity: .2 }) }
  };
  const ORDER = ['campus', 'green', 'buildings', 'roads', 'walkways', 'transit', 'custom'];
  ORDER.forEach(k => map.createPane('p_' + k).style.zIndex = 380 + ORDER.indexOf(k));
  map.createPane('p_route').style.zIndex = 460;
  const layers = new Map(), hidden = new Set();

  function popupFor(latlng, title, sub) {
    const div = document.createElement('div');
    div.innerHTML = `<b>${esc(title || 'This spot')}</b>${sub ? `<br><span>${esc(sub)}</span>` : ''}<br>`;
    const go = document.createElement('button'); go.textContent = 'Walk here'; go.onclick = () => { map.closePopup(); api('walking_route', { to: { lat: latlng.lat, lon: latlng.lng }, label: title || undefined }); };
    const me = document.createElement('button'); me.textContent = 'I am here'; me.style.marginLeft = '6px'; me.style.background = '#333';
    me.onclick = () => { map.closePopup(); api('set_user_location', { lat: latlng.lat, lon: latlng.lng }); };
    div.append(go, me); return div;
  }
  function drawLayer(msg) {
    removeLayer(msg.id);
    const kind = KINDS[msg.kind] ? msg.kind : 'custom', K = KINDS[kind];
    const lyr = L.geoJSON(msg.geojson, {
      pane: 'p_' + kind, style: f => K.style(f, msg.style),
      pointToLayer: (f, ll) => L.circleMarker(ll, { pane: 'p_' + kind, radius: kind === 'transit' ? 6 : 5, color: '#fff', weight: 2, fillColor: K.color, fillOpacity: 1 }),
      onEachFeature: (f, l) => {
        const n = f.properties && f.properties.name;
        if (n && (kind === 'buildings' || kind === 'transit' || kind === 'green' || kind === 'custom')) l.bindTooltip(esc(n), { sticky: true });
        l.on('click', e => { L.DomEvent.stopPropagation(e); L.popup().setLatLng(e.latlng).setContent(popupFor(e.latlng, n, [f.properties.building ? 'Building' : '', f.properties.highway || '', f.properties.leisure || ''].filter(Boolean).join(' · '))).openOn(map); });
      }
    });
    layers.set(msg.id, { lyr, kind, count: (msg.geojson.features || [msg.geojson]).length });
    if (!hidden.has(kind)) lyr.addTo(map);
    if (msg.fit && lyr.getBounds && lyr.getBounds().isValid()) map.fitBounds(lyr.getBounds(), { padding: [30, 30] });
    paintLegend();
  }
  function removeLayer(id) { const l = layers.get(id); if (l) { map.removeLayer(l.lyr); layers.delete(id); paintLegend(); } }
  function paintLegend() {
    const counts = {}; layers.forEach(l => { counts[l.kind] = (counts[l.kind] || 0) + l.count; });
    $('layers').innerHTML = ORDER.filter(k => counts[k]).map(k => `<label class="tog"><input type="checkbox" data-k="${k}" ${hidden.has(k) ? '' : 'checked'}><i class="sw" style="background:${KINDS[k].color}"></i>${KINDS[k].label} <small>${counts[k]}</small></label>`).join('') || '<span class="note">Nothing loaded yet. Ask the agent to load the USC campus map.</span>';
    $('layers').querySelectorAll('input').forEach(cb => cb.onchange = () => { const k = cb.dataset.k; if (cb.checked) hidden.delete(k); else hidden.add(k); layers.forEach(l => { if (l.kind === k) cb.checked ? l.lyr.addTo(map) : map.removeLayer(l.lyr); }); });
  }

  /* ---------- you ---------- */
  let meLL = L.latLng(USC);
  const me = L.marker(meLL, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), draggable: true, zIndexOffset: 1000, keyboard: false, title: 'You' }).addTo(map).bindTooltip('You', { direction: 'top', offset: [0, -10] });
  me.on('dragend', () => { const ll = me.getLatLng(); api('set_user_location', { lat: ll.lat, lon: ll.lng }); });
  function setMe(lat, lon, pan) { meLL = L.latLng(lat, lon); me.setLatLng(meLL); if (pan && !map.getBounds().pad(-.15).contains(meLL)) map.panTo(meLL, { animate: true }); }

  /* ---------- results ---------- */
  let resLayer = null;
  function showResults(msg) {
    if (resLayer) map.removeLayer(resLayer);
    resLayer = L.layerGroup().addTo(map);
    const items = msg.items || [];
    $('resultsBox').hidden = !items.length && !msg.note;
    $('resultsTitle').textContent = msg.title || 'Results';
    $('resultsNote').textContent = items.length ? (msg.note || '') : 'Nothing found nearby. Try a bigger radius or other words.';
    $('results').innerHTML = items.map((it, i) => `<li data-i="${i}"><span class="n">${i + 1}</span><div><div class="t">${esc(it.name)}</div><div class="s">${esc([it.category, it.address].filter(Boolean).join(' · '))}</div><div class="s">${it.distance_m != null ? `${fmt(it.distance_m)} · ${it.walk_min || Math.max(1, Math.round(it.distance_m / 80))} min walk` : ''}${it.opening_hours ? ` · ${esc(it.opening_hours)}` : ''}</div></div></li>`).join('');
    const bounds = [meLL];
    items.forEach((it, i) => {
      const m = L.marker([it.lat, it.lon], { icon: L.divIcon({ className: '', html: `<div class="pin">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }), title: it.name }).addTo(resLayer);
      m.bindPopup(() => popupFor(L.latLng(it.lat, it.lon), it.name, [it.address, it.distance_m != null ? fmt(it.distance_m) : ''].filter(Boolean).join(' · ')));
      bounds.push(L.latLng(it.lat, it.lon));
    });
    $('results').querySelectorAll('li').forEach(li => li.onclick = () => { const it = items[+li.dataset.i]; $('results').querySelectorAll('li').forEach(x => x.classList.toggle('on', x === li)); api('walking_route', { to: { lat: it.lat, lon: it.lon }, label: it.name }); });
    if (items.length) map.fitBounds(L.latLngBounds(bounds), { padding: [50, 50], maxZoom: 17 });
  }

  /* ---------- route + walking ---------- */
  let routeLayer = null, route = null, walking = null;
  function showRoute(msg) {
    stopWalk();
    if (routeLayer) map.removeLayer(routeLayer);
    route = msg;
    if (!msg) { $('routeBox').hidden = true; return; }
    const ll = msg.geometry.coordinates.map(([lo, la]) => [la, lo]);
    routeLayer = L.layerGroup([
      L.polyline(ll, { pane: 'p_route', color: '#5a1220', weight: 9, opacity: .55 }),
      L.polyline(ll, { pane: 'p_route', color: '#ffc72c', weight: 5, opacity: 1 }),
      L.circleMarker(ll[ll.length - 1], { pane: 'p_route', radius: 8, color: '#111', weight: 2, fillColor: '#ffc72c', fillOpacity: 1 }).bindTooltip(esc((msg.to && msg.to.label) || 'Destination'), { permanent: true, direction: 'right', className: 'lbl' })
    ]).addTo(map);
    map.fitBounds(L.latLngBounds(ll).extend(meLL), { padding: [60, 60], maxZoom: 18 });
    $('routeBox').hidden = false;
    $('routeSum').innerHTML = `${fmt(msg.distance_m)} · ${msg.duration_min} min walk<small>to ${esc((msg.to && msg.to.label) || 'destination')}</small>`;
    $('steps').innerHTML = msg.steps.map((s, i) => `<li data-i="${i}"><span>${arrowFor(s.instruction)}</span><span>${esc(s.instruction)}</span><span class="d">${s.distance_m ? fmt(s.distance_m) : ''}</span></li>`).join('');
    $('routeNote').textContent = msg.mock ? 'Offline demo route: straight legs, not real paths.' : (msg.source || '');
    // where each step starts along the line
    let acc = 0; route.stepStart = msg.steps.map(s => { const a = acc; acc += s.distance_m || 0; return a; });
    route.ll = ll; route.cum = [0]; for (let i = 1; i < ll.length; i++) route.cum.push(route.cum[i - 1] + hav(ll[i - 1], ll[i]));
    const scale = route.cum[route.cum.length - 1] / Math.max(1, acc); route.stepStart = route.stepStart.map(v => v * scale);
  }
  const arrowFor = t => /left/i.test(t) ? '↰' : /right/i.test(t) ? '↱' : /arrive|destination/i.test(t) ? '◎' : '↑';
  function posAt(d) { const c = route.cum, ll = route.ll; let i = 1; while (i < c.length - 1 && c[i] < d) i++; const seg = c[i] - c[i - 1] || 1, t = Math.max(0, Math.min(1, (d - c[i - 1]) / seg)); return [ll[i - 1][0] + (ll[i][0] - ll[i - 1][0]) * t, ll[i - 1][1] + (ll[i][1] - ll[i - 1][1]) * t]; }
  function startWalk(mult) {
    if (!route) return; stopWalk();
    const total = route.cum[route.cum.length - 1], speed = 1.35 * (mult || +$('speed').value);
    let d = 0, last = performance.now(), lastSent = 0;
    $('hud').hidden = false; $('walkBtn').textContent = 'Stop';
    const tick = now => {
      const dt = Math.min(.1, (now - last) / 1000); last = now; d = Math.min(total, d + speed * dt);
      const [la, lo] = posAt(d); setMe(la, lo, true);
      let k = 0; route.stepStart.forEach((s, i) => { if (s <= d + .5) k = i; });
      const next = route.steps[Math.min(k + 1, route.steps.length - 1)], toNext = Math.max(0, (route.stepStart[k + 1] ?? total) - d);
      $('hudArrow').textContent = d >= total ? '◎' : arrowFor(next.instruction);
      $('hudT').textContent = d >= total ? "You're here" : next.instruction;
      $('hudS').textContent = d >= total ? ((route.to && route.to.label) || 'Destination') : `in ${fmt(toNext)} · ${fmt(total - d)} left`;
      $('steps').querySelectorAll('li').forEach((li, i) => { li.classList.toggle('done', i < k); li.classList.toggle('now', i === k + 1 && d < total); });
      if (now - lastSent > 1000) { lastSent = now; send({ op: 'user_moved', lat: la, lon: lo }); }
      if (d < total) walking = requestAnimationFrame(tick); else { walking = null; $('walkBtn').textContent = 'Walk it'; send({ op: 'user_moved', lat: la, lon: lo }); }
    };
    walking = requestAnimationFrame(tick);
  }
  function stopWalk() { if (walking) cancelAnimationFrame(walking); walking = null; $('walkBtn').textContent = 'Walk it'; }
  $('walkBtn').onclick = () => walking ? stopWalk() : startWalk();

  /* ---------- map clicks, base map toggles ---------- */
  map.on('click', e => L.popup().setLatLng(e.latlng).setContent(popupFor(e.latlng, null, `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`)).openOn(map));
  $('tiles').onchange = e => e.target.checked ? tiles.addTo(map) : map.removeLayer(tiles);
  $('night').onchange = e => document.body.classList.toggle('night', e.target.checked);
  if (new URLSearchParams(location.search).get('tiles') === 'off') { $('tiles').checked = false; map.removeLayer(tiles); }

  /* ---------- server link ---------- */
  async function api(name, args) {
    try { const r = await fetch('/api/tool/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) }); const j = await r.json(); if (j.error) toast(j.error); return j; }
    catch (e) { toast('Map server is not reachable'); }
  }
  function toast(t) { const b = $('banner'); b.hidden = false; b.textContent = t; clearTimeout(toast.t); toast.t = setTimeout(() => { if (!b.dataset.sticky) b.hidden = true; }, 5000); }
  let ws = null, retry = 500;
  const send = m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => { retry = 500; $('conn').className = 'conn on'; $('conn').querySelector('span').textContent = 'Live'; };
    ws.onclose = () => { $('conn').className = 'conn off'; $('conn').querySelector('span').textContent = 'Reconnecting…'; setTimeout(connect, retry = Math.min(8000, retry * 2)); };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } handle(m); };
  }
  function handle(m) {
    switch (m.op) {
      case 'state':
        [...layers.keys()].forEach(removeLayer); (m.layers || []).forEach(drawLayer);
        if (m.user) setMe(m.user.lat, m.user.lon); if (m.results) showResults(m.results); if (m.route) showRoute(m.route); if (m.banner) handle(m.banner); break;
      case 'layer': drawLayer(m); break;
      case 'remove': removeLayer(m.id); break;
      case 'fit': map.fitBounds([[m.bbox[0], m.bbox[1]], [m.bbox[2], m.bbox[3]]]); break;
      case 'user': setMe(m.lat, m.lon, true); break;
      case 'results': showResults(m); break;
      case 'route': showRoute(m); break;
      case 'walk': startWalk(m.speed); break;
      case 'banner': { const b = $('banner'); b.hidden = false; b.dataset.sticky = '1'; b.textContent = m.text; break; }
      case 'clear': {
        const w = m.what || 'all';
        if (w === 'all' || w === 'layers') [...layers.keys()].filter(k => !k.startsWith('env:')).forEach(removeLayer);
        if (w === 'all' || w === 'route') { showRoute(null); $('hud').hidden = true; }
        if (w === 'all' || w === 'results') { if (resLayer) map.removeLayer(resLayer); $('resultsBox').hidden = true; }
        break;
      }
    }
  }
  paintLegend(); connect();
})();
