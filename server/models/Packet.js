// server/models/Packet.js
const mongoose = require('mongoose');

const PacketSchema = new mongoose.Schema({
    owner_user_id: { type: String, index: true },
    owner_email: { type: String, index: true },
    source_ip: String,
    // Optional enrichment (derived server-side from source_ip when missing).
    source_country: { type: String, index: true },
    destination_ip: String,
    protocol: { type: String, default: 'TCP' },
    method: String,
    dst_port: { type: Number },
    bytes: Number,
    entropy: { type: Number },
    timestamp: { type: Date, default: Date.now },
    is_anomaly: { type: Boolean, default: false },
    // Raw anomaly score from the AI engine (lower => more suspicious). Null means “not scored”.
    anomaly_score: { type: Number, default: null },
    // Whether the AI engine successfully scored this packet.
    ai_scored: { type: Boolean },
    // Optional correlation id echoed by the AI service.
    ai_id: { type: String },

    // Dynamic threshold telemetry (computed in Node).
    anomaly_threshold: { type: Number },
    anomaly_mean: { type: Number },
    anomaly_stddev: { type: Number },
    anomaly_baseline_n: { type: Number },
    anomaly_warmed_up: { type: Boolean },
    high_entropy: { type: Boolean, default: false },
    payload: { type: String, default: null },
}, { bufferCommands: false });

// Create a "Time Series" collection (Optimized for logs)
// Note: If this errors on free tier, standard collection works too.
module.exports = mongoose.model('Packet', PacketSchema);