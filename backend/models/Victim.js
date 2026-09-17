const mongoose = require('mongoose');

/**
 * Victim
 *  ├── Location
 *  ├── Priority
 *  └── Status
 *
 * Populated either by a drone's detection pipeline (e.g. a YOLO model
 * running on captured thermal/RGB frames flags a person, posts the
 * bounding-box GPS estimate here) or by a human dispatcher.
 */
const VictimSchema = new mongoose.Schema(
  {
    victimId: { type: String, required: true, unique: true }, // e.g. "VIC-04"
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    priority: {
      type: String,
      enum: ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'],
      default: 'MODERATE',
    },
    status: {
      type: String,
      enum: ['UNRESCUED', 'ASSIGNED', 'RESCUED'],
      default: 'UNRESCUED',
    },
    detectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Drone' },
    assignedTeam: { type: mongoose.Schema.Types.ObjectId, ref: 'RescueTeam' },
    notes: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model('Victim', VictimSchema);
