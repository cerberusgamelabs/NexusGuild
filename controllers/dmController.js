// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/dmController.js

import db from '../config/database.js';
import { log, tags } from '#utils/logging';
import { generateSnowflake } from '../utils/functions.js';

class DMController {

    // GET /api/dm — list all DM conversations for the current user
    static async getConversations(req, res) {
        try {
            const userId = req.session.user.id;

            const result = await db.query(
                `SELECT
                    dm.id,
                    dm.last_message_at,
                    dm.created_at,
                    CASE WHEN dm.user1_id = $1 THEN dm.user2_id ELSE dm.user1_id END AS partner_id,
                    u.username AS partner_username,
                    u.avatar   AS partner_avatar,
                    u.status   AS partner_status,
                    (SELECT content FROM dm_messages WHERE dm_id = dm.id ORDER BY created_at DESC LIMIT 1) AS last_message
                 FROM direct_messages dm
                 JOIN users u ON u.id = CASE WHEN dm.user1_id = $1 THEN dm.user2_id ELSE dm.user1_id END
                 WHERE dm.user1_id = $1 OR dm.user2_id = $1
                 ORDER BY dm.last_message_at DESC`,
                [userId]
            );

            res.json({ conversations: result.rows });
        } catch (error) {
            log(tags.error, 'Get DM conversations error:', error);
            res.status(500).json({ error: 'Failed to get conversations' });
        }
    }

    // POST /api/dm — open (or get existing) DM conversation with { userId }
    static async openConversation(req, res) {
        try {
            const currentUserId = req.session.user.id;
            const { userId: targetUserId } = req.body;

            if (!targetUserId) return res.status(400).json({ error: 'userId is required' });
            if (targetUserId === currentUserId) return res.status(400).json({ error: 'Cannot DM yourself' });

            // Check target user exists
            const userCheck = await db.query('SELECT id, username, avatar, status FROM users WHERE id = $1', [targetUserId]);
            if (userCheck.rows.length === 0) return res.status(404).json({ error: 'User not found' });

            // Enforce consistent ordering so UNIQUE(user1_id, user2_id) always works
            const [user1, user2] = [currentUserId, targetUserId].sort();

            let existing = await db.query(
                'SELECT * FROM direct_messages WHERE user1_id = $1 AND user2_id = $2',
                [user1, user2]
            );

            if (existing.rows.length > 0) {
                return res.json({
                    conversation: {
                        ...existing.rows[0],
                        partner_id: targetUserId,
                        partner_username: userCheck.rows[0].username,
                        partner_avatar: userCheck.rows[0].avatar,
                        partner_status: userCheck.rows[0].status
                    }
                });
            }

            const id = generateSnowflake();
            const result = await db.query(
                'INSERT INTO direct_messages (id, user1_id, user2_id) VALUES ($1, $2, $3) RETURNING *',
                [id, user1, user2]
            );

            res.status(201).json({
                conversation: {
                    ...result.rows[0],
                    partner_id: targetUserId,
                    partner_username: userCheck.rows[0].username,
                    partner_avatar: userCheck.rows[0].avatar,
                    partner_status: userCheck.rows[0].status
                }
            });
        } catch (error) {
            log(tags.error, 'Open DM conversation error:', error);
            res.status(500).json({ error: 'Failed to open conversation' });
        }
    }

    // GET /api/dm/:dmId/messages
    static async getMessages(req, res) {
        try {
            const { dmId } = req.params;
            const userId = req.session.user.id;
            const { before, limit = 50 } = req.query;

            // Verify user is part of this DM
            const dmCheck = await db.query(
                'SELECT * FROM direct_messages WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
                [dmId, userId]
            );
            if (dmCheck.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

            const params = [dmId, parseInt(limit)];
            let whereClause = before ? 'AND m.id < $3' : '';
            if (before) params.push(before);

            const result = await db.query(
                `SELECT m.*, u.username, u.avatar
                 FROM dm_messages m
                 JOIN users u ON u.id = m.sender_id
                 WHERE m.dm_id = $1 ${whereClause}
                 ORDER BY m.created_at DESC
                 LIMIT $2`,
                params
            );

            res.json({ messages: result.rows.reverse() });
        } catch (error) {
            log(tags.error, 'Get DM messages error:', error);
            res.status(500).json({ error: 'Failed to get messages' });
        }
    }

    // POST /api/dm/:dmId/messages
    static async sendMessage(req, res) {
        try {
            const { dmId } = req.params;
            const userId = req.session.user.id;
            const { content } = req.body;

            // Build attachments array from uploaded files
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

            const trimmed = content?.trim() || '';
            if (!trimmed && !attachments) {
                return res.status(400).json({ error: 'Message must have content or attachments' });
            }

            // Verify user is part of this DM
            const dmCheck = await db.query(
                'SELECT * FROM direct_messages WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
                [dmId, userId]
            );
            if (dmCheck.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

            const id = generateSnowflake();
            const result = await db.query(
                'INSERT INTO dm_messages (id, dm_id, sender_id, content, attachments) VALUES ($1, $2, $3, $4, $5) RETURNING *',
                [id, dmId, userId, trimmed, attachments ? JSON.stringify(attachments) : null]
            );

            // Update last_message_at on the conversation
            await db.query(
                'UPDATE direct_messages SET last_message_at = NOW() WHERE id = $1',
                [dmId]
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

            // Emit to each user's personal room
            const io = req.app.get('io');
            if (io) {
                const dm = dmCheck.rows[0];
                const otherId = dm.user1_id === userId ? dm.user2_id : dm.user1_id;
                io.to(`user:${userId}`).emit('dm_message_created', message);
                io.to(`user:${otherId}`).emit('dm_message_created', message);
            }

            res.status(201).json({ message });
        } catch (error) {
            log(tags.error, 'Send DM message error:', error);
            res.status(500).json({ error: 'Failed to send message' });
        }
    }

    // POST /api/dm/:dmId/messages/:messageId/reactions
    static async addDMReaction(req, res) {
        try {
            const { dmId, messageId } = req.params;
            const { emoji } = req.body;
            const userId = req.session.user.id;

            if (!emoji?.trim()) return res.status(400).json({ error: 'Emoji is required' });

            // Verify user is part of this DM
            const dmCheck = await db.query(
                'SELECT * FROM direct_messages WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
                [dmId, userId]
            );
            if (dmCheck.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

            // Verify message belongs to this DM
            const msgCheck = await db.query(
                'SELECT id FROM dm_messages WHERE id = $1 AND dm_id = $2',
                [messageId, dmId]
            );
            if (msgCheck.rows.length === 0) return res.status(404).json({ error: 'Message not found' });

            const existing = await db.query(
                'SELECT id FROM dm_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
                [messageId, userId, emoji]
            );
            if (existing.rows.length > 0) {
                return res.status(400).json({ error: 'You already reacted with this emoji' });
            }

            await db.query(
                'INSERT INTO dm_reactions (id, message_id, user_id, emoji) VALUES ($1, $2, $3, $4)',
                [generateSnowflake(), messageId, userId, emoji]
            );

            const reactionsResult = await db.query(
                `SELECT emoji, COUNT(*) AS count,
                        ARRAY_AGG(JSON_BUILD_OBJECT('userId', user_id, 'username', u.username)) AS users
                 FROM dm_reactions r JOIN users u ON r.user_id = u.id
                 WHERE message_id = $1 GROUP BY emoji`,
                [messageId]
            );

            const io = req.app.get('io');
            if (io) {
                const dm = dmCheck.rows[0];
                const otherId = dm.user1_id === userId ? dm.user2_id : dm.user1_id;
                const payload = { messageId, dmId, reactions: reactionsResult.rows };
                io.to(`user:${userId}`).emit('dm_reaction_added', payload);
                io.to(`user:${otherId}`).emit('dm_reaction_added', payload);
            }

            res.json({ reactions: reactionsResult.rows });
        } catch (error) {
            log(tags.error, 'Add DM reaction error:', error);
            res.status(500).json({ error: 'Failed to add reaction' });
        }
    }

    // DELETE /api/dm/:dmId/messages/:messageId/reactions
    static async removeDMReaction(req, res) {
        try {
            const { dmId, messageId } = req.params;
            const { emoji } = req.body;
            const userId = req.session.user.id;

            if (!emoji?.trim()) return res.status(400).json({ error: 'Emoji is required' });

            const dmCheck = await db.query(
                'SELECT * FROM direct_messages WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
                [dmId, userId]
            );
            if (dmCheck.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

            await db.query(
                'DELETE FROM dm_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
                [messageId, userId, emoji]
            );

            const reactionsResult = await db.query(
                `SELECT emoji, COUNT(*) AS count,
                        ARRAY_AGG(JSON_BUILD_OBJECT('userId', user_id, 'username', u.username)) AS users
                 FROM dm_reactions r JOIN users u ON r.user_id = u.id
                 WHERE message_id = $1 GROUP BY emoji`,
                [messageId]
            );

            const io = req.app.get('io');
            if (io) {
                const dm = dmCheck.rows[0];
                const otherId = dm.user1_id === userId ? dm.user2_id : dm.user1_id;
                const payload = { messageId, dmId, reactions: reactionsResult.rows };
                io.to(`user:${userId}`).emit('dm_reaction_removed', payload);
                io.to(`user:${otherId}`).emit('dm_reaction_removed', payload);
            }

            res.json({ reactions: reactionsResult.rows });
        } catch (error) {
            log(tags.error, 'Remove DM reaction error:', error);
            res.status(500).json({ error: 'Failed to remove reaction' });
        }
    }

    // GET /api/dm/:dmId/messages/:messageId/reactions
    static async getDMReactions(req, res) {
        try {
            const { dmId, messageId } = req.params;
            const userId = req.session.user.id;

            const dmCheck = await db.query(
                'SELECT 1 FROM direct_messages WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
                [dmId, userId]
            );
            if (dmCheck.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

            const result = await db.query(
                `SELECT emoji, COUNT(*) AS count,
                        ARRAY_AGG(JSON_BUILD_OBJECT('userId', user_id, 'username', u.username)) AS users
                 FROM dm_reactions r JOIN users u ON r.user_id = u.id
                 WHERE message_id = $1 GROUP BY emoji`,
                [messageId]
            );
            res.json({ reactions: result.rows });
        } catch (error) {
            log(tags.error, 'Get DM reactions error:', error);
            res.status(500).json({ error: 'Failed to get reactions' });
        }
    }

    // GET /api/dm/users/search?q= — find users to start a DM with
    static async searchUsers(req, res) {
        try {
            const { q } = req.query;
            const userId = req.session.user.id;

            if (!q || q.trim().length < 2) return res.json({ users: [] });

            const result = await db.query(
                `SELECT id, username, avatar, status
                 FROM users
                 WHERE username ILIKE $1 AND id != $2
                 LIMIT 10`,
                [`%${q.trim()}%`, userId]
            );

            res.json({ users: result.rows });
        } catch (error) {
            log(tags.error, 'Search users error:', error);
            res.status(500).json({ error: 'Failed to search users' });
        }
    }

    static async editMessage(req, res) {
        try {
            const { dmId, messageId } = req.params;
            const { content } = req.body;
            const userId = req.session.user.id;

            if (!content?.trim()) {
                return res.status(400).json({ error: 'Content cannot be empty' });
            }

            // Verify message belongs to this DM and was sent by this user
            const check = await db.query(
                'SELECT * FROM dm_messages WHERE id = $1 AND dm_id = $2 AND sender_id = $3',
                [messageId, dmId, userId]
            );
            if (check.rows.length === 0) {
                return res.status(404).json({ error: 'Message not found or not yours' });
            }

            const result = await db.query(
                'UPDATE dm_messages SET content = $1, edited_at = NOW() WHERE id = $2 RETURNING *',
                [content.trim(), messageId]
            );

            const message = result.rows[0];

            // Notify the other participant in real-time
            const io = req.app.get('io');
            if (io) {
                io.to(`dm:${dmId}`).emit('dm_message_updated', message);
            }

            res.json({ message });
        } catch (error) {
            log(tags.error, 'Edit DM message error:', error);
            res.status(500).json({ error: 'Failed to edit message' });
        }
    }

    static async deleteMessage(req, res) {
        try {
            const { dmId, messageId } = req.params;
            const userId = req.session.user.id;

            // Verify message belongs to this DM and was sent by this user
            const check = await db.query(
                'SELECT * FROM dm_messages WHERE id = $1 AND dm_id = $2 AND sender_id = $3',
                [messageId, dmId, userId]
            );
            if (check.rows.length === 0) {
                return res.status(404).json({ error: 'Message not found or not yours' });
            }

            await db.query('DELETE FROM dm_messages WHERE id = $1', [messageId]);

            // Notify the other participant in real-time
            const io = req.app.get('io');
            if (io) {
                io.to(`dm:${dmId}`).emit('dm_message_deleted', { message_id: messageId, dm_id: dmId });
            }

            res.json({ success: true });
        } catch (error) {
            log(tags.error, 'Delete DM message error:', error);
            res.status(500).json({ error: 'Failed to delete message' });
        }
    }
}

export default DMController;