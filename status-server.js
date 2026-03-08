// Proprietary — Cerberus Game Labs. See LICENSE for terms.
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import db from './config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3005;
const POLL_INTERVAL_MS = 60 * 1000; // 60 seconds
const FETCH_TIMEOUT_MS = 5000;

const SERVICE_URLS = {
    main:      process.env.MAIN_APP_URL    || 'http://localhost:1985',
    developer: process.env.DEV_URL         || 'http://localhost:3001',
    tos:       process.env.TOS_URL         || 'http://localhost:3002',
    privacy:   process.env.PRIVACY_URL     || 'http://localhost:3003',
    reporting: process.env.REPORTING_URL   || 'http://localhost:3004',
    staff:     process.env.STAFF_URL       || 'http://localhost:3006',
    docs:      process.env.DOCS_URL        || 'http://localhost:3007',
};

const SUBSYSTEMS = [
    { key: 'api',       name: 'API',              endpoint: '/api/health',          baseUrl: SERVICE_URLS.main },
    { key: 'auth',      name: 'Authentication',   endpoint: '/api/health/auth',     baseUrl: SERVICE_URLS.main },
    { key: 'messaging', name: 'Messaging',        endpoint: '/api/health/messaging',baseUrl: SERVICE_URLS.main },
    { key: 'realtime',  name: 'Real-time',        endpoint: '/api/health/realtime', baseUrl: SERVICE_URLS.main },
    { key: 'media',     name: 'Media & Uploads',  endpoint: '/api/health/media',    baseUrl: SERVICE_URLS.main },
    { key: 'dm',        name: 'Direct Messages',  endpoint: '/api/health/dm',       baseUrl: SERVICE_URLS.main },
    { key: 'developer', name: 'Developer Portal', endpoint: '/',                    baseUrl: SERVICE_URLS.developer },
    { key: 'tos',       name: 'Terms of Service', endpoint: '/',                    baseUrl: SERVICE_URLS.tos },
    { key: 'privacy',   name: 'Privacy Policy',   endpoint: '/',                    baseUrl: SERVICE_URLS.privacy },
    { key: 'reporting', name: 'Report Center',    endpoint: '/',                    baseUrl: SERVICE_URLS.reporting },
    { key: 'staff',     name: 'Staff Portal',     endpoint: '/',                    baseUrl: SERVICE_URLS.staff },
    { key: 'docs',      name: 'Developer Docs',   endpoint: '/',                    baseUrl: SERVICE_URLS.docs },
];

function classifyStatus(ok, responseMs) {
    if (!ok || responseMs === null) return 'outage';
    if (responseMs < 500)  return 'operational';
    if (responseMs < 2000) return 'degraded';
    return 'outage';
}

async function pollSubsystem(subsystem) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const start = Date.now();
    let ok = false;
    let responseMs = null;

    try {
        const res = await fetch(`${subsystem.baseUrl}${subsystem.endpoint}`, {
            signal: controller.signal
        });
        responseMs = Date.now() - start;
        ok = res.ok;
    } catch {
        responseMs = Date.now() - start;
        ok = false;
    } finally {
        clearTimeout(timer);
    }

    const status = classifyStatus(ok, responseMs);

    try {
        await db.query(
            `INSERT INTO uptime_log (subsystem, status, response_ms) VALUES ($1, $2, $3)`,
            [subsystem.key, status, responseMs]
        );
    } catch (e) {
        console.error(`[status] DB write failed for ${subsystem.key}:`, e.message);
    }
}

async function pollAll() {
    await Promise.all(SUBSYSTEMS.map(pollSubsystem));
}

async function buildStatusResponse() {
    // Latest result per subsystem
    const currentRes = await db.query(`
        SELECT DISTINCT ON (subsystem) subsystem, status, response_ms, checked_at
        FROM uptime_log
        ORDER BY subsystem, checked_at DESC
    `);

    const currentMap = {};
    for (const row of currentRes.rows) {
        currentMap[row.subsystem] = row;
    }

    // Daily aggregates for last 90 days
    const historyRes = await db.query(`
        SELECT
            subsystem,
            to_char(checked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
            CASE
                WHEN COUNT(*) FILTER (WHERE status = 'outage') * 2 > COUNT(*) THEN 'outage'
                WHEN (COUNT(*) FILTER (WHERE status = 'outage') + COUNT(*) FILTER (WHERE status = 'degraded')) * 2 > COUNT(*) THEN 'degraded'
                ELSE 'operational'
            END AS day_status,
            ROUND(AVG(response_ms)) AS avg_ms
        FROM uptime_log
        WHERE checked_at >= NOW() - INTERVAL '90 days'
        GROUP BY subsystem, to_char(checked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
        ORDER BY subsystem, day ASC
    `);

    // Build day-indexed map per subsystem
    const historyBySubsystem = {};
    for (const row of historyRes.rows) {
        if (!historyBySubsystem[row.subsystem]) historyBySubsystem[row.subsystem] = {};
        historyBySubsystem[row.subsystem][row.day] = {
            status: row.day_status,
            avg_ms: row.avg_ms !== null ? Number(row.avg_ms) : null
        };
    }

    // Build 90-entry arrays (oldest first)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const days = [];
    for (let i = 89; i >= 0; i--) {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - i);
        days.push(d.toISOString().slice(0, 10));
    }

    let overallStatus = 'operational';

    const subsystems = SUBSYSTEMS.map(s => {
        const current = currentMap[s.key] || null;
        const currentStatus = current ? current.status : 'unknown';

        if (currentStatus === 'outage')   overallStatus = 'outage';
        else if (currentStatus === 'degraded' && overallStatus !== 'outage') overallStatus = 'degraded';

        const dayMap = historyBySubsystem[s.key] || {};
        const history = days.map(day => ({
            day,
            status: dayMap[day] ? dayMap[day].status : 'no-data',
            avg_ms: dayMap[day] ? dayMap[day].avg_ms : null
        }));

        return {
            key:          s.key,
            name:         s.name,
            current:      currentStatus,
            response_ms:  current ? current.response_ms : null,
            last_checked: current ? current.checked_at : null,
            history
        };
    });

    return { overall: overallStatus, subsystems };
}

// ── HTTP API ──────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public_status')));

app.get('/api/status', async (req, res) => {
    try {
        const data = await buildStatusResponse();
        res.json(data);
    } catch (e) {
        console.error('[status] /api/status error:', e.message);
        res.status(500).json({ error: 'Failed to load status data' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public_status', 'index.html'));
});

// ── Init ──────────────────────────────────────────────────────────────────────

async function ensureTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS uptime_log (
            id SERIAL PRIMARY KEY,
            subsystem VARCHAR(50) NOT NULL,
            status VARCHAR(20) NOT NULL,
            response_ms INTEGER,
            checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_uptime_log_subsystem ON uptime_log(subsystem)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_uptime_log_checked_at ON uptime_log(checked_at DESC)');
}

async function start() {
    try {
        await ensureTable();
        console.log('[status] Database ready');
    } catch (e) {
        console.error('[status] DB init failed:', e.message);
        // Continue anyway — page will show empty state
    }

    // Initial poll on startup, then every 60 seconds
    pollAll();
    setInterval(pollAll, POLL_INTERVAL_MS);

    // Cleanup old rows on startup then daily
    db.cleanupUptime().catch(e => console.error('[status] cleanup error:', e.message));
    setInterval(
        () => db.cleanupUptime().catch(e => console.error('[status] cleanup error:', e.message)),
        24 * 60 * 60 * 1000
    );

    app.listen(PORT, () => {
        console.log(`[status] Server running at http://localhost:${PORT}`);
    });
}

start();
