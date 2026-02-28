// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /routes/servers.js

import express from "express";
const router = express.Router();
import ServerController from "../controllers/serverController.js";
import RoleController from "../controllers/roleController.js";
import { requireAuth } from "../middleware/auth.js";
import { isServerOwner, isServerMember, checkPermission, PERMISSIONS } from "../middleware/permissions.js";
import { validateServer } from "../middleware/validation.js";
import { uploadSingle, handleUploadError } from "../middleware/upload.js";

// ✅ Static paths must come BEFORE /:serverId or Express swallows them as params
router.post('/join', requireAuth, ServerController.joinServer);
router.get('/preview/:code', ServerController.getInvitePreview);

router.get('/', requireAuth, ServerController.getUserServers);
router.post('/', requireAuth, validateServer, ServerController.createServer);

router.get('/:serverId', requireAuth, isServerMember, ServerController.getServer);
router.patch('/:serverId', requireAuth, isServerMember, checkPermission(PERMISSIONS.MANAGE_GUILD), validateServer, ServerController.updateServer);
router.delete('/:serverId', requireAuth, isServerOwner, ServerController.deleteServer);

router.post('/:serverId/invites', requireAuth, isServerMember, checkPermission(PERMISSIONS.CREATE_INSTANT_INVITE), ServerController.createInvite);
router.get('/:serverId/invites', requireAuth, isServerMember, ServerController.getServerInvites);

router.get('/:serverId/members', requireAuth, isServerMember, ServerController.getServerMembers);
router.get('/:serverId/settings/members', requireAuth, isServerMember, ServerController.getSettingsMembers);

// Roles
router.get('/:serverId/roles', requireAuth, isServerMember, RoleController.getRoles);
router.post('/:serverId/roles', requireAuth, isServerMember, checkPermission(PERMISSIONS.MANAGE_ROLES), RoleController.createRole);
// reorder must come BEFORE /:roleId so Express doesn't treat "reorder" as a roleId param
router.patch('/:serverId/roles/reorder', requireAuth, isServerMember, checkPermission(PERMISSIONS.MANAGE_ROLES), RoleController.reorderRoles);
router.patch('/:serverId/roles/:roleId', requireAuth, isServerMember, checkPermission(PERMISSIONS.MANAGE_ROLES), RoleController.updateRole);
router.delete('/:serverId/roles/:roleId', requireAuth, isServerMember, checkPermission(PERMISSIONS.MANAGE_ROLES), RoleController.deleteRole);

// Member role assignment
router.get('/:serverId/members/:memberId/roles', requireAuth, isServerMember, RoleController.getMemberRoles);
router.post('/:serverId/members/:memberId/roles', requireAuth, isServerMember, checkPermission(PERMISSIONS.MANAGE_ROLES), RoleController.assignRole);
router.delete('/:serverId/members/:memberId/roles/:roleId', requireAuth, isServerMember, checkPermission(PERMISSIONS.MANAGE_ROLES), RoleController.removeRole);

// Member management
router.patch('/:serverId/members/:memberId', requireAuth, isServerMember, ServerController.setNickname);
router.delete('/:serverId/members/:memberId', requireAuth, isServerMember, checkPermission(PERMISSIONS.KICK_MEMBERS), ServerController.kickMember);

// Leave server
router.post('/:serverId/leave', requireAuth, isServerMember, ServerController.leaveServer);

// Upload server icon
router.post('/:serverId/icon', requireAuth, isServerOwner, uploadSingle, handleUploadError, ServerController.uploadServerIcon);

// Bans
router.get('/:serverId/bans', requireAuth, isServerMember, checkPermission(PERMISSIONS.BAN_MEMBERS), ServerController.getBans);
router.post('/:serverId/bans/:memberId', requireAuth, isServerMember, checkPermission(PERMISSIONS.BAN_MEMBERS), ServerController.banMember);
router.delete('/:serverId/bans/:memberId', requireAuth, isServerMember, checkPermission(PERMISSIONS.BAN_MEMBERS), ServerController.unbanMember);

export default router;
