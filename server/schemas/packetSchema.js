const { z } = require('zod');

const packetSchema = z.object({
    id: z.string().uuid(),
    timestamp: z.string().datetime(),
    src_ip: z.string().ip({ version: "v4" }),
    dst_ip: z.string().ip({ version: "v4" }),
    src_port: z.number().int().min(1).max(65535),
    dst_port: z.number().int().min(1).max(65535),
    protocol: z.enum(["TCP", "UDP", "ICMP"]),
    bytes: z.number().int().positive(),
    anomaly_score: z.number().min(0).max(1),
    is_anomaly: z.boolean(),
    explanation: z.array(z.object({
        feature: z.string(),
        shap_value: z.number(),
        actual_value: z.number()
    })).nullable().optional(),
    mitre: z.object({
        technique_id: z.string(),
        technique_name: z.string(),
        tactic: z.string(),
        confidence: z.enum(["high", "medium", "low"])
    }).nullable().optional(),
}).strip();

module.exports = packetSchema;
