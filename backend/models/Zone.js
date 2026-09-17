const mongoose = require('mongoose');

const ZoneSchema = new mongoose.Schema(
  {
    zoneId: { type: String, required: true, unique: true },
    name: String,
    type: { type: String, enum: ['FLOOD', 'FIRE', 'COLLAPSE', 'EARTHQUAKE', 'OTHER'], required: true },
    severity: { type: String, enum: ['ACTIVE', 'SEVERE', 'CRITICAL', 'CONTAINED'], default: 'ACTIVE' },
    polygon: [{ lat: Number, lng: Number }], // ordered boundary points
  },
  { timestamps: true }
);

module.exports = mongoose.model('Zone', ZoneSchema);
