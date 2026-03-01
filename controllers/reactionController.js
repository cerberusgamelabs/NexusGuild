// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/reactionController.js

import db from "../config/database.js";
import { generateSnowflake } from "#utils/functions";
import { log, tags } from "#utils/logging";
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ReactionController {
    /**
     * Add a reaction to a message
     * POST /api/messages/:messageId/reactions
     */
    static async addReaction(req, res) {
        try {
            const { messageId } = req.params;
            const { emoji } = req.body;  // Can be unicode emoji or "custom:server_id:name"
            const userId = req.session.user.id;

            if (!emoji || !emoji.trim()) {
                return res.status(400).json({ error: 'Emoji is required' });
            }

            // Check if message exists and get channel/server info
            const messageCheck = await db.query(
                `SELECT m.id, m.channel_id, c.server_id
                 FROM messages m
                 JOIN channels c ON m.channel_id = c.id
                 WHERE m.id = $1`,
                [messageId]
            );

            if (messageCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Message not found' });
            }

            const { channel_id: channelId, server_id: serverId } = messageCheck.rows[0];

            // Verify user is a member of the server
            const memberCheck = await db.query(
                'SELECT id FROM server_members WHERE server_id = $1 AND user_id = $2',
                [serverId, userId]
            );

            if (memberCheck.rows.length === 0) {
                return res.status(403).json({ error: 'Not a member of this server' });
            }

            // Check if reaction already exists
            const existingReaction = await db.query(
                'SELECT id FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
                [messageId, userId, emoji]
            );

            if (existingReaction.rows.length > 0) {
                return res.status(400).json({ error: 'You already reacted with this emoji' });
            }

            const id = generateSnowflake();

            await db.query(
                `INSERT INTO reactions (id, message_id, user_id, emoji)
                 VALUES ($1, $2, $3, $4)`,
                [id, messageId, userId, emoji]
            );

            // Get updated reaction counts
            const reactionsResult = await db.query(
                `SELECT emoji, COUNT(*) as count,
                        ARRAY_AGG(JSON_BUILD_OBJECT('userId', user_id, 'username', u.username)) as users
                 FROM reactions r
                 JOIN users u ON r.user_id = u.id
                 WHERE message_id = $1
                 GROUP BY emoji`,
                [messageId]
            );

            // Broadcast to channel
            const io = req.app.get('io');
            if (io) {
                io.to(`channel:${channelId}`).emit('reaction_added', {
                    messageId,
                    emoji,
                    userId,
                    username: req.session.user.username,
                    reactions: reactionsResult.rows
                });
            }

            log(tags.info, `User ${userId} reacted to message ${messageId} with ${emoji}`);
            res.json({
                message: 'Reaction added',
                reactions: reactionsResult.rows
            });
        } catch (error) {
            log(tags.error, 'Add reaction error:', error);
            res.status(500).json({ error: 'Failed to add reaction' });
        }
    }

    /**
     * Remove a reaction from a message
     * DELETE /api/messages/:messageId/reactions
     */
    static async removeReaction(req, res) {
        try {
            const { messageId } = req.params;
            const { emoji } = req.body;
            const userId = req.session.user.id;

            if (!emoji || !emoji.trim()) {
                return res.status(400).json({ error: 'Emoji is required' });
            }

            // Get channel info before deletion
            const messageCheck = await db.query(
                `SELECT m.id, m.channel_id
                 FROM messages m
                 WHERE m.id = $1`,
                [messageId]
            );

            if (messageCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Message not found' });
            }

            const { channel_id: channelId } = messageCheck.rows[0];

            // Delete the reaction
            const result = await db.query(
                `DELETE FROM reactions
                 WHERE message_id = $1 AND user_id = $2 AND emoji = $3
                 RETURNING id`,
                [messageId, userId, emoji]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Reaction not found' });
            }

            // Get updated reaction counts
            const reactionsResult = await db.query(
                `SELECT emoji, COUNT(*) as count,
                        ARRAY_AGG(JSON_BUILD_OBJECT('userId', user_id, 'username', u.username)) as users
                 FROM reactions r
                 JOIN users u ON r.user_id = u.id
                 WHERE message_id = $1
                 GROUP BY emoji`,
                [messageId]
            );

            // Broadcast to channel
            const io = req.app.get('io');
            if (io) {
                io.to(`channel:${channelId}`).emit('reaction_removed', {
                    messageId,
                    emoji,
                    userId,
                    reactions: reactionsResult.rows
                });
            }

            log(tags.info, `User ${userId} removed reaction ${emoji} from message ${messageId}`);
            res.json({
                message: 'Reaction removed',
                reactions: reactionsResult.rows
            });
        } catch (error) {
            log(tags.error, 'Remove reaction error:', error);
            res.status(500).json({ error: 'Failed to remove reaction' });
        }
    }

    /**
     * Get all reactions for a message
     * GET /api/messages/:messageId/reactions
     */
    static async getMessageReactions(req, res) {
        try {
            const { messageId } = req.params;

            const result = await db.query(
                `SELECT emoji, COUNT(*) as count,
                        ARRAY_AGG(JSON_BUILD_OBJECT('userId', user_id, 'username', u.username)) as users
                 FROM reactions r
                 JOIN users u ON r.user_id = u.id
                 WHERE message_id = $1
                 GROUP BY emoji`,
                [messageId]
            );

            res.json({ reactions: result.rows });
        } catch (error) {
            log(tags.error, 'Get reactions error:', error);
            res.status(500).json({ error: 'Failed to get reactions' });
        }
    }

    /**
     * Get custom emojis for a server (includes global emojis)
     * GET /api/servers/:serverId/emojis
     */
    static async getServerEmojis(req, res) {
        try {
            const { serverId } = req.params;

            // Get both server-specific and global emojis
            const result = await db.query(
                `SELECT id, server_id, name, filename, created_at
                 FROM custom_emojis
                 WHERE server_id = $1 OR server_id IS NULL
                 ORDER BY server_id NULLS FIRST, name`,
                [serverId]
            );

            // Separate global and server emojis
            const global = result.rows.filter(e => e.server_id === null);
            const server = result.rows.filter(e => e.server_id === serverId);

            res.json({
                global,
                server
            });
        } catch (error) {
            log(tags.error, 'Get emojis error:', error);
            res.status(500).json({ error: 'Failed to get emojis' });
        }
    }

    /**
     * Upload a custom emoji
     * POST /api/servers/:serverId/emojis
     * Requires MANAGE_GUILD_EXPRESSIONS (checked by middleware)
     */
    static async uploadCustomEmoji(req, res) {
        try {
            const { serverId } = req.params;
            const { name } = req.body;
            const userId = req.session.user.id;

            if (!name || !name.trim()) {
                return res.status(400).json({ error: 'Emoji name is required' });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'Emoji image is required' });
            }

            const id = generateSnowflake();

            const result = await db.query(
                `INSERT INTO custom_emojis (id, server_id, name, filename, created_by)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [id, serverId, name.trim(), req.file.filename, userId]
            );

            const io = req.app.get('io');
            if (io) io.to(`server:${serverId}`).emit('server_emojis_updated', { serverId });

            log(tags.success, `Custom emoji "${name}" uploaded to server ${serverId}`);
            res.status(201).json({
                message: 'Custom emoji uploaded',
                emoji: result.rows[0]
            });
        } catch (error) {
            if (error.constraint === 'custom_emojis_server_id_name_key') {
                return res.status(400).json({ error: 'An emoji with this name already exists in this server' });
            }
            log(tags.error, 'Upload emoji error:', error);
            res.status(500).json({ error: 'Failed to upload emoji' });
        }
    }

    /**
     * Delete a custom emoji
     * DELETE /api/servers/:serverId/emojis/:emojiId
     * Requires MANAGE_GUILD_EXPRESSIONS (checked by middleware)
     */
    static async deleteCustomEmoji(req, res) {
        try {
            const { serverId, emojiId } = req.params;

            const emojiCheck = await db.query(
                'SELECT id, filename FROM custom_emojis WHERE id = $1 AND server_id = $2',
                [emojiId, serverId]
            );

            if (emojiCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Emoji not found' });
            }

            const { filename } = emojiCheck.rows[0];

            await db.query('DELETE FROM custom_emojis WHERE id = $1', [emojiId]);

            // Delete file from disk (non-blocking, best-effort)
            const filePath = path.join(__dirname, `../public/img/emoji/${serverId}/${filename}`);
            fs.unlink(filePath, (err) => {
                if (err) log(tags.warning, `Could not delete emoji file: ${filePath}`);
            });

            const io = req.app.get('io');
            if (io) io.to(`server:${serverId}`).emit('server_emojis_updated', { serverId });

            log(tags.success, `Custom emoji ${emojiId} deleted from server ${serverId}`);
            res.status(204).send();
        } catch (error) {
            log(tags.error, 'Delete emoji error:', error);
            res.status(500).json({ error: 'Failed to delete emoji' });
        }
    }
}

export default ReactionController;