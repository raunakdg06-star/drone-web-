const mongoose = require('mongoose');

/**
 * RescueTeam
 *  ├── Location
 *  ├── Availability
 *  └── Assigned Victims
 */
const RescueTeamSchema = new mongoose.Schema(
  {
    teamId: { type: String, required: true, unique: true }, // e.g. "TEAM-ALPHA"
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    availability: {
      type: String,
      enum: ['AVAILABLE', 'DEPLOYED', 'OFF_DUTY'],
      default: 'AVAILABLE',
    },
    assignedVictims: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Victim' }],
    members: [{ name: String, role: String }],
    vehicle: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model('RescueTeam', RescueTeamSchema);
