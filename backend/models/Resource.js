const mongoose = require('mongoose');

const ResourceSchema = new mongoose.Schema(
  {
    resourceId: { type: String, required: true, unique: true },
    type: { type: String, enum: ['Medical', 'Water', 'Food', 'Fuel/Power', 'Shelter Kit'], required: true },
    location: { lat: Number, lng: Number },
    quantity: { type: Number, default: 0 },
    status: { type: String, enum: ['AVAILABLE', 'LOW', 'DEPLETED', 'IN_TRANSIT'], default: 'AVAILABLE' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Resource', ResourceSchema);
