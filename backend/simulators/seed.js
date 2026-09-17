/**
 * Run with: npm run seed
 * Wipes and repopulates the DB with starter data, then starts a fake
 * drone that POSTs telemetry to /api/ingest/drone every 1.5s — exactly
 * like your ESP32 will once it's flashed and flying. Swap this file out
 * for real firmware later; the server-side contract doesn't change.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios'); // npm i axios if you use this simulator

const Victim = require('../models/Victim');
const RescueTeam = require('../models/RescueTeam');
const Shelter = require('../models/Shelter');
const Resource = require('../models/Resource');
const Zone = require('../models/Zone');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/aegis_disaster_response';
const API_BASE = process.env.API_BASE || 'http://localhost:4000';

async function seed() {
  await mongoose.connect(MONGO_URI);
  await Promise.all([Victim.deleteMany({}), RescueTeam.deleteMany({}), Shelter.deleteMany({}), Resource.deleteMany({}), Zone.deleteMany({})]);

  await Zone.create({ zoneId: 'ZN-01', name: 'Riverside Flood Zone', type: 'FLOOD', severity: 'SEVERE', polygon: [] });
  await Victim.insertMany([
    { victimId: 'VIC-01', location: { lat: 22.55, lng: 88.34 }, priority: 'CRITICAL' },
    { victimId: 'VIC-02', location: { lat: 22.56, lng: 88.35 }, priority: 'HIGH' },
  ]);
  await RescueTeam.insertMany([
    { teamId: 'TEAM-ALPHA', location: { lat: 22.54, lng: 88.33 }, availability: 'AVAILABLE' },
    { teamId: 'TEAM-BRAVO', location: { lat: 22.57, lng: 88.36 }, availability: 'AVAILABLE' },
  ]);
  await Shelter.insertMany([
    { shelterId: 'SHL-01', location: { lat: 22.53, lng: 88.32 }, capacity: 200, occupancy: 126 },
  ]);
  await Resource.insertMany([
    { resourceId: 'RES-MED-1', type: 'Medical', location: { lat: 22.55, lng: 88.335 }, quantity: 40 },
  ]);

  console.log('[seed] done');
  mongoose.disconnect();
}

async function simulateDroneHardware() {
  let angle = 0;
  const center = { lat: 22.5726, lng: 88.3639 };
  setInterval(async () => {
    angle += 0.05;
    const payload = {
      droneId: 'DRN-01',
      gps: {
        lat: center.lat + Math.sin(angle) * 0.01,
        lng: center.lng + Math.cos(angle) * 0.01,
        altitude: 40 + Math.sin(angle * 3) * 5,
        heading: (angle * 180) / Math.PI,
      },
      battery: Math.max(20, 100 - angle * 2),
      status: 'PATROL',
      sensorData: {
        thermalReading: 20 + Math.random() * 15,
        gasReading: 380 + Math.random() * 40,
        signalStrength: -50 - Math.random() * 20,
      },
    };
    try {
      await axios.post(`${API_BASE}/api/ingest/drone`, payload);
    } catch (e) {
      console.error('[simulator] failed to post telemetry — is the server running?', e.message);
    }
  }, 1500);
}

if (require.main === module) {
  seed().then(() => {
    if (process.argv.includes('--with-drone-sim')) simulateDroneHardware();
  });
}
