// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /routes/integrations.js

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
    getDddiceIntegration,
    startDddiceActivation,
    pollDddiceActivation,
    getDddiceDiceBox,
    setDddiceTheme,
    disconnectDddice,
} from '../controllers/integrationsController.js';

const router = express.Router();

router.get('/dddice',                    requireAuth, getDddiceIntegration);
router.post('/dddice/activate',          requireAuth, startDddiceActivation);
router.get('/dddice/activate/:code',     requireAuth, pollDddiceActivation);
router.get('/dddice/dice-box',           requireAuth, getDddiceDiceBox);
router.patch('/dddice/theme',            requireAuth, setDddiceTheme);
router.delete('/dddice',                 requireAuth, disconnectDddice);

export default router;
