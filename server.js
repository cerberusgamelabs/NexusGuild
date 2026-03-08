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
import { generateSnowflake } from "./utils/functions.js";

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
import groupDmRoutes from "./routes/groupDm.js";
import userRoutes from "./routes/users.js";
import importRoutes from "./routes/import.js";
import forumRoutes from "./routes/forum.js";
import voiceRoutes from "./routes/voice.js";
import embedRoutes from "./routes/embed.js";
import ascensionRoutes from "./routes/ascension.js";
import auditRoutes from "./routes/audit.js";
import webhookRoutes from "./routes/webhooks.js";
import botRoutes from "./routes/bots.js";
import interactionRoutes from "./routes/interactions.js";
import reportRoutes from "./routes/reports.js";
import vttRoutes from "./routes/vtt.js";
import v1Routes from "./routes/v1.js";
import { initBotGateway } from "./gateway/botGateway.js";
import { runExpirationJob } from "./controllers/ascensionController.js";

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

// ── CORS origin registry ──────────────────────────────────────────────────────
// Loaded from DB at startup; refreshed every 60 s so staff portal changes take effect.

const allowedOrigins = new Set();

async function loadAllowedOrigins() {
    try {
        const result = await db.query(`SELECT origin FROM cors_origins`);
        allowedOrigins.clear();
        for (const row of result.rows) allowedOrigins.add(row.origin);
        log(tags.info, `CORS: ${allowedOrigins.size} allowed origin(s) loaded`);
    } catch (err) {
        log(tags.error, 'Failed to load CORS origins:', err);
    }
}

const startServer = async () => {
    try {
        await db.initDB();

        // Seed the default origin (untouchable in staff portal).
        // Delete any stale default row first so a changed CLIENT_URL takes effect on restart.
        const defaultOrigin = process.env.CLIENT_URL || 'https://www.nexusguild.gg';
        await db.query(`DELETE FROM cors_origins WHERE is_default = true AND origin != $1`, [defaultOrigin]);
        await db.query(
            `INSERT INTO cors_origins (id, origin, description, is_default)
             VALUES ($1, $2, 'Main NexusGuild client (default)', true)
             ON CONFLICT (origin) DO UPDATE SET is_default = true`,
            [generateSnowflake(), defaultOrigin]
        );

        // Seed developer portal origin (always allowed, not removable via staff portal)
        const devOrigin = process.env.DEV_PORTAL_URL || 'https://dev.nexusguild.gg';
        await db.query(
            `INSERT INTO cors_origins (id, origin, description, is_default)
             VALUES ($1, $2, 'Developer portal (default)', true)
             ON CONFLICT (origin) DO UPDATE SET is_default = true`,
            [generateSnowflake(), devOrigin]
        );

        await loadAllowedOrigins();
        setInterval(loadAllowedOrigins, 60_000);

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
                secure: process.env.NODE_ENV === 'production',
                ...(process.env.NODE_ENV === 'production' && { domain: '.nexusguild.gg' })
            }
        });

        app.use(cors({
            origin: (origin, callback) => {
                // Allow server-to-server / same-origin requests (no Origin header)
                if (!origin || allowedOrigins.has(origin)) return callback(null, true);
                callback(new Error(`Origin '${origin}' not allowed by CORS`));
            },
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
        app.use('/api/group-dm', groupDmRoutes);
        app.use('/api/users', userRoutes);
        app.use('/api/import', importRoutes);
        app.use('/api/forum', forumRoutes);
        app.use('/api/voice', voiceRoutes);
        app.use('/api/embed', embedRoutes);
        app.use('/api/ascension', ascensionRoutes);
        app.use('/api/audit', auditRoutes);
        app.use('/api/webhooks', webhookRoutes);
        app.use('/api/bots', botRoutes);
        app.use('/api/interactions', interactionRoutes);
        app.use('/api/reports', reportRoutes);
        app.use('/api/vtt',     vttRoutes);
        app.use('/api/v1', v1Routes);

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

        // POST /api/inbound-email — Resend inbound email webhook (no auth)
        app.post('/api/inbound-email', async (req, res) => {
            try {
                const payload = req.body;
                const meta = payload.data || payload;

                // Fetch full email body via Resend receiving API
                let html = null;
                let text = null;
                if (meta.email_id && process.env.RESEND_API_KEY) {
                    const { Resend } = await import('resend');
                    const resend = new Resend(process.env.RESEND_API_KEY);
                    const { data: full } = await resend.emails.receiving.get(meta.email_id);
                    html = full?.html || null;
                    text = full?.text || null;
                }

                const id = generateSnowflake();
                await db.query(
                    `INSERT INTO inbound_emails (id, from_address, to_address, subject, body_html, body_text, raw_payload)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        id,
                        meta.from || '',
                        Array.isArray(meta.to) ? meta.to.join(', ') : (meta.to || ''),
                        meta.subject || '(no subject)',
                        html,
                        text,
                        payload
                    ]
                );
                log(tags.info, `Inbound email stored: ${meta.subject} from ${meta.from}`);
                res.status(200).json({ ok: true });
            } catch (err) {
                log(tags.error, 'Inbound email webhook error:', err);
                res.status(500).json({ error: 'Failed to store email' });
            }
        });

        app.get('/reset-password', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
        });

        app.get('/invite/bot/:botId', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'bot-invite.html'));
        });

        app.get('/invite/:code', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });

        app.get('*', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });

        const io = initializeSocket(server, sessionMiddleware);
        app.set('io', io);
        const botGateway = initBotGateway(io);
        app.set('botGateway', botGateway);

        // Run ascension expiration job every hour
        setInterval(runExpirationJob, 3_600_000);

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