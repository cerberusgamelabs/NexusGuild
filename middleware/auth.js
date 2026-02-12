// File Location: /middleware/auth.js

const requireAuth = (req, res, next) => {
    if (req.session && req.session.user) {
        next();
    } else {
        res.status(401).json({ error: 'Authentication required' });
    }
};

const optionalAuth = (req, res, next) => {
    // Just passes through, used for routes where auth is optional
    next();
};

const requireBotAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bot ')) {
        return res.status(401).json({ error: 'Bot authentication required' });
    }

    const token = authHeader.substring(4);

    // TODO: Implement bot token validation
    // For now, just pass through
    req.botToken = token;
    next();
};

export {
    requireAuth,
    optionalAuth,
    requireBotAuth
};