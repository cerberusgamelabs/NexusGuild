// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /routes/audit.js

import express from 'express';
const router = express.Router();
import AuditController from '../controllers/auditController.js';
import { requireAuth } from '../middleware/auth.js';
import { isServerMember, checkPermission, PERMISSIONS } from '../middleware/permissions.js';

// GET /api/audit/servers/:serverId?limit=50&before=<snowflake>
router.get(
    '/servers/:serverId',
    requireAuth,
    isServerMember,
    checkPermission(PERMISSIONS.VIEW_AUDIT_LOG),
    AuditController.getAuditLog
);

export default router;
