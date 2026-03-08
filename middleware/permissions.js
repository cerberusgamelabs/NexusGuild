// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /middleware/permissions.js

import db from "../config/database.js";
import { PermissionHandler, PERMISSIONS } from "../config/permissions.js";
import { permissionCache } from "../utils/permissionCache.js";

const checkPermission = (permission) => {
    return async (req, res, next) => {
        try {
            const userId = req.session.user.id;
            const { serverId, channelId } = req.params;
            const resolvedServerId = serverId || channelId;

            // Get permission base from cache (replaces 3 queries with 0-1)
            const base = await permissionCache.getPermissionBase(userId, resolvedServerId);
            if (!base) {
                return res.status(404).json({ error: 'Server not found' });
            }

            // Owner bypass (already in cache)
            if (base.isOwner) return next();

            // Check permission using aggregated server-level perms
            // Note: This middleware checks server-level permissions only.
            // Channel-level overrides are checked separately in controllers.
            if (PermissionHandler.hasPermission(base.basePerms, permission)) {
                next();
            } else {
                res.status(403).json({ error: 'Insufficient permissions' });
            }
        } catch (error) {
            console.error('Permission check error:', error);
            res.status(500).json({ error: 'Failed to check permissions' });
        }
    };
};

const isServerOwner = async (req, res, next) => {
    try {
        const userId = req.session.user.id;
        const { serverId } = req.params;

        const result = await db.query(
            'SELECT owner_id FROM servers WHERE id = $1',
            [serverId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Server not found' });
        }

        if (result.rows[0].owner_id === userId) {
            next();
        } else {
            res.status(403).json({ error: 'Only server owner can perform this action' });
        }
    } catch (error) {
        console.error('Owner check error:', error);
        res.status(500).json({ error: 'Failed to verify ownership' });
    }
};

const isServerMember = async (req, res, next) => {
    try {
        const userId = req.session.user.id;
        const { serverId } = req.params;

        const result = await db.query(
            'SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2',
            [serverId, userId]
        );

        if (result.rows.length > 0) {
            next();
        } else {
            res.status(403).json({ error: 'You are not a member of this server' });
        }
    } catch (error) {
        console.error('Member check error:', error);
        res.status(500).json({ error: 'Failed to verify membership' });
    }
};

export {
    checkPermission,
    isServerOwner,
    isServerMember,
    PERMISSIONS
};