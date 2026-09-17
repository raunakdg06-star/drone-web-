require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const Drone = require('./models/Drone');
const Victim = require('./models/Victim');
const RescueTeam = require('./models/RescueTeam');
const Shelter = require('./models/Shelter');
const Resource = require('./models/Resource');
const Zone = require('./models/Zone');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/aegis_disaster_response';

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('[mongo] connected'))
  .catch((err) => console.error('[mongo] connection error', err));

/* --------------------------------------------------------------------
   REST — CRUD-ish endpoints the React dashboard fetches on load, then
   keeps in sync afterwards via the Socket.io events emitted below.
   -------------------------------------------------------------------- */
app.get('/api/drones', async (req, res) => res.json(await Drone.find()));
app.get('/api/victims', async (req, res) => res.json(await Victim.find()));
app.get('/api/teams', async (req, res) => res.json(await RescueTeam.find().populate('assignedVictims')));
app.get('/api/shelters', async (req, res) => res.json(await Shelter.find()));
app.get('/api/resources', async (req, res) => res.json(await Resource.find()));
app.get('/api/zones', async (req, res) => res.json(await Zone.find()));

/* --------------------------------------------------------------------
   HARDWARE INGEST — this is the route your physical drone talks to.

   Your flight controller / companion board (e.g. an ESP32 or Raspberry
   Pi Zero riding on the drone) reads GPS (NEO-6M/M8N), battery voltage
   (a voltage divider into an ADC), and whatever sensors you're carrying
   (thermal cam, gas sensor, etc.), packages them as JSON, and POSTs (or
   publishes over MQTT to a bridge that POSTs) here every 1-2 seconds:

   POST /api/ingest/drone
   {
     "droneId": "DRN-01",
     "gps": { "lat": 22.5726, "lng": 88.3639, "altitude": 42, "heading": 187 },
     "battery": 76,
     "sensorData": { "thermalReading": 31.2, "gasReading": 410, "signalStrength": -62 }
   }

   The handler upserts the Drone document and immediately re-broadcasts
   it to every connected dashboard client over the "drone:update" socket
   event — that's the "make drone locations update live" requirement.
   -------------------------------------------------------------------- */
app.post('/api/ingest/drone', async (req, res) => {
  try {
    const { droneId, gps, battery, status, sensorData } = req.body;
    if (!droneId || !gps) return res.status(400).json({ error: 'droneId and gps are required' });

    const drone = await Drone.findOneAndUpdate(
      { droneId },
      { gps, battery, status, sensorData, lastSeen: new Date() },
      { new: true, upsert: true }
    );

    io.emit('drone:update', drone);

    // Basic auto-detection hook: if a thermal spike suggests a person,
    // you could auto-create a Victim here instead of waiting for a human.
    if (sensorData && sensorData.thermalReading > 36) {
      io.emit('drone:alert', { droneId, message: 'Possible heat signature detected', gps });
    }

    res.json(drone);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ingest failed' });
  }
});

/* --------------------------------------------------------------------
   Dispatcher actions — a human (or an assignment algorithm) calling
   these also broadcasts over sockets so every open dashboard updates
   instantly, no polling.
   -------------------------------------------------------------------- */
app.post('/api/victims', async (req, res) => {
  const victim = await Victim.create(req.body);
  io.emit('victim:new', victim);
  res.status(201).json(victim);
});

app.post('/api/teams/:teamId/assign', async (req, res) => {
  const { teamId } = req.params;
  const { victimId } = req.body;
  const team = await RescueTeam.findOneAndUpdate(
    { teamId },
    { availability: 'DEPLOYED', $addToSet: { assignedVictims: victimId } },
    { new: true }
  );
  const victim = await Victim.findByIdAndUpdate(victimId, { status: 'ASSIGNED', assignedTeam: team._id }, { new: true });
  io.emit('team:update', team);
  io.emit('victim:update', victim);
  res.json({ team, victim });
});

/* --------------------------------------------------------------------
   Socket.io connection lifecycle
   -------------------------------------------------------------------- */
io.on('connection', (socket) => {
  console.log('[socket] client connected', socket.id);
  socket.on('disconnect', () => console.log('[socket] client disconnected', socket.id));
});

server.listen(PORT, () => console.log(`AEGIS backend listening on :${PORT}`));
