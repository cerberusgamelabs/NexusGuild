// File Location: /routes/users.js

import express from "express";
const router = express.Router();
import UserController from "../controllers/userController.js";
import { requireAuth } from "../middleware/auth.js";
import { uploadSingle, handleUploadError } from "../middleware/upload.js";

router.post('/me/avatar', requireAuth, uploadSingle, handleUploadError, UserController.uploadAvatar);

export default router;
