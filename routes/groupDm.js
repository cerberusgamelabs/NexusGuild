// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /routes/groupDm.js

import express from 'express';
const router = express.Router();
import GroupDmController from '../controllers/groupDmController.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadMultiple, uploadSingle, handleUploadError } from '../middleware/upload.js';

// Create a new group DM
router.post('/', requireAuth, GroupDmController.createGroupDm);

// Get all group DM conversations for current user
router.get('/', requireAuth, GroupDmController.getGroupConversations);

// Get messages in a group DM
router.get('/:id/messages', requireAuth, GroupDmController.getGroupMessages);

// Send a message in a group DM (supports file attachments)
router.post('/:id/messages', requireAuth, uploadMultiple, handleUploadError, GroupDmController.sendGroupMessage);

// Rename group DM
router.patch('/:id', requireAuth, GroupDmController.updateGroupDm);

// Upload group DM avatar (owner only)
router.patch('/:id/avatar', requireAuth, uploadSingle, handleUploadError, GroupDmController.uploadGroupAvatar);

// Add a member (owner only)
router.post('/:id/members', requireAuth, GroupDmController.addGroupMember);

// Remove a member (owner removes other; any member can remove themselves)
router.delete('/:id/members/:userId', requireAuth, GroupDmController.removeGroupMember);

// Reactions
router.post('/:id/messages/:mid/reactions',   requireAuth, GroupDmController.addGroupReaction);
router.delete('/:id/messages/:mid/reactions', requireAuth, GroupDmController.removeGroupReaction);

// Edit / delete messages
router.patch('/:id/messages/:mid',  requireAuth, GroupDmController.editGroupMessage);
router.delete('/:id/messages/:mid', requireAuth, GroupDmController.deleteGroupMessage);

export default router;
