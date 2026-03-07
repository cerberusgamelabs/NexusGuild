// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/reportController.js

import db from '../config/database.js';
import { generateSnowflake } from '../utils/functions.js';
import { log, tags } from '#utils/logging';

const VALID_REASONS = [
    'Spam',
    'Harassment',
    'Hate speech',
    'NSFW content',
    'Misinformation',
    'Threats / violence',
    'Impersonation',
    'Other',
];

// POST /api/reports
export async function fileReport(req, res) {
    const { type, scope, reportedUserId, messageId, messageContent, serverId, reason, details, isAnonymous } = req.body;
    const reporterId = req.session.user.id;

    if (!['message', 'user'].includes(type)) return res.status(400).json({ error: 'Invalid report type.' });
    if (!['server', 'global'].includes(scope)) return res.status(400).json({ error: 'Invalid scope.' });
    if (!VALID_REASONS.includes(reason)) return res.status(400).json({ error: 'Invalid reason.' });
    if (!reportedUserId) return res.status(400).json({ error: 'reportedUserId is required.' });

    // Server-scoped reports require a serverId
    if (scope === 'server' && !serverId) return res.status(400).json({ error: 'serverId is required for server-scoped reports.' });

    // Anonymous only allowed at server scope
    const anon = scope === 'server' ? !!isAnonymous : false;

    try {
        const id = generateSnowflake();
        await db.query(
            `INSERT INTO reports
                (id, type, scope, reporter_id, reported_user_id, message_id, message_content, server_id, reason, details, is_anonymous)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [id, type, scope, reporterId, reportedUserId, messageId || null, messageContent || null,
             serverId || null, reason, details || null, anon]
        );

        // Notify online server admins via socket
        if (scope === 'server' && serverId) {
            const io = req.app.get('io');
            if (io) {
                const reporterRow = anon ? null : await db.query(
                    `SELECT username FROM users WHERE id = $1`, [reporterId]
                );
                io.to(`server:${serverId}`).emit('server_report', {
                    reportId: id,
                    type,
                    reason,
                    reportedUserId,
                    isAnonymous: anon,
                    reporterUsername: anon ? null : reporterRow?.rows[0]?.username,
                });
            }
        }

        log(tags.info, `Report filed: ${type} | scope=${scope} | reason=${reason}`);
        res.status(201).json({ ok: true, reportId: id });
    } catch (err) {
        log(tags.error, 'fileReport error:', err);
        res.status(500).json({ error: 'Failed to file report.' });
    }
}

// GET /api/reports/servers/:serverId
export async function getServerReports(req, res) {
    const { serverId } = req.params;
    const { status } = req.query;

    const conditions = [`r.server_id = $1`];
    const params = [serverId];

    if (status) {
        params.push(status);
        conditions.push(`r.status = $${params.length}`);
    }

    try {
        const result = await db.query(
            `SELECT
                r.*,
                CASE WHEN r.is_anonymous THEN NULL ELSE ru.username END AS reporter_username,
                rpu.username AS reported_username
             FROM reports r
             LEFT JOIN users ru  ON ru.id  = r.reporter_id
             LEFT JOIN users rpu ON rpu.id = r.reported_user_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY r.created_at DESC`,
            params
        );
        res.json({ reports: result.rows });
    } catch (err) {
        log(tags.error, 'getServerReports error:', err);
        res.status(500).json({ error: 'Failed to load reports.' });
    }
}

// PATCH /api/reports/servers/:serverId/:reportId
export async function updateReport(req, res) {
    const { reportId, serverId } = req.params;
    const { status } = req.body;
    const userId = req.session.user.id;

    if (!['reviewed', 'dismissed'].includes(status)) {
        return res.status(400).json({ error: 'Status must be reviewed or dismissed.' });
    }

    try {
        const result = await db.query(
            `UPDATE reports SET status=$1, reviewed_by=$2, reviewed_at=NOW()
             WHERE id=$3 AND server_id=$4 RETURNING id`,
            [status, userId, reportId, serverId]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Report not found.' });
        res.json({ ok: true });
    } catch (err) {
        log(tags.error, 'updateReport error:', err);
        res.status(500).json({ error: 'Failed to update report.' });
    }
}

// POST /api/reports/:reportId/escalate  (server → global)
export async function escalateReport(req, res) {
    const { reportId } = req.params;
    const { serverId } = req.params;

    try {
        const result = await db.query(
            `UPDATE reports SET scope='global', status='escalated', escalated_at=NOW()
             WHERE id=$1 AND server_id=$2 AND scope='server' RETURNING id`,
            [reportId, serverId]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Report not found or already escalated.' });
        res.json({ ok: true });
    } catch (err) {
        log(tags.error, 'escalateReport error:', err);
        res.status(500).json({ error: 'Failed to escalate report.' });
    }
}
