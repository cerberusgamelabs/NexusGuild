// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/vttController.js

import db from '../config/database.js';
import { PERMISSIONS, PermissionHandler } from '../config/permissions.js';
import { generateSnowflake } from '../utils/functions.js';
import { log, tags } from '#utils/logging';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function _getUserPerms(userId, serverId) {
    const res = await db.query(`
        SELECT COALESCE(bit_or(r.permissions), 0) AS perms
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1 AND ur.server_id = $2
    `, [userId, serverId]);
    return BigInt(res.rows[0]?.perms ?? 0);
}

async function _isGM(userId, serverId, channel) {
    // Server owner is always GM
    const serverRes = await db.query('SELECT owner_id FROM servers WHERE id=$1', [serverId]);
    if (serverRes.rows[0]?.owner_id === userId) return true;

    const perms = await _getUserPerms(userId, serverId);
    return PermissionHandler.hasPermission(perms, PERMISSIONS.ADMINISTRATOR) ||
           PermissionHandler.hasPermission(perms, PERMISSIONS.VTT_GM);
}

async function _getChannelServer(channelId) {
    const res = await db.query('SELECT server_id FROM channels WHERE id=$1 AND type=$2', [channelId, 'vtt']);
    return res.rows[0]?.server_id || null;
}

// ── Session (map + tokens + encounter in one call) ────────────────────────────

export async function getSession(req, res) {
    const { channelId } = req.params;
    try {
        const serverId = await _getChannelServer(channelId);
        if (!serverId) return res.status(404).json({ error: 'VTT channel not found' });

        const [mapRes, tokensRes, encounterRes, charsRes] = await Promise.all([
            db.query('SELECT * FROM vtt_maps WHERE channel_id=$1', [channelId]),
            db.query('SELECT * FROM vtt_tokens WHERE channel_id=$1 ORDER BY id', [channelId]),
            db.query('SELECT * FROM vtt_encounters WHERE channel_id=$1', [channelId]),
            db.query('SELECT * FROM vtt_characters WHERE channel_id=$1 ORDER BY name', [channelId]),
        ]);

        const isGM = await _isGM(req.session.userId, serverId, null);

        res.json({
            map:       mapRes.rows[0] || null,
            tokens:    tokensRes.rows,
            encounter: encounterRes.rows[0] || null,
            characters: charsRes.rows,
            isGM,
        });
    } catch (e) {
        log(tags.error, 'vttController.getSession:', e.message);
        res.status(500).json({ error: 'Failed to load VTT session' });
    }
}

// ── Map ───────────────────────────────────────────────────────────────────────

export async function uploadMap(req, res) {
    const { channelId } = req.params;
    try {
        const serverId = await _getChannelServer(channelId);
        if (!serverId) return res.status(404).json({ error: 'VTT channel not found' });
        if (!await _isGM(req.session.userId, serverId, null))
            return res.status(403).json({ error: 'VTT_GM permission required' });

        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const mapUrl = `/uploads/vtt/maps/${req.file.filename}`;

        const existing = await db.query('SELECT id FROM vtt_maps WHERE channel_id=$1', [channelId]);
        let map;
        if (existing.rows.length) {
            const r = await db.query(
                `UPDATE vtt_maps SET map_url=$1, updated_at=NOW() WHERE channel_id=$2 RETURNING *`,
                [mapUrl, channelId]
            );
            map = r.rows[0];
        } else {
            const r = await db.query(
                `INSERT INTO vtt_maps (id, channel_id, map_url) VALUES ($1,$2,$3) RETURNING *`,
                [generateSnowflake(), channelId, mapUrl]
            );
            map = r.rows[0];
        }

        // Broadcast to channel
        const io = req.app.get('io');
        io.to(`channel:${channelId}`).emit('vtt_map_updated', { channelId, map });

        res.json({ map });
    } catch (e) {
        log(tags.error, 'vttController.uploadMap:', e.message);
        res.status(500).json({ error: 'Failed to upload map' });
    }
}

export async function updateMap(req, res) {
    const { channelId } = req.params;
    const { grid_size, fog_data } = req.body;
    try {
        const serverId = await _getChannelServer(channelId);
        if (!serverId) return res.status(404).json({ error: 'VTT channel not found' });
        if (!await _isGM(req.session.userId, serverId, null))
            return res.status(403).json({ error: 'VTT_GM permission required' });

        const existing = await db.query('SELECT id FROM vtt_maps WHERE channel_id=$1', [channelId]);
        let map;
        if (existing.rows.length) {
            const sets = [], vals = [];
            if (grid_size !== undefined) { sets.push(`grid_size=$${sets.length+1}`); vals.push(grid_size); }
            if (fog_data  !== undefined) { sets.push(`fog_data=$${sets.length+1}`);  vals.push(JSON.stringify(fog_data)); }
            if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
            sets.push(`updated_at=NOW()`);
            vals.push(channelId);
            const r = await db.query(
                `UPDATE vtt_maps SET ${sets.join(',')} WHERE channel_id=$${vals.length} RETURNING *`, vals
            );
            map = r.rows[0];
        } else {
            const r = await db.query(
                `INSERT INTO vtt_maps (id, channel_id, grid_size, fog_data)
                 VALUES ($1,$2,$3,$4) RETURNING *`,
                [generateSnowflake(), channelId, grid_size || 64, fog_data ? JSON.stringify(fog_data) : null]
            );
            map = r.rows[0];
        }

        const io = req.app.get('io');
        io.to(`channel:${channelId}`).emit('vtt_map_updated', { channelId, map });
        res.json({ map });
    } catch (e) {
        log(tags.error, 'vttController.updateMap:', e.message);
        res.status(500).json({ error: 'Failed to update map' });
    }
}

// ── Tokens ────────────────────────────────────────────────────────────────────

export async function addToken(req, res) {
    const { channelId } = req.params;
    const { x = 0, y = 0, size = 1, label = '' } = req.body;
    try {
        const serverId = await _getChannelServer(channelId);
        if (!serverId) return res.status(404).json({ error: 'VTT channel not found' });

        const imageUrl = req.file ? `/uploads/vtt/tokens/${req.file.filename}` : null;
        const id = generateSnowflake();

        const r = await db.query(
            `INSERT INTO vtt_tokens (id, channel_id, owner_id, x, y, size, image_url, label)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [id, channelId, req.session.userId, x, y, size, imageUrl, label]
        );
        const token = r.rows[0];

        const io = req.app.get('io');
        io.to(`channel:${channelId}`).emit('vtt_token_added', { token });
        res.status(201).json({ token });
    } catch (e) {
        log(tags.error, 'vttController.addToken:', e.message);
        res.status(500).json({ error: 'Failed to add token' });
    }
}

export async function updateToken(req, res) {
    const { channelId, tokenId } = req.params;
    try {
        const serverId = await _getChannelServer(channelId);
        if (!serverId) return res.status(404).json({ error: 'VTT channel not found' });

        const tokenRes = await db.query('SELECT * FROM vtt_tokens WHERE id=$1 AND channel_id=$2', [tokenId, channelId]);
        if (!tokenRes.rows.length) return res.status(404).json({ error: 'Token not found' });
        const token = tokenRes.rows[0];

        const isGM = await _isGM(req.session.userId, serverId, null);
        // Players can only move their own token; GM can move any
        if (!isGM && token.owner_id !== req.session.userId)
            return res.status(403).json({ error: 'You can only move your own token' });

        const { x, y, size, label, hp, hp_max, conditions } = req.body;
        const sets = [], vals = [];
        if (x          !== undefined) { sets.push(`x=$${sets.length+1}`);          vals.push(x); }
        if (y          !== undefined) { sets.push(`y=$${sets.length+1}`);          vals.push(y); }
        if (size       !== undefined) { sets.push(`size=$${sets.length+1}`);       vals.push(size); }
        if (label      !== undefined) { sets.push(`label=$${sets.length+1}`);      vals.push(label); }
        if (hp         !== undefined) { sets.push(`hp=$${sets.length+1}`);         vals.push(hp); }
        if (hp_max     !== undefined) { sets.push(`hp_max=$${sets.length+1}`);     vals.push(hp_max); }
        if (conditions !== undefined) { sets.push(`conditions=$${sets.length+1}`); vals.push(JSON.stringify(conditions)); }

        if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
        vals.push(tokenId);
        const r = await db.query(
            `UPDATE vtt_tokens SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals
        );
        const updated = r.rows[0];

        const io = req.app.get('io');
        io.to(`channel:${channelId}`).emit('vtt_token_moved', { token: updated });
        res.json({ token: updated });
    } catch (e) {
        log(tags.error, 'vttController.updateToken:', e.message);
        res.status(500).json({ error: 'Failed to update token' });
    }
}

export async function removeToken(req, res) {
    const { channelId, tokenId } = req.params;
    try {
        const serverId = await _getChannelServer(channelId);
        if (!serverId) return res.status(404).json({ error: 'VTT channel not found' });

        const tokenRes = await db.query('SELECT owner_id FROM vtt_tokens WHERE id=$1 AND channel_id=$2', [tokenId, channelId]);
        if (!tokenRes.rows.length) return res.status(404).json({ error: 'Token not found' });

        const isGM = await _isGM(req.session.userId, serverId, null);
        if (!isGM && tokenRes.rows[0].owner_id !== req.session.userId)
            return res.status(403).json({ error: 'You can only remove your own token' });

        await db.query('DELETE FROM vtt_tokens WHERE id=$1', [tokenId]);

        const io = req.app.get('io');
        io.to(`channel:${channelId}`).emit('vtt_token_removed', { tokenId });
        res.json({ success: true });
    } catch (e) {
        log(tags.error, 'vttController.removeToken:', e.message);
        res.status(500).json({ error: 'Failed to remove token' });
    }
}

// ── Encounter / Initiative ────────────────────────────────────────────────────

export async function updateEncounter(req, res) {
    const { channelId } = req.params;
    try {
        const serverId = await _getChannelServer(channelId);
        if (!serverId) return res.status(404).json({ error: 'VTT channel not found' });
        if (!await _isGM(req.session.userId, serverId, null))
            return res.status(403).json({ error: 'VTT_GM permission required' });

        const { round, active_index, is_active, combatants } = req.body;
        const existing = await db.query('SELECT id FROM vtt_encounters WHERE channel_id=$1', [channelId]);
        let encounter;
        if (existing.rows.length) {
            const sets = [], vals = [];
            if (round        !== undefined) { sets.push(`round=$${sets.length+1}`);        vals.push(round); }
            if (active_index !== undefined) { sets.push(`active_index=$${sets.length+1}`); vals.push(active_index); }
            if (is_active    !== undefined) { sets.push(`is_active=$${sets.length+1}`);    vals.push(is_active); }
            if (combatants   !== undefined) { sets.push(`combatants=$${sets.length+1}`);   vals.push(JSON.stringify(combatants)); }
            sets.push('updated_at=NOW()');
            vals.push(channelId);
            const r = await db.query(
                `UPDATE vtt_encounters SET ${sets.join(',')} WHERE channel_id=$${vals.length} RETURNING *`, vals
            );
            encounter = r.rows[0];
        } else {
            const r = await db.query(
                `INSERT INTO vtt_encounters (id, channel_id, round, active_index, is_active, combatants)
                 VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
                [generateSnowflake(), channelId,
                 round ?? 1, active_index ?? 0, is_active ?? false,
                 JSON.stringify(combatants ?? [])]
            );
            encounter = r.rows[0];
        }

        const io = req.app.get('io');
        io.to(`channel:${channelId}`).emit('vtt_encounter_updated', { encounter });
        res.json({ encounter });
    } catch (e) {
        log(tags.error, 'vttController.updateEncounter:', e.message);
        res.status(500).json({ error: 'Failed to update encounter' });
    }
}

// ── Characters ────────────────────────────────────────────────────────────────

export async function getCharacters(req, res) {
    const { channelId } = req.params;
    try {
        const serverId = await _getChannelServer(channelId);
        if (!serverId) return res.status(404).json({ error: 'VTT channel not found' });

        const isGM = await _isGM(req.session.userId, serverId, null);
        // Players see only their own; GM sees all
        const r = isGM
            ? await db.query('SELECT * FROM vtt_characters WHERE channel_id=$1 ORDER BY name', [channelId])
            : await db.query('SELECT * FROM vtt_characters WHERE channel_id=$1 AND user_id=$2 ORDER BY name', [channelId, req.session.userId]);

        res.json({ characters: r.rows });
    } catch (e) {
        log(tags.error, 'vttController.getCharacters:', e.message);
        res.status(500).json({ error: 'Failed to load characters' });
    }
}

export async function createCharacter(req, res) {
    const { channelId } = req.params;
    const { name, system = 'generic', sheet_data = {}, token_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    try {
        const serverId = await _getChannelServer(channelId);
        if (!serverId) return res.status(404).json({ error: 'VTT channel not found' });

        const isGM = await _isGM(req.session.userId, serverId, null);
        // NPCs (user_id=null) only creatable by GM
        const ownerId = req.body.is_npc && isGM ? null : req.session.userId;

        const r = await db.query(
            `INSERT INTO vtt_characters (id, channel_id, user_id, token_id, system, name, sheet_data)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [generateSnowflake(), channelId, ownerId, token_id || null, system, name, JSON.stringify(sheet_data)]
        );
        res.status(201).json({ character: r.rows[0] });
    } catch (e) {
        log(tags.error, 'vttController.createCharacter:', e.message);
        res.status(500).json({ error: 'Failed to create character' });
    }
}

export async function updateCharacter(req, res) {
    const { channelId, charId } = req.params;
    try {
        const serverId = await _getChannelServer(channelId);
        if (!serverId) return res.status(404).json({ error: 'VTT channel not found' });

        const charRes = await db.query('SELECT * FROM vtt_characters WHERE id=$1 AND channel_id=$2', [charId, channelId]);
        if (!charRes.rows.length) return res.status(404).json({ error: 'Character not found' });

        const isGM = await _isGM(req.session.userId, serverId, null);
        if (!isGM && charRes.rows[0].user_id !== req.session.userId)
            return res.status(403).json({ error: 'You can only edit your own character' });

        const { name, sheet_data, token_id, system } = req.body;
        const sets = [], vals = [];
        if (name       !== undefined) { sets.push(`name=$${sets.length+1}`);       vals.push(name); }
        if (system     !== undefined) { sets.push(`system=$${sets.length+1}`);     vals.push(system); }
        if (token_id   !== undefined) { sets.push(`token_id=$${sets.length+1}`);   vals.push(token_id || null); }
        if (sheet_data !== undefined) { sets.push(`sheet_data=$${sets.length+1}`); vals.push(JSON.stringify(sheet_data)); }
        sets.push('updated_at=NOW()');
        vals.push(charId);

        const r = await db.query(
            `UPDATE vtt_characters SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals
        );
        res.json({ character: r.rows[0] });
    } catch (e) {
        log(tags.error, 'vttController.updateCharacter:', e.message);
        res.status(500).json({ error: 'Failed to update character' });
    }
}

export async function deleteCharacter(req, res) {
    const { channelId, charId } = req.params;
    try {
        const serverId = await _getChannelServer(channelId);
        if (!serverId) return res.status(404).json({ error: 'VTT channel not found' });

        const charRes = await db.query('SELECT user_id FROM vtt_characters WHERE id=$1 AND channel_id=$2', [charId, channelId]);
        if (!charRes.rows.length) return res.status(404).json({ error: 'Character not found' });

        const isGM = await _isGM(req.session.userId, serverId, null);
        if (!isGM && charRes.rows[0].user_id !== req.session.userId)
            return res.status(403).json({ error: 'You can only delete your own character' });

        await db.query('DELETE FROM vtt_characters WHERE id=$1', [charId]);
        res.json({ success: true });
    } catch (e) {
        log(tags.error, 'vttController.deleteCharacter:', e.message);
        res.status(500).json({ error: 'Failed to delete character' });
    }
}

// ── dddice guest token ────────────────────────────────────────────────────────

export async function getDddiceToken(req, res) {
    const { channelId } = req.params;
    try {
        const apiKey = process.env.DDDICE_API_TOKEN;
        if (!apiKey) return res.status(503).json({ error: 'dddice not configured' });

        // Get or create dddice room slug for this channel
        const chanRes = await db.query(
            'SELECT dddice_room_slug, server_id FROM channels WHERE id=$1 AND type=$2',
            [channelId, 'vtt']
        );
        if (!chanRes.rows.length) return res.status(404).json({ error: 'VTT channel not found' });

        let roomSlug = chanRes.rows[0].dddice_room_slug;

        if (!roomSlug) {
            // Create a new dddice room using the admin API key
            const roomRes = await fetch('https://dddice.com/api/1.0/room', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_public: true })
            });
            if (!roomRes.ok) throw new Error('Failed to create dddice room');
            const roomData = await roomRes.json();
            roomSlug = roomData.data.slug;
            await db.query('UPDATE channels SET dddice_room_slug=$1 WHERE id=$2', [roomSlug, channelId]);
        }

        // Create a guest user (no auth) — returns a short-lived fetch token
        const guestRes = await fetch('https://dddice.com/api/1.0/user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        if (!guestRes.ok) throw new Error('Failed to create dddice guest user');
        const guestData = await guestRes.json();
        const fetchToken = guestData.data; // {type:"token", data:"<fetch-token>"}

        // Exchange the fetch token for a full API token
        const apiTokenRes = await fetch('https://dddice.com/api/1.0/user/token', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${fetchToken}`, 'Content-Type': 'application/json' }
        });
        const apiTokenData = await apiTokenRes.json();
        const guestToken = apiTokenRes.ok ? (apiTokenData.data || fetchToken) : fetchToken;

        // Join the guest to the room using their API token
        await fetch(`https://dddice.com/api/1.0/room/${roomSlug}/participant`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${guestToken}`, 'Content-Type': 'application/json' },
        });

        // Fetch the account's available themes so the client uses a valid one
        const diceBoxRes = await fetch('https://dddice.com/api/1.0/dice-box', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const diceBoxData = await diceBoxRes.json();
        const theme = diceBoxData.data?.[0]?.id || diceBoxData.data?.[0]?.slug || 'dddice-bees';

        res.json({
            guestToken,
            roomSlug,
            theme,
        });
    } catch (e) {
        log(tags.error, 'vttController.getDddiceToken:', e.message);
        res.status(500).json({ error: 'Failed to get dddice session' });
    }
}

// ── dddice roll (server-side, for debugging) ──────────────────────────────────

export async function dddiceRoll(req, res) {
    const { channelId } = req.params;
    const { dice } = req.body; // [{type, theme}]
    try {
        const apiKey = process.env.DDDICE_API_TOKEN;
        const chanRes = await db.query('SELECT dddice_room_slug FROM channels WHERE id=$1', [channelId]);
        const roomSlug = chanRes.rows[0]?.dddice_room_slug;
        if (!roomSlug) return res.status(404).json({ error: 'No dddice room for this channel' });

        const rollRes = await fetch('https://dddice.com/api/1.0/roll', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ dice, room: roomSlug })
        });
        const rollData = await rollRes.json();
        log(tags.info, `dddice roll: ${rollRes.status}`, JSON.stringify(rollData).slice(0, 300));
        res.status(rollRes.status).json(rollData);
    } catch (e) {
        log(tags.error, 'vttController.dddiceRoll:', e.message);
        res.status(500).json({ error: 'Roll failed' });
    }
}
