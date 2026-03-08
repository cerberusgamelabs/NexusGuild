// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// Discord-compatible REST API v1 — all routes use bot token auth (requireBotAuth)

import db from '../config/database.js';
import { generateSnowflake } from '#utils/functions';
import { log, tags } from '#utils/logging';
import { resolveChannelPerms } from '../utils/channelPerms.js';
import { PERMISSIONS, PermissionHandler } from '../config/permissions.js';

const CHANNEL_TYPE = {
    text: 0, voice: 2, category: 4, announcement: 5,
    forum: 15, media: 15, thread: 11, public_thread: 11, private_thread: 12,
};

function fmtMessage(row) {
    return {
        id: row.id,
        channel_id: row.channel_id,
        author: {
            id: row.user_id,
            username: row.username || row.display_name || 'Unknown',
            avatar: row.avatar || null,
            bot: row.is_bot || false,
        },
        content: row.content || '',
        timestamp: row.created_at,
        edited_timestamp: row.updated_at || null,
        attachments: row.attachments
            ? (typeof row.attachments === 'string' ? JSON.parse(row.attachments) : row.attachments)
            : [],
        embeds: [],
        pinned: row.is_pinned || false,
        type: 0,
    };
}

function fmtChannel(row) {
    return {
        id: row.id,
        type: CHANNEL_TYPE[row.type] ?? 0,
        guild_id: row.server_id,
        name: row.name,
        topic: row.topic || null,
        position: row.position ?? 0,
        parent_id: row.category_id || null,
    };
}

function fmtGuild(row) {
    return {
        id: row.id,
        name: row.name,
        icon: row.icon || null,
        owner_id: row.owner_id,
        approximate_member_count: parseInt(row.member_count) || 0,
    };
}

function fmtMember(row) {
    return {
        user: {
            id: row.id,
            username: row.username,
            avatar: row.avatar || null,
            bot: row.is_bot || false,
        },
        nick: row.nickname || null,
        roles: row.role_ids || [],
        joined_at: row.joined_at,
    };
}

function fmtRole(row) {
    return {
        id: row.id,
        name: row.name,
        color: row.color ? parseInt(row.color.replace('#', ''), 16) : 0,
        permissions: (row.permissions || 0).toString(),
        position: row.position || 0,
        mentionable: row.mentionable || false,
        hoist: row.hoist || false,
    };
}

// Verify bot is a member of the server that owns the channel. Returns server_id or null.
async function botInChannelServer(botId, channelId) {
    const r = await db.query('SELECT server_id FROM channels WHERE id = $1', [channelId]);
    if (!r.rows.length) return null;
    const { server_id } = r.rows[0];
    const m = await db.query(
        'SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2',
        [server_id, botId]
    );
    return m.rows.length ? server_id : null;
}

async function botInGuild(botId, guildId) {
    const r = await db.query(
        'SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2',
        [guildId, botId]
    );
    return r.rows.length > 0;
}

// Returns bot's effective permission bitmask in a guild (owner gets all perms).
async function botServerPerms(botId, guildId) {
    const own = await db.query('SELECT owner_id FROM servers WHERE id = $1', [guildId]);
    if (own.rows[0]?.owner_id === botId) return ~0n;
    const r = await db.query(
        `SELECT COALESCE(bit_or(r.permissions::bigint), 0) AS perms
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = $1 AND ur.server_id = $2`,
        [botId, guildId]
    );
    return BigInt(r.rows[0]?.perms || 0);
}

export default class V1Controller {

    // GET /users/@me
    static async getMe(req, res) {
        res.json({
            id: req.botUser.id,
            username: req.botUser.username,
            avatar: req.botUser.avatar || null,
            bot: true,
        });
    }

    // GET /channels/:channelId
    static async getChannel(req, res) {
        try {
            const { channelId } = req.params;
            const serverId = await botInChannelServer(req.botUser.id, channelId);
            if (!serverId) return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const perms = await resolveChannelPerms(req.botUser.id, serverId, channelId);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.VIEW_CHANNEL))
                return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const r = await db.query('SELECT * FROM channels WHERE id = $1', [channelId]);
            if (!r.rows.length) return res.status(404).json({ code: 10003, message: 'Unknown Channel' });
            res.json(fmtChannel(r.rows[0]));
        } catch (err) {
            log(tags.error, 'v1 getChannel:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // GET /channels/:channelId/messages
    static async getMessages(req, res) {
        try {
            const { channelId } = req.params;
            const { limit = 50, before, after } = req.query;

            const serverId = await botInChannelServer(req.botUser.id, channelId);
            if (!serverId) return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const perms = await resolveChannelPerms(req.botUser.id, serverId, channelId);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.VIEW_CHANNEL))
                return res.status(403).json({ code: 50001, message: 'Missing Access' });
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.READ_MESSAGE_HISTORY))
                return res.status(403).json({ code: 50013, message: 'Missing Permissions' });

            const cap = Math.min(parseInt(limit) || 50, 100);
            let query = `
                SELECT m.*, COALESCE(m.display_name, u.username) AS username,
                       COALESCE(m.display_avatar, u.avatar) AS avatar, u.is_bot,
                       (pm.message_id IS NOT NULL) AS is_pinned
                FROM messages m
                LEFT JOIN users u ON u.id = m.user_id
                LEFT JOIN pinned_messages pm ON pm.message_id = m.id AND pm.channel_id = m.channel_id
                WHERE m.channel_id = $1`;
            const params = [channelId];

            if (before) { params.push(before); query += ` AND m.id < $${params.length}`; }
            if (after)  { params.push(after);  query += ` AND m.id > $${params.length}`; }
            params.push(cap);
            query += ` ORDER BY m.created_at DESC LIMIT $${params.length}`;

            const r = await db.query(query, params);
            res.json(r.rows.reverse().map(fmtMessage));
        } catch (err) {
            log(tags.error, 'v1 getMessages:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // POST /channels/:channelId/messages
    static async createMessage(req, res) {
        try {
            const { channelId } = req.params;
            const { content, embeds } = req.body;
            const bot = req.botUser;

            if (!content?.trim()) return res.status(400).json({ code: 50006, message: 'Cannot send an empty message' });

            const serverId = await botInChannelServer(bot.id, channelId);
            if (!serverId) return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const perms = await resolveChannelPerms(bot.id, serverId, channelId);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.VIEW_CHANNEL))
                return res.status(403).json({ code: 50001, message: 'Missing Access' });
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.SEND_MESSAGES))
                return res.status(403).json({ code: 50013, message: 'Missing Permissions' });

            const id = generateSnowflake();
            const result = await db.query(
                `INSERT INTO messages (id, channel_id, user_id, content) VALUES ($1, $2, $3, $4) RETURNING *`,
                [id, channelId, bot.id, content.trim()]
            );

            const message = fmtMessage({
                ...result.rows[0],
                username: bot.username,
                avatar: bot.avatar,
                is_bot: true,
            });

            const io = req.app.get('io');
            if (io) {
                const full = { ...result.rows[0], username: bot.username, avatar: bot.avatar,
                    reply_to_content: null, reply_to_username: null, reply_to_user_id: null,
                    thread_channel_id: null, thread_reply_count: 0 };
                io.to(`channel:${channelId}`).emit('message_created', full);
                io.to(`server:${serverId}`).emit('channel_notification', {
                    channelId, serverId, messageId: id,
                    username: bot.username, content: content.trim(),
                });
                const botGateway = req.app.get('botGateway');
                if (botGateway) botGateway.emit(serverId, 'MESSAGE_CREATE', full);
            }

            res.status(200).json(message);
        } catch (err) {
            log(tags.error, 'v1 createMessage:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // PATCH /channels/:channelId/messages/:messageId
    static async editMessage(req, res) {
        try {
            const { channelId, messageId } = req.params;
            const { content } = req.body;
            const bot = req.botUser;

            if (!content?.trim()) return res.status(400).json({ code: 50006, message: 'Cannot send an empty message' });

            const serverId = await botInChannelServer(bot.id, channelId);
            if (!serverId) return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const perms = await resolveChannelPerms(bot.id, serverId, channelId);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.VIEW_CHANNEL))
                return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const existing = await db.query(
                'SELECT user_id FROM messages WHERE id = $1 AND channel_id = $2', [messageId, channelId]
            );
            if (!existing.rows.length) return res.status(404).json({ code: 10008, message: 'Unknown Message' });
            if (existing.rows[0].user_id !== bot.id) return res.status(403).json({ code: 50005, message: 'Cannot edit a message authored by another user' });

            const r = await db.query(
                `UPDATE messages SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
                [content.trim(), messageId]
            );
            const updated = fmtMessage({ ...r.rows[0], username: bot.username, avatar: bot.avatar, is_bot: true });

            const io = req.app.get('io');
            if (io) io.to(`channel:${channelId}`).emit('message_updated', { ...r.rows[0], username: bot.username, avatar: bot.avatar });
            const botGateway = req.app.get('botGateway');
            if (botGateway) botGateway.emit(serverId, 'MESSAGE_UPDATE', updated);

            res.json(updated);
        } catch (err) {
            log(tags.error, 'v1 editMessage:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // DELETE /channels/:channelId/messages/:messageId
    static async deleteMessage(req, res) {
        try {
            const { channelId, messageId } = req.params;
            const bot = req.botUser;

            const serverId = await botInChannelServer(bot.id, channelId);
            if (!serverId) return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const perms = await resolveChannelPerms(bot.id, serverId, channelId);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.VIEW_CHANNEL))
                return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const existing = await db.query(
                'SELECT user_id FROM messages WHERE id = $1 AND channel_id = $2', [messageId, channelId]
            );
            if (!existing.rows.length) return res.status(404).json({ code: 10008, message: 'Unknown Message' });
            if (existing.rows[0].user_id !== bot.id) return res.status(403).json({ code: 50003, message: 'Cannot delete a message authored by another user' });

            await db.query('DELETE FROM messages WHERE id = $1', [messageId]);

            const io = req.app.get('io');
            if (io) io.to(`channel:${channelId}`).emit('message_deleted', { messageId, channelId });
            const botGateway = req.app.get('botGateway');
            if (botGateway) botGateway.emit(serverId, 'MESSAGE_DELETE', { id: messageId, channel_id: channelId, guild_id: serverId });

            res.status(204).send();
        } catch (err) {
            log(tags.error, 'v1 deleteMessage:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // PUT /channels/:channelId/messages/:messageId/reactions/:emoji/@me
    static async addReaction(req, res) {
        try {
            const { channelId, messageId, emoji } = req.params;
            const bot = req.botUser;

            const serverId = await botInChannelServer(bot.id, channelId);
            if (!serverId) return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const perms = await resolveChannelPerms(bot.id, serverId, channelId);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.VIEW_CHANNEL))
                return res.status(403).json({ code: 50001, message: 'Missing Access' });
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.ADD_REACTIONS))
                return res.status(403).json({ code: 50013, message: 'Missing Permissions' });

            const msg = await db.query('SELECT id FROM messages WHERE id = $1', [messageId]);
            if (!msg.rows.length) return res.status(404).json({ code: 10008, message: 'Unknown Message' });

            const decodedEmoji = decodeURIComponent(emoji);
            const id = generateSnowflake();
            await db.query(
                `INSERT INTO reactions (id, message_id, user_id, emoji) VALUES ($1, $2, $3, $4)
                 ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
                [id, messageId, bot.id, decodedEmoji]
            );

            const io = req.app.get('io');
            if (io) {
                const counts = await db.query(
                    `SELECT emoji, COUNT(*) AS count FROM reactions WHERE message_id = $1 GROUP BY emoji`,
                    [messageId]
                );
                io.to(`channel:${channelId}`).emit('reaction_updated', { messageId, reactions: counts.rows });
            }

            res.status(204).send();
        } catch (err) {
            log(tags.error, 'v1 addReaction:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // DELETE /channels/:channelId/messages/:messageId/reactions/:emoji/@me
    static async removeReaction(req, res) {
        try {
            const { channelId, messageId, emoji } = req.params;
            const bot = req.botUser;

            const serverId = await botInChannelServer(bot.id, channelId);
            if (!serverId) return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const decodedEmoji = decodeURIComponent(emoji);
            await db.query(
                'DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
                [messageId, bot.id, decodedEmoji]
            );

            const io = req.app.get('io');
            if (io) {
                const counts = await db.query(
                    `SELECT emoji, COUNT(*) AS count FROM reactions WHERE message_id = $1 GROUP BY emoji`,
                    [messageId]
                );
                io.to(`channel:${channelId}`).emit('reaction_updated', { messageId, reactions: counts.rows });
            }

            res.status(204).send();
        } catch (err) {
            log(tags.error, 'v1 removeReaction:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // GET /guilds/:guildId
    static async getGuild(req, res) {
        try {
            const { guildId } = req.params;
            if (!await botInGuild(req.botUser.id, guildId)) return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const r = await db.query(
                `SELECT s.*, COUNT(sm.id) AS member_count
                 FROM servers s LEFT JOIN server_members sm ON sm.server_id = s.id
                 WHERE s.id = $1 GROUP BY s.id`,
                [guildId]
            );
            if (!r.rows.length) return res.status(404).json({ code: 10004, message: 'Unknown Guild' });
            res.json(fmtGuild(r.rows[0]));
        } catch (err) {
            log(tags.error, 'v1 getGuild:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // GET /guilds/:guildId/channels
    static async getGuildChannels(req, res) {
        try {
            const { guildId } = req.params;
            if (!await botInGuild(req.botUser.id, guildId)) return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const r = await db.query(
                'SELECT * FROM channels WHERE server_id = $1 ORDER BY position ASC, created_at ASC',
                [guildId]
            );
            res.json(r.rows.map(fmtChannel));
        } catch (err) {
            log(tags.error, 'v1 getGuildChannels:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // GET /guilds/:guildId/members
    static async getGuildMembers(req, res) {
        try {
            const { guildId } = req.params;
            const { limit = 100, after } = req.query;
            if (!await botInGuild(req.botUser.id, guildId)) return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const cap = Math.min(parseInt(limit) || 100, 1000);
            let query = `
                SELECT u.id, u.username, u.avatar, u.is_bot, sm.nickname, sm.joined_at,
                       ARRAY_AGG(ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL) AS role_ids
                FROM server_members sm
                JOIN users u ON u.id = sm.user_id
                LEFT JOIN user_roles ur ON ur.user_id = sm.user_id AND ur.server_id = sm.server_id
                WHERE sm.server_id = $1`;
            const params = [guildId];

            if (after) { params.push(after); query += ` AND sm.user_id > $${params.length}`; }
            query += ` GROUP BY u.id, u.username, u.avatar, u.is_bot, sm.nickname, sm.joined_at`;
            query += ` ORDER BY sm.joined_at ASC LIMIT $${params.length + 1}`;
            params.push(cap);

            const r = await db.query(query, params);
            res.json(r.rows.map(fmtMember));
        } catch (err) {
            log(tags.error, 'v1 getGuildMembers:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // GET /guilds/:guildId/members/:userId
    static async getGuildMember(req, res) {
        try {
            const { guildId, userId } = req.params;
            if (!await botInGuild(req.botUser.id, guildId)) return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const r = await db.query(
                `SELECT u.id, u.username, u.avatar, u.is_bot, sm.nickname, sm.joined_at,
                        ARRAY_AGG(ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL) AS role_ids
                 FROM server_members sm
                 JOIN users u ON u.id = sm.user_id
                 LEFT JOIN user_roles ur ON ur.user_id = sm.user_id AND ur.server_id = sm.server_id
                 WHERE sm.server_id = $1 AND sm.user_id = $2
                 GROUP BY u.id, u.username, u.avatar, u.is_bot, sm.nickname, sm.joined_at`,
                [guildId, userId]
            );
            if (!r.rows.length) return res.status(404).json({ code: 10007, message: 'Unknown Member' });
            res.json(fmtMember(r.rows[0]));
        } catch (err) {
            log(tags.error, 'v1 getGuildMember:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // DELETE /channels/:channelId/messages/bulk-delete
    static async bulkDeleteMessages(req, res) {
        try {
            const { channelId } = req.params;
            const { messages: ids } = req.body;
            const bot = req.botUser;

            if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100)
                return res.status(400).json({ code: 50016, message: 'Provide 1–100 message IDs' });

            const serverId = await botInChannelServer(bot.id, channelId);
            if (!serverId) return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const perms = await resolveChannelPerms(bot.id, serverId, channelId);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.VIEW_CHANNEL))
                return res.status(403).json({ code: 50001, message: 'Missing Access' });

            // Only delete the bot's own messages
            const r = await db.query(
                `DELETE FROM messages WHERE id = ANY($1::varchar[]) AND channel_id = $2 AND user_id = $3 RETURNING id`,
                [ids, channelId, bot.id]
            );
            const deleted = r.rows.map(row => row.id);

            const io = req.app.get('io');
            const botGateway = req.app.get('botGateway');
            for (const messageId of deleted) {
                if (io) io.to(`channel:${channelId}`).emit('message_deleted', { messageId, channelId });
                if (botGateway) botGateway.emit(serverId, 'MESSAGE_DELETE', { id: messageId, channel_id: channelId, guild_id: serverId });
            }

            res.status(204).send();
        } catch (err) {
            log(tags.error, 'v1 bulkDeleteMessages:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // GET /channels/:channelId/pins
    static async getPins(req, res) {
        try {
            const { channelId } = req.params;
            const serverId = await botInChannelServer(req.botUser.id, channelId);
            if (!serverId) return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const perms = await resolveChannelPerms(req.botUser.id, serverId, channelId);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.VIEW_CHANNEL))
                return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const r = await db.query(
                `SELECT m.*, COALESCE(m.display_name, u.username) AS username,
                        COALESCE(m.display_avatar, u.avatar) AS avatar, u.is_bot, TRUE AS is_pinned
                 FROM pinned_messages pm
                 JOIN messages m ON m.id = pm.message_id
                 LEFT JOIN users u ON u.id = m.user_id
                 WHERE pm.channel_id = $1
                 ORDER BY pm.pinned_at DESC`,
                [channelId]
            );
            res.json(r.rows.map(fmtMessage));
        } catch (err) {
            log(tags.error, 'v1 getPins:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // PUT /channels/:channelId/pins/:messageId
    static async addPin(req, res) {
        try {
            const { channelId, messageId } = req.params;
            const bot = req.botUser;

            const serverId = await botInChannelServer(bot.id, channelId);
            if (!serverId) return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const perms = await resolveChannelPerms(bot.id, serverId, channelId);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.VIEW_CHANNEL))
                return res.status(403).json({ code: 50001, message: 'Missing Access' });
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.MANAGE_MESSAGES))
                return res.status(403).json({ code: 50013, message: 'Missing Permissions' });

            const msg = await db.query('SELECT id FROM messages WHERE id = $1 AND channel_id = $2', [messageId, channelId]);
            if (!msg.rows.length) return res.status(404).json({ code: 10008, message: 'Unknown Message' });

            await db.query(
                `INSERT INTO pinned_messages (channel_id, message_id, pinned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                [channelId, messageId, bot.id]
            );

            const io = req.app.get('io');
            if (io) io.to(`channel:${channelId}`).emit('message_pinned', { messageId, channelId });

            res.status(204).send();
        } catch (err) {
            log(tags.error, 'v1 addPin:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // DELETE /channels/:channelId/pins/:messageId
    static async removePin(req, res) {
        try {
            const { channelId, messageId } = req.params;
            const bot = req.botUser;

            const serverId = await botInChannelServer(bot.id, channelId);
            if (!serverId) return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const perms = await resolveChannelPerms(bot.id, serverId, channelId);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.VIEW_CHANNEL))
                return res.status(403).json({ code: 50001, message: 'Missing Access' });
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.MANAGE_MESSAGES))
                return res.status(403).json({ code: 50013, message: 'Missing Permissions' });

            await db.query(
                'DELETE FROM pinned_messages WHERE channel_id = $1 AND message_id = $2',
                [channelId, messageId]
            );

            const io = req.app.get('io');
            if (io) io.to(`channel:${channelId}`).emit('message_unpinned', { messageId, channelId });

            res.status(204).send();
        } catch (err) {
            log(tags.error, 'v1 removePin:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // GET /guilds/:guildId/roles
    static async getGuildRoles(req, res) {
        try {
            const { guildId } = req.params;
            if (!await botInGuild(req.botUser.id, guildId)) return res.status(403).json({ code: 50001, message: 'Missing Access' });

            const r = await db.query(
                'SELECT * FROM roles WHERE server_id = $1 ORDER BY position DESC, created_at ASC',
                [guildId]
            );
            res.json(r.rows.map(fmtRole));
        } catch (err) {
            log(tags.error, 'v1 getGuildRoles:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // POST /guilds/:guildId/roles
    static async createGuildRole(req, res) {
        try {
            const { guildId } = req.params;
            const { name, color, permissions, position, mentionable, hoist } = req.body;
            const bot = req.botUser;

            if (!await botInGuild(bot.id, guildId)) return res.status(403).json({ code: 50001, message: 'Missing Access' });
            const perms = await botServerPerms(bot.id, guildId);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.MANAGE_ROLES))
                return res.status(403).json({ code: 50013, message: 'Missing Permissions' });

            if (!name?.trim()) return res.status(400).json({ code: 50035, message: 'name is required' });

            const colorHex = typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : (color || '#99AAB5');
            const id = generateSnowflake();
            const r = await db.query(
                `INSERT INTO roles (id, server_id, name, color, permissions, position, mentionable)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                [id, guildId, name.trim(), colorHex,
                 permissions ? BigInt(permissions) : 0n,
                 position || 0,
                 mentionable || false]
            );

            const io = req.app.get('io');
            if (io) io.to(`server:${guildId}`).emit('role_created', r.rows[0]);
            const botGateway = req.app.get('botGateway');
            if (botGateway) botGateway.emit(guildId, 'ROLE_UPDATE', fmtRole(r.rows[0]));

            res.status(200).json(fmtRole(r.rows[0]));
        } catch (err) {
            log(tags.error, 'v1 createGuildRole:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // PATCH /guilds/:guildId/roles/:roleId
    static async editGuildRole(req, res) {
        try {
            const { guildId, roleId } = req.params;
            const { name, color, permissions, position, mentionable, hoist } = req.body;
            const bot = req.botUser;

            if (!await botInGuild(bot.id, guildId)) return res.status(403).json({ code: 50001, message: 'Missing Access' });
            const perms = await botServerPerms(bot.id, guildId);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.MANAGE_ROLES))
                return res.status(403).json({ code: 50013, message: 'Missing Permissions' });

            const existing = await db.query('SELECT * FROM roles WHERE id = $1 AND server_id = $2', [roleId, guildId]);
            if (!existing.rows.length) return res.status(404).json({ code: 10011, message: 'Unknown Role' });

            const curr = existing.rows[0];
            const colorHex = typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : (color ?? curr.color);
            const r = await db.query(
                `UPDATE roles SET name=$1, color=$2, permissions=$3, position=$4, mentionable=$5
                 WHERE id=$6 RETURNING *`,
                [
                    name?.trim() ?? curr.name,
                    colorHex,
                    permissions != null ? BigInt(permissions) : curr.permissions,
                    position ?? curr.position,
                    mentionable ?? curr.mentionable,
                    roleId,
                ]
            );

            const io = req.app.get('io');
            if (io) io.to(`server:${guildId}`).emit('role_updated', r.rows[0]);
            const botGateway = req.app.get('botGateway');
            if (botGateway) botGateway.emit(guildId, 'ROLE_UPDATE', fmtRole(r.rows[0]));

            res.json(fmtRole(r.rows[0]));
        } catch (err) {
            log(tags.error, 'v1 editGuildRole:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // DELETE /guilds/:guildId/roles/:roleId
    static async deleteGuildRole(req, res) {
        try {
            const { guildId, roleId } = req.params;
            const bot = req.botUser;

            if (!await botInGuild(bot.id, guildId)) return res.status(403).json({ code: 50001, message: 'Missing Access' });
            const perms = await botServerPerms(bot.id, guildId);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.MANAGE_ROLES))
                return res.status(403).json({ code: 50013, message: 'Missing Permissions' });

            const existing = await db.query('SELECT id FROM roles WHERE id = $1 AND server_id = $2', [roleId, guildId]);
            if (!existing.rows.length) return res.status(404).json({ code: 10011, message: 'Unknown Role' });

            await db.query('DELETE FROM roles WHERE id = $1', [roleId]);

            const io = req.app.get('io');
            if (io) io.to(`server:${guildId}`).emit('role_deleted', { roleId, serverId: guildId });
            const botGateway = req.app.get('botGateway');
            if (botGateway) botGateway.emit(guildId, 'ROLE_UPDATE', { deleted: true, id: roleId, guild_id: guildId });

            res.status(204).send();
        } catch (err) {
            log(tags.error, 'v1 deleteGuildRole:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // PUT /guilds/:guildId/members/:userId/roles/:roleId
    static async addMemberRole(req, res) {
        try {
            const { guildId, userId, roleId } = req.params;
            const bot = req.botUser;

            if (!await botInGuild(bot.id, guildId)) return res.status(403).json({ code: 50001, message: 'Missing Access' });
            const perms = await botServerPerms(bot.id, guildId);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.MANAGE_ROLES))
                return res.status(403).json({ code: 50013, message: 'Missing Permissions' });

            const [role, member] = await Promise.all([
                db.query('SELECT id FROM roles WHERE id = $1 AND server_id = $2', [roleId, guildId]),
                db.query('SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2', [guildId, userId]),
            ]);
            if (!role.rows.length) return res.status(404).json({ code: 10011, message: 'Unknown Role' });
            if (!member.rows.length) return res.status(404).json({ code: 10007, message: 'Unknown Member' });

            await db.query(
                `INSERT INTO user_roles (user_id, role_id, server_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                [userId, roleId, guildId]
            );

            // Emit GUILD_MEMBER_UPDATE
            const memberRow = await db.query(
                `SELECT u.id, u.username, u.avatar, u.is_bot, sm.nickname, sm.joined_at,
                        ARRAY_AGG(ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL) AS role_ids
                 FROM server_members sm JOIN users u ON u.id = sm.user_id
                 LEFT JOIN user_roles ur ON ur.user_id = sm.user_id AND ur.server_id = sm.server_id
                 WHERE sm.server_id = $1 AND sm.user_id = $2
                 GROUP BY u.id, u.username, u.avatar, u.is_bot, sm.nickname, sm.joined_at`,
                [guildId, userId]
            );
            const botGateway = req.app.get('botGateway');
            if (botGateway && memberRow.rows.length)
                botGateway.emit(guildId, 'GUILD_MEMBER_UPDATE', { guild_id: guildId, ...fmtMember(memberRow.rows[0]) });

            res.status(204).send();
        } catch (err) {
            log(tags.error, 'v1 addMemberRole:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }

    // DELETE /guilds/:guildId/members/:userId/roles/:roleId
    static async removeMemberRole(req, res) {
        try {
            const { guildId, userId, roleId } = req.params;
            const bot = req.botUser;

            if (!await botInGuild(bot.id, guildId)) return res.status(403).json({ code: 50001, message: 'Missing Access' });
            const perms = await botServerPerms(bot.id, guildId);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.MANAGE_ROLES))
                return res.status(403).json({ code: 50013, message: 'Missing Permissions' });

            await db.query(
                'DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2 AND server_id = $3',
                [userId, roleId, guildId]
            );

            const memberRow = await db.query(
                `SELECT u.id, u.username, u.avatar, u.is_bot, sm.nickname, sm.joined_at,
                        ARRAY_AGG(ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL) AS role_ids
                 FROM server_members sm JOIN users u ON u.id = sm.user_id
                 LEFT JOIN user_roles ur ON ur.user_id = sm.user_id AND ur.server_id = sm.server_id
                 WHERE sm.server_id = $1 AND sm.user_id = $2
                 GROUP BY u.id, u.username, u.avatar, u.is_bot, sm.nickname, sm.joined_at`,
                [guildId, userId]
            );
            const botGateway = req.app.get('botGateway');
            if (botGateway && memberRow.rows.length)
                botGateway.emit(guildId, 'GUILD_MEMBER_UPDATE', { guild_id: guildId, ...fmtMember(memberRow.rows[0]) });

            res.status(204).send();
        } catch (err) {
            log(tags.error, 'v1 removeMemberRole:', err);
            res.status(500).json({ code: 0, message: 'Internal server error' });
        }
    }
}
