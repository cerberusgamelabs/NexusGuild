// File Location: /routes/servers.js

import express from "express";
const router = express.Router();
import ServerController from "../controllers/serverController.js";
import { requireAuth } from "../middleware/auth.js";
import { isServerOwner, isServerMember } from "../middleware/permissions.js";
import { validateServer } from "../middleware/validation.js";

// ✅ /join must come BEFORE /:serverId or Express swallows it as a param
router.post('/join', requireAuth, ServerController.joinServer);

router.get('/', requireAuth, ServerController.getUserServers);
router.post('/', requireAuth, validateServer, ServerController.createServer);

router.get('/:serverId', requireAuth, isServerMember, ServerController.getServer);
router.patch('/:serverId', requireAuth, isServerOwner, validateServer, ServerController.updateServer);
router.delete('/:serverId', requireAuth, isServerOwner, ServerController.deleteServer);

router.post('/:serverId/invites', requireAuth, isServerMember, ServerController.createInvite);
router.get('/:serverId/invites', requireAuth, isServerMember, ServerController.getServerInvites);

router.get('/:serverId/members', requireAuth, isServerMember, ServerController.getServerMembers);

export default router;