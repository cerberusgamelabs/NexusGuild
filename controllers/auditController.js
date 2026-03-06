// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/auditController.js

import db from '../config/database.js';
import { log, tags } from '#utils/logging';

class AuditController {
    static async getAuditLog(req, res) {
        try {
            const { serverId } = req.params;
            const limit = Math.min(parseInt(req.query.limit) || 50, 100);
            const before = req.query.before;

            let query = `
                SELECT a.*,
                       actor.username AS actor_username,
                       actor.avatar   AS actor_avatar,
                       tgt.username   AS target_username
                FROM server_audit_log a
                LEFT JOIN users actor ON a.actor_id = actor.id
                LEFT JOIN users tgt   ON a.target_id = tgt.id AND a.target_type = 'user'
                WHERE a.server_id = $1
            `;
            const params = [serverId];

            if (before) {
                query += ` AND a.id < $2`;
                params.push(before);
            }

            query += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1}`;
            params.push(limit);

            const result = await db.query(query, params);
            res.json({ entries: result.rows });
        } catch (error) {
            log(tags.error, 'Get audit log error:', error);
            res.status(500).json({ error: 'Failed to get audit log' });
        }
    }
}

export default AuditController;
