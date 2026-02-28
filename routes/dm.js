// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /routes/dm.js

import express from 'express';
const router = express.Router();
import DMController from '../controllers/dmController.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadMultiple, handleUploadError } from '../middleware/upload.js';

// Search users to start a DM (must be before /:dmId routes)
router.get('/users/search', requireAuth, DMController.searchUsers);

// Get all DM conversations for current user
router.get('/', requireAuth, DMController.getConversations);

// Open/create a DM conversation
router.post('/', requireAuth, DMController.openConversation);

// Get messages for a DM conversation
router.get('/:dmId/messages', requireAuth, DMController.getMessages);

// Send a message in a DM conversation (supports file attachments)
router.post('/:dmId/messages', requireAuth, uploadMultiple, handleUploadError, DMController.sendMessage);

// DM reactions
router.post('/:dmId/messages/:messageId/reactions',    requireAuth, DMController.addDMReaction);
router.delete('/:dmId/messages/:messageId/reactions',  requireAuth, DMController.removeDMReaction);
router.get('/:dmId/messages/:messageId/reactions',     requireAuth, DMController.getDMReactions);

// Edit a DM message (sender only)
router.patch('/:dmId/messages/:messageId', requireAuth, DMController.editMessage);

// Delete a DM message (sender only)
router.delete('/:dmId/messages/:messageId', requireAuth, DMController.deleteMessage);

export default router;