const { z } = require('zod');

const settingsSchema = z.object({
    attackMode: z.boolean().optional(),
    packetRate: z.number().int().min(1).max(1000).optional(),
}).strip();

module.exports = settingsSchema;
