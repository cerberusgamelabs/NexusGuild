// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /utils/permissionCache.js

import db from '../config/database.js';
import { PermissionHandler, PERMISSIONS } from '../config/permissions.js';

// LRU cache with TTL for permission resolution
// Keys: permBase:${userId}:${serverId}
// TTL: 30 seconds (balances freshness vs network latency)
// Max entries: 100 (prevent memory growth)

const CACHE_TTL_MS = 30 * 1000;
const CACHE_MAX_SIZE = 100;

class PermissionCache {
    constructor() {
        this.cache = new Map(); // key → { data, expiresAt, lastAccessed }
        this.accessOrder = []; // LRU order (most recent at end)
    }

    _prune() {
        const now = Date.now();
        // Remove expired entries
        for (const [key, { expiresAt }] of this.cache.entries()) {
            if (expiresAt < now) {
                this.cache.delete(key);
                const idx = this.accessOrder.indexOf(key);
                if (idx !== -1) this.accessOrder.splice(idx, 1);
            }
        }
        // Evict LRU if over size
        while (this.cache.size > CACHE_MAX_SIZE) {
            const lruKey = this.accessOrder.shift();
            if (lruKey) this.cache.delete(lruKey);
        }
    }

    _touch(key) {
        const idx = this.accessOrder.indexOf(key);
        if (idx !== -1) {
            this.accessOrder.splice(idx, 1);
        }
        this.accessOrder.push(key);
    }

    async getPermissionBase(userId, serverId) {
        const key = `permBase:${userId}:${serverId}`;
        const now = Date.now();

        // Check cache hit
        const entry = this.cache.get(key);
        if (entry && entry.expiresAt > now) {
            this._touch(key);
            return entry.data;
        }

        // Cache miss or expired — fetch from DB
        const data = await this._fetchPermissionBase(userId, serverId);

        // Store in cache
        this.cache.set(key, {
            data,
            expiresAt: now + CACHE_TTL_MS,
        });
        this._touch(key);
        this._prune();

        return data;
    }

    async _fetchPermissionBase(userId, serverId) {
        // Single query that returns everything needed for server-level permissions
        const result = await db.query(
            `SELECT
                s.owner_id,
                r_everyone.id AS everyone_role_id,
                r_everyone.permissions AS everyone_permissions,
                COALESCE(bit_or(r_user.permissions::bigint), 0)::text AS aggregate_permissions,
                ARRAY_AGG(DISTINCT ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL) AS user_role_ids
             FROM servers s
             LEFT JOIN roles r_everyone ON r_everyone.server_id = s.id AND r_everyone.name = '@everyone'
             LEFT JOIN user_roles ur ON ur.server_id = s.id AND ur.user_id = $2
             LEFT JOIN roles r_user ON r_user.id = ur.role_id
             WHERE s.id = $1
             GROUP BY s.owner_id, r_everyone.id, r_everyone.permissions`,
            [serverId, userId]
        );

        const row = result.rows[0];
        if (!row) {
            return null; // server doesn't exist
        }

        const isOwner = row.owner_id === userId;
        let basePerms = BigInt(row.aggregate_permissions || '0');
        if (row.everyone_permissions) {
            basePerms |= BigInt(row.everyone_permissions);
        }

        // ADMINISTrator bypass: if base has ADMINISTRATOR, treat as all perms
        const hasAdmin = PermissionHandler.hasPermission(basePerms, PERMISSIONS.ADMINISTRATOR);

        return {
            isOwner,
            everyoneRoleId: row.everyone_role_id,
            basePerms,
            userRoleIds: new Set(row.user_role_ids || []),
            hasAdmin,
        };
    }

    invalidateServer(userId, serverId) {
        const key = `permBase:${userId}:${serverId}`;
        this.cache.delete(key);
        const idx = this.accessOrder.indexOf(key);
        if (idx !== -1) this.accessOrder.splice(idx, 1);
    }

    invalidateUser(userId) {
        // Invalidate all entries for a user (e.g., role changes across servers)
        const prefix = `permBase:${userId}:`;
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
                const idx = this.accessOrder.indexOf(key);
                if (idx !== -1) this.accessOrder.splice(idx, 1);
            }
        }
    }

    clear() {
        this.cache.clear();
        this.accessOrder = [];
    }
}

// Singleton instance
const permissionCache = new PermissionCache();

export { permissionCache, PermissionCache };
export default permissionCache;
