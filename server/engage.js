// EngageSC (Campus Labs / Anthology Engage at engage.usc.edu): upcoming public events, placed on the USC map.
// Sources, tried in order (EngageSC at USC runs on CampusGroups; its "Subscribe" iCal link is the most reliable):
//   0. ENGAGE_ICS_URL / data/engage-events.ics   the Subscribe link (webcal:// is fine) or the downloaded .ics
//   1. data/engage-events.json   a file you saved yourself (e.g. the JSON below, opened while signed in, for non-public events)
//   2. Engage discovery JSON     {ENGAGE_URL}/api/discovery/event/search?...   (what the EngageSC events page itself calls)
//   3. Engage RSS feed           {ENGAGE_URL}/events.rss
//   4. iCal feed                 ENGAGE_ICS_URL (optional, e.g. an org's or your personal Engage calendar link)
// Results are cached for 5 minutes. Locations are matched to real OpenStreetMap building names from data/usc-environment.geojson.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { USC, haversineM, walkMinutes } from './usc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, '..', 'data');
const BASE = (process.env.ENGAGE_URL || 'https://engage.usc.edu').replace(/\/$/, '');
const ICS = (process.env.ENGAGE_ICS_URL || 'https://engage.usc.edu/ical/usc/ical_usc.ics').trim().replace(/^webcal:\/\//i, 'https://');
const MOCK = process.env.OSM_MOCK === '1' || process.env.ENGAGE_MOCK === '1';
const TZ = 'America/Los_Angeles';
const log = (...a) => console.error('[engage]', ...a);
const UA = 'SC-Iris-hackathon/0.1 (EngageSC events on a campus map)';

// USC building codes → approximate entrances (used when a location has no coordinates and no OSM name match)
const CODES = {
  RTH: [34.0200, -118.2898, 'Ronald Tutor Hall'], SAL: [34.0195, -118.2895, 'Salvatori Computer Science Center'], SGM: [34.0213, -118.2891, 'Seeley G. Mudd Building'],
  THH: [34.0222, -118.2846, 'Taper Hall'], TCC: [34.0219, -118.2860, 'Ronald Tutor Campus Center'], VKC: [34.0213, -118.2840, 'Von KleinSmid Center'],
  LVL: [34.0218, -118.2829, 'Leavey Library'], DML: [34.0201, -118.2838, 'Doheny Memorial Library'], DOH: [34.0201, -118.2838, 'Doheny Memorial Library'],
  KAP: [34.0225, -118.2910, 'Kaprielian Hall'], OHE: [34.0207, -118.2896, 'Olin Hall of Engineering'], ZHS: [34.0193, -118.2861, 'Zumberge Hall of Science'],
  WPH: [34.0222, -118.2840, 'Waite Phillips Hall'], JFF: [34.0186, -118.2823, 'Fertitta Hall'], ACC: [34.0186, -118.2846, 'Accounting Building'],
  HOH: [34.0189, -118.2848, 'Hoffman Hall'], SOS: [34.0216, -118.2849, 'Social Sciences Building'], MRF: [34.0233, -118.2855, 'Marks Hall'],
  PED: [34.0242, -118.2882, 'Lyon Center'], LRC: [34.0242, -118.2882, 'Lyon Center'], BKS: [34.0179, -118.2849, 'Bookstore'], GFS: [34.0214, -118.2878, 'Grace Ford Salvatori Hall'],
  SCA: [34.0234, -118.2865, 'School of Cinematic Arts'], ANN: [34.0228, -118.2869, 'Annenberg'], ASC: [34.0216, -118.2884, 'Annenberg'], CPA: [34.0191, -118.2903, 'Cardinal Gardens'],
  EEB: [34.0198, -118.2899, 'Hughes Aircraft Electrical Engineering Center'], PHE: [34.0207, -118.2877, 'Powell Hall'], VHE: [34.0201, -118.2884, 'Vivian Hall of Engineering'],
  SLH: [34.0193, -118.2854, 'Stauffer Hall'], WAH: [34.0194, -118.2833, 'Watt Hall'], MHP: [34.0225, -118.2874, 'Mudd Hall of Philosophy'], CUB: [34.0185, -118.2845, 'Cubic'],
  UUC: [34.0218, -118.2862, 'Ronald Tutor Campus Center'], 'TROJAN GROUNDS': [34.0217, -118.2848, 'Trojan Grounds'], 'TOMMY TROJAN': [34.0206, -118.2856, 'Tommy Trojan'],
  'HAHN PLAZA': [34.0206, -118.2850, 'Hahn Plaza'], 'ALUMNI PARK': [34.0198, -118.2862, 'Alumni Park'], 'MCCARTHY QUAD': [34.0215, -118.2830, 'McCarthy Quad'],
  'USC VILLAGE': [34.0260, -118.2855, 'USC Village'], 'TUTOR CAMPUS CENTER': [34.0219, -118.2860, 'Ronald Tutor Campus Center'], 'CAMPUS CENTER': [34.0219, -118.2860, 'Ronald Tutor Campus Center'], 'TUTOR HALL': [34.0200, -118.2898, 'Ronald Tutor Hall'], 'SALVATORI': [34.0195, -118.2895, 'Salvatori Computer Science Center'], 'TAPER': [34.0222, -118.2846, 'Taper Hall'], 'ANNENBERG': [34.0228, -118.2869, 'Annenberg'], 'FERTITTA': [34.0186, -118.2823, 'Fertitta Hall'], 'GALEN': [34.0213, -118.2798, 'Galen Center'], 'BOVARD': [34.0207, -118.2864, 'Bovard Auditorium'],
  'LYON': [34.0242, -118.2882, 'Lyon Center'], 'LEAVEY': [34.0218, -118.2829, 'Leavey Library'], 'DOHENY': [34.0201, -118.2838, 'Doheny Memorial Library']
};

let osmNames = null, osmMtime = 0;
async function buildingIndex() {
  const f = path.join(DATA, 'usc-environment.geojson');
  try {
    const st = await fs.stat(f); if (osmNames && st.mtimeMs === osmMtime) return osmNames;
    const fc = JSON.parse(await fs.readFile(f, 'utf8')); osmMtime = st.mtimeMs; osmNames = [];
    for (const ft of fc.features || []) {
      const p = ft.properties || {}; if (!p.name || !ft.geometry || !/Polygon/.test(ft.geometry.type)) continue;
      const ring = ft.geometry.type === 'Polygon' ? ft.geometry.coordinates[0] : ft.geometry.coordinates[0][0];
      let la = 0, lo = 0; ring.forEach(c => { la += c[1]; lo += c[0]; }); la /= ring.length; lo /= ring.length;
      osmNames.push({ name: p.name, norm: norm(p.name), lat: la, lon: lo });
    }
  } catch { osmNames = osmNames || []; }
  return osmNames;
}
const norm = s => String(s || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|of|and|hall|building|center|room|rm|usc|university|park|campus|los|angeles|ca)\b/g, ' ').replace(/\s+/g, ' ').trim();

async function locate(loc) {
  if (!loc) return null;
  const raw = String(loc), up = raw.toUpperCase();
  // building code like "SGM 124", "RTH 115", "(THH)"
  const code = (up.match(/\b([A-Z]{3})\b(?=\s*[-#]?\s*\d|\)|$|,)/) || [])[1];
  const names = await buildingIndex(), n = norm(raw);
  if (n.length >= 4) {
    let best = null, bs = 0;
    for (const b of names) {
      if (!b.norm) continue;
      let sc = 0;
      if (n.includes(b.norm) && b.norm.length >= 5) sc = b.norm.length + 10;
      else { const bw = b.norm.split(' ').filter(w => w.length > 2), hit = bw.filter(w => n.split(' ').includes(w)).length; if (bw.length && hit === bw.length) sc = hit * 4; else if (hit >= 2) sc = hit * 2; }
      if (sc > bs) { bs = sc; best = b; }
    }
    if (best && bs >= 6) return { lat: best.lat, lon: best.lon, matched: best.name, how: 'OpenStreetMap building name' };
  }
  if (code && CODES[code]) return { lat: CODES[code][0], lon: CODES[code][1], matched: CODES[code][2], how: 'USC building code' };
  for (const k of Object.keys(CODES)) if (k.length > 3 && up.includes(k)) return { lat: CODES[k][0], lon: CODES[k][1], matched: CODES[k][2], how: 'USC place name' };
  return null;
}

const fmtWhen = d => {
  const now = new Date(), opts = { timeZone: TZ };
  const day = new Intl.DateTimeFormat('en-US', { ...opts, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dd = (a, b) => day.format(a) === day.format(b);
  const tom = new Date(now.getTime() + 864e5);
  const time = new Intl.DateTimeFormat('en-US', { ...opts, hour: 'numeric', minute: '2-digit' }).format(d);
  const label = dd(d, now) ? 'Today' : dd(d, tom) ? 'Tomorrow' : new Intl.DateTimeFormat('en-US', { ...opts, weekday: 'short', month: 'short', day: 'numeric' }).format(d);
  return { time, day: label };
};
const strip = s => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

async function getText(url, accept) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

function fromDiscovery(j) {
  const arr = Array.isArray(j) ? j : j.value || j.items || j.events || [];
  return arr.map(e => ({
    id: String(e.id ?? e.eventId ?? e.name), name: strip(e.name || e.title), org: strip(e.organizationName || (e.organizationNames || [])[0] || e.host || ''),
    start: e.startsOn || e.startDate || e.start, end: e.endsOn || e.endDate || e.end, location: strip(e.location || e.locationName || e.address || ''),
    lat: e.latitude != null ? +e.latitude : null, lon: e.longitude != null ? +e.longitude : null,
    url: e.url || (e.id != null ? `${BASE}/event/${e.id}` : BASE), categories: e.categoryNames || [], perks: e.benefitNames || [],
    summary: strip(e.description || '').slice(0, 220)
  }));
}
function fromRss(xml) {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/g) || [];
  const tag = (s, re) => { const m = s.match(re); return m ? m[1] : ''; };
  return items.map((it, i) => {
    const desc = tag(it, /<description>([\s\S]*?)<\/description>/);
    const start = tag(it, /<(?:[\w]+:)?start(?:Date)?>([\s\S]*?)<\/(?:[\w]+:)?start(?:Date)?>/) || tag(desc.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'), /class="dt-start[^"]*"[^>]*datetime="([^"]+)"/) || tag(it, /<pubDate>([\s\S]*?)<\/pubDate>/);
    const end = tag(it, /<(?:[\w]+:)?end(?:Date)?>([\s\S]*?)<\/(?:[\w]+:)?end(?:Date)?>/) || tag(desc.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'), /class="dt-end[^"]*"[^>]*datetime="([^"]+)"/);
    const loc = tag(it, /<(?:[\w]+:)?location>([\s\S]*?)<\/(?:[\w]+:)?location>/) || tag(desc.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'), /class="p-location[^"]*"[^>]*>([\s\S]*?)<\//);
    const link = strip(tag(it, /<link>([\s\S]*?)<\/link>/)) || tag(it, /<guid[^>]*>([\s\S]*?)<\/guid>/);
    return { id: (link.match(/event\/(\d+)/) || [])[1] || 'rss' + i, name: strip(tag(it, /<title>([\s\S]*?)<\/title>/)), org: strip(tag(it, /<(?:[\w]+:)?host>([\s\S]*?)<\//) || tag(it, /<author>([\s\S]*?)<\/author>/)),
      start: strip(start), end: strip(end), location: strip(loc), lat: null, lon: null, url: strip(link) || BASE, categories: (it.match(/<category>([\s\S]*?)<\/category>/g) || []).map(strip), perks: [], summary: strip(desc).slice(0, 220) };
  });
}
function fromIcs(txt) {
  const un = txt.replace(/\r?\n[ \t]/g, '');
  return (un.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || []).map((v, i) => {
    const g = k => { const m = v.match(new RegExp('^' + k + '(?:;[^:\\n]*)?:(.*)$', 'm')); return m ? m[1].trim() : ''; };
    const dt = s => { const m = s.match(/(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?(Z?)/); if (!m) return s; const p = [+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)]; return m[7] ? new Date(Date.UTC(...p)).toISOString() : laToIso(p); };
    const geo = g('GEO').split(';');
    return { id: g('UID') || 'ics' + i, name: g('SUMMARY').replace(/\\,/g, ','), org: g('ORGANIZER').replace(/^.*CN=([^;:]+).*$/, '$1'), start: dt(g('DTSTART')), end: dt(g('DTEND')),
      location: g('LOCATION').replace(/\\,/g, ',').replace(/\\n/g, ' '), lat: geo.length === 2 ? +geo[0] : null, lon: geo.length === 2 ? +geo[1] : null, url: g('URL') || BASE, categories: g('CATEGORIES').split(',').filter(Boolean), perks: [], summary: g('DESCRIPTION').replace(/\\n/g, ' ').replace(/\\,/g, ',').slice(0, 220) };
  });
}

function mockEvents() {
  const t = h => new Date(Date.now() + h * 36e5).toISOString();
  return [
    { id: 'm1', name: 'AI/ML Club: Building LLM Agents', org: 'AI/ML Club', start: t(1.2), end: t(2.4), location: 'RTH 115', perks: ['Free Food'] },
    { id: 'm2', name: 'Trojan Founders Mixer', org: 'Lloyd Greif Center', start: t(2), end: t(3.5), location: 'Lyon Center courtyard', perks: [] },
    { id: 'm3', name: 'Resume Review Drop-in', org: 'Career Center', start: t(0.6), end: t(2.6), location: 'Ronald Tutor Campus Center 450', perks: [] },
    { id: 'm4', name: 'Robotics Society Open Lab', org: 'Robotics Society', start: t(3), end: t(5), location: 'SGM 124', perks: ['Free Food'] },
    { id: 'm5', name: 'Sunset Yoga on McCarthy Quad', org: 'USC Recreation', start: t(26), end: t(27), location: 'McCarthy Quad', perks: [] }
  ].map(e => ({ ...e, lat: null, lon: null, url: BASE, categories: [], summary: 'Offline sample event (ENGAGE_MOCK / OSM_MOCK). Not real EngageSC data.' }));
}

// wall-clock time in Los Angeles → ISO (handles PST/PDT)
function laToIso(p) {
  const guess = Date.UTC(...p), f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const q = Object.fromEntries(f.formatToParts(new Date(guess)).map(x => [x.type, x.value])), asLa = Date.UTC(+q.year, +q.month - 1, +q.day, +q.hour, +q.minute, +q.second);
  return new Date(guess - (asLa - guess)).toISOString();
}
let cache = null;
export async function engageEvents({ query = '', hours = 72, limit = 30, near } = {}) {
  const now = Date.now(), errors = {};
  let raw = null, source = '';
  if (cache && now - cache.t < 5 * 60e3) ({ raw, source } = cache);
  if (!raw) {
    try { const j = JSON.parse(await fs.readFile(path.join(DATA, 'engage-events.json'), 'utf8')); raw = fromDiscovery(j); source = 'data/engage-events.json (saved from EngageSC)'; } catch (e) { if (e.code !== 'ENOENT') errors.file = e.message; }
    if (!raw) try { const r = fromIcs(await fs.readFile(path.join(DATA, 'engage-events.ics'), 'utf8')); if (r.length) { raw = r; source = 'data/engage-events.ics (exported from EngageSC)'; } } catch (e) { if (e.code !== 'ENOENT') errors.icsFile = e.message; }
    if (!raw && ICS) try { const r = fromIcs(await getText(ICS, 'text/calendar')); if (r.length) { raw = r; source = 'EngageSC calendar subscription (ENGAGE_ICS_URL)'; } else errors.ics = 'calendar feed empty'; } catch (e) { errors.ics = e.message; }
    if (!raw && MOCK) { raw = mockEvents(); source = 'offline sample events (mock mode)'; }
    if (!raw) try {
      const u = `${BASE}/api/discovery/event/search?endsAfter=${encodeURIComponent(new Date(now).toISOString())}&orderByField=endsOn&orderByDirection=ascending&status=Approved&take=100&query=`;
      const j = JSON.parse(await getText(u, 'application/json')); const r = fromDiscovery(j); if (r.length) { raw = r; source = 'EngageSC discovery API (public events)'; } else errors.discovery = 'no public events returned';
    } catch (e) { errors.discovery = e.message; }
    if (!raw) try { const r = fromRss(await getText(`${BASE}/events.rss`, 'application/rss+xml,application/xml,text/xml')); if (r.length) { raw = r; source = 'EngageSC RSS feed (public events)'; } else errors.rss = 'feed empty'; } catch (e) { errors.rss = e.message; }
    if (!raw && ICS) try { const r = fromIcs(await getText(ICS, 'text/calendar')); if (r.length) { raw = r; source = 'iCal feed (ENGAGE_ICS_URL)'; } } catch (e) { errors.ics = e.message; }
    if (raw) cache = { t: now, raw, source };
  }
  if (!raw) return { items: [], source: 'none', errors, note: 'Could not read EngageSC. Save events as data/engage-events.json (see README) or set ENGAGE_ICS_URL.' };
  const origin = near && Number.isFinite(near.lat) ? near : { lat: USC.lat, lon: USC.lon };
  const q = String(query || '').toLowerCase().split(/\s+/).filter(w => w.length > 2 && !/^(event|events|what|whats|happening|today|near|nearby|any|the|for|and)$/.test(w));
  const out = [];
  for (const e of raw) {
    const s = new Date(e.start), en = e.end ? new Date(e.end) : new Date(s.getTime() + 36e5);
    if (isNaN(s)) continue;
    if (en.getTime() < now || s.getTime() > now + hours * 36e5) continue;
    if (q.length && !q.some(w => (e.name + ' ' + e.org + ' ' + (e.categories || []).join(' ') + ' ' + e.summary).toLowerCase().includes(w))) continue;
    let lat = e.lat, lon = e.lon, matched = null, how = lat != null ? 'EngageSC coordinates' : null;
    if (!(Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) > 1)) { const g = await locate(e.location); if (g) ({ lat, lon, matched, how } = g); else { lat = null; lon = null; } }
    const d = lat != null ? Math.round(haversineM(origin, { lat, lon })) : null;
    const w1 = fmtWhen(s), w2 = fmtWhen(en);
    out.push({ id: e.id, name: e.name, org: e.org, start: s.toISOString(), end: en.toISOString(), when: `${w1.day} ${w1.time}–${w2.time}`, day: w1.day, time: w1.time,
      happening_now: s.getTime() <= now, location: e.location || 'See event page', lat, lon, located_by: how, matched_building: matched, distance_m: d, walk_min: d != null ? walkMinutes(d) : null,
      perks: e.perks || [], categories: e.categories || [], url: e.url, summary: e.summary });
  }
  out.sort((a, b) => a.start.localeCompare(b.start) || (a.distance_m ?? 1e9) - (b.distance_m ?? 1e9));
  return { items: out.slice(0, Math.max(1, Math.min(100, limit))), total: out.length, source, errors: Object.keys(errors).length ? errors : undefined, fetched_at: new Date(cache ? cache.t : now).toISOString() };
}
