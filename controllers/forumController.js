// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/forumController.js

import db from '../config/database.js';
import { generateSnowflake } from '#utils/functions';
import { log, tags } from '#utils/logging';
import { PermissionHandler, PERMISSIONS } from '../config/permissions.js';
import { resolveChannelPerms } from '../utils/channelPerms.js';

class ForumController {

    static async listPosts(req, res) {
        try {
            const { channelId } = req.params;
            const userId = req.session.user.id;

            const chanRes = await db.query('SELECT server_id FROM channels WHERE id = $1', [channelId]);
            if (!chanRes.rows.length) return res.status(404).json({ error: 'Channel not found' });

            const perms = await resolveChannelPerms(userId, chanRes.rows[0].server_id, channelId);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.VIEW_CHANNEL))
                return res.status(403).json({ error: 'Missing VIEW_CHANNEL' });

            const result = await db.query(
                `SELECT fp.*, u.username, u.avatar,
                        (SELECT m.attachments
                         FROM messages m
                         WHERE m.post_id = fp.id
                         ORDER BY m.created_at ASC LIMIT 1) AS opener_attachments
                 FROM forum_posts fp
                 JOIN users u ON fp.user_id = u.id
                 WHERE fp.channel_id = $1
                 ORDER BY fp.last_reply_at DESC`,
                [channelId]
            );

            res.json({ posts: result.rows });
        } catch (err) {
            log(tags.error, 'listPosts error:', err);
            res.status(500).json({ error: 'Failed to load posts' });
        }
    }

    static async createPost(req, res) {
        try {
            const { channelId } = req.params;
            const { title, content } = req.body;
            const userId = req.session.user.id;

            const chanRes = await db.query('SELECT server_id, type FROM channels WHERE id = $1', [channelId]);
            if (!chanRes.rows.length) return res.status(404).json({ error: 'Channel not found' });
            const { server_id: serverId, type: channelType } = chanRes.rows[0];

            const perms = await resolveChannelPerms(userId, serverId, channelId);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.SEND_MESSAGES))
                return res.status(403).json({ error: 'Missing SEND_MESSAGES' });

            if (!title?.trim()) return res.status(400).json({ error: 'Post title required' });

            let attachments = null;
            if (req.files?.length > 0) {
                attachments = req.files.map(f => ({
                    filename: f.filename, originalName: f.originalname,
                    mimetype: f.mimetype, size: f.size, url: `/uploads/${f.filename}`
                }));
            }

            if (channelType === 'media' && !attachments)
                return res.status(400).json({ error: 'Media channel posts require an attachment' });
            if (!content && !attachments)
                return res.status(400).json({ error: 'Post must have content or an attachment' });

            const postId    = generateSnowflake();
            const messageId = generateSnowflake();

            await db.query(
                `INSERT INTO forum_posts (id, channel_id, user_id, title) VALUES ($1, $2, $3, $4)`,
                [postId, channelId, userId, title.trim()]
            );
            await db.query(
                `INSERT INTO messages (id, channel_id, user_id, content, attachments, post_id)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [messageId, channelId, userId, content || '', attachments ? JSON.stringify(attachments) : null, postId]
            );

            const userRes = await db.query('SELECT username, avatar FROM users WHERE id = $1', [userId]);
            const post = {
                id: postId, channel_id: channelId, user_id: userId,
                title: title.trim(), reply_count: 0, last_reply_at: new Date(), created_at: new Date(),
                username: userRes.rows[0].username, avatar: userRes.rows[0].avatar,
                opener_attachments: attachments ? JSON.stringify(attachments) : null,
            };

            const io = req.app.get('io');
            if (io) {
                io.to(`channel:${channelId}`).emit('forum_post_created', { channelId, post });
                io.to(`server:${serverId}`).emit('channel_notification', {
                    channelId, serverId, messageId,
                    username: userRes.rows[0].username, content: title.trim(),
                });
            }

            log(tags.success, `Forum post "${title.trim()}" created in channel ${channelId}`);
            res.status(201).json({ post });
        } catch (err) {
            log(tags.error, 'createPost error:', err);
            res.status(500).json({ error: 'Failed to create post' });
        }
    }

    static async getPostMessages(req, res) {
        try {
            const { postId } = req.params;
            const userId = req.session.user.id;

            const postRes = await db.query('SELECT * FROM forum_posts WHERE id = $1', [postId]);
            if (!postRes.rows.length) return res.status(404).json({ error: 'Post not found' });
            const post = postRes.rows[0];

            const chanRes = await db.query('SELECT server_id FROM channels WHERE id = $1', [post.channel_id]);
            const perms = await resolveChannelPerms(userId, chanRes.rows[0].server_id, post.channel_id);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.VIEW_CHANNEL))
                return res.status(403).json({ error: 'Missing VIEW_CHANNEL' });

            const result = await db.query(
                `SELECT m.*, u.username, u.avatar
                 FROM messages m JOIN users u ON m.user_id = u.id
                 WHERE m.post_id = $1
                 ORDER BY m.created_at ASC`,
                [postId]
            );

            res.json({ post, messages: result.rows });
        } catch (err) {
            log(tags.error, 'getPostMessages error:', err);
            res.status(500).json({ error: 'Failed to load post' });
        }
    }

    static async replyToPost(req, res) {
        try {
            const { postId } = req.params;
            const { content } = req.body;
            const userId = req.session.user.id;

            const postRes = await db.query('SELECT * FROM forum_posts WHERE id = $1', [postId]);
            if (!postRes.rows.length) return res.status(404).json({ error: 'Post not found' });
            const post = postRes.rows[0];

            const chanRes = await db.query('SELECT server_id FROM channels WHERE id = $1', [post.channel_id]);
            const serverId = chanRes.rows[0].server_id;
            const perms = await resolveChannelPerms(userId, serverId, post.channel_id);
            if (!PermissionHandler.hasPermission(perms, PERMISSIONS.SEND_MESSAGES))
                return res.status(403).json({ error: 'Missing SEND_MESSAGES' });

            let attachments = null;
            if (req.files?.length > 0) {
                attachments = req.files.map(f => ({
                    filename: f.filename, originalName: f.originalname,
                    mimetype: f.mimetype, size: f.size, url: `/uploads/${f.filename}`
                }));
            }
            if (!content && !attachments)
                return res.status(400).json({ error: 'Reply must have content or an attachment' });

            const messageId = generateSnowflake();
            await db.query(
                `INSERT INTO messages (id, channel_id, user_id, content, attachments, post_id)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [messageId, post.channel_id, userId, content || '', attachments ? JSON.stringify(attachments) : null, postId]
            );
            await db.query(
                `UPDATE forum_posts SET reply_count = reply_count + 1, last_reply_at = NOW() WHERE id = $1`,
                [postId]
            );

            const userRes = await db.query('SELECT username, avatar FROM users WHERE id = $1', [userId]);
            const message = {
                id: messageId, post_id: postId, channel_id: post.channel_id, user_id: userId,
                content: content || '', attachments, created_at: new Date(),
                username: userRes.rows[0].username, avatar: userRes.rows[0].avatar,
            };

            const io = req.app.get('io');
            if (io) {
                io.to(`channel:${post.channel_id}`).emit('forum_reply_added', {
                    postId, channelId: post.channel_id, message
                });
                io.to(`server:${serverId}`).emit('channel_notification', {
                    channelId: post.channel_id, serverId, messageId,
                    username: userRes.rows[0].username, content: content || '',
                });
            }

            res.status(201).json({ message });
        } catch (err) {
            log(tags.error, 'replyToPost error:', err);
            res.status(500).json({ error: 'Failed to post reply' });
        }
    }

    static async deletePost(req, res) {
        try {
            const { postId } = req.params;
            const userId = req.session.user.id;

            const postRes = await db.query('SELECT * FROM forum_posts WHERE id = $1', [postId]);
            if (!postRes.rows.length) return res.status(404).json({ error: 'Post not found' });
            const post = postRes.rows[0];

            if (post.user_id !== userId) {
                const chanRes = await db.query('SELECT server_id FROM channels WHERE id = $1', [post.channel_id]);
                const perms = await resolveChannelPerms(userId, chanRes.rows[0].server_id, post.channel_id);
                if (!PermissionHandler.hasPermission(perms, PERMISSIONS.MANAGE_MESSAGES))
                    return res.status(403).json({ error: 'Cannot delete this post' });
            }

            await db.query('DELETE FROM forum_posts WHERE id = $1', [postId]);

            const io = req.app.get('io');
            if (io) io.to(`channel:${post.channel_id}`).emit('forum_post_deleted', {
                postId, channelId: post.channel_id
            });

            log(tags.warning, `Forum post ${postId} deleted`);
            res.json({ ok: true });
        } catch (err) {
            log(tags.error, 'deletePost error:', err);
            res.status(500).json({ error: 'Failed to delete post' });
        }
    }
}

export default ForumController;
