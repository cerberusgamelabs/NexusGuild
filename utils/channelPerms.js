// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /utils/channelPerms.js

import db from '../config/database.js';
import { PermissionHandler, PERMISSIONS } from '../config/permissions.js';
import { permissionCache } from './permissionCache.js';

// Resolve effective perms for one user in one channel.
export async function resolveChannelPerms(userId, serverId, channelId) {
    // Get permission base from cache (reduces 5 queries → 2)
    const base = await permissionCache.getPermissionBase(userId, serverId);
    if (!base) return 0n; // server doesn't exist

    if (base.isOwner || base.hasAdmin) return ~0n; // all perms

    // Fetch channel overrides (only needed query)
    const overridesRes = await db.query(
        `SELECT cpo.target_id, cpo.target_type, cpo.allow, cpo.deny
         FROM channel_permission_overrides cpo
         WHERE cpo.channel_id = $1
           AND (cpo.target_type = 'role' OR (cpo.target_type = 'member' AND cpo.target_id = $2))`,
        [channelId, userId]
    );

    let perms = base.basePerms;

    // @everyone override
    const everyoneOverride = overridesRes.rows.find(o => o.target_id === base.everyoneRoleId);
    if (everyoneOverride) {
        perms &= ~BigInt(everyoneOverride.deny);
        perms |= BigInt(everyoneOverride.allow);
    }

    // Role overrides
    let roleAllow = 0n, roleDeny = 0n;
    for (const o of overridesRes.rows) {
        if (o.target_type === 'role' && o.target_id !== base.everyoneRoleId && base.userRoleIds.has(o.target_id)) {
            roleAllow |= BigInt(o.allow);
            roleDeny  |= BigInt(o.deny);
        }
    }
    perms &= ~roleDeny;
    perms |= roleAllow;

    // Member override
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

    // Get permission base (cached after first call)
    const base = await permissionCache.getPermissionBase(userId, serverId);
    if (!base) return {}; // server doesn't exist

    if (base.isOwner || base.hasAdmin) {
        const result = {};
        channelIds.forEach(id => { result[id] = ~0n; });
        return result;
    }

    // Fetch all channel overrides in one query (only query needed besides base)
    const overridesRes = await db.query(
        `SELECT channel_id, target_id, target_type, allow, deny
         FROM channel_permission_overrides
         WHERE channel_id = ANY($1::varchar[])`,
        [channelIds]
    );

    // Group overrides by channel
    const byChannel = {};
    for (const o of overridesRes.rows) {
        if (!byChannel[o.channel_id]) byChannel[o.channel_id] = [];
        byChannel[o.channel_id].push(o);
    }

    const result = {};
    for (const channelId of channelIds) {
        let perms = base.basePerms;
        const overrides = byChannel[channelId] || [];

        // @everyone override
        const eo = overrides.find(o => o.target_id === base.everyoneRoleId);
        if (eo) { perms &= ~BigInt(eo.deny); perms |= BigInt(eo.allow); }

        // Role overrides
        let roleAllow = 0n, roleDeny = 0n;
        for (const o of overrides) {
            if (o.target_type === 'role' && o.target_id !== base.everyoneRoleId && base.userRoleIds.has(o.target_id)) {
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
