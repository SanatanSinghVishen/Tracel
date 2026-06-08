const { z } = require('zod');

const resetMongoSchema = z.object({
    confirm: z.literal("RESET", {
        errorMap: () => ({ message: "Confirmation required: set { confirm: 'RESET' }" })
    })
}).strip();

module.exports = {
    resetMongoSchema
};
