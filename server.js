// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /server.js

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import http from "http";
import session from "express-session";
import connectPgSimple from 'connect-pg-simple';
const pgSession = connectPgSimple(session);
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { log, tags } from "#utils/logging";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import db from "./config/database.js";
import initializeSocket from "./config/socket.js";
import { PERMISSIONS } from "./config/permissions.js";

import authRoutes from "./routes/auth.js";
import serverRoutes from "./routes/servers.js";
import channelRoutes from "./routes/channels.js";
import messageRoutes from "./routes/messages.js";
import reactionRoutes from './routes/reactions.js';
import dmRoutes from "./routes/dm.js";
import userRoutes from "./routes/users.js";
import importRoutes from "./routes/import.js";
import forumRoutes from "./routes/forum.js";
import voiceRoutes from "./routes/voice.js";

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

const startServer = async () => {
    try {
        await db.initDB();

        const sessionMiddleware = session({
            store: new pgSession({
                pool: db.pool,
                tableName: 'session'
            }),
            secret: process.env.SESSION_SECRET || 'nexusguild-secret-key',
            resave: false,
            saveUninitialized: false,
            cookie: {
                maxAge: 30 * 24 * 60 * 60 * 1000,
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production'
            }
        });

        app.use(cors({
            origin: process.env.CLIENT_URL || 'http://localhost:3000',
            credentials: true
        }));
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use(sessionMiddleware);

        app.use(express.static(path.join(__dirname, 'public')));

        app.use('/api/auth', authRoutes);
        app.use('/api/servers', serverRoutes);
        app.use('/api/channels', channelRoutes);
        app.use('/api/messages', messageRoutes);
        app.use('/api/reactions', reactionRoutes);
        app.use('/api/dm', dmRoutes);
        app.use('/api/users', userRoutes);
        app.use('/api/import', importRoutes);
        app.use('/api/forum', forumRoutes);
        app.use('/api/voice', voiceRoutes);

        app.get('/api/health', (req, res) => {
            res.json({ status: 'ok', timestamp: new Date(), uptime: process.uptime() * 1000, memory: process.memoryUsage() });
        });

        app.get('/api/health/auth', async (req, res) => {
            const start = Date.now();
            try {
                await db.query('SELECT 1 FROM users LIMIT 1');
                res.json({ status: 'ok', subsystem: 'auth', response_ms: Date.now() - start });
            } catch {
                res.status(500).json({ status: 'error', subsystem: 'auth', response_ms: Date.now() - start });
            }
        });

        app.get('/api/health/messaging', async (req, res) => {
            const start = Date.now();
            try {
                await db.query('SELECT 1 FROM messages LIMIT 1');
                res.json({ status: 'ok', subsystem: 'messaging', response_ms: Date.now() - start });
            } catch {
                res.status(500).json({ status: 'error', subsystem: 'messaging', response_ms: Date.now() - start });
            }
        });

        app.get('/api/health/realtime', (req, res) => {
            const start = Date.now();
            try {
                const io = req.app.get('io');
                if (!io) throw new Error('not initialized');
                const connected = io.engine.clientsCount;
                res.json({ status: 'ok', subsystem: 'realtime', response_ms: Date.now() - start, connected });
            } catch {
                res.status(500).json({ status: 'error', subsystem: 'realtime', response_ms: Date.now() - start });
            }
        });

        app.get('/api/health/media', async (req, res) => {
            const start = Date.now();
            try {
                await fs.promises.access(path.join(__dirname, 'public', 'uploads'), fs.constants.R_OK);
                res.json({ status: 'ok', subsystem: 'media', response_ms: Date.now() - start });
            } catch {
                res.status(500).json({ status: 'error', subsystem: 'media', response_ms: Date.now() - start });
            }
        });

        app.get('/api/health/dm', async (req, res) => {
            const start = Date.now();
            try {
                await db.query('SELECT 1 FROM direct_messages LIMIT 1');
                res.json({ status: 'ok', subsystem: 'dm', response_ms: Date.now() - start });
            } catch {
                res.status(500).json({ status: 'error', subsystem: 'dm', response_ms: Date.now() - start });
            }
        });

        // Expose permission flag values to the frontend (BigInts serialised as Numbers — all ≤ 2^20)
        const permissionsPayload = Object.fromEntries(
            Object.entries(PERMISSIONS).map(([k, v]) => [k, Number(v)])
        );
        app.get('/api/permissions', (req, res) => res.json(permissionsPayload));

        app.get('/invite/:code', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });

        app.get('*', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });

        const io = initializeSocket(server, sessionMiddleware);
        app.set('io', io);

        server.listen(PORT, "0.0.0.0", () => {
            log(`
=============================================

          NexusGuild Server Running

   Port: ${PORT}

     HTTP:   http://localhost:${PORT}
     Socket: http://localhost:${PORT}

=============================================
            `);
        });
    } catch (error) {
        log(tags.error, 'Failed to start server:', error);
        process.exit(1);
    }
};

process.on('unhandledRejection', (error) => {
    log(tags.error, 'Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    log(tags.error, 'Uncaught exception:', error);
    process.exit(1);
});

process.on('SIGTERM', () => {
    log(tags.system, 'SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        db.pool.end(() => process.exit(0));
    });
});

startServer();