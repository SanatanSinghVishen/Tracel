const validate = (schema) => (req, res, next) => {
    const result = schema.safeParse(req.body);
    
    if (!result.success) {
        return res.status(400).json({
            status: 400,
            title: "Validation Error",
            detail: result.error.issues
        });
    }

    // Replace req.body with the sanitized version (stripped of unknown fields)
    req.body = result.data;
    next();
};

module.exports = validate;
