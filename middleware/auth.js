// Proprietary — Cerberus Game Labs. See LICENSE for terms.
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

const requireBotAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bot ')) {
        return res.status(401).json({ error: 'Bot authentication required' });
    }
    const token = authHeader.slice(4).trim();
    try {
        const { default: db } = await import('../config/database.js');
        const result = await db.query(
            `SELECT b.id, b.owner_id, b.callback_url, b.public_bot,
                    u.username, u.avatar, u.is_bot
             FROM bots b
             JOIN users u ON u.id = b.id
             WHERE b.token = $1`,
            [token]
        );
        if (!result.rows.length) return res.status(401).json({ error: 'Invalid bot token' });
        req.botUser = result.rows[0];
        next();
    } catch (err) {
        next(err);
    }
};

export {
    requireAuth,
    optionalAuth,
    requireBotAuth
};