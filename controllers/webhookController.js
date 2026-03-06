// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/webhookController.js

import crypto from 'crypto';
import db from '../config/database.js';
import { generateSnowflake } from '#utils/functions';
import { log, tags } from '#utils/logging';
import { logAuditEvent } from '../utils/audit.js';

// Shared: verify userId has MANAGE_WEBHOOKS in the webhook's server.
// Returns the webhook row if allowed, null if not found, or throws with a res already sent.
async function _checkWebhookPerm(webhookId, userId, res) {
    const wh = await db.query(`SELECT * FROM webhooks WHERE id = $1`, [webhookId]);
    if (wh.rows.length === 0) {
        res.status(404).json({ error: 'Webhook not found' });
        return null;
    }
    const webhook = wh.rows[0];
    const ownerRes = await db.query(`SELECT owner_id FROM servers WHERE id = $1`, [webhook.server_id]);
    if (ownerRes.rows[0]?.owner_id !== userId) {
        const permRes = await db.query(
            `SELECT COALESCE(bit_or(r.permissions::bigint), 0)::text AS perms
             FROM roles r JOIN user_roles ur ON r.id = ur.role_id
             WHERE ur.user_id = $1 AND ur.server_id = $2`,
            [userId, webhook.server_id]
        );
        const evRes = await db.query(
            `SELECT permissions FROM roles WHERE server_id = $1 AND name = '@everyone'`,
            [webhook.server_id]
        );
        let perms = BigInt(permRes.rows[0]?.perms || '0');
        if (evRes.rows[0]) perms |= BigInt(evRes.rows[0].permissions);
        const MANAGE_WEBHOOKS = 1n << 29n;
        const ADMINISTRATOR   = 1n << 3n;
        if (!((perms & ADMINISTRATOR) === ADMINISTRATOR) && !((perms & MANAGE_WEBHOOKS) === MANAGE_WEBHOOKS)) {
            res.status(403).json({ error: 'Insufficient permissions' });
            return null;
        }
    }
    return webhook;
}

class WebhookController {
    static async listWebhooks(req, res) {
        try {
            const { serverId } = req.params;
            const result = await db.query(
                `SELECT w.*, c.name AS channel_name
                 FROM webhooks w
                 JOIN channels c ON w.channel_id = c.id
                 WHERE w.server_id = $1
                 ORDER BY w.created_at DESC`,
                [serverId]
            );
            res.json({ webhooks: result.rows });
        } catch (error) {
            log(tags.error, 'List webhooks error:', error);
            res.status(500).json({ error: 'Failed to list webhooks' });
        }
    }

    static async createWebhook(req, res) {
        try {
            const { serverId } = req.params;
            const { channelId, name } = req.body;
            const userId = req.session.user.id;

            if (!channelId || !name?.trim()) {
                return res.status(400).json({ error: 'channelId and name are required' });
            }

            const chanCheck = await db.query(
                `SELECT id FROM channels WHERE id = $1 AND server_id = $2`,
                [channelId, serverId]
            );
            if (chanCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Channel not found in this server' });
            }

            const id    = generateSnowflake();
            const token = crypto.randomBytes(32).toString('hex');

            const result = await db.query(
                `INSERT INTO webhooks (id, server_id, channel_id, name, token, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [id, serverId, channelId, name.trim(), token, userId]
            );

            await logAuditEvent(serverId, 'webhook_create', userId, id, 'webhook', { name: name.trim() });
            res.status(201).json({ webhook: result.rows[0] });
        } catch (error) {
            log(tags.error, 'Create webhook error:', error);
            res.status(500).json({ error: 'Failed to create webhook' });
        }
    }

    static async updateWebhook(req, res) {
        try {
            const { webhookId } = req.params;
            const userId = req.session.user.id;
            const { name, channelId, avatar } = req.body;

            const webhook = await _checkWebhookPerm(webhookId, userId, res);
            if (!webhook) return;

            // If channelId is being changed, verify it belongs to the same server
            if (channelId && channelId !== webhook.channel_id) {
                const chanCheck = await db.query(
                    `SELECT id FROM channels WHERE id = $1 AND server_id = $2`,
                    [channelId, webhook.server_id]
                );
                if (chanCheck.rows.length === 0) {
                    return res.status(404).json({ error: 'Channel not found in this server' });
                }
            }

            const result = await db.query(
                `UPDATE webhooks
                 SET name       = COALESCE($1, name),
                     channel_id = COALESCE($2, channel_id),
                     avatar     = $3
                 WHERE id = $4
                 RETURNING *`,
                [name?.trim() || null, channelId || null, avatar?.trim() || null, webhookId]
            );

            await logAuditEvent(webhook.server_id, 'webhook_update', userId, webhookId, 'webhook', { name: result.rows[0].name });
            res.json({ webhook: result.rows[0] });
        } catch (error) {
            log(tags.error, 'Update webhook error:', error);
            res.status(500).json({ error: 'Failed to update webhook' });
        }
    }

    static async deleteWebhook(req, res) {
        try {
            const { webhookId } = req.params;
            const userId = req.session.user.id;

            const webhook = await _checkWebhookPerm(webhookId, userId, res);
            if (!webhook) return;

            await db.query(`DELETE FROM webhooks WHERE id = $1`, [webhookId]);
            await logAuditEvent(webhook.server_id, 'webhook_delete', userId, webhookId, 'webhook', { name: webhook.name });
            res.json({ message: 'Webhook deleted' });
        } catch (error) {
            log(tags.error, 'Delete webhook error:', error);
            res.status(500).json({ error: 'Failed to delete webhook' });
        }
    }

    static async executeWebhook(req, res) {
        try {
            const { webhookId, token } = req.params;
            const { content, username, avatar_url } = req.body;

            if (!content?.trim()) {
                return res.status(400).json({ error: 'content is required' });
            }

            const wh = await db.query(
                `SELECT * FROM webhooks WHERE id = $1 AND token = $2`,
                [webhookId, token]
            );
            if (wh.rows.length === 0) return res.status(401).json({ error: 'Invalid webhook or token' });

            const webhook      = wh.rows[0];
            const id           = generateSnowflake();
            const displayName  = username?.trim()  || webhook.name;
            const displayAvatar = avatar_url || webhook.avatar || null;

            const result = await db.query(
                `INSERT INTO messages (id, channel_id, user_id, content, webhook_id, display_name, display_avatar)
                 VALUES ($1, $2, NULL, $3, $4, $5, $6) RETURNING *`,
                [id, webhook.channel_id, content.trim(), webhookId, displayName, displayAvatar]
            );

            const message = {
                ...result.rows[0],
                username:  displayName,
                avatar:    displayAvatar,
                is_pinned: false,
            };

            const io = req.app.get('io');
            if (io) {
                io.to(`channel:${webhook.channel_id}`).emit('message_created', message);
                io.to(`server:${webhook.server_id}`).emit('channel_notification', {
                    channelId: webhook.channel_id,
                    serverId:  webhook.server_id,
                    authorId:  null,
                    content:   content.trim(),
                });
            }

            res.status(204).end();
        } catch (error) {
            log(tags.error, 'Execute webhook error:', error);
            res.status(500).json({ error: 'Failed to execute webhook' });
        }
    }
}

export default WebhookController;
