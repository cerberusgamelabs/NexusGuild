// Proprietary — Cerberus Game Labs. See LICENSE for terms.
import db from '../config/database.js';
import { generateSnowflake } from '#utils/functions';
import crypto from 'crypto';

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

export default class BotController {

    // ── Bot management (session-auth, for dev portal) ─────────────────────

    static async getPublicBot(req, res) {
        const { botId } = req.params;
        const result = await db.query(
            `SELECT b.id, u.username AS name, u.avatar, b.description
             FROM bots b JOIN users u ON u.id = b.id
             WHERE b.id = $1`,
            [botId]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Bot not found' });
        res.json({ bot: result.rows[0] });
    }

    static async createBot(req, res) {
        const ownerId = req.session.user.id;
        const { name, description, callbackUrl } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'Bot name is required' });
        if (name.length > 32) return res.status(400).json({ error: 'Name must be 32 characters or fewer' });

        const botId = generateSnowflake();
        const token = generateToken();
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            // Create the bot user row
            await client.query(
                `INSERT INTO users (id, username, email, password_hash, is_bot)
                 VALUES ($1, $2, $3, $4, true)`,
                [botId, name.trim(), `bot_${botId}@internal.nexusguild.gg`, 'BOT_NO_PASSWORD']
            );
            // Create bot record
            await client.query(
                `INSERT INTO bots (id, owner_id, description, token, callback_url)
                 VALUES ($1, $2, $3, $4, $5)`,
                [botId, ownerId, description?.trim() || null, token, callbackUrl?.trim() || null]
            );
            await client.query('COMMIT');
            res.status(201).json({ id: botId, name: name.trim(), token, description, callbackUrl });
        } catch (err) {
            await client.query('ROLLBACK');
            if (err.code === '23505') return res.status(409).json({ error: 'A bot with that name already exists' });
            throw err;
        } finally {
            client.release();
        }
    }

    static async listBots(req, res) {
        const ownerId = req.session.user.id;
        const result = await db.query(
            `SELECT b.id, u.username AS name, u.avatar, b.description,
                    b.public_bot, b.callback_url, b.created_at,
                    COUNT(sm.server_id) AS server_count
             FROM bots b
             JOIN users u ON u.id = b.id
             LEFT JOIN server_members sm ON sm.user_id = b.id
             WHERE b.owner_id = $1
             GROUP BY b.id, u.username, u.avatar, b.description, b.public_bot, b.callback_url, b.created_at
             ORDER BY b.created_at ASC`,
            [ownerId]
        );
        res.json({ bots: result.rows });
    }

    static async getBot(req, res) {
        const ownerId = req.session.user.id;
        const { botId } = req.params;
        const result = await db.query(
            `SELECT b.id, u.username AS name, u.avatar, b.description,
                    b.public_bot, b.callback_url, b.created_at
             FROM bots b JOIN users u ON u.id = b.id
             WHERE b.id = $1 AND b.owner_id = $2`,
            [botId, ownerId]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Bot not found' });
        res.json({ bot: result.rows[0] });
    }

    static async updateBot(req, res) {
        const ownerId = req.session.user.id;
        const { botId } = req.params;
        const { name, description, callbackUrl, publicBot } = req.body;

        const existing = await db.query(
            `SELECT b.id FROM bots b WHERE b.id = $1 AND b.owner_id = $2`,
            [botId, ownerId]
        );
        if (!existing.rows.length) return res.status(404).json({ error: 'Bot not found' });

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            if (name !== undefined) {
                await client.query(`UPDATE users SET username = $1 WHERE id = $2`, [name.trim(), botId]);
            }
            await client.query(
                `UPDATE bots SET
                    description  = COALESCE($1, description),
                    callback_url = COALESCE($2, callback_url),
                    public_bot   = COALESCE($3, public_bot)
                 WHERE id = $4`,
                [description ?? null, callbackUrl ?? null, publicBot ?? null, botId]
            );
            await client.query('COMMIT');
            res.json({ success: true });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    static async deleteBot(req, res) {
        const ownerId = req.session.user.id;
        const { botId } = req.params;
        const result = await db.query(
            `DELETE FROM bots WHERE id = $1 AND owner_id = $2 RETURNING id`,
            [botId, ownerId]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Bot not found' });
        // Cascade deletes the users row too (ON DELETE CASCADE)
        await db.query(`DELETE FROM users WHERE id = $1`, [botId]);
        res.json({ success: true });
    }

    static async regenerateToken(req, res) {
        const ownerId = req.session.user.id;
        const { botId } = req.params;
        const token = generateToken();
        const result = await db.query(
            `UPDATE bots SET token = $1 WHERE id = $2 AND owner_id = $3 RETURNING id`,
            [token, botId, ownerId]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Bot not found' });
        res.json({ token });
    }

    static async getToken(req, res) {
        const ownerId = req.session.user.id;
        const { botId } = req.params;
        const result = await db.query(
            `SELECT token FROM bots WHERE id = $1 AND owner_id = $2`,
            [botId, ownerId]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Bot not found' });
        res.json({ token: result.rows[0].token });
    }

    // ── Server install / remove ───────────────────────────────────────────

    static async addBotToServer(req, res) {
        const userId = req.session.user.id;
        const { botId, serverId } = req.params;

        // Bot must exist
        const bot = await db.query(`SELECT id FROM bots WHERE id = $1`, [botId]);
        if (!bot.rows.length) return res.status(404).json({ error: 'Bot not found' });

        // Invoking user must be server owner or have MANAGE_GUILD on the target server
        const server = await db.query(`SELECT owner_id FROM servers WHERE id = $1`, [serverId]);
        if (!server.rows.length) return res.status(404).json({ error: 'Server not found' });

        if (server.rows[0].owner_id !== userId) {
            const perm = await db.query(
                `SELECT BIT_OR(r.permissions) AS perms
                 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                 WHERE ur.user_id = $1 AND ur.server_id = $2`,
                [userId, serverId]
            );
            const perms = BigInt(perm.rows[0]?.perms ?? 0);
            if (!(perms & 8n) && !(perms & 32n)) {
                return res.status(403).json({ error: 'You need Manage Server permission to add bots' });
            }
        }

        const memberId = generateSnowflake();
        await db.query(
            `INSERT INTO server_members (id, server_id, user_id) VALUES ($1, $2, $3)
             ON CONFLICT (server_id, user_id) DO NOTHING`,
            [memberId, serverId, botId]
        );
        res.json({ success: true });
    }

    static async removeBotFromServer(req, res) {
        const ownerId = req.session.user.id;
        const { botId, serverId } = req.params;

        const bot = await db.query(
            `SELECT id FROM bots WHERE id = $1 AND owner_id = $2`, [botId, ownerId]
        );
        if (!bot.rows.length) return res.status(404).json({ error: 'Bot not found' });

        await db.query(
            `DELETE FROM server_members WHERE server_id = $1 AND user_id = $2`,
            [serverId, botId]
        );
        res.json({ success: true });
    }

    static async listBotServers(req, res) {
        const ownerId = req.session.user.id;
        const { botId } = req.params;

        const bot = await db.query(
            `SELECT id FROM bots WHERE id = $1 AND owner_id = $2`, [botId, ownerId]
        );
        if (!bot.rows.length) return res.status(404).json({ error: 'Bot not found' });

        const result = await db.query(
            `SELECT s.id, s.name, s.icon
             FROM server_members sm JOIN servers s ON s.id = sm.server_id
             WHERE sm.user_id = $1`,
            [botId]
        );
        res.json({ servers: result.rows });
    }

    // ── Slash command management ──────────────────────────────────────────

    static async listCommands(req, res) {
        const ownerId = req.session.user.id;
        const { botId, serverId } = req.params;

        const bot = await db.query(
            `SELECT id FROM bots WHERE id = $1 AND owner_id = $2`, [botId, ownerId]
        );
        if (!bot.rows.length) return res.status(404).json({ error: 'Bot not found' });

        const result = await db.query(
            `SELECT id, name, description, options, created_at
             FROM slash_commands WHERE bot_id = $1 AND server_id = $2
             ORDER BY name ASC`,
            [botId, serverId]
        );
        res.json({ commands: result.rows });
    }

    static async upsertCommand(req, res) {
        const ownerId = req.session.user.id;
        const { botId, serverId } = req.params;
        const { name, description, options } = req.body;

        if (!name?.match(/^[\w-]{1,32}$/)) return res.status(400).json({ error: 'Command name must be 1-32 word characters' });
        if (!description?.trim()) return res.status(400).json({ error: 'Description is required' });

        const bot = await db.query(
            `SELECT id FROM bots WHERE id = $1 AND owner_id = $2`, [botId, ownerId]
        );
        if (!bot.rows.length) return res.status(404).json({ error: 'Bot not found' });

        const id = generateSnowflake();
        const result = await db.query(
            `INSERT INTO slash_commands (id, bot_id, server_id, name, description, options)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (bot_id, server_id, name)
             DO UPDATE SET description = $5, options = $6
             RETURNING id, name, description, options`,
            [id, botId, serverId, name.toLowerCase(), description.trim(), JSON.stringify(options || [])]
        );
        res.json({ command: result.rows[0] });
    }

    static async deleteCommand(req, res) {
        const ownerId = req.session.user.id;
        const { botId, commandId } = req.params;

        const bot = await db.query(
            `SELECT id FROM bots WHERE id = $1 AND owner_id = $2`, [botId, ownerId]
        );
        if (!bot.rows.length) return res.status(404).json({ error: 'Bot not found' });

        await db.query(`DELETE FROM slash_commands WHERE id = $1 AND bot_id = $2`, [commandId, botId]);
        res.json({ success: true });
    }
}
