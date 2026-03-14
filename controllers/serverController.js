// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/serverController.js

import db from "../config/database.js";
import { DEFAULT_PERMISSIONS, PERMISSIONS, PermissionHandler } from "../config/permissions.js";
import { v4 as uuidv4 } from "uuid";
import { generateSnowflake } from "#utils/functions";
import { log, tags } from "#utils/logging";
import { logAuditEvent } from "../utils/audit.js";

class ServerController {
    static async createServer(req, res) {
        const client = await db.pool.connect();
        try {
            const { name, icon } = req.body;
            const userId = req.session.user.id;
            const username = req.session.user.username;

            await client.query('BEGIN');

            const serverId = generateSnowflake();
            const serverResult = await client.query(
                `INSERT INTO servers (id, name, icon, owner_id) VALUES ($1, $2, $3, $4) RETURNING *`,
                [serverId, name, icon || null, userId]
            );
            const server = serverResult.rows[0];

            const memberId = generateSnowflake();
            await client.query(
                `INSERT INTO server_members (id, server_id, user_id) VALUES ($1, $2, $3)`,
                [memberId, server.id, userId]
            );

            const roleId = generateSnowflake();
            const roleResult = await client.query(
                `INSERT INTO roles (id, server_id, name, color, permissions, position) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [roleId, server.id, '@everyone', '#99AAB5', DEFAULT_PERMISSIONS.toString(), 0]
            );
            await client.query(
                `INSERT INTO user_roles (user_id, role_id, server_id) VALUES ($1, $2, $3)`,
                [userId, roleResult.rows[0].id, server.id]
            );

            const textCatId = generateSnowflake();
            const textCat = await client.query(
                `INSERT INTO categories (id, server_id, name, position) VALUES ($1, $2, $3, $4) RETURNING *`,
                [textCatId, server.id, 'Text Channels', 0]
            );

            const voiceCatId = generateSnowflake();
            const voiceCat = await client.query(
                `INSERT INTO categories (id, server_id, name, position) VALUES ($1, $2, $3, $4) RETURNING *`,
                [voiceCatId, server.id, 'Voice Channels', 1]
            );

            await client.query(
                `INSERT INTO channels (id, server_id, category_id, name, type, position) VALUES ($1,$2,$3,$4,$5,$6)`,
                [generateSnowflake(), server.id, textCat.rows[0].id, 'general', 'text', 0]
            );
            await client.query(
                `INSERT INTO channels (id, server_id, category_id, name, type, position) VALUES ($1,$2,$3,$4,$5,$6)`,
                [generateSnowflake(), server.id, textCat.rows[0].id, 'announcements', 'announcement', 1]
            );
            await client.query(
                `INSERT INTO channels (id, server_id, category_id, name, type, position) VALUES ($1,$2,$3,$4,$5,$6)`,
                [generateSnowflake(), server.id, voiceCat.rows[0].id, 'General', 'voice', 0]
            );

            await client.query('COMMIT');
            log(tags.success, `Server created: "${name}" (${serverId}) by ${username} ${userId}`);
            res.status(201).json({ message: 'Server created successfully', server });
        } catch (error) {
            await client.query('ROLLBACK');
            log(tags.error, 'Create server error:', error);
            res.status(500).json({ error: 'Failed to create server' });
        } finally {
            client.release();
        }
    }

    static async getUserServers(req, res) {
        try {
            const userId = req.session.user.id;
            const result = await db.query(
                `SELECT s.*, sm.joined_at
                 FROM servers s
                 JOIN server_members sm ON s.id = sm.server_id
                 WHERE sm.user_id = $1
                 ORDER BY sm.joined_at`,
                [userId]
            );
            res.json({ servers: result.rows });
        } catch (error) {
            log(tags.error, 'Get user servers error:', error);
            res.status(500).json({ error: 'Failed to get servers' });
        }
    }

    static async getServer(req, res) {
        try {
            const { serverId } = req.params;
            const result = await db.query('SELECT * FROM servers WHERE id = $1', [serverId]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Server not found' });
            res.json({ server: result.rows[0] });
        } catch (error) {
            log(tags.error, 'Get server error:', error);
            res.status(500).json({ error: 'Failed to get server' });
        }
    }

    static async updateServer(req, res) {
        try {
            const { serverId } = req.params;
            const { name, icon } = req.body;
            const result = await db.query(
                `UPDATE servers SET name = COALESCE($1, name), icon = COALESCE($2, icon) WHERE id = $3 RETURNING *`,
                [name, icon, serverId]
            );
            if (result.rows.length === 0) return res.status(404).json({ error: 'Server not found' });
            log(tags.info, `Server updated: "${result.rows[0].name}" [${serverId}]`);
            logAuditEvent(serverId, 'server_update', req.session.user.id, serverId, 'server', { name: result.rows[0].name });
            res.json({ message: 'Server updated successfully', server: result.rows[0] });
        } catch (error) {
            log(tags.error, 'Update server error:', error);
            res.status(500).json({ error: 'Failed to update server' });
        }
    }

    static async deleteServer(req, res) {
        try {
            const { serverId } = req.params;
            const nameResult = await db.query('SELECT name FROM servers WHERE id = $1', [serverId]);
            const serverName = nameResult.rows[0]?.name || 'Unknown';
            await db.query('DELETE FROM servers WHERE id = $1', [serverId]);
            log(tags.warning, `Server deleted: "${serverName}" [${serverId}]`);
            res.json({ message: 'Server deleted successfully' });
        } catch (error) {
            log(tags.error, 'Delete server error:', error);
            res.status(500).json({ error: 'Failed to delete server' });
        }
    }

    static async createInvite(req, res) {
        try {
            const { serverId } = req.params;
            const { maxUses = 0, expiresIn = null } = req.body;
            const userId = req.session.user.id;

            const inviteId = generateSnowflake();
            const code = uuidv4().substring(0, 8).toUpperCase();
            let expiresAt = null;
            if (expiresIn) expiresAt = new Date(Date.now() + expiresIn * 1000);

            const result = await db.query(
                `INSERT INTO invites (id, code, server_id, inviter_id, max_uses, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [inviteId, code, serverId, userId, maxUses, expiresAt]
            );

            const serverName = await db.query('SELECT name FROM servers WHERE id = $1', [serverId]);
            log(tags.info, `Invite created: ${code} for "${serverName.rows[0]?.name}" [${serverId}] by user [${userId}]`);
            res.status(201).json({ message: 'Invite created successfully', invite: result.rows[0] });
        } catch (error) {
            log(tags.error, 'Create invite error:', error);
            res.status(500).json({ error: 'Failed to create invite' });
        }
    }

    static async getServerInvites(req, res) {
        try {
            const { serverId } = req.params;
            const result = await db.query(
                `SELECT i.*, u.username as inviter_username
                 FROM invites i
                 LEFT JOIN users u ON i.inviter_id = u.id
                 WHERE i.server_id = $1
                   AND (i.expires_at IS NULL OR i.expires_at > NOW())
                   AND (i.max_uses = 0 OR i.uses < i.max_uses)
                 ORDER BY i.created_at DESC`,
                [serverId]
            );
            res.json({ invites: result.rows });
        } catch (error) {
            log(tags.error, 'Get invites error:', error);
            res.status(500).json({ error: 'Failed to get invites' });
        }
    }

    static async joinServer(req, res) {
        try {
            const { code } = req.body;
            const userId = req.session.user.id;

            if (!code) return res.status(400).json({ error: 'Invite code is required' });

            const inviteResult = await db.query(
                `SELECT * FROM invites
                 WHERE UPPER(code) = UPPER($1)
                   AND (expires_at IS NULL OR expires_at > NOW())
                   AND (max_uses = 0 OR uses < max_uses)`,
                [code]
            );

            if (inviteResult.rows.length === 0) {
                return res.status(404).json({ error: 'Invalid or expired invite code' });
            }

            const invite = inviteResult.rows[0];

            const banCheck = await db.query(
                `SELECT 1 FROM bans WHERE server_id = $1 AND user_id = $2`,
                [invite.server_id, userId]
            );
            if (banCheck.rows.length > 0) {
                return res.status(403).json({ error: 'You are banned from this server' });
            }

            const memberCheck = await db.query(
                'SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2',
                [invite.server_id, userId]
            );

            if (memberCheck.rows.length > 0) {
                const serverResult = await db.query('SELECT * FROM servers WHERE id = $1', [invite.server_id]);
                return res.json({ message: 'Already a member', server: serverResult.rows[0] });
            }

            const memberId = generateSnowflake();
            await db.query(
                'INSERT INTO server_members (id, server_id, user_id) VALUES ($1, $2, $3)',
                [memberId, invite.server_id, userId]
            );
            await db.query('UPDATE invites SET uses = uses + 1 WHERE id = $1', [invite.id]);

            const everyoneRole = await db.query(
                `SELECT id FROM roles WHERE server_id = $1 AND name = '@everyone'`,
                [invite.server_id]
            );
            if (everyoneRole.rows.length > 0) {
                await db.query(
                    `INSERT INTO user_roles (user_id, role_id, server_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                    [userId, everyoneRole.rows[0].id, invite.server_id]
                );
            }

            const serverResult = await db.query('SELECT * FROM servers WHERE id = $1', [invite.server_id]);
            const server = serverResult.rows[0];

            const userResult = await db.query('SELECT username FROM users WHERE id = $1', [userId]);
            const username = userResult.rows[0].username;

            const io = req.app.get('io');
            if (io) {
                io.to(`server:${server.id}`).emit('user_joined', {
                    userId,
                    username,
                    serverId: server.id
                });
            }

            // Bootstrap read cursors for every channel in the newly joined server
            // so the user starts tracking unreads from this moment forward.
            await db.query(
                `INSERT INTO user_channel_reads (user_id, channel_id, last_read_message_id)
                 SELECT $1, c.id, m_last.id
                 FROM channels c
                 JOIN LATERAL (
                     SELECT id FROM messages
                     WHERE channel_id = c.id
                     ORDER BY created_at DESC
                     LIMIT 1
                 ) m_last ON true
                 WHERE c.server_id = $2
                   AND c.type = 'text'
                 ON CONFLICT (user_id, channel_id) DO NOTHING`,
                [userId, invite.server_id]
            );

            log(tags.info, `User "${username}" [${userId}] joined "${server.name}" [${server.id}] via invite ${code}`);
            res.json({ message: 'Joined server successfully', server });
        } catch (error) {
            log(tags.error, 'Join server error:', error);
            res.status(500).json({ error: 'Failed to join server' });
        }
    }

    static async getServerMembers(req, res) {
        try {
            const { serverId } = req.params;
            const userId = req.session.user.id;
            const [membersResult, myPermsResult] = await Promise.all([
                db.query(
                    `SELECT u.id, u.username, u.avatar, u.status, u.custom_status, sm.nickname, sm.joined_at,
                            (SELECT r.color FROM roles r
                             JOIN user_roles ur ON r.id = ur.role_id
                             WHERE ur.user_id = u.id AND ur.server_id = $1
                               AND r.name != '@everyone'
                             ORDER BY r.position DESC
                             LIMIT 1) AS role_color,
                            (SELECT r.name FROM roles r
                             JOIN user_roles ur ON r.id = ur.role_id
                             WHERE ur.user_id = u.id AND ur.server_id = $1
                               AND r.hoist = TRUE
                             ORDER BY r.position DESC
                             LIMIT 1) AS hoist_role_name,
                            (SELECT r.position FROM roles r
                             JOIN user_roles ur ON r.id = ur.role_id
                             WHERE ur.user_id = u.id AND ur.server_id = $1
                               AND r.hoist = TRUE
                             ORDER BY r.position DESC
                             LIMIT 1) AS hoist_role_position
                     FROM users u
                     JOIN server_members sm ON u.id = sm.user_id
                     WHERE sm.server_id = $1
                     ORDER BY u.username`,
                    [serverId]
                ),
                db.query(
                    `SELECT COALESCE(bit_or(r.permissions), 0) AS my_permissions
                     FROM roles r
                     WHERE r.server_id = $1
                       AND (r.name = '@everyone' OR r.id IN (
                         SELECT role_id FROM user_roles WHERE user_id = $2 AND server_id = $1
                       ))`,
                    [serverId, userId]
                )
            ]);
            res.json({
                members: membersResult.rows,
                myPermissions: String(myPermsResult.rows[0]?.my_permissions || '0')
            });
        } catch (error) {
            log(tags.error, 'Get server members error:', error);
            res.status(500).json({ error: 'Failed to get server members' });
        }
    }

    static async leaveServer(req, res) {
        try {
            const { serverId } = req.params;
            const userId = req.session.user.id;
            const ownerCheck = await db.query(`SELECT owner_id FROM servers WHERE id = $1`, [serverId]);
            if (ownerCheck.rows[0]?.owner_id === userId) {
                return res.status(400).json({ error: 'Server owner cannot leave — delete the server instead' });
            }
            await db.query(`DELETE FROM server_members WHERE server_id = $1 AND user_id = $2`, [serverId, userId]);
            const io = req.app.get('io');
            io?.to(`server:${serverId}`).emit('user_left', { userId, serverId });
            res.json({ message: 'Left server' });
        } catch (error) {
            log(tags.error, 'Leave server error:', error);
            res.status(500).json({ error: 'Failed to leave server' });
        }
    }

    static async getSettingsMembers(req, res) {
        try {
            const { serverId } = req.params;
            const result = await db.query(
                `SELECT u.id, u.username, u.avatar, u.status, sm.nickname, sm.joined_at,
                        COALESCE(
                          json_agg(DISTINCT jsonb_build_object('id', r.id, 'name', r.name, 'color', r.color))
                          FILTER (WHERE r.id IS NOT NULL AND r.name != '@everyone'), '[]'
                        ) AS roles
                 FROM users u
                 JOIN server_members sm ON u.id = sm.user_id AND sm.server_id = $1
                 LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.server_id = $1
                 LEFT JOIN roles r ON r.id = ur.role_id
                 GROUP BY u.id, u.username, u.avatar, u.status, sm.nickname, sm.joined_at
                 ORDER BY u.username`,
                [serverId]
            );
            res.json({ members: result.rows });
        } catch (error) {
            log(tags.error, 'Get settings members error:', error);
            res.status(500).json({ error: 'Failed to get members' });
        }
    }

    static async kickMember(req, res) {
        try {
            const { serverId, memberId } = req.params;
            if (memberId === req.session.user.id) {
                return res.status(400).json({ error: 'Cannot kick yourself' });
            }
            const ownerCheck = await db.query(`SELECT owner_id FROM servers WHERE id = $1`, [serverId]);
            if (ownerCheck.rows[0]?.owner_id === memberId) {
                return res.status(400).json({ error: 'Cannot kick the server owner' });
            }
            await db.query(`DELETE FROM server_members WHERE server_id = $1 AND user_id = $2`, [serverId, memberId]);
            logAuditEvent(serverId, 'member_kick', req.session.user.id, memberId, 'user');
            const io = req.app.get('io');
            io?.to(`server:${serverId}`).emit('user_left', { userId: memberId, serverId });
            res.json({ message: 'Member kicked' });
        } catch (error) {
            log(tags.error, 'Kick member error:', error);
            res.status(500).json({ error: 'Failed to kick member' });
        }
    }

    static async banMember(req, res) {
        try {
            const { serverId, memberId } = req.params;
            const { reason } = req.body;
            if (memberId === req.session.user.id) {
                return res.status(400).json({ error: 'Cannot ban yourself' });
            }
            const ownerCheck = await db.query(`SELECT owner_id FROM servers WHERE id = $1`, [serverId]);
            if (ownerCheck.rows[0]?.owner_id === memberId) {
                return res.status(400).json({ error: 'Cannot ban the server owner' });
            }
            const id = generateSnowflake();
            await db.query(
                `INSERT INTO bans (id, server_id, user_id, banned_by, reason)
                 VALUES ($1,$2,$3,$4,$5) ON CONFLICT (server_id, user_id) DO UPDATE SET reason = EXCLUDED.reason`,
                [id, serverId, memberId, req.session.user.id, reason || null]
            );
            await db.query(`DELETE FROM server_members WHERE server_id = $1 AND user_id = $2`, [serverId, memberId]);
            logAuditEvent(serverId, 'member_ban', req.session.user.id, memberId, 'user', { reason: reason || null });
            const io = req.app.get('io');
            io?.to(`server:${serverId}`).emit('user_left', { userId: memberId, serverId });
            res.json({ message: 'Member banned' });
        } catch (error) {
            log(tags.error, 'Ban member error:', error);
            res.status(500).json({ error: 'Failed to ban member' });
        }
    }

    static async unbanMember(req, res) {
        try {
            const { serverId, memberId } = req.params;
            await db.query(`DELETE FROM bans WHERE server_id = $1 AND user_id = $2`, [serverId, memberId]);
            logAuditEvent(serverId, 'member_unban', req.session.user.id, memberId, 'user');
            res.json({ message: 'Member unbanned' });
        } catch (error) {
            log(tags.error, 'Unban member error:', error);
            res.status(500).json({ error: 'Failed to unban member' });
        }
    }

    static async getBans(req, res) {
        try {
            const { serverId } = req.params;
            const result = await db.query(
                `SELECT b.*, u.username, u.avatar FROM bans b
                 JOIN users u ON b.user_id = u.id
                 WHERE b.server_id = $1 ORDER BY b.created_at DESC`,
                [serverId]
            );
            res.json({ bans: result.rows });
        } catch (error) {
            log(tags.error, 'Get bans error:', error);
            res.status(500).json({ error: 'Failed to get bans' });
        }
    }

    static async setNickname(req, res) {
        try {
            const { serverId, memberId } = req.params;
            const { nickname } = req.body;
            const userId = req.session.user.id;
            const isSelf = memberId === userId;

            // Server owner bypasses all checks
            const ownerCheck = await db.query(`SELECT owner_id FROM servers WHERE id = $1`, [serverId]);
            const isOwner = ownerCheck.rows[0]?.owner_id === userId;

            if (!isOwner) {
                const requiredPerm = isSelf ? PERMISSIONS.CHANGE_NICKNAME : PERMISSIONS.MANAGE_NICKNAMES;
                const [rolesResult, everyoneResult] = await Promise.all([
                    db.query(
                        `SELECT COALESCE(bit_or(r.permissions::bigint), 0)::text AS perms
                         FROM roles r JOIN user_roles ur ON r.id = ur.role_id
                         WHERE ur.user_id = $1 AND ur.server_id = $2`,
                        [userId, serverId]
                    ),
                    db.query(`SELECT permissions FROM roles WHERE server_id = $1 AND name = '@everyone'`, [serverId]),
                ]);
                let userPerms = BigInt(rolesResult.rows[0]?.perms || '0');
                if (everyoneResult.rows[0]) userPerms |= BigInt(everyoneResult.rows[0].permissions);
                if (!PermissionHandler.hasPermission(userPerms, requiredPerm)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
            }

            await db.query(
                `UPDATE server_members SET nickname = $1 WHERE server_id = $2 AND user_id = $3`,
                [nickname || null, serverId, memberId]
            );
            res.json({ message: 'Nickname updated' });
        } catch (error) {
            log(tags.error, 'Set nickname error:', error);
            res.status(500).json({ error: 'Failed to set nickname' });
        }
    }
    static async uploadServerIcon(req, res) {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            const { serverId } = req.params;
            const iconUrl = `/uploads/${req.file.filename}`;
            const result = await db.query(
                `UPDATE servers SET icon = $1 WHERE id = $2 RETURNING *`,
                [iconUrl, serverId]
            );
            if (result.rows.length === 0) return res.status(404).json({ error: 'Server not found' });
            log(tags.info, `Server icon updated for ${serverId}`);
            res.json({ server: result.rows[0] });
        } catch (error) {
            log(tags.error, 'Upload server icon error:', error);
            res.status(500).json({ error: 'Failed to upload server icon' });
        }
    }

    // GET /api/servers/preview/:code — public, no auth required
    static async getInvitePreview(req, res) {
        try {
            const { code } = req.params;
            const result = await db.query(
                `SELECT s.name, s.icon, s.id,
                        u.username AS inviter_username,
                        (SELECT COUNT(*) FROM server_members WHERE server_id = s.id) AS member_count,
                        (i.expires_at IS NOT NULL AND i.expires_at < NOW())
                            OR (i.max_uses > 0 AND i.uses >= i.max_uses) AS is_expired
                 FROM invites i
                 JOIN servers s ON s.id = i.server_id
                 LEFT JOIN users u ON u.id = i.inviter_id
                 WHERE UPPER(i.code) = UPPER($1)`,
                [code]
            );
            if (result.rows.length === 0) return res.status(404).json({ error: 'Invite not found' });
            const row = result.rows[0];
            res.json({
                serverName: row.name,
                serverIcon: row.icon,
                serverId: row.id,
                inviterUsername: row.inviter_username,
                memberCount: parseInt(row.member_count),
                isExpired: row.is_expired,
            });
        } catch (error) {
            log(tags.error, 'Get invite preview error:', error);
            res.status(500).json({ error: 'Failed to get invite preview' });
        }
    }

    static async getServerNicRegion(req, res) {
        try {
            const result = await db.query(`
                SELECT r.id, r.name, r.visibility, r.seed,
                       (SELECT COUNT(*) FROM nic_resource_nodes WHERE region_id = r.id) as resource_count,
                       (SELECT COUNT(*) FROM nic_entry_points WHERE region_id = r.id) as entry_count,
                       (SELECT COUNT(*) FROM nic_structures WHERE region_id = r.id AND active = true) as structure_count,
                       s.nic_minimap_enabled
                FROM nic_regions r
                JOIN servers s ON s.id = r.server_id
                WHERE r.server_id = $1 AND r.status = 'active'
                LIMIT 1
            `, [req.params.serverId]);
            if (!result.rows.length) return res.json(null);
            res.json(result.rows[0]);
        } catch (error) {
            log(tags.error, 'Get server NIC region error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }

    static async updateNicSettings(req, res) {
        const { nic_minimap_enabled } = req.body;
        try {
            await db.query(
                'UPDATE servers SET nic_minimap_enabled = $1 WHERE id = $2',
                [!!nic_minimap_enabled, req.params.serverId]
            );
            res.json({ ok: true });
        } catch (error) {
            log(tags.error, 'Update NIC settings error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }
}

export default ServerController;