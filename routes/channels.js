// File Location: /routes/channels.js

import express from "express";
const router = express.Router();
import ChannelController from "../controllers/channelController.js";
import { requireAuth } from "../middleware/auth.js";
import { isServerMember, checkPermission, PERMISSIONS } from "../middleware/permissions.js";
import { validateChannel } from "../middleware/validation.js";

// Get server channels
router.get('/servers/:serverId/channels', requireAuth, isServerMember, ChannelController.getServerChannels);

// Create channel
router.post(
    '/servers/:serverId/channels',
    requireAuth,
    isServerMember,
    checkPermission(PERMISSIONS.MANAGE_CHANNELS),
    validateChannel,
    ChannelController.createChannel
);

// Create category
router.post(
    '/servers/:serverId/categories',
    requireAuth,
    isServerMember,
    checkPermission(PERMISSIONS.MANAGE_CHANNELS),
    ChannelController.createCategory
);

// Update channel
router.patch(
    '/:channelId',
    requireAuth,
    validateChannel,
    ChannelController.updateChannel
);

// Delete channel
router.delete(
    '/:channelId',
    requireAuth,
    ChannelController.deleteChannel
);

export default router;