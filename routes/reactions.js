// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /routes/reactions.js

import express from "express";
const router = express.Router();
import ReactionController from "../controllers/reactionController.js";
import { requireAuth } from "../middleware/auth.js";
import { uploadEmoji } from "../middleware/upload.js";
import { checkPermission, isServerMember, PERMISSIONS } from "../middleware/permissions.js";

// Message reactions
router.post('/messages/:messageId/reactions', requireAuth, ReactionController.addReaction);
router.delete('/messages/:messageId/reactions', requireAuth, ReactionController.removeReaction);
router.get('/messages/:messageId/reactions', requireAuth, ReactionController.getMessageReactions);

// Custom emojis
router.get('/servers/:serverId/emojis', requireAuth, ReactionController.getServerEmojis);
router.post('/servers/:serverId/emojis', requireAuth, isServerMember, checkPermission(PERMISSIONS.MANAGE_GUILD_EXPRESSIONS), uploadEmoji, ReactionController.uploadCustomEmoji);
router.delete('/servers/:serverId/emojis/:emojiId', requireAuth, isServerMember, checkPermission(PERMISSIONS.MANAGE_GUILD_EXPRESSIONS), ReactionController.deleteCustomEmoji);

export default router;