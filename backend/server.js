require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const Engine = require('./sim/engine');
const { persistAll, persistDrone } = require('./persist');
const Drone = require('./models/Drone');
const Victim = require('./models/Victim');
const RescueTeam = require('./models/RescueTeam');
const Shelter = require('./models/Shelter');
const Resource = require('./models/Resource');
const Zone = require('./models/Zone');

/* ------------------------------ configuration ------------------------------ */
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI;
const INGEST_KEY = process.env.INGEST_KEY; // optional: require x-api-key on hardware posts
const CORS_ORIGIN = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : '*';
// The map covers a square of MAP_SPAN_DEG degrees around this point. Set it to
// where your real drone flies so its GPS lands in the middle of the map.
const MAP_CENTER = {
  lat: Number(process.env.MAP_CENTER_LAT) || 22.5726,
  lng: Number(process.env.MAP_CENTER_LNG) || 88.3639,
};
const MAP_SPAN_DEG = Number(process.env.MAP_SPAN_DEG) || 0.05;

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CORS_ORIGIN } });

const engine = Engine.create({ center: MAP_CENTER, spanDeg: MAP_SPAN_DEG });
const emit = (type, payload) => io.emit(type, payload);
const clients = () => io.engine.clientsCount;

/* --------------------------------- MongoDB --------------------------------- */
const mongoReady = () => mongoose.connection.readyState === 1;

async function persistNow() {
  if (!mongoReady()) return;
  try {
    await persistAll(engine.snapshot(), engine.toGps);
  } catch (err) {
    console.error('[mongo] persist failed:', err.message);
  }
}

if (MONGO_URI) {
  mongoose
    .connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 })
    .then(() => {
      console.log('[mongo] connected');
      return persistNow();
    })
    .catch((err) => console.error('[mongo] connection failed — running in memory only:', err.message));
} else {
  console.warn('[mongo] MONGO_URI not set — running in memory only');
}

/* ------------------------------ live simulation ------------------------------ */
// The world only advances while someone is watching, so an idle free-tier
// instance does no work and makes no database writes.
setInterval(() => {
  if (clients() > 0) engine.tick(emit);
}, 1000);
setInterval(() => {
  if (clients() > 0) persistNow();
}, 5000);

/* ------------------------------------ REST ----------------------------------- */
app.get('/', (req, res) =>
  res.json({ name: 'OUTPOST backend', status: 'ok', try: ['/api/health', '/api/state', '/api/drones'] })
);

app.get('/api/health', (req, res) =>
  res.json({
    ok: true,
    mongo: mongoReady() ? 'connected' : 'not connected',
    clients: clients(),
    tick: engine.state.tick,
    map: { center: MAP_CENTER, spanDeg: MAP_SPAN_DEG },
  })
);

// Full live snapshot — the frontend loads this first (it also wakes a sleeping free-tier server).
app.get('/api/state', (req, res) => res.json(engine.snapshot()));

const list = (Model) => async (req, res) => {
  if (!mongoReady()) return res.status(503).json({ error: 'database not connected' });
  res.json(await Model.find().lean());
};
app.get('/api/drones', list(Drone));
app.get('/api/victims', list(Victim));
app.get('/api/teams', list(RescueTeam));
app.get('/api/shelters', list(Shelter));
app.get('/api/resources', list(Resource));
app.get('/api/zones', list(Zone));

/* ------------------------------ hardware ingest ------------------------------ */
// Your physical drone (ESP32 / Pi) posts telemetry here every second or two:
// {
//   "droneId": "DRN-HW1",
//   "gps": { "lat": 22.5726, "lng": 88.3639, "altitude": 42, "heading": 187 },
//   "battery": 76,
//   "status": "PATROL",
//   "sensorData": { "thermalReading": 31.2, "gasReading": 410, "signalStrength": -62 }
// }
// It appears on every open dashboard immediately, marked as a live hardware link.
app.post('/api/ingest/drone', (req, res) => {
  if (INGEST_KEY && req.get('x-api-key') !== INGEST_KEY) return res.status(401).json({ error: 'bad or missing x-api-key' });
  const b = req.body || {};
  const lat = Number(b.gps && b.gps.lat);
  const lng = Number(b.gps && b.gps.lng);
  if (!b.droneId || typeof b.droneId !== 'string' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'droneId (string) and gps.lat / gps.lng (numbers) are required' });
  }
  const wire = engine.ingestDrone(b, emit);
  if (mongoReady()) persistDrone(wire).catch((err) => console.error('[mongo] drone persist failed:', err.message));
  res.json(wire);
});

// Log a victim from outside: { "lat": .., "lng": .., "priority": "CRITICAL" }  (or x / y in map space)
app.post('/api/victims', (req, res) => {
  const b = req.body || {};
  const hasGps = Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng));
  const hasXY = Number.isFinite(Number(b.x)) && Number.isFinite(Number(b.y));
  if (!hasGps && !hasXY) return res.status(400).json({ error: 'send lat + lng, or x + y' });
  res.status(201).json(engine.addVictim(b, emit));
});

/* ---------------------------------- sockets ---------------------------------- */
io.on('connection', (socket) => {
  console.log('[socket] connected', socket.id, `(${clients()} open)`);
  socket.emit('state:init', engine.snapshot());
  socket.on('latency', (cb) => typeof cb === 'function' && cb());
  socket.on('disconnect', () => console.log('[socket] disconnected', socket.id));
});

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

server.listen(PORT, () => console.log(`OUTPOST backend listening on :${PORT}`));
