# SC Iris map environment

An MCP server that pulls USC campus and neighborhood data from free OpenStreetMap services, plus a Leaflet map that draws every tool result live. Your agent (Claude Desktop, Claude Code or your own) calls the tools; the map at http://localhost:8787 updates as it goes.

```
agent ──MCP (stdio)──▶ trojanos-osm server ──▶ Overpass   (campus, buildings, walkways, roads, parks, Metro, places)
                              │             ──▶ Nominatim  (place names and addresses)
                              │             ──▶ OSRM foot  (walking routes with turn-by-turn steps)
                              └──WebSocket──▶ Leaflet map in the browser (draws every result; click to walk)
```

## Run it

Needs Node 18.17 or newer.

```bash
npm install
npm test                 # offline self-check with demo data (14 checks)
npm run demo             # scripted demo against live OpenStreetMap; open http://localhost:8787
```

Set your contact email so the OSM services can identify your app (their usage policies ask for this):

```bash
export OSM_CONTACT="you@usc.edu"
```

### Connect it to Claude Desktop

Add this to `claude_desktop_config.json` (Settings → Developer → Edit Config), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "trojanos-osm": {
      "command": "node",
      "args": ["/absolute/path/to/trojanos-map/server/index.js"],
      "env": { "OSM_CONTACT": "you@usc.edu" }
    }
  }
}
```

### Connect it to Claude Code

```bash
claude mcp add trojanos-osm --env OSM_CONTACT=you@usc.edu -- node /absolute/path/to/trojanos-map/server/index.js
```

Then open http://localhost:8787 and ask:

1. "Load the USC campus map."
2. "I'm at RTH. I want to buy avocados."
3. "Walk me to the closest one and animate the walk."

## Tools

| Tool | What it does | OSM service |
| --- | --- | --- |
| `load_campus_environment` | Campus outline, building footprints, walkways, parks, Metro, and roads out to ~2.5 mi. Draws them and saves `data/usc-environment.geojson`. | Overpass |
| `search_nearby` | Real places near the student, from plain words ("I want to buy avocados") or OSM tags (`shop=supermarket`). Sorted by distance, pinned and numbered. | Overpass |
| `geocode` | Finds a place name or address, biased to ~2.5 mi around USC. | Nominatim |
| `reverse_geocode` | What is at a coordinate. | Nominatim |
| `walking_route` | Walking route on real paths with turn-by-turn steps. Endpoints are `{lat, lon}` or `{query: "Leavey Library"}`; "from" defaults to the student. | OSRM (foot) |
| `start_walk` | Animates the student along the route with glasses-style turn prompts. | — |
| `set_user_location`, `get_user_location` | The "You" marker. It also updates while a walk animates. | — |
| `show_on_map`, `clear_map` | Draw any GeoJSON, or clear results and routes. | — |

On the map itself you can:

- click anywhere and choose **Walk here** or **I am here**
- drag the red "You" dot to move yourself
- click a result in the list to route to it
- press **Walk it** to animate the walk

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OSM_CONTACT` | (unset) | Your email, sent in the User-Agent as the OSM policies ask |
| `MAP_PORT` | `8787` | Port for the map page |
| `OVERPASS_URL` | overpass-api.de, then overpass.kumi.systems | Comma-separated Overpass endpoints, tried in order |
| `NOMINATIM_URL` | nominatim.openstreetmap.org | Geocoder |
| `OSRM_FOOT_URL` | routing.openstreetmap.de/routed-foot | Walking router |
| `OSM_MOCK` | (unset) | `1` = offline demo data (hand-drawn shapes, clearly labelled, NOT OSM) |
| `CACHE_DIR` | `data/cache` | Disk cache for every OSM response |

## Good-citizen rules (and why they matter on demo day)

- **Every response is cached on disk** (7 days for map data, 1 day for routes). Run `npm run demo` once on good Wi-Fi before the event: the cache then makes the live demo instant and independent of venue Wi-Fi.
- **Nominatim is throttled** to 1 request per second, per its usage policy. Do not use it for autocomplete.
- **Public servers are shared and best-effort.** Overpass can be slow or busy at peak times. The server falls back to a second Overpass mirror, and `OSM_MOCK=1` is the last-resort offline mode.
- **Credit OpenStreetMap.** The map shows "© OpenStreetMap contributors", which the OSM license requires. Keep it on any screen or slide that shows the map.

## Notes

- **Hours and stock aren't live.** Opening hours come from OSM tags when someone has mapped them; stock is not in OSM at all. The tools say so in every result.
- **Layer size:** the full environment (buildings in the campus core plus roads to 2.5 mi) is a few MB of GeoJSON, which the browser draws with canvas rendering.
- **3D simulator:** `data/usc-environment.geojson` is written for the 3D SC Iris simulator, so it can replace its hand-approximated campus with real OSM footprints and paths.

## SC Iris lens simulation with the real map (local mode)

`web/lens.html` is the full "SC Iris Through the Lens" glasses simulation. When this server serves it, it runs on real map data:

```bash
npm install          # once
npm run lens         # same as `npm run map`; prints http://localhost:8787/lens.html
```

Open **http://localhost:8787/lens.html** in Safari or Chrome. If port 8787 is taken (for example, the Claude desktop app already started this server), just open that URL, because that server serves the page too. Or run `MAP_PORT=8788 npm run lens` and open `http://localhost:8788/lens.html`.

What changes in local mode:
- The live map uses real OpenStreetMap tiles (dark-tinted to suit the glasses).
- **Google Maps (optional):** open `http://localhost:8787/lens.html?gkey=YOUR_GOOGLE_MAPS_API_KEY`. The key needs the "Maps JavaScript API" enabled. It is remembered in this browser. Add `&gtype=satellite` or `&gtype=hybrid` for imagery.
- The 3D campus is rebuilt from the real OpenStreetMap building footprints, heights and walkways in `data/usc-environment.geojson`. The first launch downloads that file automatically, which takes about a minute.
- Place search, walking routes (OSRM, full street geometry) and turn prompts come from this server's tools.

## EngageSC events (engage.usc.edu)

`engage_events` (an MCP tool, also served at `/api/tool/engage_events`) lists upcoming USC events with their time, host, location, perks such as free food, and link. Each event is pinned on the real building, matched by OpenStreetMap building name or USC building code (RTH, SGM, THH, …). The lens simulation loads them automatically. They appear in chapter 4 ("Pick an event"), in "Ask anything" ("what's happening on campus?", "any free food?") and as pink pins under the map's **Events** filter, and you can navigate to any of them. The list refreshes every 5 minutes.

Where the events come from, in order:
1. `data/engage-events.json`: a file you save yourself. Use this for events that need a USC sign-in. While signed in to EngageSC in your browser, open
   `https://engage.usc.edu/api/discovery/event/search?orderByField=endsOn&orderByDirection=ascending&status=Approved&take=100&endsAfter=2026-11-15T00:00:00Z`
   (change the date to today) and save the page as `data/engage-events.json`.
2. EngageSC's public event search, which is what its own Events page uses.
3. EngageSC's public RSS feed (`https://engage.usc.edu/events.rss`).
4. An iCal link: `ENGAGE_ICS_URL="https://…ics" npm run lens`.

`OSM_MOCK=1` or `ENGAGE_MOCK=1` uses sample events (marked as samples). Try it with `curl -s -X POST localhost:8799/api/tool/engage_events -d '{}' | head -c 600`.
