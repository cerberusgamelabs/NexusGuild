// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /routes/forum.js

import express from 'express';
const router = express.Router();
import ForumController from '../controllers/forumController.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadMultiple, handleUploadError } from '../middleware/upload.js';

router.get('/channels/:channelId/posts',    requireAuth, ForumController.listPosts);
router.post('/channels/:channelId/posts',   requireAuth, uploadMultiple, handleUploadError, ForumController.createPost);
router.get('/posts/:postId/messages',       requireAuth, ForumController.getPostMessages);
router.post('/posts/:postId/messages',      requireAuth, uploadMultiple, handleUploadError, ForumController.replyToPost);
router.delete('/posts/:postId',             requireAuth, ForumController.deletePost);

export default router;
