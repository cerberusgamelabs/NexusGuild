// Proprietary — Cerberus Game Labs. See LICENSE for terms.
import db from '../config/database.js';
import { generateSnowflake } from '#utils/functions';
import crypto from 'crypto';

// In-memory store: interactionId → { token, channelId, serverId, botId, expiresAt }
const pendingInteractions = new Map();

// Clean up expired interactions every 30 seconds
setInterval(() => {
    const now = Date.now();
    for (const [id, interaction] of pendingInteractions) {
        if (interaction.expiresAt < now) pendingInteractions.delete(id);
    }
}, 30_000);

export default class InteractionController {

    // GET /api/interactions/servers/:serverId/commands
    static async getServerCommands(req, res) {
        const { serverId } = req.params;
        const result = await db.query(
            `SELECT sc.id, sc.name, sc.description, sc.options, sc.bot_id,
                    u.username AS bot_name, u.avatar AS bot_avatar
             FROM slash_commands sc
             JOIN bots b ON b.id = sc.bot_id
             JOIN users u ON u.id = sc.bot_id
             JOIN server_members sm ON sm.user_id = sc.bot_id AND sm.server_id = $1
             WHERE sc.server_id = $1
             ORDER BY sc.name ASC`,
            [serverId]
        );
        res.json({ commands: result.rows });
    }

    // POST /api/interactions
    // Invokes a slash command — emits INTERACTION_CREATE to bot gateway,
    // or falls back to HTTP callback if configured and bot not connected.
    static async dispatch(req, res) {
        const userId = req.session.user.id;
        const { commandId, channelId, serverId, options } = req.body;

        if (!commandId || !channelId) {
            return res.status(400).json({ error: 'commandId and channelId are required' });
        }

        const cmdResult = await db.query(
            `SELECT sc.id, sc.name, sc.bot_id, b.callback_url, u.username AS bot_name
             FROM slash_commands sc
             JOIN bots b ON b.id = sc.bot_id
             JOIN users u ON u.id = sc.bot_id
             WHERE sc.id = $1`,
            [commandId]
        );
        if (!cmdResult.rows.length) return res.status(404).json({ error: 'Command not found' });
        const cmd = cmdResult.rows[0];

        // Load invoking member info
        const memberResult = await db.query(
            `SELECT u.id, u.username, u.avatar,
                    ARRAY_AGG(ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL) AS roles
             FROM users u
             LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.server_id = $1
             WHERE u.id = $2
             GROUP BY u.id`,
            [serverId, userId]
        );

        const interactionId    = generateSnowflake();
        const interactionToken = crypto.randomBytes(24).toString('hex');

        // Store pending interaction (3 second TTL for initial response; deferred extends to 15 min)
        pendingInteractions.set(interactionId, {
            token:     interactionToken,
            channelId,
            serverId,
            botId:     cmd.bot_id,
            botName:   cmd.bot_name,
            deferred:  false,
            expiresAt: Date.now() + 3000,
        });

        const payload = {
            id:         interactionId,
            type:       1,
            token:      interactionToken,
            channel_id: channelId,
            server_id:  serverId,
            member:     memberResult.rows[0] || { id: userId },
            data: {
                id:      cmd.id,
                name:    cmd.name,
                options: options || [],
            },
        };

        // Try gateway first
        const botGateway = req.app.get('botGateway');
        const deliveredViaGateway = botGateway?.emitToBot(cmd.bot_id, 'INTERACTION_CREATE', payload);

        if (deliveredViaGateway) {
            return res.json({ success: true, interactionId });
        }

        // Fall back to HTTP callback if configured
        if (cmd.callback_url) {
            try {
                const response = await fetch(cmd.callback_url, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(payload),
                    signal:  AbortSignal.timeout(5000),
                });

                if (response.ok) {
                    const botReply = await response.json().catch(() => null);
                    if (botReply?.content) {
                        await InteractionController._postBotMessage(req, cmd.bot_id, cmd.bot_name, channelId, serverId, botReply.content);
                    }
                    pendingInteractions.delete(interactionId);
                    return res.json({ success: true });
                }
            } catch (err) {
                if (err.name === 'TimeoutError') {
                    return res.status(504).json({ error: 'Bot callback timed out' });
                }
                throw err;
            }
        }

        pendingInteractions.delete(interactionId);
        return res.status(503).json({ error: 'Bot is not connected to the gateway and has no callback URL configured' });
    }

    // POST /api/interactions/:interactionId/:token/callback
    // Called by the bot to respond to an interaction (no bot auth needed — token IS the auth)
    // type 4 = immediate reply (default), type 5 = deferred (extends TTL to 15 min, no message yet)
    static async callback(req, res) {
        const { interactionId, token } = req.params;
        const { type = 4, content } = req.body;

        const interaction = pendingInteractions.get(interactionId);
        if (!interaction) return res.status(404).json({ error: 'Unknown or expired interaction' });
        if (interaction.token !== token) return res.status(401).json({ error: 'Invalid interaction token' });
        if (Date.now() > interaction.expiresAt) {
            pendingInteractions.delete(interactionId);
            return res.status(400).json({ error: 'Interaction token expired' });
        }

        // Deferred response — keep interaction alive for 15 minutes so bot can follow up
        if (type === 5) {
            interaction.deferred = true;
            interaction.expiresAt = Date.now() + 15 * 60 * 1000;
            return res.json({ success: true });
        }

        pendingInteractions.delete(interactionId);

        if (content) {
            await InteractionController._postBotMessage(
                req,
                interaction.botId,
                interaction.botName,
                interaction.channelId,
                interaction.serverId,
                content
            );
        }

        res.json({ success: true });
    }

    // POST /api/interactions/:interactionId/:token/followup
    // Bot posts a followup message after a deferred response (within 15 min window)
    static async followup(req, res) {
        const { interactionId, token } = req.params;
        const { content } = req.body;

        const interaction = pendingInteractions.get(interactionId);
        if (!interaction) return res.status(404).json({ error: 'Unknown or expired interaction' });
        if (interaction.token !== token) return res.status(401).json({ error: 'Invalid interaction token' });
        if (Date.now() > interaction.expiresAt) {
            pendingInteractions.delete(interactionId);
            return res.status(400).json({ error: 'Interaction token expired' });
        }
        if (!content?.trim()) return res.status(400).json({ error: 'content is required' });

        pendingInteractions.delete(interactionId);

        await InteractionController._postBotMessage(
            req,
            interaction.botId,
            interaction.botName,
            interaction.channelId,
            interaction.serverId,
            content
        );

        res.json({ success: true });
    }

    static async _postBotMessage(req, botId, botName, channelId, serverId, content) {
        const msgId = generateSnowflake();
        await db.query(
            `INSERT INTO messages (id, channel_id, user_id, content, display_name)
             VALUES ($1, $2, $3, $4, $5)`,
            [msgId, channelId, botId, content, botName]
        );
        const io = req.app.get('io');
        if (io) {
            const msgRow = await db.query(
                `SELECT m.*, u.username, u.avatar, u.is_bot FROM messages m
                 JOIN users u ON u.id = m.user_id WHERE m.id = $1`,
                [msgId]
            );
            if (msgRow.rows.length) {
                io.to(`channel:${channelId}`).emit('message_created', msgRow.rows[0]);
                if (serverId) {
                    io.to(`server:${serverId}`).emit('channel_notification', {
                        channelId, serverId, username: botName, content,
                    });
                    const botGateway = req.app.get('botGateway');
                    if (botGateway) botGateway.emit(serverId, 'MESSAGE_CREATE', msgRow.rows[0]);
                }
            }
        }
    }
}
