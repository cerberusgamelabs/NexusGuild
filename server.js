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
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { log, tags } from "#utils/logging";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import db from "./config/database.js";
import initializeSocket from "./config/socket.js";

import authRoutes from "./routes/auth.js";
import serverRoutes from "./routes/servers.js";
import channelRoutes from "./routes/channels.js";
import messageRoutes from "./routes/messages.js";
import reactionRoutes from './routes/reactions.js';

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

        app.get('/api/health', (req, res) => {
            res.json({ status: 'ok', timestamp: new Date() });
        });

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