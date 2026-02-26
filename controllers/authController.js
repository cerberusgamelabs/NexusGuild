// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/authController.js

import bcrypt from "bcryptjs";
import db from "../config/database.js";
import { generateSnowflake } from "#utils/functions";
import { log, tags } from "#utils/logging";

class AuthController {
    static async register(req, res) {
        try {
            const { username, email, password } = req.body;

            const existingUser = await db.query(
                'SELECT id FROM users WHERE email = $1 OR username = $2',
                [email, username]
            );

            if (existingUser.rows.length > 0) {
                return res.status(400).json({
                    error: 'User with this email or username already exists'
                });
            }

            const passwordHash = await bcrypt.hash(password, 10);
            const id = generateSnowflake();

            const result = await db.query(
                `INSERT INTO users (id, username, email, password_hash, avatar, status)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id, username, email, avatar, status, created_at`,
                [id, username, email, passwordHash, null, 'online']
            );

            const user = result.rows[0];

            req.session.user = {
                id: user.id,
                username: user.username,
                email: user.email
            };

            log(tags.success, `User registered: ${username} (${id})`);

            res.status(201).json({
                message: 'User registered successfully',
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    avatar: user.avatar,
                    status: user.status
                }
            });
        } catch (error) {
            log(tags.error, 'Registration error:', error);
            res.status(500).json({ error: 'Failed to register user' });
        }
    }

    static async login(req, res) {
        try {
            const { email, password } = req.body;

            const result = await db.query(
                'SELECT * FROM users WHERE email = $1',
                [email]
            );

            if (result.rows.length === 0) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const user = result.rows[0];
            const isValid = await bcrypt.compare(password, user.password_hash);

            if (!isValid) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            await db.query(
                'UPDATE users SET status = $1 WHERE id = $2',
                ['online', user.id]
            );

            req.session.user = {
                id: user.id,
                username: user.username,
                email: user.email
            };

            log(tags.info, `User logged in: ${user.username} (${user.id})`);

            res.json({
                message: 'Login successful',
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    avatar: user.avatar,
                    status: 'online'
                }
            });
        } catch (error) {
            log(tags.error, 'Login error:', error);
            res.status(500).json({ error: 'Failed to login' });
        }
    }

    static async logout(req, res) {
        try {
            if (req.session.user) {
                await db.query(
                    'UPDATE users SET status = $1 WHERE id = $2',
                    ['offline', req.session.user.id]
                );

                // Snapshot read positions for all channels in all the user's servers.
                // ON CONFLICT DO NOTHING preserves existing accurate cursors from markChannelRead;
                // only creates new rows for channels the user never explicitly visited.
                // This lets the LATERAL query in getServerChannels detect offline messages.
                await db.query(
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
                    [req.session.user.id, req.session.user.id]
                );

                const username = req.session.user.username;

                req.session.destroy((err) => {
                    if (err) {
                        log(tags.error, 'Session destruction error:', err);
                        return res.status(500).json({ error: 'Failed to logout' });
                    }
                    log(tags.info, `User logged out: ${username}`);
                    res.json({ message: 'Logout successful' });
                });
            } else {
                res.status(400).json({ error: 'No active session' });
            }
        } catch (error) {
            log(tags.error, 'Logout error:', error);
            res.status(500).json({ error: 'Failed to logout' });
        }
    }

    static async getCurrentUser(req, res) {
        try {
            const userId = req.session.user.id;

            const result = await db.query(
                'SELECT id, username, email, avatar, status, custom_status FROM users WHERE id = $1',
                [userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }

            res.json({ user: result.rows[0] });
        } catch (error) {
            log(tags.error, 'Get current user error:', error);
            res.status(500).json({ error: 'Failed to get user data' });
        }
    }
}

export default AuthController;