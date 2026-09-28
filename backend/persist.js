/**
 * Writes the live world into MongoDB using the Mongoose models.
 * Everything is an upsert keyed by the entity's id, so it is safe to call
 * repeatedly and safe after a server restart.
 */
const Drone = require('./models/Drone');
const Victim = require('./models/Victim');
const RescueTeam = require('./models/RescueTeam');
const Shelter = require('./models/Shelter');
const Resource = require('./models/Resource');
const Zone = require('./models/Zone');

const droneDoc = (d) => ({
  droneId: d.id,
  gps: { lat: d.gps.lat, lng: d.gps.lng, altitude: d.gps.altitude, heading: d.gps.heading },
  battery: d.battery,
  status: d.status,
  sensorData: {
    thermalReading: d.sensor.thermalReading,
    gasReading: d.sensor.gasReading,
    signalStrength: d.sensor.signalStrength,
  },
  lastSeen: new Date(),
});

const victimDoc = (v) => ({
  victimId: v.id,
  location: { lat: v.gps.lat, lng: v.gps.lng },
  priority: v.priority,
  status: v.status,
});

const teamDoc = (t) => ({
  teamId: t.id,
  location: { lat: t.gps.lat, lng: t.gps.lng },
  availability: t.availability,
});

const shelterDoc = (s) => ({
  shelterId: s.id,
  location: { lat: s.gps.lat, lng: s.gps.lng },
  capacity: s.capacity,
  occupancy: s.occupancy,
  status: s.status,
});

const resourceDoc = (r) => ({
  resourceId: r.id,
  type: r.type,
  location: { lat: r.gps.lat, lng: r.gps.lng },
  quantity: r.quantity,
  status: r.status,
});

const zoneDoc = (z, toGps) => ({
  zoneId: z.id,
  name: z.name,
  type: z.type,
  severity: z.severity,
  polygon: z.pts.map((p) => toGps({ x: p[0], y: p[1] })),
});

const upsert = (key, doc) => ({
  updateOne: { filter: { [key]: doc[key] }, update: { $set: doc }, upsert: true },
});

/** Build the bulk operations for a snapshot (exported so it can be tested without a database). */
function buildOps(snapshot, toGps) {
  return [
    [Drone, snapshot.drones.map((d) => upsert('droneId', droneDoc(d)))],
    [Victim, snapshot.victims.map((v) => upsert('victimId', victimDoc(v)))],
    [RescueTeam, snapshot.teams.map((t) => upsert('teamId', teamDoc(t)))],
    [Shelter, snapshot.shelters.map((s) => upsert('shelterId', shelterDoc(s)))],
    [Resource, snapshot.resources.map((r) => upsert('resourceId', resourceDoc(r)))],
    [Zone, snapshot.zones.map((z) => upsert('zoneId', zoneDoc(z, toGps)))],
  ];
}

async function persistAll(snapshot, toGps) {
  for (const [Model, ops] of buildOps(snapshot, toGps)) {
    if (ops.length) await Model.bulkWrite(ops, { ordered: false });
  }
}

async function persistDrone(wireDrone) {
  const doc = droneDoc(wireDrone);
  await Drone.updateOne({ droneId: doc.droneId }, { $set: doc }, { upsert: true });
}

module.exports = { persistAll, persistDrone, buildOps, droneDoc, victimDoc, teamDoc, shelterDoc, resourceDoc, zoneDoc };
