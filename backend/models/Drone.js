const mongoose = require('mongoose');

/**
 * Drone
 *  ├── GPS
 *  ├── Battery
 *  ├── Status
 *  └── Sensor Data
 *
 * This is the document your ESP32/flight-controller telemetry maps onto.
 * A real drone publishes a JSON packet (over MQTT, LoRa+gateway, or plain
 * HTTP POST from a companion computer) shaped like the `gps`/`battery`/
 * `sensorData` fields below; the ingest route in routes/drones.js writes
 * it here and re-broadcasts it over Socket.io in the same tick.
 */
const DroneSchema = new mongoose.Schema(
  {
    droneId: { type: String, required: true, unique: true }, // e.g. "DRN-01"
    gps: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      altitude: { type: Number, default: 0 }, // meters
      heading: { type: Number, default: 0 },  // degrees
    },
    battery: { type: Number, min: 0, max: 100, default: 100 }, // percent
    status: {
      type: String,
      enum: ['PATROL', 'RETURNING_TO_BASE', 'CHARGING', 'GROUNDED', 'OFFLINE'],
      default: 'PATROL',
    },
    sensorData: {
      thermalReading: Number,     // °C, from an IR/thermal camera module
      gasReading: Number,         // ppm, from an MQ-series gas sensor
      imageUrl: String,           // last captured frame (S3 / local storage URL)
      signalStrength: Number,     // RSSI dBm from the telemetry radio
    },
    assignedZone: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone' },
    lastSeen: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Drone', DroneSchema);
