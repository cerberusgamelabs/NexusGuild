// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /utils/channelPerms.js

import db from '../config/database.js';
import { PermissionHandler, PERMISSIONS } from '../config/permissions.js';

// Resolve effective perms for one user in one channel.
export async function resolveChannelPerms(userId, serverId, channelId) {
    // 1. Owner bypass
    const ownerRes = await db.query('SELECT owner_id FROM servers WHERE id = $1', [serverId]);
    const isOwner = ownerRes.rows[0]?.owner_id === userId;
    if (isOwner) return ~0n; // all perms

    const [rolesRes, everyoneRes] = await Promise.all([
        db.query(
            `SELECT COALESCE(bit_or(r.permissions::bigint), 0)::text AS perms
             FROM roles r JOIN user_roles ur ON r.id = ur.role_id
             WHERE ur.user_id = $1 AND ur.server_id = $2`,
            [userId, serverId]
        ),
        db.query(`SELECT id, permissions FROM roles WHERE server_id = $1 AND name = '@everyone'`, [serverId]),
    ]);

    let base = BigInt(rolesRes.rows[0]?.perms || '0');
    const everyoneRoleId = everyoneRes.rows[0]?.id;
    if (everyoneRes.rows[0]) base |= BigInt(everyoneRes.rows[0].permissions);

    // 2. ADMINISTRATOR bypass
    if (PermissionHandler.hasPermission(base, PERMISSIONS.ADMINISTRATOR)) return ~0n;

    // 3. Fetch all overrides for this channel
    const overridesRes = await db.query(
        `SELECT cpo.target_id, cpo.target_type, cpo.allow, cpo.deny
         FROM channel_permission_overrides cpo
         WHERE cpo.channel_id = $1
           AND (cpo.target_type = 'role' OR (cpo.target_type = 'member' AND cpo.target_id = $2))`,
        [channelId, userId]
    );

    // Get user's role IDs
    const userRolesRes = await db.query(
        `SELECT role_id FROM user_roles WHERE user_id = $1 AND server_id = $2`,
        [userId, serverId]
    );
    const userRoleIds = new Set(userRolesRes.rows.map(r => r.role_id));

    let perms = base;

    // 3. @everyone channel override
    const everyoneOverride = overridesRes.rows.find(o => o.target_id === everyoneRoleId);
    if (everyoneOverride) {
        perms &= ~BigInt(everyoneOverride.deny);
        perms |= BigInt(everyoneOverride.allow);
    }

    // 4. Role overrides
    let roleAllow = 0n, roleDeny = 0n;
    for (const o of overridesRes.rows) {
        if (o.target_type === 'role' && o.target_id !== everyoneRoleId && userRoleIds.has(o.target_id)) {
            roleAllow |= BigInt(o.allow);
            roleDeny  |= BigInt(o.deny);
        }
    }
    perms &= ~roleDeny;
    perms |= roleAllow;

    // 5. Member override
    const memberOverride = overridesRes.rows.find(o => o.target_type === 'member' && o.target_id === userId);
    if (memberOverride) {
        perms &= ~BigInt(memberOverride.deny);
        perms |= BigInt(memberOverride.allow);
    }

    return perms;
}

// Batch version: fetch all overrides for a server in one query,
// compute server-level base once, then resolve per channel.
export async function batchResolveChannelPerms(userId, serverId, channelIds) {
    if (channelIds.length === 0) return {};

    const ownerRes = await db.query('SELECT owner_id FROM servers WHERE id = $1', [serverId]);
    if (ownerRes.rows[0]?.owner_id === userId) {
        const result = {};
        channelIds.forEach(id => { result[id] = ~0n; });
        return result;
    }

    const [rolesRes, everyoneRes, userRolesRes, overridesRes] = await Promise.all([
        db.query(
            `SELECT COALESCE(bit_or(r.permissions::bigint), 0)::text AS perms
             FROM roles r JOIN user_roles ur ON r.id = ur.role_id
             WHERE ur.user_id = $1 AND ur.server_id = $2`,
            [userId, serverId]
        ),
        db.query(`SELECT id, permissions FROM roles WHERE server_id = $1 AND name = '@everyone'`, [serverId]),
        db.query(`SELECT role_id FROM user_roles WHERE user_id = $1 AND server_id = $2`, [userId, serverId]),
        db.query(
            `SELECT channel_id, target_id, target_type, allow, deny
             FROM channel_permission_overrides
             WHERE channel_id = ANY($1::varchar[])`,
            [channelIds]
        ),
    ]);

    let base = BigInt(rolesRes.rows[0]?.perms || '0');
    const everyoneRow = everyoneRes.rows[0];
    const everyoneRoleId = everyoneRow?.id;
    if (everyoneRow) base |= BigInt(everyoneRow.permissions);

    const isAdmin = PermissionHandler.hasPermission(base, PERMISSIONS.ADMINISTRATOR);
    const userRoleIds = new Set(userRolesRes.rows.map(r => r.role_id));

    // Group overrides by channel
    const byChannel = {};
    for (const o of overridesRes.rows) {
        if (!byChannel[o.channel_id]) byChannel[o.channel_id] = [];
        byChannel[o.channel_id].push(o);
    }

    const result = {};
    for (const channelId of channelIds) {
        if (isAdmin) { result[channelId] = ~0n; continue; }

        let perms = base;
        const overrides = byChannel[channelId] || [];

        // @everyone override
        const eo = overrides.find(o => o.target_id === everyoneRoleId);
        if (eo) { perms &= ~BigInt(eo.deny); perms |= BigInt(eo.allow); }

        // Role overrides
        let roleAllow = 0n, roleDeny = 0n;
        for (const o of overrides) {
            if (o.target_type === 'role' && o.target_id !== everyoneRoleId && userRoleIds.has(o.target_id)) {
                roleAllow |= BigInt(o.allow);
                roleDeny  |= BigInt(o.deny);
            }
        }
        perms &= ~roleDeny;
        perms |= roleAllow;

        // Member override
        const mo = overrides.find(o => o.target_type === 'member' && o.target_id === userId);
        if (mo) { perms &= ~BigInt(mo.deny); perms |= BigInt(mo.allow); }

        result[channelId] = perms;
    }
    return result;
}
