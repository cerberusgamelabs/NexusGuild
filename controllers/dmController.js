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

            if (!content?.trim()) return res.status(400).json({ error: 'Content is required' });

            // Verify user is part of this DM
            const dmCheck = await db.query(
                'SELECT * FROM direct_messages WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
                [dmId, userId]
            );
            if (dmCheck.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

            const id = generateSnowflake();
            const result = await db.query(
                'INSERT INTO dm_messages (id, dm_id, sender_id, content) VALUES ($1, $2, $3, $4) RETURNING *',
                [id, dmId, userId, content.trim()]
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

            // Emit to both users in the DM room
            const io = req.app.get('io');
            if (io) {
                io.to(`dm:${dmId}`).emit('dm_message_created', message);
            }

            res.status(201).json({ message });
        } catch (error) {
            log(tags.error, 'Send DM message error:', error);
            res.status(500).json({ error: 'Failed to send message' });
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
}

export default DMController;