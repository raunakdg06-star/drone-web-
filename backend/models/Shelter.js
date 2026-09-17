const mongoose = require('mongoose');

const ShelterSchema = new mongoose.Schema(
  {
    shelterId: { type: String, required: true, unique: true },
    location: { lat: Number, lng: Number },
    capacity: { type: Number, required: true },
    occupancy: { type: Number, default: 0 },
    resources: [{ type: String }], // e.g. ["food","medical","blankets"]
    status: { type: String, enum: ['OPEN', 'NEAR_FULL', 'FULL', 'CLOSED'], default: 'OPEN' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Shelter', ShelterSchema);
