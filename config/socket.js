// Proprietary — Cerberus Game Labs. See LICENSE for terms.
﻿// File Location: /config/socket.js

import { Server } from "socket.io";
import { log, tags } from "#utils/logging";
import db from "./database.js";

const initializeSocket = (server, sessionMiddleware) => {
    const io = new Server(server, {
        cors: {
            origin: process.env.CLIENT_URL || "http://localhost:3000",
            credentials: true
        },
        pingTimeout: 60000,
        pingInterval: 25000
    });

    io.use((socket, next) => {
        sessionMiddleware(socket.request, {}, next);
    });

    io.use((socket, next) => {
        const session = socket.request.session;
        if (session && session.user) {
            socket.userId = session.user.id;
            socket.username = session.user.username;
            next();
        } else {
            next(new Error('Authentication error'));
        }
    });

    const onlineUsers = new Map();
    const voiceStates = new Map();
    const dmVoiceStates = new Map(); // Map<dmId, Set<userId>>

    // Returns all member IDs for a 1:1 DM or group DM
    async function getDmMemberIds(dmId) {
        const r1 = await db.query(
            `SELECT user1_id, user2_id FROM direct_messages WHERE id = $1`, [dmId]);
        if (r1.rows.length) return [r1.rows[0].user1_id, r1.rows[0].user2_id];
        const r2 = await db.query(
            `SELECT user_id FROM group_dm_members WHERE group_dm_id = $1`, [dmId]);
        return r2.rows.map(r => r.user_id);
    }

    io.on('connection', (socket) => {
        log(tags.info, `User connected: ${socket.username} (${socket.userId})`);

        // Personal room — allows targeted emits (e.g. DM notifications) without
        // requiring the recipient to have manually joined a conversation room.
        socket.join(`user:${socket.userId}`);

        onlineUsers.set(socket.userId, {
            socketId: socket.id,
            username: socket.username,
            status: 'online'
        });

        io.emit('presence_update', {
            userId: socket.userId,
            username: socket.username,
            status: 'online'
        });

        socket.on('join_server', async (serverId) => {
            socket.join(`server:${serverId}`);
            log(tags.info, `${socket.username} joined server ${serverId}`);
            socket.to(`server:${serverId}`).emit('user_joined', {
                userId: socket.userId,
                username: socket.username,
                serverId
            });
        });

        socket.on('leave_server', (serverId) => {
            socket.leave(`server:${serverId}`);
            log(tags.info, `${socket.username} left server ${serverId}`);
            socket.to(`server:${serverId}`).emit('user_left', {
                userId: socket.userId,
                username: socket.username,
                serverId
            });
        });

        socket.on('join_channel', (channelId) => {
            socket.join(`channel:${channelId}`);
            log(tags.info, `${socket.username} joined channel ${channelId}`);
        });

        socket.on('leave_channel', (channelId) => {
            socket.leave(`channel:${channelId}`);
        });

        socket.on('send_message', async (data) => {
            const { channelId, content, attachments } = data;
            io.to(`channel:${channelId}`).emit('message_created', {
                id: Date.now().toString(),
                channelId,
                userId: socket.userId,
                username: socket.username,
                content,
                attachments: attachments || [],
                createdAt: new Date()
            });
        });

        socket.on('start_typing', (channelId) => {
            socket.to(`channel:${channelId}`).emit('user_typing', {
                channelId,
                userId: socket.userId,
                username: socket.username
            });
        });

        socket.on('stop_typing', (channelId) => {
            socket.to(`channel:${channelId}`).emit('user_stop_typing', {
                channelId,
                userId: socket.userId,
                username: socket.username
            });
        });

        socket.on('join_voice', (data) => {
            const { channelId, serverId } = data;
            socket.join(`voice:${channelId}`);
            voiceStates.set(socket.userId, { channelId, serverId, muted: false, deafened: false });
            io.to(`server:${serverId}`).emit('voice_state_update', {
                userId: socket.userId,
                username: socket.username,
                channelId,
                joined: true
            });
        });

        socket.on('leave_voice', (data) => {
            const { channelId, serverId } = data;
            socket.leave(`voice:${channelId}`);
            voiceStates.delete(socket.userId);
            io.to(`server:${serverId}`).emit('voice_state_update', {
                userId: socket.userId,
                username: socket.username,
                channelId,
                joined: false
            });
        });

        socket.on('voice_state_change', (data) => {
            const { muted, deafened } = data;
            const voiceState = voiceStates.get(socket.userId);
            if (voiceState) {
                voiceState.muted = muted;
                voiceState.deafened = deafened;
                io.to(`voice:${voiceState.channelId}`).emit('user_voice_state', {
                    userId: socket.userId,
                    muted,
                    deafened
                });
            }
        });

        socket.on('join_dm_voice', async ({ dmId }) => {
            try {
                const memberIds = await getDmMemberIds(dmId);
                if (!memberIds.includes(socket.userId)) return;

                if (!dmVoiceStates.has(dmId)) dmVoiceStates.set(dmId, new Set());
                dmVoiceStates.get(dmId).add(socket.userId);

                const payload = { dmId, userId: socket.userId, username: socket.username, joined: true };
                for (const uid of memberIds) io.to(`user:${uid}`).emit('dm_voice_state_update', payload);
                log(tags.info, `${socket.username} joined DM voice ${dmId}`);
            } catch (err) {
                log(tags.error, 'join_dm_voice error:', err);
            }
        });

        socket.on('leave_dm_voice', async ({ dmId }) => {
            try {
                const memberIds = await getDmMemberIds(dmId);
                if (!memberIds.includes(socket.userId)) return;

                if (dmVoiceStates.has(dmId)) {
                    dmVoiceStates.get(dmId).delete(socket.userId);
                    if (dmVoiceStates.get(dmId).size === 0) dmVoiceStates.delete(dmId);
                }

                const payload = { dmId, userId: socket.userId, username: socket.username, joined: false };
                for (const uid of memberIds) io.to(`user:${uid}`).emit('dm_voice_state_update', payload);
                log(tags.info, `${socket.username} left DM voice ${dmId}`);
            } catch (err) {
                log(tags.error, 'leave_dm_voice error:', err);
            }
        });

        socket.on('disconnect', async () => {
            log(tags.warning, `User disconnected: ${socket.username} (${socket.userId})`);
            onlineUsers.delete(socket.userId);

            // Snapshot read positions for unvisited channels so offline messages
            // are counted as unread when the user next logs in.
            db.query(
                `INSERT INTO user_channel_reads (user_id, channel_id, last_read_message_id)
                 SELECT $1, c.id, m_last.id
                 FROM server_members sm
                 JOIN channels c ON c.server_id = sm.server_id AND c.type IN ('text', 'announcement', 'forum', 'media')
                 JOIN LATERAL (
                     SELECT id FROM messages
                     WHERE channel_id = c.id
                     ORDER BY created_at DESC
                     LIMIT 1
                 ) m_last ON true
                 WHERE sm.user_id = $2
                 ON CONFLICT (user_id, channel_id) DO NOTHING`,
                [socket.userId, socket.userId]
            ).catch(err => log(tags.error, 'Disconnect snapshot error:', err));

            const voiceState = voiceStates.get(socket.userId);
            if (voiceState) {
                io.to(`server:${voiceState.serverId}`).emit('voice_state_update', {
                    userId: socket.userId,
                    username: socket.username,
                    channelId: voiceState.channelId,
                    joined: false
                });
                voiceStates.delete(socket.userId);
            }

            // Clean up DM voice state
            for (const [dmId, users] of [...dmVoiceStates.entries()]) {
                if (!users.has(socket.userId)) continue;
                users.delete(socket.userId);
                if (users.size === 0) dmVoiceStates.delete(dmId);
                getDmMemberIds(dmId).then(memberIds => {
                    const payload = { dmId, userId: socket.userId, username: socket.username, joined: false };
                    for (const uid of memberIds) io.to(`user:${uid}`).emit('dm_voice_state_update', payload);
                }).catch(err => log(tags.error, 'DM voice disconnect cleanup error:', err));
            }

            io.emit('presence_update', {
                userId: socket.userId,
                username: socket.username,
                status: 'offline'
            });
        });

        // ── DM Rooms ──────────────────────────────────────────────────────
        socket.on('join_dm', (dmId) => {
            socket.join(`dm:${dmId}`);
            log(tags.info, `${socket.username} joined DM room ${dmId}`);
        });

        socket.on('leave_dm', (dmId) => {
            socket.leave(`dm:${dmId}`);
        });

        socket.on('dm_typing', (dmId) => {
            socket.to(`dm:${dmId}`).emit('dm_typing', {
                dmId,
                userId: socket.userId,
                username: socket.username
            });
        });

        socket.on('dm_stop_typing', (dmId) => {
            socket.to(`dm:${dmId}`).emit('dm_stop_typing', {
                dmId,
                userId: socket.userId
            });
        });
    });

    return io;
};

export default initializeSocket;