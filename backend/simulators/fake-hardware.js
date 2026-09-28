/**
 * Pretends to be your physical drone: posts GPS + battery + sensor telemetry
 * to /api/ingest/drone every 1.5 s, exactly the way an ESP32 will.
 *
 *   node simulators/fake-hardware.js                         (against localhost)
 *   API_BASE=https://your-app.onrender.com node simulators/fake-hardware.js
 *
 * It flies a circle around the map centre. Stop it (Ctrl+C) and the dashboard
 * marks the drone OFFLINE after 15 seconds.
 */
const API_BASE = (process.env.API_BASE || 'http://localhost:4000').replace(/\/$/, '');
const DRONE_ID = process.env.DRONE_ID || 'DRN-HW1';
const CENTER = {
  lat: Number(process.env.MAP_CENTER_LAT) || 22.5726,
  lng: Number(process.env.MAP_CENTER_LNG) || 88.3639,
};
const headers = { 'Content-Type': 'application/json' };
if (process.env.INGEST_KEY) headers['x-api-key'] = process.env.INGEST_KEY;

let angle = 0;
let battery = 100;

async function send() {
  angle += 0.12;
  battery = Math.max(5, battery - 0.15);
  const body = {
    droneId: DRONE_ID,
    gps: {
      lat: CENTER.lat + Math.sin(angle) * 0.008,
      lng: CENTER.lng + Math.cos(angle) * 0.008,
      altitude: 40 + Math.sin(angle * 3) * 5,
      heading: ((angle * 180) / Math.PI + 90) % 360,
    },
    battery: Number(battery.toFixed(1)),
    status: 'PATROL',
    sensorData: {
      thermalReading: 20 + Math.random() * 6,
      gasReading: 380 + Math.random() * 40,
      signalStrength: -50 - Math.random() * 20,
    },
  };
  try {
    const res = await fetch(`${API_BASE}/api/ingest/drone`, { method: 'POST', headers, body: JSON.stringify(body) });
    console.log(res.status, `${body.gps.lat.toFixed(5)}, ${body.gps.lng.toFixed(5)}  batt ${body.battery}%`);
  } catch (err) {
    console.error('post failed:', err.message);
  }
}

console.log(`Posting fake telemetry for ${DRONE_ID} to ${API_BASE} — Ctrl+C to stop`);
send();
setInterval(send, 1500);
