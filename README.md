# OUTPOST — Disaster Response Command Center

A live dashboard for coordinating drones, rescue teams, victims, shelters and supplies during a disaster.
The map is fed by a Node backend over Socket.io, and a physical drone can report into it over plain HTTP.

```
outpost/
├── frontend/index.html          the dashboard (static page: intro, Leaflet map, live feed)
├── backend/
│   ├── server.js                Express + Socket.io + MongoDB
│   ├── sim/engine.js            the simulation (drones patrol / dock / recharge, teams triage & rescue, victims spawn)
│   ├── persist.js               writes the live world into MongoDB
│   ├── models/                  Mongoose schemas (Drone, Victim, RescueTeam, Shelter, Resource, Zone)
│   └── simulators/fake-hardware.js   pretends to be your drone (posts GPS/battery/sensors)
├── .github/workflows/deploy-pages.yml   publishes frontend/ to GitHub Pages on every push
├── render.yaml                  backend blueprint for Render
├── netlify.toml, vercel.json    alternative hosts for the frontend
└── README.md
```

## How the pieces talk

```
 your drone (ESP32/Pi) ──POST /api/ingest/drone──►  backend  ──Socket.io──►  dashboard (browser)
                                                       │
                                        simulation engine + MongoDB Atlas
```

* The **backend** owns the world. It ticks once a second **while at least one dashboard is open**, pushes every change
  over Socket.io, and saves the state to MongoDB every 5 seconds.
* The **dashboard** loads `/api/state`, then subscribes to live events. The header tells you honestly which mode it is in:
  `SOCKET.IO — LIVE` (real backend, real measured latency) or `OFFLINE DEMO — SIMULATED`
  (backend unreachable: the same engine runs inside the browser instead).
* Render's free tier sleeps when idle, so the first visit can take 30–60 s. The dashboard starts waking the
  server during the intro animation and shows a "waking backend" panel with a skip button if it is still asleep.

### URL options for the dashboard
| Option | Effect |
|---|---|
| `?offline` | never contact the backend, run the built-in simulation |
| `?backend=http://localhost:4000` | point at a different backend (local development) |

The default backend address is set at the top of the script in `frontend/index.html` (`BACKEND_URL`).

## Connecting your real drone

Post JSON to `POST https://<your-backend>/api/ingest/drone` every 1–2 seconds:

```json
{
  "droneId": "DRN-HW1",
  "gps": { "lat": 22.5726, "lng": 88.3639, "altitude": 42, "heading": 187 },
  "battery": 76,
  "status": "PATROL",
  "sensorData": { "thermalReading": 31.2, "gasReading": 410, "signalStrength": -62 }
}
```

It appears on every open dashboard within a second, drawn in white and labelled `HW`, with its real values in the
detail panel. If it stops sending for 15 seconds it turns OFFLINE. A thermal reading above 36 °C raises a
"possible heat signature" alert in the dispatch log.

**Set the map centre to where you fly.** The map covers a square around `MAP_CENTER_LAT` / `MAP_CENTER_LNG`
(default about 5.5 km wide, `MAP_SPAN_DEG=0.05`). Set those two variables in Render to your flying field so your
drone's GPS lands in the middle of the map. GPS outside the square is pinned to the map edge and flagged.

Test the whole path with no hardware:

```bash
cd backend
API_BASE=https://<your-backend>.onrender.com node simulators/fake-hardware.js
```

You can also log a victim from outside (for example from a detection pipeline):

```bash
curl -X POST https://<your-backend>/api/victims -H "Content-Type: application/json" \
     -d '{"lat":22.58,"lng":88.37,"priority":"CRITICAL"}'
```

## Environment variables (backend)

| Variable | Required | Meaning |
|---|---|---|
| `MONGO_URI` | yes | MongoDB Atlas connection string (set it in Render, never commit it) |
| `PORT` | no | set automatically by Render |
| `INGEST_KEY` | no | if set, hardware must send it as the `x-api-key` header |
| `CORS_ORIGIN` | no | e.g. `https://<you>.github.io` (default: allow all) |
| `MAP_CENTER_LAT`, `MAP_CENTER_LNG`, `MAP_SPAN_DEG` | no | where the map is (see above) |

Without `MONGO_URI` the backend still runs, in memory only.

## Endpoints

`GET /api/health`, `GET /api/state` (live snapshot), `GET /api/drones|victims|teams|shelters|resources|zones` (from MongoDB),
`POST /api/ingest/drone`, `POST /api/victims`. Socket.io events: `state:init`, `drone`, `victim`, `team`, `shelter`,
`victim:remove`, `stats`, `feed`.

## Run locally

```bash
cd backend && npm install
cp .env.example .env        # put your MONGO_URI in it (or leave it empty to run in memory)
npm start                   # http://localhost:4000
```
Then open `frontend/index.html?backend=http://localhost:4000` in a browser.

## Deploy

* **Frontend** → GitHub Pages: repo Settings → Pages → Source → *GitHub Actions*, then push to `main`.
* **Backend** → Render: New → Blueprint → pick this repo (reads `render.yaml`), paste `MONGO_URI` when asked.
  Pushing to `main` redeploys it automatically.

`frontend/index.html` contains an embedded copy of `backend/sim/engine.js` (between the `ENGINE-EMBED` markers) for the
offline demo. If you change the simulation, copy the file's contents between those markers too.
