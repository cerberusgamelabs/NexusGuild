// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /utils/audit.js

import db from '../config/database.js';
import { generateSnowflake } from './functions.js';

/**
 * Log a server audit event. Never throws — audit failures must not break the calling operation.
 *
 * @param {string} serverId
 * @param {string} action       e.g. 'member_ban', 'channel_create'
 * @param {string} actorId      user who performed the action
 * @param {string|null} targetId   affected entity id (user, channel, role, etc.)
 * @param {string|null} targetType 'user' | 'channel' | 'role' | 'server' | 'webhook' | 'message'
 * @param {object|null} changes    freeform context ({ name, reason, ... })
 */
export async function logAuditEvent(serverId, action, actorId, targetId = null, targetType = null, changes = null) {
    try {
        await db.query(
            `INSERT INTO server_audit_log (id, server_id, action, actor_id, target_id, target_type, changes)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                generateSnowflake(),
                serverId,
                action,
                actorId  || null,
                targetId || null,
                targetType || null,
                changes ? JSON.stringify(changes) : null,
            ]
        );
    } catch (err) {
        // Silent — audit must not break the main operation
        console.error('[AUDIT] Failed to log event:', err.message);
    }
}
