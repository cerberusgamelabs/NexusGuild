// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /routes/ascension.js

import express from 'express';
const router = express.Router();
import AscensionController from '../controllers/ascensionController.js';
import { requireAuth } from '../middleware/auth.js';

router.get('/nodes',                                        requireAuth, AscensionController.getNodes);
router.get('/balance',                                      requireAuth, AscensionController.getBalance);
router.get('/ledger',                                       requireAuth, AscensionController.getLedger);
router.get('/unlocks',                                      requireAuth, AscensionController.getUnlocks);
router.post('/grant',                                       requireAuth, AscensionController.grantPoints);
router.post('/unlock/:nodeId',                              requireAuth, AscensionController.unlockNode);
router.get('/servers/:serverId/balance',                    requireAuth, AscensionController.getServerBalance);
router.get('/servers/:serverId/unlocks',                    requireAuth, AscensionController.getServerUnlocks);
router.post('/servers/:serverId/donate',                    requireAuth, AscensionController.donateToServer);
router.post('/servers/:serverId/unlock/:nodeId',            requireAuth, AscensionController.unlockServerNode);
router.patch('/servers/:serverId/unlocks/:nodeId/enable',   requireAuth, AscensionController.enableServerNode);

export default router;
