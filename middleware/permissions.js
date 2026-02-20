// File Location: /middleware/permissions.js

import db from "../config/database.js";
import { PermissionHandler, PERMISSIONS } from "../config/permissions.js";

const checkPermission = (permission) => {
    return async (req, res, next) => {
        try {
            const userId = req.session.user.id;
            const { serverId, channelId } = req.params;
            const resolvedServerId = serverId || channelId;

            // Server owners have implicit administrator ? bypass permission check
            const ownerCheck = await db.query(
                'SELECT owner_id FROM servers WHERE id = $1',
                [resolvedServerId]
            );
            if (ownerCheck.rows.length > 0 && ownerCheck.rows[0].owner_id === userId) {
                return next();
            }

            // Get user's roles in the server
            const rolesResult = await db.query(`
                SELECT r.permissions
                FROM roles r
                JOIN user_roles ur ON r.id = ur.role_id
                WHERE ur.user_id = $1 AND ur.server_id = $2
            `, [userId, resolvedServerId]);

            // Always include @everyone permissions
            const everyoneResult = await db.query(`
                SELECT permissions FROM roles
                WHERE server_id = $1 AND name = '@everyone'
            `, [resolvedServerId]);

            // Calculate combined permissions
            let userPermissions = 0n;
            for (const role of rolesResult.rows) {
                userPermissions = userPermissions | BigInt(role.permissions);
            }
            if (everyoneResult.rows.length > 0) {
                userPermissions = userPermissions | BigInt(everyoneResult.rows[0].permissions);
            }

            // Check if user has the required permission
            if (PermissionHandler.hasPermission(userPermissions, permission)) {
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