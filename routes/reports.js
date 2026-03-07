// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /routes/reports.js

import express from 'express';
const router = express.Router();
import { fileReport, getServerReports, updateReport, escalateReport } from '../controllers/reportController.js';
import { requireAuth } from '../middleware/auth.js';
import { isServerMember, checkPermission, PERMISSIONS } from '../middleware/permissions.js';

// Anyone authenticated can file a report
router.post('/', requireAuth, fileReport);

// Server-admin routes  — :serverId in path so isServerMember can verify membership
router.get(
    '/servers/:serverId',
    requireAuth,
    isServerMember,
    checkPermission(PERMISSIONS.MANAGE_GUILD),
    getServerReports
);

router.patch(
    '/servers/:serverId/:reportId',
    requireAuth,
    isServerMember,
    checkPermission(PERMISSIONS.MANAGE_GUILD),
    updateReport
);

router.post(
    '/servers/:serverId/:reportId/escalate',
    requireAuth,
    isServerMember,
    checkPermission(PERMISSIONS.MANAGE_GUILD),
    escalateReport
);

export default router;
