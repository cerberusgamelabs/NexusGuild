// Proprietary — Cerberus Game Labs. See LICENSE for terms.
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import InteractionController from '../controllers/interactionController.js';

const router = Router();

router.get('/servers/:serverId/commands', requireAuth, InteractionController.getServerCommands);
router.post('/', requireAuth, InteractionController.dispatch);
// Bot response endpoints — no session auth, token in URL is the credential
router.post('/:interactionId/:token/callback', InteractionController.callback);
router.post('/:interactionId/:token/followup', InteractionController.followup);

export default router;
