// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /routes/messages.js

import express from "express";
const router = express.Router();
import MessageController from "../controllers/messageController.js";
import ChannelController from "../controllers/channelController.js";
import { requireAuth, requireBotAuth } from "../middleware/auth.js";
import { validateMessage } from "../middleware/validation.js";
import { uploadMultiple, handleUploadError } from "../middleware/upload.js";

// Bot: post a message to a channel (token auth)
router.post('/bot/channels/:channelId/messages', requireBotAuth, MessageController.createBotMessage);

// Get channel messages
router.get('/channels/:channelId/messages', requireAuth, MessageController.getChannelMessages);

// Get pinned messages for a channel
router.get('/channels/:channelId/pins', requireAuth, MessageController.getPinnedMessages);

// Send message (with optional file attachments)
router.post('/channels/:channelId/messages',
    requireAuth,
    uploadMultiple,
    handleUploadError,
    validateMessage,
    MessageController.createMessage
);

// Update message
router.patch('/:messageId', requireAuth, validateMessage, MessageController.updateMessage);

// Delete message
router.delete('/:messageId', requireAuth, MessageController.deleteMessage);

// Pin / unpin message
router.put('/:messageId/pin', requireAuth, MessageController.pinMessage);
router.delete('/:messageId/pin', requireAuth, MessageController.unpinMessage);

// Suppress embed (author only)
router.patch('/:messageId/embed', requireAuth, MessageController.suppressEmbed);

// Threads
router.post('/:messageId/thread', requireAuth, ChannelController.createThread);
router.get('/:messageId/thread',  requireAuth, ChannelController.getThread);

export default router;