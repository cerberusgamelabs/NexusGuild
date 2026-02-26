// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /routes/voice.js

import express from 'express';
const router = express.Router();
import VoiceController from '../controllers/voiceController.js';
import { requireAuth } from '../middleware/auth.js';

// GET /api/voice/token?channelId=X&serverId=X
router.get('/token', requireAuth, VoiceController.getToken);

export default router;
