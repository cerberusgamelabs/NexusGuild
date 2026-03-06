// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /routes/webhooks.js

import express from 'express';
const router = express.Router();
import WebhookController from '../controllers/webhookController.js';
import { requireAuth } from '../middleware/auth.js';
import { isServerMember, checkPermission, PERMISSIONS } from '../middleware/permissions.js';

// List webhooks for a server
router.get(
    '/servers/:serverId',
    requireAuth,
    isServerMember,
    checkPermission(PERMISSIONS.MANAGE_WEBHOOKS),
    WebhookController.listWebhooks
);

// Create webhook
router.post(
    '/servers/:serverId',
    requireAuth,
    isServerMember,
    checkPermission(PERMISSIONS.MANAGE_WEBHOOKS),
    WebhookController.createWebhook
);

// Update webhook (permission checked inline)
router.patch('/:webhookId', requireAuth, WebhookController.updateWebhook);

// Delete webhook (permission checked inline — no serverId in path)
router.delete('/:webhookId', requireAuth, WebhookController.deleteWebhook);

// Execute webhook (no auth — token in path)
router.post('/:webhookId/:token', WebhookController.executeWebhook);

export default router;
