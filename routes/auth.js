// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /routes/auth.js

import express from "express";
const router = express.Router();
import AuthController from "../controllers/authController.js";
import { validateRegister, validateLogin } from "../middleware/validation.js";
import { requireAuth } from "../middleware/auth.js";

router.post('/register', validateRegister, AuthController.register);
router.post('/login', validateLogin, AuthController.login);
router.post('/logout', requireAuth, AuthController.logout);
router.get('/me', requireAuth, AuthController.getCurrentUser);

router.patch('/password', requireAuth, AuthController.changePassword);
router.post('/reset-password/request', AuthController.requestPasswordReset);
router.post('/reset-password/confirm', AuthController.confirmPasswordReset);

router.get('/google', AuthController.googleRedirect);
router.get('/google/callback', AuthController.googleCallback);

export default router;