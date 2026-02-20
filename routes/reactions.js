// File Location: /routes/reactions.js

import express from "express";
const router = express.Router();
import ReactionController from "../controllers/reactionController.js";
import { requireAuth } from "../middleware/auth.js";
import { uploadSingle } from "../middleware/upload.js";

// Message reactions
router.post('/messages/:messageId/reactions', requireAuth, ReactionController.addReaction);
router.delete('/messages/:messageId/reactions', requireAuth, ReactionController.removeReaction);
router.get('/messages/:messageId/reactions', requireAuth, ReactionController.getMessageReactions);

// Custom emojis
router.get('/servers/:serverId/emojis', requireAuth, ReactionController.getServerEmojis);
router.post('/servers/:serverId/emojis', requireAuth, uploadSingle, ReactionController.uploadCustomEmoji);

export default router;