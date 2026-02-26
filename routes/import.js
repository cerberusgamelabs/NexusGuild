// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /routes/import.js

import express from 'express';
const router = express.Router();
import ImportController from '../controllers/importController.js';

// Middleware: verify the request comes from the Discord bot via shared secret
function requireBotSecret(req, res, next) {
    const auth = req.headers['authorization'] || '';
    const secret = process.env.BOT_SECRET;
    if (!secret || auth !== `Bearer ${secret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

router.post('/discord', requireBotSecret, ImportController.importDiscordServer);

export default router;
