// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /routes/users.js

import express from "express";
const router = express.Router();
import UserController from "../controllers/userController.js";
import { requireAuth } from "../middleware/auth.js";
import { uploadSingle, handleUploadError } from "../middleware/upload.js";

router.post('/me/avatar', requireAuth, uploadSingle, handleUploadError, UserController.uploadAvatar);
router.patch('/me/status', requireAuth, UserController.setCustomStatus);
router.patch('/me/profile', requireAuth, UserController.updateProfileLayout);
router.patch('/me/profile/banner', requireAuth, uploadSingle, handleUploadError, UserController.updateProfileBanner);
router.get('/:userId/profile', UserController.getProfile);

export default router;
