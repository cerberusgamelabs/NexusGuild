// File Location: /config/socket.js

import { Server } from "socket.io";
import { log, tags } from "#utils/logging";

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

    io.on('connection', (socket) => {
        log(tags.info, `User connected: ${socket.username} (${socket.userId})`);

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
                userId: socket.userId
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

        socket.on('webrtc_offer', (data) => {
            socket.to(data.targetSocketId).emit('webrtc_offer', {
                offer: data.offer,
                fromSocketId: socket.id
            });
        });

        socket.on('webrtc_answer', (data) => {
            socket.to(data.targetSocketId).emit('webrtc_answer', {
                answer: data.answer,
                fromSocketId: socket.id
            });
        });

        socket.on('webrtc_ice_candidate', (data) => {
            socket.to(data.targetSocketId).emit('webrtc_ice_candidate', {
                candidate: data.candidate,
                fromSocketId: socket.id
            });
        });

        socket.on('disconnect', () => {
            log(tags.warning, `User disconnected: ${socket.username} (${socket.userId})`);
            onlineUsers.delete(socket.userId);

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

            io.emit('presence_update', {
                userId: socket.userId,
                username: socket.username,
                status: 'offline'
            });
        });
    });

    return io;
};

export default initializeSocket;