// server/models/Packet.js
const mongoose = require('mongoose');

const PacketSchema = new mongoose.Schema({
    owner_user_id: { type: String, index: true },
    owner_email: { type: String, index: true },
    source_ip: String,
    destination_ip: String,
    method: String,
    bytes: Number,
    timestamp: { type: Date, default: Date.now },
    is_anomaly: { type: Boolean, default: false },
    anomaly_score: { type: Number, default: 0 }
}, { bufferCommands: false });

// Create a "Time Series" collection (Optimized for logs)
// Note: If this errors on free tier, standard collection works too.
module.exports = mongoose.model('Packet', PacketSchema);