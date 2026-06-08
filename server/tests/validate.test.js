const validate = require('../middleware/validate');
const { z } = require('zod');

describe('Validate Middleware', () => {
    it('validates and replaces req.body on success', () => {
        const schema = z.object({
            name: z.string(),
            age: z.number()
        }).strip();

        const req = { body: { name: 'Alice', age: 30, extra: 'field' } };
        const res = {};
        const next = jest.fn();

        const middleware = validate(schema);
        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.body).toEqual({ name: 'Alice', age: 30 });
    });

    it('returns 400 on validation error', () => {
        const schema = z.object({
            name: z.string(),
            age: z.number()
        });

        const req = { body: { name: 'Alice', age: 'thirty' } };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        const next = jest.fn();

        const middleware = validate(schema);
        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });
});
