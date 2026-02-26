// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/importController.js
//
// Receives a Discord server export JSON + a NexusGuild userId and reconstructs
// the full server structure: server → roles → categories → channels → overrides.
//
// Called by the Discord bot after /backup UserID:<nexusId> is run.

import db from '../config/database.js';
import { generateSnowflake } from '#utils/functions';
import { log, tags } from '#utils/logging';

// Discord channel type → NexusGuild channel type
// Discord numeric type → NexusGuild string type
// Threads (10, 11, 12) and stage (13) are skipped — not in this map.
const CHANNEL_TYPE_MAP = {
    0:  'text',         // GUILD_TEXT
    2:  'voice',        // GUILD_VOICE
    5:  'announcement', // GUILD_ANNOUNCEMENT
    15: 'forum',        // GUILD_FORUM
    16: 'media',        // GUILD_MEDIA
};

class ImportController {
    static async importDiscordServer(req, res) {
        const {
            userId,
            guild,
            everyoneRole,
            roles = [],
            channels = [],
        } = req.body;

        if (!userId || !guild) {
            return res.status(400).json({ error: 'userId and guild are required' });
        }

        // Verify the NexusGuild user exists
        const userRes = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
        if (!userRes.rows.length) {
            return res.status(404).json({ error: 'NexusGuild user not found' });
        }

        // ID maps: Discord ID → NexusGuild ID (built as we create things)
        const roleIdMap     = {}; // discordRoleId → nexusRoleId
        const categoryIdMap = {}; // discordCategoryId → nexusCategoryId

        try {
            // ── 1. Create the server ────────────────────────────────────────────
            const serverId = generateSnowflake();
            await db.query(
                `INSERT INTO servers (id, name, owner_id) VALUES ($1, $2, $3)`,
                [serverId, guild.name, userId]
            );

            // Add owner as a member
            const membershipId = generateSnowflake();
            await db.query(
                `INSERT INTO server_members (id, server_id, user_id) VALUES ($1, $2, $3)`,
                [membershipId, serverId, userId]
            );

            log(tags.success, `Import: created server "${guild.name}" [${serverId}] for user ${userId}`);

            // ── 2. Create @everyone role ────────────────────────────────────────
            // We create it directly — raw server INSERT doesn't scaffold it.
            const nexusEveryoneId = generateSnowflake();
            const everyonePerms = everyoneRole?.permissions ?? '103926848';
            await db.query(
                `INSERT INTO roles (id, server_id, name, color, permissions, position)
                 VALUES ($1, $2, '@everyone', '#99AAB5', $3, 0)`,
                [nexusEveryoneId, serverId, everyonePerms]
            );
            // Map Discord @everyone ID → nexus @everyone ID
            if (everyoneRole) roleIdMap[everyoneRole.id] = nexusEveryoneId;

            // Assign @everyone to the importing user
            await db.query(
                `INSERT INTO user_roles (user_id, role_id, server_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                [userId, nexusEveryoneId, serverId]
            );

            // ── 3. Create roles (skip bot roles) ────────────────────────────────
            // Sort by position descending so highest-hierarchy roles get created first.
            // We do NOT bulk-assign these to the importing user — owner bypass covers access.
            const importableRoles = roles
                .filter(r => !r.tags?.botId)
                .sort((a, b) => b.position - a.position);

            for (const role of importableRoles) {
                const nexusRoleId = generateSnowflake();
                roleIdMap[role.id] = nexusRoleId;

                await db.query(
                    `INSERT INTO roles (id, server_id, name, color, permissions, position, hoist, mentionable)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                        nexusRoleId,
                        serverId,
                        role.name,
                        role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#99aab5',
                        role.permissions,
                        role.position,
                        role.hoist ?? false,
                        role.mentionable ?? false,
                    ]
                );
            }

            log(tags.success, `Import: created ${importableRoles.length} roles`);

            // ── 4. Create categories (Discord type 4) ───────────────────────────
            const discordCategories = channels
                .filter(c => c.type === 4)
                .sort((a, b) => a.position - b.position);

            for (const cat of discordCategories) {
                const nexusCatId = generateSnowflake();
                categoryIdMap[cat.id] = nexusCatId;

                await db.query(
                    `INSERT INTO categories (id, server_id, name, position) VALUES ($1, $2, $3, $4)`,
                    [nexusCatId, serverId, cat.name, cat.position]
                );
            }

            log(tags.success, `Import: created ${discordCategories.length} categories`);

            // ── 5. Create channels (everything except type 4) ───────────────────
            const discordChannels = channels
                .filter(c => c.type !== 4 && CHANNEL_TYPE_MAP[c.type])
                .sort((a, b) => a.position - b.position);

            // channelIdMap: discordChannelId → nexusChannelId (for future use)
            const channelIdMap = {};

            for (const ch of discordChannels) {
                const nexusChanId = generateSnowflake();
                channelIdMap[ch.id] = nexusChanId;
                const nexusCatId = ch.parentId ? categoryIdMap[ch.parentId] ?? null : null;
                const chanType   = CHANNEL_TYPE_MAP[ch.type] ?? 'text';

                await db.query(
                    `INSERT INTO channels (id, server_id, category_id, name, type, topic, position)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [nexusChanId, serverId, nexusCatId, ch.name, chanType, ch.topic ?? null, ch.position]
                );

                // Seed user_channel_reads cursor so unread tracking works from day 1
                await db.query(
                    `INSERT INTO user_channel_reads (user_id, channel_id, last_read_message_id)
                     VALUES ($1, $2, '0') ON CONFLICT DO NOTHING`,
                    [userId, nexusChanId]
                );

                // Apply per-channel permission overwrites (role type=0 only; member=1 can't map)
                const categoryOverwrites = ch.parentId
                    ? (discordCategories.find(c => c.id === ch.parentId)?.permissionOverwrites ?? [])
                    : [];

                // Merge: channel-level overwrites take precedence over category-level
                const mergedOverwrites = _mergeOverwrites(categoryOverwrites, ch.permissionOverwrites ?? []);

                for (const ow of mergedOverwrites) {
                    if (ow.type !== 0) continue; // skip member overwrites
                    const nexusTargetId = roleIdMap[ow.id];
                    if (!nexusTargetId) continue;

                    await db.query(
                        `INSERT INTO channel_permission_overrides
                             (channel_id, target_id, target_type, allow, deny)
                         VALUES ($1, $2, 'role', $3, $4)
                         ON CONFLICT (channel_id, target_id) DO UPDATE SET allow = $3, deny = $4`,
                        [nexusChanId, nexusTargetId, ow.allow, ow.deny]
                    );
                }
            }

            log(tags.success, `Import: created ${discordChannels.length} channels`);

            // Notify the importing user's client to reload their server list
            const io = req.app.get('io');
            if (io) io.to(`user:${userId}`).emit('server_joined', { serverId });

            res.json({
                ok: true,
                serverId,
                rolesCreated:      importableRoles.length,
                categoriesCreated: discordCategories.length,
                channelsCreated:   discordChannels.length,
            });

        } catch (err) {
            log(tags.error, 'Discord import error:', err);
            res.status(500).json({ error: 'Import failed', detail: err.message });
        }
    }
}

// Merge category-level overwrites with channel-level overwrites.
// Channel overwrites win when both target the same ID.
function _mergeOverwrites(categoryOws, channelOws) {
    const map = {};
    for (const ow of categoryOws)  map[ow.id] = { ...ow };
    for (const ow of channelOws)   map[ow.id] = { ...ow }; // channel wins
    return Object.values(map);
}

export default ImportController;
