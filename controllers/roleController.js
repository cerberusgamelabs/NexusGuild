// File Location: /controllers/roleController.js

import db from "../config/database.js";
import { generateSnowflake } from "#utils/functions";
import { log, tags } from "#utils/logging";

class RoleController {
    // GET /api/servers/:serverId/roles
    static async getRoles(req, res) {
        try {
            const { serverId } = req.params;
            const result = await db.query(
                `SELECT * FROM roles WHERE server_id = $1 ORDER BY position DESC, created_at ASC`,
                [serverId]
            );
            res.json({ roles: result.rows });
        } catch (error) {
            log(tags.error, 'Get roles error:', error);
            res.status(500).json({ error: 'Failed to get roles' });
        }
    }

    // POST /api/servers/:serverId/roles
    static async createRole(req, res) {
        try {
            const { serverId } = req.params;
            const { name = 'New Role', color = '#99AAB5', permissions = '0' } = req.body;
            const id = generateSnowflake();
            const posResult = await db.query(
                `SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM roles WHERE server_id = $1 AND name != '@everyone'`,
                [serverId]
            );
            const position = posResult.rows[0].pos;
            const result = await db.query(
                `INSERT INTO roles (id, server_id, name, color, permissions, position) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
                [id, serverId, name, color, permissions, position]
            );
            const io = req.app.get('io');
            io?.to(`server:${serverId}`).emit('role_updated', { serverId });
            res.status(201).json({ role: result.rows[0] });
        } catch (error) {
            log(tags.error, 'Create role error:', error);
            res.status(500).json({ error: 'Failed to create role' });
        }
    }

    // PATCH /api/servers/:serverId/roles/:roleId
    static async updateRole(req, res) {
        try {
            const { serverId, roleId } = req.params;
            const { name, color, permissions, hoist } = req.body;
            const check = await db.query(`SELECT name FROM roles WHERE id = $1`, [roleId]);
            if (check.rows[0]?.name === '@everyone' && name && name !== '@everyone') {
                return res.status(400).json({ error: 'Cannot rename @everyone' });
            }
            const result = await db.query(
                `UPDATE roles SET
                   name = COALESCE($1, name),
                   color = COALESCE($2, color),
                   permissions = COALESCE($3, permissions),
                   hoist = COALESCE($6, hoist)
                 WHERE id = $4 AND server_id = $5 RETURNING *`,
                [name, color, permissions, roleId, serverId, hoist ?? null]
            );
            if (result.rows.length === 0) return res.status(404).json({ error: 'Role not found' });
            const io = req.app.get('io');
            io?.to(`server:${serverId}`).emit('role_updated', { serverId });
            res.json({ role: result.rows[0] });
        } catch (error) {
            log(tags.error, 'Update role error:', error);
            res.status(500).json({ error: 'Failed to update role' });
        }
    }

    // PATCH /api/servers/:serverId/roles/reorder
    static async reorderRoles(req, res) {
        try {
            const { serverId } = req.params;
            const { order } = req.body;
            if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
            await Promise.all(order.map((roleId, idx) =>
                db.query(
                    `UPDATE roles SET position = $1 WHERE id = $2 AND server_id = $3 AND name != '@everyone'`,
                    [order.length - idx, roleId, serverId]
                )
            ));
            const io = req.app.get('io');
            io?.to(`server:${serverId}`).emit('role_updated', { serverId });
            res.json({ message: 'Role order updated' });
        } catch (error) {
            log(tags.error, 'Reorder roles error:', error);
            res.status(500).json({ error: 'Failed to reorder roles' });
        }
    }

    // DELETE /api/servers/:serverId/roles/:roleId
    static async deleteRole(req, res) {
        try {
            const { serverId, roleId } = req.params;
            const check = await db.query(`SELECT name FROM roles WHERE id = $1`, [roleId]);
            if (check.rows[0]?.name === '@everyone') {
                return res.status(400).json({ error: 'Cannot delete @everyone role' });
            }
            await db.query(`DELETE FROM roles WHERE id = $1 AND server_id = $2`, [roleId, serverId]);
            const io = req.app.get('io');
            io?.to(`server:${serverId}`).emit('role_updated', { serverId });
            res.json({ message: 'Role deleted' });
        } catch (error) {
            log(tags.error, 'Delete role error:', error);
            res.status(500).json({ error: 'Failed to delete role' });
        }
    }

    // GET /api/servers/:serverId/members/:memberId/roles
    static async getMemberRoles(req, res) {
        try {
            const { serverId, memberId } = req.params;
            const result = await db.query(
                `SELECT r.* FROM roles r JOIN user_roles ur ON r.id = ur.role_id
                 WHERE ur.user_id = $1 AND ur.server_id = $2`,
                [memberId, serverId]
            );
            res.json({ roles: result.rows });
        } catch (error) {
            log(tags.error, 'Get member roles error:', error);
            res.status(500).json({ error: 'Failed to get member roles' });
        }
    }

    // POST /api/servers/:serverId/members/:memberId/roles  body: { roleId }
    static async assignRole(req, res) {
        try {
            const { serverId, memberId } = req.params;
            const { roleId } = req.body;
            const check = await db.query(
                `SELECT id FROM roles WHERE id = $1 AND server_id = $2`,
                [roleId, serverId]
            );
            if (check.rows.length === 0) return res.status(404).json({ error: 'Role not found' });
            await db.query(
                `INSERT INTO user_roles (user_id, role_id, server_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
                [memberId, roleId, serverId]
            );
            const io = req.app.get('io');
            io?.to(`server:${serverId}`).emit('role_updated', { serverId });
            res.json({ message: 'Role assigned' });
        } catch (error) {
            log(tags.error, 'Assign role error:', error);
            res.status(500).json({ error: 'Failed to assign role' });
        }
    }

    // DELETE /api/servers/:serverId/members/:memberId/roles/:roleId
    static async removeRole(req, res) {
        try {
            const { serverId, memberId, roleId } = req.params;
            const check = await db.query(`SELECT name FROM roles WHERE id = $1`, [roleId]);
            if (check.rows[0]?.name === '@everyone') {
                return res.status(400).json({ error: 'Cannot remove @everyone role' });
            }
            await db.query(
                `DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2 AND server_id = $3`,
                [memberId, roleId, serverId]
            );
            const io = req.app.get('io');
            io?.to(`server:${serverId}`).emit('role_updated', { serverId });
            res.json({ message: 'Role removed' });
        } catch (error) {
            log(tags.error, 'Remove role error:', error);
            res.status(500).json({ error: 'Failed to remove role' });
        }
    }
}

export default RoleController;
