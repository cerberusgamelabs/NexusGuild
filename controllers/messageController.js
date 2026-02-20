// File Location: /controllers/messageController.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from "../config/database.js";
import { generateSnowflake } from "#utils/functions";
import { log, tags } from "#utils/logging";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MessageController {
    static async getChannelMessages(req, res) {
        try {
            const { channelId } = req.params;
            const { limit = 50, before } = req.query;

            let query = `
                SELECT m.*, u.username, u.avatar
                FROM messages m
                JOIN users u ON m.user_id = u.id
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
                return res.status(403).json({ error: 'You can only delete your own messages' });
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