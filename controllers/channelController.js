// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/channelController.js

import db from "../config/database.js";
import { generateSnowflake } from "#utils/functions";
import { log, tags } from "#utils/logging";
import { PermissionHandler, PERMISSIONS } from "../config/permissions.js";
import { batchResolveChannelPerms } from "../utils/channelPerms.js";

// Resolve channelId → serverId and check if userId holds the given permission.
// Returns { serverId, allowed } or null if the channel doesn't exist.
async function checkChannelPerm(userId, channelId, permission) {
    const chanRes = await db.query('SELECT server_id FROM channels WHERE id = $1', [channelId]);
    if (chanRes.rows.length === 0) return null;
    const serverId = chanRes.rows[0].server_id;
    const ownerRes = await db.query('SELECT owner_id FROM servers WHERE id = $1', [serverId]);
    if (ownerRes.rows[0]?.owner_id === userId) return { serverId, allowed: true };
    const [rolesRes, everyoneRes] = await Promise.all([
        db.query(
            `SELECT COALESCE(bit_or(r.permissions::bigint), 0)::text AS perms
             FROM roles r JOIN user_roles ur ON r.id = ur.role_id
             WHERE ur.user_id = $1 AND ur.server_id = $2`,
            [userId, serverId]
        ),
        db.query(`SELECT permissions FROM roles WHERE server_id = $1 AND name = '@everyone'`, [serverId]),
    ]);
    let perms = BigInt(rolesRes.rows[0]?.perms || '0');
    if (everyoneRes.rows[0]) perms |= BigInt(everyoneRes.rows[0].permissions);
    return { serverId, allowed: PermissionHandler.hasPermission(perms, permission) };
}

class ChannelController {
    static async getServerChannels(req, res) {
        try {
            const { serverId } = req.params;
            const userId = req.session.user.id;
            const username = req.session.user.username;

            const categoriesResult = await db.query(
                `SELECT * FROM categories WHERE server_id = $1 ORDER BY position`,
                [serverId]
            );

            const channelsResult = await db.query(
                `SELECT c.*,
                    unread.unread_count,
                    unread.mention_count
                 FROM channels c
                 LEFT JOIN LATERAL (
                     SELECT
                         COUNT(m.id)::int AS unread_count,
                         COUNT(m.id) FILTER (
                             WHERE m.content ILIKE '%@everyone%'
                                OR m.content ILIKE '%@here%'
                                OR m.content ILIKE '%@' || $3 || '%'
                         )::int AS mention_count
                     FROM user_channel_reads ucr
                     JOIN messages m
                         ON m.channel_id = c.id
                        AND m.user_id != $2
                        AND m.id > ucr.last_read_message_id
                     WHERE ucr.channel_id = c.id AND ucr.user_id = $2
                 ) unread ON true
                 WHERE c.server_id = $1
                 ORDER BY c.position`,
                [serverId, userId, username]
            );

            // Resolve per-channel permissions and filter out invisible channels
            const channelIds = channelsResult.rows.map(c => c.id);
            const channelPerms = await batchResolveChannelPerms(userId, serverId, channelIds);

            const visibleChannels = channelsResult.rows.filter(ch => {
                const perms = channelPerms[ch.id] ?? 0n;
                return PermissionHandler.hasPermission(perms, PERMISSIONS.VIEW_CHANNEL) ||
                       PermissionHandler.hasPermission(perms, PERMISSIONS.ADMINISTRATOR);
            });

            const channels = visibleChannels.map(ch => ({
                ...ch,
                my_permissions: (channelPerms[ch.id] ?? 0n).toString(),
            }));

            res.json({
                categories: categoriesResult.rows,
                channels,
            });
        } catch (error) {
            log(tags.error, 'Get server channels error:', error);
            res.status(500).json({ error: 'Failed to get channels' });
        }
    }

    static async markChannelRead(req, res) {
        try {
            const { channelId } = req.params;
            const userId = req.session.user.id;

            // Upsert the latest message ID as the read cursor.
            // If the channel has no messages the SELECT returns nothing and the
            // INSERT is skipped — no row needed until there is content to track.
            await db.query(
                `INSERT INTO user_channel_reads (user_id, channel_id, last_read_message_id)
                 SELECT $1, $2, id
                 FROM messages
                 WHERE channel_id = $3
                 ORDER BY created_at DESC
                 LIMIT 1
                 ON CONFLICT (user_id, channel_id) DO UPDATE
                     SET last_read_message_id = EXCLUDED.last_read_message_id`,
                [userId, channelId, channelId]
            );

            res.json({ ok: true });
        } catch (error) {
            log(tags.error, 'Mark channel read error:', error);
            res.status(500).json({ error: 'Failed to mark channel as read' });
        }
    }

    static async createChannel(req, res) {
        try {
            const { serverId } = req.params;
            const { name, type = 'text', categoryId, topic } = req.body;

            const positionResult = await db.query(
                `SELECT COALESCE(MAX(position), -1) + 1 as next_position
                 FROM channels
                 WHERE server_id = $1 AND category_id = $2`,
                [serverId, categoryId || null]
            );

            const position = positionResult.rows[0].next_position;
            const id = generateSnowflake();

            const result = await db.query(
                `INSERT INTO channels (id, server_id, category_id, name, type, topic, position)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING *`,
                [id, serverId, categoryId || null, name, type, topic || null, position]
            );

            log(tags.success, `Channel created: "${name}" (${id}) in server ${serverId}`);

            const io = req.app.get('io');
            if (io) {
                io.to(`server:${serverId}`).emit('channel_created', {
                    serverId,
                    channel: result.rows[0]
                });
            }

            res.status(201).json({
                message: 'Channel created successfully',
                channel: result.rows[0]
            });
        } catch (error) {
            log(tags.error, 'Create channel error:', error);
            res.status(500).json({ error: 'Failed to create channel' });
        }
    }

    static async updateChannel(req, res) {
        try {
            const { channelId } = req.params;
            const { name, topic, position } = req.body;
            const userId = req.session.user.id;

            const perm = await checkChannelPerm(userId, channelId, PERMISSIONS.MANAGE_CHANNELS);
            if (perm === null) return res.status(404).json({ error: 'Channel not found' });
            if (!perm.allowed) return res.status(403).json({ error: 'Insufficient permissions' });

            const result = await db.query(
                `UPDATE channels
                 SET name = COALESCE($1, name),
                     topic = COALESCE($2, topic),
                     position = COALESCE($3, position)
                 WHERE id = $4
                 RETURNING *`,
                [name, topic, position, channelId]
            );

            if (result.rows.length === 0) return res.status(404).json({ error: 'Channel not found' });
            log(tags.info, `Channel updated: "${result.rows[0].name}" [${channelId}]`);

            const io = req.app.get('io');
            if (io) {
                io.to(`server:${perm.serverId}`).emit('channel_updated', {
                    serverId: perm.serverId,
                    channel: result.rows[0]
                });
            }

            res.json({ message: 'Channel updated successfully', channel: result.rows[0] });
        } catch (error) {
            log(tags.error, 'Update channel error:', error);
            res.status(500).json({ error: 'Failed to update channel' });
        }
    }

    static async deleteChannel(req, res) {
        try {
            const { channelId } = req.params;
            const userId = req.session.user.id;

            const channelResult = await db.query(
                'SELECT server_id, name FROM channels WHERE id = $1',
                [channelId]
            );

            if (channelResult.rows.length === 0) {
                return res.status(404).json({ error: 'Channel not found' });
            }

            const { server_id: serverId, name: channelName } = channelResult.rows[0];

            const perm = await checkChannelPerm(userId, channelId, PERMISSIONS.MANAGE_CHANNELS);
            if (!perm?.allowed) return res.status(403).json({ error: 'Insufficient permissions' });

            await db.query('DELETE FROM channels WHERE id = $1', [channelId]);

            // Broadcast
            const io = req.app.get('io');
            if (io) {
                io.to(`server:${serverId}`).emit('channel_deleted', {
                    serverId,
                    channelId
                });
            }

            log(tags.warning, `Channel deleted: "${channelName}" [${channelId}]`);
            res.json({ message: 'Channel deleted successfully' });
        } catch (error) {
            log(tags.error, 'Delete channel error:', error);
            res.status(500).json({ error: 'Failed to delete channel' });
        }
    }

    static async createCategory(req, res) {
        try {
            const { serverId } = req.params;
            const { name } = req.body;

            const positionResult = await db.query(
                `SELECT COALESCE(MAX(position), -1) + 1 as next_position
                 FROM categories
                 WHERE server_id = $1`,
                [serverId]
            );

            const position = positionResult.rows[0].next_position;
            const id = generateSnowflake();

            const result = await db.query(
                `INSERT INTO categories (id, server_id, name, position)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
                [id, serverId, name, position]
            );

            log(tags.success, `Category created: "${name}" (${id}) in server ${serverId}`);

            const io = req.app.get('io');
            io?.to(`server:${serverId}`).emit('category_created', { serverId });

            res.status(201).json({
                message: 'Category created successfully',
                category: result.rows[0]
            });
        } catch (error) {
            log(tags.error, 'Create category error:', error);
            res.status(500).json({ error: 'Failed to create category' });
        }
    }

    static async updateCategory(req, res) {
        try {
            const { serverId, categoryId } = req.params;
            const { name } = req.body;
            if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

            const result = await db.query(
                `UPDATE categories SET name = $1 WHERE id = $2 AND server_id = $3 RETURNING *`,
                [name.trim(), categoryId, serverId]
            );
            if (result.rows.length === 0) return res.status(404).json({ error: 'Category not found' });

            const io = req.app.get('io');
            io?.to(`server:${serverId}`).emit('category_updated', { serverId });

            log(tags.info, `Category renamed: "${result.rows[0].name}" [${categoryId}]`);
            res.json({ category: result.rows[0] });
        } catch (error) {
            log(tags.error, 'Update category error:', error);
            res.status(500).json({ error: 'Failed to update category' });
        }
    }

    static async deleteCategory(req, res) {
        try {
            const { serverId, categoryId } = req.params;

            // Move channels to uncategorized before deleting
            await db.query(`UPDATE channels SET category_id = NULL WHERE category_id = $1`, [categoryId]);
            await db.query(`DELETE FROM categories WHERE id = $1 AND server_id = $2`, [categoryId, serverId]);

            const io = req.app.get('io');
            io?.to(`server:${serverId}`).emit('category_deleted', { serverId });

            log(tags.warning, `Category deleted: [${categoryId}] from server ${serverId}`);
            res.json({ message: 'Category deleted' });
        } catch (error) {
            log(tags.error, 'Delete category error:', error);
            res.status(500).json({ error: 'Failed to delete category' });
        }
    }

}

export default ChannelController;