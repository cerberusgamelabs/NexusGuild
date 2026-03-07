// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/authController.js

import bcrypt from "bcryptjs";
import crypto from "crypto";
import db from "../config/database.js";
import { generateSnowflake } from "#utils/functions";
import { log, tags } from "#utils/logging";
import { sendEmail } from "../utils/email.js";

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

    static async changePassword(req, res) {
        try {
            const userId = req.session.user.id;
            const { currentPassword, newPassword } = req.body;

            if (!currentPassword || !newPassword)
                return res.status(400).json({ error: 'currentPassword and newPassword are required' });
            if (newPassword.length < 8)
                return res.status(400).json({ error: 'New password must be at least 8 characters' });

            const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
            const user = result.rows[0];

            const valid = await bcrypt.compare(currentPassword, user.password_hash);
            if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

            const hash = await bcrypt.hash(newPassword, 10);
            await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);

            log(tags.info, `Password changed for user ${userId}`);
            res.json({ message: 'Password changed successfully' });
        } catch (error) {
            log(tags.error, 'Change password error:', error);
            res.status(500).json({ error: 'Failed to change password' });
        }
    }

    static async requestPasswordReset(req, res) {
        try {
            const { email } = req.body;
            if (!email) return res.status(400).json({ error: 'Email is required' });

            const result = await db.query('SELECT id, username FROM users WHERE email = $1 AND is_bot = false', [email]);

            // Always return 200 to avoid leaking whether the email exists
            if (result.rows.length) {
                const user = result.rows[0];
                const token = crypto.randomBytes(32).toString('hex');
                const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

                // Invalidate any existing unused tokens for this user
                await db.query(
                    `UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false`,
                    [user.id]
                );
                await db.query(
                    `INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)`,
                    [token, user.id, expiresAt]
                );

                const baseUrl = process.env.CLIENT_URL || 'https://www.nexusguild.gg';
                const resetUrl = `${baseUrl}/reset-password?token=${token}`;

                await sendEmail({
                    to: email,
                    subject: 'Reset your NexusGuild password',
                    html: `
                        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#1e1f22;color:#dbdee1;padding:32px;border-radius:8px;">
                            <h2 style="color:#fff;margin-bottom:8px;">Password Reset</h2>
                            <p style="color:#949ba4;">Hi ${user.username},</p>
                            <p style="color:#949ba4;">Someone requested a password reset for your NexusGuild account. Click the button below to set a new password. This link expires in 1 hour.</p>
                            <a href="${resetUrl}" style="display:inline-block;margin:24px 0;padding:12px 24px;background:#5865f2;color:#fff;border-radius:4px;text-decoration:none;font-weight:600;">Reset Password</a>
                            <p style="color:#949ba4;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
                        </div>
                    `,
                });

                log(tags.info, `Password reset requested for ${email}`);
            }

            res.json({ message: 'If that email is registered, a reset link has been sent.' });
        } catch (error) {
            log(tags.error, 'Password reset request error:', error);
            res.status(500).json({ error: 'Failed to process request' });
        }
    }

    static async confirmPasswordReset(req, res) {
        try {
            const { token, newPassword } = req.body;
            if (!token || !newPassword)
                return res.status(400).json({ error: 'token and newPassword are required' });
            if (newPassword.length < 8)
                return res.status(400).json({ error: 'Password must be at least 8 characters' });

            const result = await db.query(
                `SELECT user_id FROM password_reset_tokens
                 WHERE token = $1 AND used = false AND expires_at > NOW()`,
                [token]
            );
            if (!result.rows.length)
                return res.status(400).json({ error: 'Invalid or expired reset link' });

            const { user_id } = result.rows[0];
            const hash = await bcrypt.hash(newPassword, 10);

            await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user_id]);
            await db.query('UPDATE password_reset_tokens SET used = true WHERE token = $1', [token]);

            log(tags.info, `Password reset completed for user ${user_id}`);
            res.json({ message: 'Password reset successfully' });
        } catch (error) {
            log(tags.error, 'Password reset confirm error:', error);
            res.status(500).json({ error: 'Failed to reset password' });
        }
    }
}

export default AuthController;