// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /staff-server.js
// Standalone staff portal. Shares the same PostgreSQL database as the main app.
// Run: node staff-server.js   (separate process from server.js)

import dotenv from 'dotenv';
dotenv.config({ override: true });

import express from 'express';
import session from 'express-session';
import { createClient as createRedisClient } from 'redis';
import { RedisStore } from 'connect-redis';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import db from './config/database.js';
import { generateSnowflake } from './utils/functions.js';
import { sendEmail } from './utils/email.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const redisClient = createRedisClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', err => console.error('[staff] Redis error:', err));
await redisClient.connect();

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.STAFF_PORT || 3006;

// ── Role hierarchy ────────────────────────────────────────────────────────────

const ROLE_ORDER = ['viewer', 'moderator', 'superadmin', 'owner'];

function requireStaff(minRole = 'viewer') {
    return async (req, res, next) => {
        if (!req.session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });
        try {
            const r = await db.query(
                `SELECT id, role FROM staff_members WHERE user_id = $1 AND is_active = true`,
                [req.session.user.id]
            );
            if (!r.rows.length) return res.status(403).json({ error: 'Not staff' });
            req.staffRole = r.rows[0].role;
            req.staffId   = r.rows[0].id;
            if (ROLE_ORDER.indexOf(req.staffRole) < ROLE_ORDER.indexOf(minRole))
                return res.status(403).json({ error: 'Insufficient role' });
            next();
        } catch (err) {
            console.error('[staff] requireStaff error:', err);
            res.status(500).json({ error: 'Internal error' });
        }
    };
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
    store: new RedisStore({ client: redisClient, prefix: 'ng_sess:' }),
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
app.use(sessionMiddleware);

// Serve staff SPA
app.use(express.static(path.join(__dirname, 'public_staff')));

// ── Auth routes ───────────────────────────────────────────────────────────────

// POST /api/staff/login
app.post('/api/staff/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

        const userRes = await db.query(
            `SELECT id, username, email, password_hash, avatar, status FROM users WHERE email = $1`,
            [email]
        );
        if (!userRes.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
        const user = userRes.rows[0];

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        const staffRes = await db.query(
            `SELECT id, role FROM staff_members WHERE user_id = $1 AND is_active = true`,
            [user.id]
        );
        if (!staffRes.rows.length) return res.status(403).json({ error: 'Not a staff member' });

        req.session.user = { id: user.id, username: user.username, email: user.email, avatar: user.avatar };
        await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));

        res.json({ user: req.session.user, staffRole: staffRes.rows[0].role });
    } catch (err) {
        console.error('[staff] login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// POST /api/staff/logout
app.post('/api/staff/logout', requireStaff('viewer'), (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

// GET /api/staff/me
app.get('/api/staff/me', requireStaff('viewer'), async (req, res) => {
    try {
        const staffRes = await db.query(
            `SELECT sm.role FROM staff_members sm WHERE sm.user_id = $1 AND sm.is_active = true`,
            [req.session.user.id]
        );
        res.json({ user: req.session.user, staffRole: staffRes.rows[0]?.role });
    } catch (err) {
        console.error('[staff] me error:', err);
        res.status(500).json({ error: 'Failed' });
    }
});

// ── Dashboard stats ───────────────────────────────────────────────────────────

// GET /api/staff/stats
app.get('/api/staff/stats', requireStaff('viewer'), async (req, res) => {
    try {
        const [users, servers, messages, activeUsers, ascVolume] = await Promise.all([
            db.query(`SELECT COUNT(*) AS count FROM users`),
            db.query(`SELECT COUNT(*) AS count FROM servers`),
            db.query(`SELECT COUNT(*) AS count FROM messages`),
            db.query(`SELECT COUNT(DISTINCT user_id) AS count FROM messages WHERE created_at > NOW() - INTERVAL '24 hours'`),
            db.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM ascension_purchases`)
        ]);
        res.json({
            totalUsers:    parseInt(users.rows[0].count, 10),
            totalServers:  parseInt(servers.rows[0].count, 10),
            totalMessages: parseInt(messages.rows[0].count, 10),
            activeUsers24h: parseInt(activeUsers.rows[0].count, 10),
            ascensionVolume: parseInt(ascVolume.rows[0].total, 10)
        });
    } catch (err) {
        console.error('[staff] stats error:', err);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// ── User management ───────────────────────────────────────────────────────────

// GET /api/staff/users?q=&page=
app.get('/api/staff/users', requireStaff('viewer'), async (req, res) => {
    try {
        const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
        const q      = req.query.q ? `%${req.query.q}%` : null;
        const offset = (page - 1) * 25;

        const where  = q ? `WHERE u.username ILIKE $1 OR u.email ILIKE $1` : '';
        const params = q ? [q, 25, offset] : [25, offset];
        const p1     = q ? '$2' : '$1';
        const p2     = q ? '$3' : '$2';

        const [rows, total] = await Promise.all([
            db.query(
                `SELECT u.id, u.username, u.email, u.status, u.created_at,
                        (gb.user_id IS NOT NULL) AS is_globally_banned
                 FROM users u
                 LEFT JOIN global_bans gb ON gb.user_id = u.id
                 ${where}
                 ORDER BY u.created_at DESC
                 LIMIT ${p1} OFFSET ${p2}`,
                params
            ),
            db.query(
                `SELECT COUNT(*) AS count FROM users u ${where}`,
                q ? [q] : []
            )
        ]);

        res.json({ users: rows.rows, total: parseInt(total.rows[0].count, 10), page });
    } catch (err) {
        console.error('[staff] users list error:', err);
        res.status(500).json({ error: 'Failed to get users' });
    }
});

// GET /api/staff/users/:id
app.get('/api/staff/users/:id', requireStaff('viewer'), async (req, res) => {
    try {
        const { id } = req.params;
        const [userRes, memberCount, balanceRes, banRes] = await Promise.all([
            db.query(
                `SELECT id, username, email, avatar, status, custom_status, created_at FROM users WHERE id = $1`,
                [id]
            ),
            db.query(
                `SELECT COUNT(*) AS count FROM server_members WHERE user_id = $1`,
                [id]
            ),
            db.query(
                `SELECT COALESCE(SUM(remaining), 0) AS balance
                 FROM ascension_purchases WHERE user_id = $1 AND expires_at > NOW()`,
                [id]
            ),
            db.query(
                `SELECT gb.reason, gb.banned_at, sm.user_id AS banned_by_user_id
                 FROM global_bans gb
                 LEFT JOIN staff_members sm ON sm.id = gb.banned_by
                 WHERE gb.user_id = $1`,
                [id]
            )
        ]);
        if (!userRes.rows.length) return res.status(404).json({ error: 'User not found' });

        res.json({
            user: userRes.rows[0],
            serverCount:  parseInt(memberCount.rows[0].count, 10),
            ascBalance:   parseInt(balanceRes.rows[0].balance, 10),
            globalBan:    banRes.rows[0] || null
        });
    } catch (err) {
        console.error('[staff] user detail error:', err);
        res.status(500).json({ error: 'Failed to get user' });
    }
});

// DELETE /api/staff/users/:id  — hard-delete
app.delete('/api/staff/users/:id', requireStaff('superadmin'), async (req, res) => {
    try {
        const { id } = req.params;
        await db.query(`DELETE FROM users WHERE id = $1`, [id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('[staff] delete user error:', err);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// POST /api/staff/users/:id/ban
app.post('/api/staff/users/:id/ban', requireStaff('moderator'), async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const banId = generateSnowflake();
        await db.query(
            `INSERT INTO global_bans (id, user_id, banned_by, reason)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id) DO UPDATE SET reason = $4, banned_by = $3, banned_at = NOW()`,
            [banId, id, req.staffId, reason || null]
        );
        res.json({ ok: true });
    } catch (err) {
        console.error('[staff] ban user error:', err);
        res.status(500).json({ error: 'Failed to ban user' });
    }
});

// DELETE /api/staff/users/:id/ban
app.delete('/api/staff/users/:id/ban', requireStaff('moderator'), async (req, res) => {
    try {
        const { id } = req.params;
        await db.query(`DELETE FROM global_bans WHERE user_id = $1`, [id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('[staff] unban user error:', err);
        res.status(500).json({ error: 'Failed to unban user' });
    }
});

// ── Server management ─────────────────────────────────────────────────────────

// GET /api/staff/servers?q=&page=
app.get('/api/staff/servers', requireStaff('viewer'), async (req, res) => {
    try {
        const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
        const q      = req.query.q ? `%${req.query.q}%` : null;
        const offset = (page - 1) * 25;

        const where  = q ? `WHERE s.name ILIKE $1` : '';
        const params = q ? [q, 25, offset] : [25, offset];
        const p1     = q ? '$2' : '$1';
        const p2     = q ? '$3' : '$2';

        const [rows, total] = await Promise.all([
            db.query(
                `SELECT s.id, s.name, s.icon, s.created_at,
                        u.username AS owner_username,
                        COUNT(sm.user_id) AS member_count
                 FROM servers s
                 LEFT JOIN users u ON u.id = s.owner_id
                 LEFT JOIN server_members sm ON sm.server_id = s.id
                 ${where}
                 GROUP BY s.id, u.username
                 ORDER BY s.created_at DESC
                 LIMIT ${p1} OFFSET ${p2}`,
                params
            ),
            db.query(
                `SELECT COUNT(*) AS count FROM servers s ${where}`,
                q ? [q] : []
            )
        ]);

        res.json({ servers: rows.rows, total: parseInt(total.rows[0].count, 10), page });
    } catch (err) {
        console.error('[staff] servers list error:', err);
        res.status(500).json({ error: 'Failed to get servers' });
    }
});

// GET /api/staff/servers/:id
app.get('/api/staff/servers/:id', requireStaff('viewer'), async (req, res) => {
    try {
        const { id } = req.params;
        const [serverRes, channelCount, members] = await Promise.all([
            db.query(
                `SELECT s.id, s.name, s.icon, s.created_at,
                        u.id AS owner_id, u.username AS owner_username
                 FROM servers s
                 LEFT JOIN users u ON u.id = s.owner_id
                 WHERE s.id = $1`,
                [id]
            ),
            db.query(`SELECT COUNT(*) AS count FROM channels WHERE server_id = $1`, [id]),
            db.query(
                `SELECT u.id, u.username, u.avatar, sm.joined_at
                 FROM server_members sm
                 JOIN users u ON u.id = sm.user_id
                 WHERE sm.server_id = $1
                 ORDER BY sm.joined_at ASC
                 LIMIT 100`,
                [id]
            )
        ]);

        if (!serverRes.rows.length) return res.status(404).json({ error: 'Server not found' });

        res.json({
            server:       serverRes.rows[0],
            channelCount: parseInt(channelCount.rows[0].count, 10),
            members:      members.rows
        });
    } catch (err) {
        console.error('[staff] server detail error:', err);
        res.status(500).json({ error: 'Failed to get server' });
    }
});

// DELETE /api/staff/servers/:id  — hard-delete
app.delete('/api/staff/servers/:id', requireStaff('superadmin'), async (req, res) => {
    try {
        const { id } = req.params;
        await db.query(`DELETE FROM servers WHERE id = $1`, [id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('[staff] delete server error:', err);
        res.status(500).json({ error: 'Failed to delete server' });
    }
});

// PATCH /api/staff/servers/:id/owner  — transfer ownership
app.patch('/api/staff/servers/:id/owner', requireStaff('superadmin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { newOwnerId } = req.body;
        if (!newOwnerId) return res.status(400).json({ error: 'newOwnerId required' });

        const memberRes = await db.query(
            `SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2`,
            [id, newOwnerId]
        );
        if (!memberRes.rows.length) return res.status(400).json({ error: 'User is not a server member' });

        await db.query(`UPDATE servers SET owner_id = $1 WHERE id = $2`, [newOwnerId, id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('[staff] transfer owner error:', err);
        res.status(500).json({ error: 'Failed to transfer ownership' });
    }
});

// ── Ascension management ──────────────────────────────────────────────────────

// GET /api/staff/ascension/nodes  — all nodes including inactive
app.get('/api/staff/ascension/nodes', requireStaff('viewer'), async (req, res) => {
    try {
        const result = await db.query(
            `SELECT * FROM skill_tree_nodes ORDER BY type, tier, sort_order`
        );
        res.json({ nodes: result.rows });
    } catch (err) {
        console.error('[staff] asc nodes error:', err);
        res.status(500).json({ error: 'Failed to get nodes' });
    }
});

// POST /api/staff/ascension/nodes
app.post('/api/staff/ascension/nodes', requireStaff('superadmin'), async (req, res) => {
    try {
        const { type, parent_id, tier, name, description, icon, cost, sort_order } = req.body;
        if (!type || !name || cost === undefined) return res.status(400).json({ error: 'Missing required fields' });
        const id = generateSnowflake();
        const result = await db.query(
            `INSERT INTO skill_tree_nodes (id, type, parent_id, tier, name, description, icon, cost, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [id, type, parent_id || null, tier || 1, name, description || null, icon || null, parseInt(cost, 10) || 0, parseInt(sort_order, 10) || 0]
        );
        res.json({ node: result.rows[0] });
    } catch (err) {
        console.error('[staff] create node error:', err);
        res.status(500).json({ error: 'Failed to create node' });
    }
});

// PATCH /api/staff/ascension/nodes/:id
app.patch('/api/staff/ascension/nodes/:id', requireStaff('superadmin'), async (req, res) => {
    try {
        const { id } = req.params;
        const fields = ['type', 'parent_id', 'tier', 'name', 'description', 'icon', 'cost', 'sort_order', 'is_active'];
        const updates = [];
        const values  = [];
        let   idx     = 1;

        for (const f of fields) {
            if (req.body[f] !== undefined) {
                updates.push(`${f} = $${idx++}`);
                values.push(req.body[f]);
            }
        }

        if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
        values.push(id);

        const result = await db.query(
            `UPDATE skill_tree_nodes SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Node not found' });
        res.json({ node: result.rows[0] });
    } catch (err) {
        console.error('[staff] update node error:', err);
        res.status(500).json({ error: 'Failed to update node' });
    }
});

// DELETE /api/staff/ascension/nodes/:id  — soft-delete
app.delete('/api/staff/ascension/nodes/:id', requireStaff('superadmin'), async (req, res) => {
    try {
        const { id } = req.params;
        await db.query(`UPDATE skill_tree_nodes SET is_active = false WHERE id = $1`, [id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('[staff] delete node error:', err);
        res.status(500).json({ error: 'Failed to deactivate node' });
    }
});

// GET /api/staff/ascension/users?q=
app.get('/api/staff/ascension/users', requireStaff('viewer'), async (req, res) => {
    try {
        const q = req.query.q ? `%${req.query.q}%` : '%';
        const result = await db.query(
            `SELECT u.id, u.username, u.avatar,
                    COALESCE(SUM(ap.remaining) FILTER (WHERE ap.expires_at > NOW()), 0) AS balance
             FROM users u
             LEFT JOIN ascension_purchases ap ON ap.user_id = u.id
             WHERE u.username ILIKE $1
             GROUP BY u.id
             ORDER BY balance DESC
             LIMIT 50`,
            [q]
        );
        res.json({ users: result.rows });
    } catch (err) {
        console.error('[staff] asc users error:', err);
        res.status(500).json({ error: 'Failed to get ascension users' });
    }
});

// POST /api/staff/ascension/grant  — grant points to any user
app.post('/api/staff/ascension/grant', requireStaff('superadmin'), async (req, res) => {
    try {
        const { userId, amount, reason } = req.body;
        if (!userId || !amount) return res.status(400).json({ error: 'userId and amount required' });
        const pts = parseInt(amount, 10);
        if (pts <= 0) return res.status(400).json({ error: 'amount must be positive' });

        const userCheck = await db.query(`SELECT id FROM users WHERE id = $1`, [userId]);
        if (!userCheck.rows.length) return res.status(404).json({ error: 'User not found' });

        const purchaseId = generateSnowflake();
        const expiresAt  = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await db.query(
            `INSERT INTO ascension_purchases (id, user_id, amount, remaining, source, expires_at)
             VALUES ($1, $2, $3, $3, 'on_demand', $4)`,
            [purchaseId, userId, pts, expiresAt]
        );

        const ledgerId = generateSnowflake();
        await db.query(
            `INSERT INTO ascension_ledger (id, user_id, delta, reason, ref_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [ledgerId, userId, pts, reason || 'staff_grant', purchaseId]
        );

        const balRes = await db.query(
            `SELECT COALESCE(SUM(remaining), 0) AS balance
             FROM ascension_purchases WHERE user_id = $1 AND expires_at > NOW()`,
            [userId]
        );
        res.json({ ok: true, balance: parseInt(balRes.rows[0].balance, 10) });
    } catch (err) {
        console.error('[staff] grant points error:', err);
        res.status(500).json({ error: 'Failed to grant points' });
    }
});

// ── Audit log ─────────────────────────────────────────────────────────────────

// GET /api/staff/audit?page=
app.get('/api/staff/audit', requireStaff('moderator'), async (req, res) => {
    try {
        const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
        const offset = (page - 1) * 100;
        const result = await db.query(
            `SELECT al.id, al.delta, al.reason, al.ref_id, al.created_at,
                    u.id AS user_id, u.username
             FROM ascension_ledger al
             LEFT JOIN users u ON u.id = al.user_id
             ORDER BY al.created_at DESC
             LIMIT 100 OFFSET $1`,
            [offset]
        );
        const total = await db.query(`SELECT COUNT(*) AS count FROM ascension_ledger`);
        res.json({ entries: result.rows, total: parseInt(total.rows[0].count, 10), page });
    } catch (err) {
        console.error('[staff] audit error:', err);
        res.status(500).json({ error: 'Failed to get audit log' });
    }
});

// ── Staff roster management (owner only) ──────────────────────────────────────

// GET /api/staff/members
app.get('/api/staff/members', requireStaff('owner'), async (req, res) => {
    try {
        const result = await db.query(
            `SELECT sm.id, sm.role, sm.granted_at, sm.is_active,
                    u.id AS user_id, u.username, u.email, u.avatar,
                    g.username AS granted_by_username
             FROM staff_members sm
             JOIN users u ON u.id = sm.user_id
             LEFT JOIN users g ON g.id = sm.granted_by
             ORDER BY sm.granted_at ASC`
        );
        res.json({ members: result.rows });
    } catch (err) {
        console.error('[staff] members list error:', err);
        res.status(500).json({ error: 'Failed to get staff members' });
    }
});

// POST /api/staff/members
app.post('/api/staff/members', requireStaff('owner'), async (req, res) => {
    try {
        const { userId, role } = req.body;
        if (!userId || !role) return res.status(400).json({ error: 'userId and role required' });
        if (!ROLE_ORDER.includes(role) || role === 'owner') return res.status(400).json({ error: 'Invalid role' });

        const userCheck = await db.query(`SELECT id, username FROM users WHERE id = $1`, [userId]);
        if (!userCheck.rows.length) return res.status(404).json({ error: 'User not found' });

        const id = generateSnowflake();
        await db.query(
            `INSERT INTO staff_members (id, user_id, role, granted_by, is_active)
             VALUES ($1, $2, $3, $4, true)
             ON CONFLICT (user_id) DO UPDATE SET role = $3, granted_by = $4, is_active = true, granted_at = NOW()`,
            [id, userId, role, req.session.user.id]
        );
        res.json({ ok: true });
    } catch (err) {
        console.error('[staff] add member error:', err);
        res.status(500).json({ error: 'Failed to add staff member' });
    }
});

// PATCH /api/staff/members/:id
app.patch('/api/staff/members/:id', requireStaff('owner'), async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;
        if (!role || !ROLE_ORDER.includes(role)) return res.status(400).json({ error: 'Invalid role' });

        // Prevent demoting the owner row itself
        const memberRes = await db.query(`SELECT user_id, role FROM staff_members WHERE id = $1`, [id]);
        if (!memberRes.rows.length) return res.status(404).json({ error: 'Staff member not found' });
        if (memberRes.rows[0].role === 'owner' && memberRes.rows[0].user_id === req.session.user.id)
            return res.status(400).json({ error: 'Cannot change your own owner role' });

        await db.query(`UPDATE staff_members SET role = $1 WHERE id = $2`, [role, id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('[staff] update member role error:', err);
        res.status(500).json({ error: 'Failed to update role' });
    }
});

// DELETE /api/staff/members/:id  — deactivate (not delete)
app.delete('/api/staff/members/:id', requireStaff('owner'), async (req, res) => {
    try {
        const { id } = req.params;
        const memberRes = await db.query(`SELECT user_id, role FROM staff_members WHERE id = $1`, [id]);
        if (!memberRes.rows.length) return res.status(404).json({ error: 'Staff member not found' });

        // Cannot deactivate your own account
        if (memberRes.rows[0].user_id === req.session.user.id)
            return res.status(400).json({ error: 'Cannot deactivate your own account' });

        await db.query(`UPDATE staff_members SET is_active = false WHERE id = $1`, [id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('[staff] deactivate member error:', err);
        res.status(500).json({ error: 'Failed to deactivate staff member' });
    }
});

// POST /api/staff/members/:id/reactivate
app.post('/api/staff/members/:id/reactivate', requireStaff('owner'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            `UPDATE staff_members SET is_active = true WHERE id = $1 RETURNING id`,
            [id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Staff member not found' });
        res.json({ ok: true });
    } catch (err) {
        console.error('[staff] reactivate member error:', err);
        res.status(500).json({ error: 'Failed to reactivate staff member' });
    }
});

// ── CORS origin management ────────────────────────────────────────────────────

// GET /api/staff/cors
app.get('/api/staff/cors', requireStaff('superadmin'), async (req, res) => {
    try {
        const result = await db.query(
            `SELECT co.id, co.origin, co.description, co.is_default, co.added_at,
                    u.username AS added_by_username
             FROM cors_origins co
             LEFT JOIN staff_members sm ON sm.id = co.added_by
             LEFT JOIN users u ON u.id = sm.user_id
             ORDER BY co.is_default DESC, co.added_at ASC`
        );
        res.json({ origins: result.rows });
    } catch (err) {
        console.error('[staff] cors list error:', err);
        res.status(500).json({ error: 'Failed to get CORS origins' });
    }
});

// POST /api/staff/cors
app.post('/api/staff/cors', requireStaff('superadmin'), async (req, res) => {
    try {
        const { origin, description } = req.body;
        if (!origin) return res.status(400).json({ error: 'origin required' });

        // Basic format validation
        try { new URL(origin); } catch {
            return res.status(400).json({ error: 'Invalid URL format' });
        }

        const id = generateSnowflake();
        await db.query(
            `INSERT INTO cors_origins (id, origin, description, is_default, added_by)
             VALUES ($1, $2, $3, false, $4)`,
            [id, origin, description || null, req.staffId]
        );
        res.json({ ok: true, id });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Origin already exists' });
        console.error('[staff] cors add error:', err);
        res.status(500).json({ error: 'Failed to add CORS origin' });
    }
});

// DELETE /api/staff/cors/:id
app.delete('/api/staff/cors/:id', requireStaff('superadmin'), async (req, res) => {
    try {
        const { id } = req.params;
        const check = await db.query(`SELECT is_default FROM cors_origins WHERE id = $1`, [id]);
        if (!check.rows.length) return res.status(404).json({ error: 'Not found' });
        if (check.rows[0].is_default) return res.status(403).json({ error: 'Cannot remove the default origin' });

        await db.query(`DELETE FROM cors_origins WHERE id = $1`, [id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('[staff] cors delete error:', err);
        res.status(500).json({ error: 'Failed to remove CORS origin' });
    }
});

// ── Inbound Email Inbox ───────────────────────────────────────────────────────

// GET /api/staff/inbox?page=
app.get('/api/staff/inbox', requireStaff('moderator'), async (req, res) => {
    try {
        const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
        const offset = (page - 1) * 50;

        const [rows, total] = await Promise.all([
            db.query(
                `SELECT ie.id, ie.from_address, ie.to_address, ie.subject, ie.is_read,
                        ie.received_at, u.username AS read_by_username
                 FROM inbound_emails ie
                 LEFT JOIN users u ON u.id = ie.read_by
                 ORDER BY ie.received_at DESC
                 LIMIT 50 OFFSET $1`,
                [offset]
            ),
            db.query(`SELECT COUNT(*) AS count FROM inbound_emails`)
        ]);

        res.json({ emails: rows.rows, total: parseInt(total.rows[0].count, 10), page });
    } catch (err) {
        console.error('[staff] inbox list error:', err);
        res.status(500).json({ error: 'Failed to get inbox' });
    }
});

// GET /api/staff/inbox/:id — get email + mark as read
app.get('/api/staff/inbox/:id', requireStaff('moderator'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            `SELECT ie.*, u.username AS read_by_username
             FROM inbound_emails ie
             LEFT JOIN users u ON u.id = ie.read_by
             WHERE ie.id = $1`,
            [id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Email not found' });

        // Mark as read if not already
        if (!result.rows[0].is_read) {
            await db.query(
                `UPDATE inbound_emails SET is_read = true, read_by = $1, read_at = NOW() WHERE id = $2`,
                [req.session.user.id, id]
            );
        }

        res.json({ email: result.rows[0] });
    } catch (err) {
        console.error('[staff] inbox detail error:', err);
        res.status(500).json({ error: 'Failed to get email' });
    }
});

// POST /api/staff/inbox/:id/reply
app.post('/api/staff/inbox/:id/reply', requireStaff('moderator'), async (req, res) => {
    try {
        const { id } = req.params;
        const { subject, body } = req.body;
        if (!body) return res.status(400).json({ error: 'body is required' });

        const emailRes = await db.query(
            `SELECT from_address, subject AS original_subject FROM inbound_emails WHERE id = $1`,
            [id]
        );
        if (!emailRes.rows.length) return res.status(404).json({ error: 'Email not found' });

        const { from_address, original_subject } = emailRes.rows[0];
        const replySubject = subject || `Re: ${original_subject}`;
        const staffName = req.session.user.username;
        const fromAddress = `${staffName} <${staffName}@nexusguild.gg>`;

        await sendEmail({
            from: fromAddress,
            to: from_address,
            subject: replySubject,
            html: `
                <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#1e1f22;color:#dbdee1;padding:32px;border-radius:8px;">
                    <p style="white-space:pre-wrap;color:#dbdee1">${body.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
                    <hr style="border:none;border-top:1px solid #2e2f35;margin:24px 0">
                    <p style="color:#949ba4;font-size:12px">${staffName} — NexusGuild Support</p>
                </div>
            `,
        });

        res.json({ ok: true });
    } catch (err) {
        console.error('[staff] inbox reply error:', err);
        res.status(500).json({ error: 'Failed to send reply' });
    }
});

// DELETE /api/staff/inbox/:id
app.delete('/api/staff/inbox/:id', requireStaff('superadmin'), async (req, res) => {
    try {
        const { id } = req.params;
        await db.query(`DELETE FROM inbound_emails WHERE id = $1`, [id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('[staff] inbox delete error:', err);
        res.status(500).json({ error: 'Failed to delete email' });
    }
});

// ── Reports ───────────────────────────────────────────────────────────────────

// GET /api/staff/reports?page=&status=&type=
app.get('/api/staff/reports', requireStaff('moderator'), async (req, res) => {
    try {
        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = 30;
        const offset = (page - 1) * limit;

        const conditions = [`r.scope = 'global'`];
        const params = [];

        if (req.query.status) { params.push(req.query.status); conditions.push(`r.status = $${params.length}`); }
        if (req.query.type)   { params.push(req.query.type);   conditions.push(`r.type = $${params.length}`); }

        params.push(limit, offset);
        const result = await db.query(
            `SELECT
                r.*,
                ru.username  AS reporter_username,
                rpu.username AS reported_username,
                s.name       AS server_name
             FROM reports r
             LEFT JOIN users u   ON u.id   = r.reporter_id
             LEFT JOIN users ru  ON ru.id  = r.reporter_id
             LEFT JOIN users rpu ON rpu.id = r.reported_user_id
             LEFT JOIN servers s ON s.id   = r.server_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY r.created_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );

        const countRes = await db.query(
            `SELECT COUNT(*) FROM reports r WHERE ${conditions.slice(0, conditions.length).join(' AND ')}`,
            params.slice(0, params.length - 2)
        );

        res.json({ reports: result.rows, total: parseInt(countRes.rows[0].count), page, limit });
    } catch (err) {
        console.error('[staff] reports list error:', err);
        res.status(500).json({ error: 'Failed to load reports.' });
    }
});

// PATCH /api/staff/reports/:id  — update status (reviewed/dismissed)
app.patch('/api/staff/reports/:id', requireStaff('moderator'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        if (!['reviewed', 'dismissed'].includes(status)) {
            return res.status(400).json({ error: 'Status must be reviewed or dismissed.' });
        }
        const result = await db.query(
            `UPDATE reports SET status=$1, reviewed_by=$2, reviewed_at=NOW()
             WHERE id=$3 AND scope='global' RETURNING id`,
            [status, req.session.user.id, id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Report not found.' });
        res.json({ ok: true });
    } catch (err) {
        console.error('[staff] reports update error:', err);
        res.status(500).json({ error: 'Failed to update report.' });
    }
});

// ── SPA fallback ──────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public_staff', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
=============================================

      NexusGuild Staff Portal Running

   Port: ${PORT}

     HTTP: http://localhost:${PORT}

=============================================
    `);
});

process.on('unhandledRejection', (error) => {
    console.error('[staff] Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('[staff] Uncaught exception:', error);
    process.exit(1);
});
