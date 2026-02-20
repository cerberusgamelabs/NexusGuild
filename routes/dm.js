// File Location: /routes/dm.js

import express from 'express';
const router = express.Router();
import DMController from '../controllers/dmController.js';
import { requireAuth } from '../middleware/auth.js';

// Search users to start a DM (must be before /:dmId routes)
router.get('/users/search', requireAuth, DMController.searchUsers);

// Get all DM conversations for current user
router.get('/', requireAuth, DMController.getConversations);

// Open/create a DM conversation
router.post('/', requireAuth, DMController.openConversation);

// Get messages for a DM conversation
router.get('/:dmId/messages', requireAuth, DMController.getMessages);

// Send a message in a DM conversation
router.post('/:dmId/messages', requireAuth, DMController.sendMessage);

// Edit a DM message (sender only)
router.patch('/:dmId/messages/:messageId', requireAuth, DMController.editMessage);

// Delete a DM message (sender only)
router.delete('/:dmId/messages/:messageId', requireAuth, DMController.deleteMessage);

export default router;