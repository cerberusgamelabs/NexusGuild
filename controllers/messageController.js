// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/messageController.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from "../config/database.js";
import { generateSnowflake } from "#utils/functions";
import { log, tags } from "#utils/logging";
import { PermissionHandler, PERMISSIONS } from "../config/permissions.js";
import { resolveChannelPerms } from "../utils/channelPerms.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Returns true if userId is the server owner or holds the given permission.
async function hasServerPerm(userId, serverId, permission) {
    const ownerRes = await db.query('SELECT owner_id FROM servers WHERE id = $1', [serverId]);
    if (ownerRes.rows[0]?.owner_id === userId) return true;
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
    return PermissionHandler.hasPermission(perms, permission);
}

class MessageController {
    static async getChannelMessages(req, res) {
        try {
            const { channelId } = req.params;
            const userId = req.session.user.id;
            const { limit = 50, before } = req.query;

            // Channel-level VIEW_CHANNEL + READ_MESSAGE_HISTORY check
            const chanRes = await db.query('SELECT server_id FROM channels WHERE id = $1', [channelId]);
            if (chanRes.rows.length > 0) {
                const perms = await resolveChannelPerms(userId, chanRes.rows[0].server_id, channelId);
                if (!PermissionHandler.hasPermission(perms, PERMISSIONS.VIEW_CHANNEL) ||
                    !PermissionHandler.hasPermission(perms, PERMISSIONS.READ_MESSAGE_HISTORY)) {
                    return res.status(403).json({ error: 'Missing channel permissions' });
                }
            }

            let query = `
                SELECT m.*, u.username, u.avatar,
                       (pm.message_id IS NOT NULL) AS is_pinned
                FROM messages m
                JOIN users u ON m.user_id = u.id
                LEFT JOIN pinned_messages pm
                    ON pm.message_id = m.id AND pm.channel_id = m.channel_id
                WHERE m.channel_id = $1
            `;
            const params = [channelId];

            if (before) {
                query += ` AND m.id < $2`;
                params.push(before);
            }

            query += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
            params.push(limit);

            const result = await db.query(query, params);
            res.json({ messages: result.rows.reverse() });
        } catch (error) {
            log(tags.error, 'Get channel messages error:', error);
            res.status(500).json({ error: 'Failed to get messages' });
        }
    }

    static async createMessage(req, res) {
        try {
            const { channelId } = req.params;
            const { content } = req.body;
            const userId = req.session.user.id;

            // Handle file attachments from multer
            let attachments = null;
            if (req.files && req.files.length > 0) {
                attachments = req.files.map(file => ({
                    filename: file.filename,
                    originalName: file.originalname,
                    mimetype: file.mimetype,
                    size: file.size,
                    url: `/uploads/${file.filename}`
                }));
            }

            // Allow empty content if there are attachments
            if (!content && !attachments) {
                return res.status(400).json({ error: 'Message must have content or attachments' });
            }

            // Channel-level permission checks (SEND_MESSAGES + MENTION_EVERYONE)
            const chanRes = await db.query('SELECT server_id FROM channels WHERE id = $1', [channelId]);
            if (chanRes.rows.length > 0) {
                const chPerms = await resolveChannelPerms(userId, chanRes.rows[0].server_id, channelId);
                if (!PermissionHandler.hasPermission(chPerms, PERMISSIONS.SEND_MESSAGES)) {
                    return res.status(403).json({ error: 'You do not have permission to send messages in this channel' });
                }
                if (content && /@everyone\b|@here\b/i.test(content) &&
                    !PermissionHandler.hasPermission(chPerms, PERMISSIONS.MENTION_EVERYONE)) {
                    return res.status(403).json({ error: 'You do not have permission to use @everyone or @here' });
                }
            }

            const id = generateSnowflake();

            const result = await db.query(
                `INSERT INTO messages (id, channel_id, user_id, content, attachments)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [id, channelId, userId, content || '', attachments ? JSON.stringify(attachments) : null]
            );

            const userResult = await db.query(
                'SELECT username, avatar FROM users WHERE id = $1',
                [userId]
            );

            const message = {
                ...result.rows[0],
                username: userResult.rows[0].username,
                avatar: userResult.rows[0].avatar
            };

            const io = req.app.get('io');
            if (io) {
                io.to(`channel:${channelId}`).emit('message_created', message);

                const channelResult = await db.query(
                    'SELECT server_id FROM channels WHERE id = $1',
                    [channelId]
                );
                if (channelResult.rows.length > 0) {
                    const serverId = channelResult.rows[0].server_id;
                    io.to(`server:${serverId}`).emit('channel_notification', {
                        channelId,
                        serverId,
                        messageId: id,
                        username: userResult.rows[0].username,
                        content: content || '',
                    });
                }
            }

            log(tags.info, `Message sent by ${userResult.rows[0].username} in channel ${channelId}${attachments ? ` with ${attachments.length} attachment(s)` : ''}`);
            res.status(201).json({ message: 'Message sent successfully', data: message });
        } catch (error) {
            log(tags.error, 'Create message error:', error);
            res.status(500).json({ error: 'Failed to send message' });
        }
    }

    static async updateMessage(req, res) {
        try {
            const { messageId } = req.params;
            const { content, removeAttachments } = req.body;   // <-- add removeAttachments
            const userId = req.session.user.id;

            const checkResult = await db.query(
                'SELECT user_id, channel_id, attachments FROM messages WHERE id = $1',
                [messageId]
            );

            if (checkResult.rows.length === 0)
                return res.status(404).json({ error: 'Message not found' });
            if (checkResult.rows[0].user_id !== userId)
                return res.status(403).json({ error: 'You can only edit your own messages' });

            // Handle attachment removal
            let newAttachments = checkResult.rows[0].attachments
                ? (typeof checkResult.rows[0].attachments === 'string'
                    ? JSON.parse(checkResult.rows[0].attachments)
                    : checkResult.rows[0].attachments)
                : null;

            if (removeAttachments && removeAttachments.length > 0 && newAttachments) {
                // Delete files from disk
                for (const filename of removeAttachments) {
                    const filePath = path.join(__dirname, '../public/uploads', filename);
                    try {
                        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    } catch (e) {
                        log(tags.warning, `Could not delete file ${filename}:`, e.message);
                    }
                }

                newAttachments = newAttachments.filter(a => !removeAttachments.includes(a.filename));
                if (newAttachments.length === 0) newAttachments = null;
            }

            const result = await db.query(
                `UPDATE messages
             SET content = $1, edited_at = NOW(), attachments = $2
             WHERE id = $3 RETURNING *`,
                [content, newAttachments ? JSON.stringify(newAttachments) : null, messageId]
            );

            const userResult = await db.query(
                'SELECT username, avatar FROM users WHERE id = $1',
                [checkResult.rows[0].user_id]
            );

            const updatedMessage = {
                ...result.rows[0],
                username: userResult.rows[0].username,
                avatar: userResult.rows[0].avatar
            };

            const io = req.app.get('io');
            if (io) {
                io.to(`channel:${checkResult.rows[0].channel_id}`).emit('message_updated', updatedMessage);
            }

            res.json({ message: 'Message updated successfully', data: updatedMessage });
        } catch (error) {
            log(tags.error, 'Update message error:', error);
            res.status(500).json({ error: 'Failed to update message' });
        }
    }

    static async pinMessage(req, res) {
        try {
            const { messageId } = req.params;
            const userId = req.session.user.id;

            const msgRes = await db.query('SELECT channel_id FROM messages WHERE id = $1', [messageId]);
            if (msgRes.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
            const channelId = msgRes.rows[0].channel_id;

            const chanRes = await db.query('SELECT server_id FROM channels WHERE id = $1', [channelId]);
            if (chanRes.rows.length === 0) return res.status(404).json({ error: 'Channel not found' });
            const serverId = chanRes.rows[0].server_id;

            if (!await hasServerPerm(userId, serverId, PERMISSIONS.MANAGE_MESSAGES)) {
                return res.status(403).json({ error: 'Missing MANAGE_MESSAGES permission' });
            }

            await db.query(
                `INSERT INTO pinned_messages (channel_id, message_id, pinned_by)
                 VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                [channelId, messageId, userId]
            );

            const io = req.app.get('io');
            if (io) io.to(`channel:${channelId}`).emit('message_pinned', { messageId, channelId });

            log(tags.info, `Message ${messageId} pinned in channel ${channelId} by ${userId}`);
            res.json({ message: 'Message pinned' });
        } catch (error) {
            log(tags.error, 'Pin message error:', error);
            res.status(500).json({ error: 'Failed to pin message' });
        }
    }

    static async unpinMessage(req, res) {
        try {
            const { messageId } = req.params;
            const userId = req.session.user.id;

            const msgRes = await db.query('SELECT channel_id FROM messages WHERE id = $1', [messageId]);
            if (msgRes.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
            const channelId = msgRes.rows[0].channel_id;

            const chanRes = await db.query('SELECT server_id FROM channels WHERE id = $1', [channelId]);
            if (chanRes.rows.length === 0) return res.status(404).json({ error: 'Channel not found' });
            const serverId = chanRes.rows[0].server_id;

            if (!await hasServerPerm(userId, serverId, PERMISSIONS.MANAGE_MESSAGES)) {
                return res.status(403).json({ error: 'Missing MANAGE_MESSAGES permission' });
            }

            await db.query(
                'DELETE FROM pinned_messages WHERE channel_id = $1 AND message_id = $2',
                [channelId, messageId]
            );

            const io = req.app.get('io');
            if (io) io.to(`channel:${channelId}`).emit('message_unpinned', { messageId, channelId });

            log(tags.info, `Message ${messageId} unpinned in channel ${channelId} by ${userId}`);
            res.json({ message: 'Message unpinned' });
        } catch (error) {
            log(tags.error, 'Unpin message error:', error);
            res.status(500).json({ error: 'Failed to unpin message' });
        }
    }

    static async getPinnedMessages(req, res) {
        try {
            const { channelId } = req.params;
            const userId = req.session.user.id;

            // Verify membership
            const chanRes = await db.query('SELECT server_id FROM channels WHERE id = $1', [channelId]);
            if (chanRes.rows.length === 0) return res.status(404).json({ error: 'Channel not found' });
            const serverId = chanRes.rows[0].server_id;

            const memberCheck = await db.query(
                'SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2',
                [serverId, userId]
            );
            if (memberCheck.rows.length === 0) {
                return res.status(403).json({ error: 'Not a member of this server' });
            }

            const result = await db.query(
                `SELECT m.*, u.username, u.avatar,
                        pm.pinned_at, pm.pinned_by,
                        pu.username AS pinned_by_username
                 FROM pinned_messages pm
                 JOIN messages m ON m.id = pm.message_id
                 JOIN users u ON u.id = m.user_id
                 LEFT JOIN users pu ON pu.id = pm.pinned_by
                 WHERE pm.channel_id = $1
                 ORDER BY pm.pinned_at DESC`,
                [channelId]
            );

            res.json({ pins: result.rows });
        } catch (error) {
            log(tags.error, 'Get pinned messages error:', error);
            res.status(500).json({ error: 'Failed to get pinned messages' });
        }
    }

    static async deleteMessage(req, res) {
        try {
            const { messageId } = req.params;
            const userId = req.session.user.id;

            const checkResult = await db.query(
                'SELECT user_id, channel_id FROM messages WHERE id = $1',
                [messageId]
            );

            if (checkResult.rows.length === 0) {
                return res.status(404).json({ error: 'Message not found' });
            }
            if (checkResult.rows[0].user_id !== userId) {
                // Allow users with MANAGE_MESSAGES to delete others' messages
                const chanRes = await db.query('SELECT server_id FROM channels WHERE id = $1', [checkResult.rows[0].channel_id]);
                const allowed = chanRes.rows.length > 0 &&
                    await hasServerPerm(userId, chanRes.rows[0].server_id, PERMISSIONS.MANAGE_MESSAGES);
                if (!allowed) {
                    return res.status(403).json({ error: 'You can only delete your own messages' });
                }
            }

            await db.query('DELETE FROM messages WHERE id = $1', [messageId]);

            const io = req.app.get('io');
            if (io) {
                io.to(`channel:${checkResult.rows[0].channel_id}`).emit('message_deleted', { messageId });
            }

            res.json({ message: 'Message deleted successfully' });
        } catch (error) {
            log(tags.error, 'Delete message error:', error);
            res.status(500).json({ error: 'Failed to delete message' });
        }
    }
}

export default MessageController;