// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// Bot gateway — Socket.io /bot-gateway namespace
// Bots connect with: io('/bot-gateway', { auth: { token: 'BOT_TOKEN' } })

import db from '../config/database.js';
import { log, tags } from '#utils/logging';

const GATEWAY_EVENTS = new Set([
    'MESSAGE_CREATE', 'MESSAGE_UPDATE', 'MESSAGE_DELETE',
    'MEMBER_JOIN', 'MEMBER_LEAVE',
    'CHANNEL_CREATE', 'CHANNEL_UPDATE', 'CHANNEL_DELETE',
    'ROLE_UPDATE', 'INTERACTION_CREATE',
]);

// botId → socket (only one connection per bot)
const connectedBots = new Map();

export function initBotGateway(io) {
    const gateway = io.of('/bot-gateway');

    // Auth middleware
    gateway.use(async (socket, next) => {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        if (!token) return next(new Error('Missing bot token'));

        try {
            const result = await db.query(
                `SELECT b.id, b.owner_id, u.username AS name
                 FROM bots b JOIN users u ON u.id = b.id
                 WHERE b.token = $1`,
                [token]
            );
            if (!result.rows.length) return next(new Error('Invalid bot token'));
            socket.botUser = result.rows[0];
            next();
        } catch {
            next(new Error('Authentication error'));
        }
    });

    gateway.on('connection', async (socket) => {
        const bot = socket.botUser;
        log(tags.info, `Bot connected to gateway: ${bot.name} (${bot.id})`);

        // Only one socket per bot — disconnect any previous connection
        const existing = connectedBots.get(bot.id);
        if (existing) existing.disconnect(true);
        connectedBots.set(bot.id, socket);

        // Join rooms for all servers the bot is in
        let botServerIds = [];
        try {
            const servers = await db.query(
                `SELECT server_id FROM server_members WHERE user_id = $1`, [bot.id]
            );
            botServerIds = servers.rows.map(r => r.server_id);
            for (const server_id of botServerIds) socket.join(`server:${server_id}`);
        } catch (err) {
            log(tags.error, 'Gateway: failed to load bot servers:', err);
        }

        // Broadcast online presence to all servers the bot is in
        for (const serverId of botServerIds) {
            io.to(`server:${serverId}`).emit('presence_update', {
                userId: bot.id,
                username: bot.name,
                status: 'online'
            });
        }

        // Send READY event
        socket.emit('READY', { bot: { id: bot.id, name: bot.name }, v: 1 });

        // Heartbeat
        socket.on('HEARTBEAT', () => socket.emit('HEARTBEAT_ACK'));

        socket.on('disconnect', () => {
            if (connectedBots.get(bot.id) === socket) connectedBots.delete(bot.id);
            log(tags.info, `Bot disconnected from gateway: ${bot.name} (${bot.id})`);

            // Broadcast offline presence
            for (const serverId of botServerIds) {
                io.to(`server:${serverId}`).emit('presence_update', {
                    userId: bot.id,
                    username: bot.name,
                    status: 'offline'
                });
            }
        });
    });

    return {
        // Broadcast to all bots in a server room
        emit(serverId, event, data) {
            gateway.to(`server:${serverId}`).emit(event, data);
        },
        // Send to a specific bot (returns true if delivered, false if not connected)
        emitToBot(botId, event, data) {
            const socket = connectedBots.get(botId);
            if (!socket) return false;
            socket.emit(event, data);
            return true;
        },
        isConnected(botId) {
            return connectedBots.has(botId);
        },
    };
}
