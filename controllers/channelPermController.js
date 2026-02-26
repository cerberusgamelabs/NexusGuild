// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/channelPermController.js

import db from '../config/database.js';
import { PermissionHandler, PERMISSIONS } from '../config/permissions.js';
import { log, tags } from '#utils/logging';

async function canManageChannel(userId, channelId) {
    const chanRes = await db.query('SELECT server_id FROM channels WHERE id = $1', [channelId]);
    if (!chanRes.rows.length) return false;
    const serverId = chanRes.rows[0].server_id;
    const ownerRes = await db.query('SELECT owner_id FROM servers WHERE id = $1', [serverId]);
    if (ownerRes.rows[0]?.owner_id === userId) return true;
    const [rolesRes, everyoneRes] = await Promise.all([
        db.query(
            `SELECT COALESCE(bit_or(r.permissions::bigint), 0)::text AS perms
             FROM roles r JOIN user_roles ur ON r.id = ur.role_id
             WHERE ur.user_id = $1 AND ur.server_id = $2`,
            [userId, serverId]
        ),
        db.query(
            `SELECT permissions FROM roles WHERE server_id = $1 AND name = '@everyone'`, [serverId]
        ),
    ]);
    let perms = BigInt(rolesRes.rows[0]?.perms || '0');
    if (everyoneRes.rows[0]) perms |= BigInt(everyoneRes.rows[0].permissions);
    return PermissionHandler.hasPermission(perms, PERMISSIONS.MANAGE_CHANNELS) ||
           PermissionHandler.hasPermission(perms, PERMISSIONS.ADMINISTRATOR);
}

class ChannelPermController {
    static async getOverrides(req, res) {
        try {
            const { channelId } = req.params;
            const userId = req.session.user.id;
            if (!await canManageChannel(userId, channelId))
                return res.status(403).json({ error: 'Missing MANAGE_CHANNELS' });

            const chanRes = await db.query('SELECT server_id FROM channels WHERE id = $1', [channelId]);
            const serverId = chanRes.rows[0]?.server_id;

            const [overridesRes, everyoneRes] = await Promise.all([
                db.query(
                    `SELECT cpo.target_id, cpo.target_type, cpo.allow, cpo.deny,
                            CASE WHEN cpo.target_type = 'role' THEN r.name
                                 ELSE u.username END AS display_name,
                            CASE WHEN cpo.target_type = 'role' THEN r.color ELSE NULL END AS color
                     FROM channel_permission_overrides cpo
                     LEFT JOIN roles r ON cpo.target_type = 'role' AND r.id = cpo.target_id
                     LEFT JOIN users u ON cpo.target_type = 'member' AND u.id = cpo.target_id
                     WHERE cpo.channel_id = $1`,
                    [channelId]
                ),
                db.query(
                    `SELECT id, name, color FROM roles WHERE server_id = $1 AND name = '@everyone'`,
                    [serverId]
                ),
            ]);

            res.json({
                overrides: overridesRes.rows,
                everyoneRole: everyoneRes.rows[0] || null,
            });
        } catch (err) {
            log(tags.error, 'getOverrides error:', err);
            res.status(500).json({ error: 'Failed to get overrides' });
        }
    }

    static async upsertOverride(req, res) {
        try {
            const { channelId, targetId } = req.params;
            const { target_type, allow, deny } = req.body;
            const userId = req.session.user.id;

            if (!await canManageChannel(userId, channelId))
                return res.status(403).json({ error: 'Missing MANAGE_CHANNELS' });
            if (!['role', 'member'].includes(target_type))
                return res.status(400).json({ error: 'target_type must be role or member' });

            await db.query(
                `INSERT INTO channel_permission_overrides (channel_id, target_id, target_type, allow, deny)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (channel_id, target_id) DO UPDATE SET allow = $4, deny = $5`,
                [channelId, targetId, target_type, BigInt(allow || 0).toString(), BigInt(deny || 0).toString()]
            );

            const chanRes = await db.query('SELECT server_id FROM channels WHERE id = $1', [channelId]);
            const serverId = chanRes.rows[0]?.server_id;
            const io = req.app.get('io');
            if (io && serverId) io.to(`server:${serverId}`).emit('permissions_updated', { serverId, channelId });

            res.json({ ok: true });
        } catch (err) {
            log(tags.error, 'upsertOverride error:', err);
            res.status(500).json({ error: 'Failed to save override' });
        }
    }

    static async deleteOverride(req, res) {
        try {
            const { channelId, targetId } = req.params;
            const userId = req.session.user.id;

            if (!await canManageChannel(userId, channelId))
                return res.status(403).json({ error: 'Missing MANAGE_CHANNELS' });

            await db.query(
                `DELETE FROM channel_permission_overrides WHERE channel_id = $1 AND target_id = $2`,
                [channelId, targetId]
            );

            const chanRes = await db.query('SELECT server_id FROM channels WHERE id = $1', [channelId]);
            const serverId = chanRes.rows[0]?.server_id;
            const io = req.app.get('io');
            if (io && serverId) io.to(`server:${serverId}`).emit('permissions_updated', { serverId, channelId });

            res.json({ ok: true });
        } catch (err) {
            log(tags.error, 'deleteOverride error:', err);
            res.status(500).json({ error: 'Failed to delete override' });
        }
    }
}

export default ChannelPermController;
