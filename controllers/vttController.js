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

        const [mapRes, tokensRes, encounterRes, charsRes, rollsRes] = await Promise.all([
            db.query('SELECT * FROM vtt_maps WHERE channel_id=$1', [channelId]),
            db.query('SELECT * FROM vtt_tokens WHERE channel_id=$1 ORDER BY id', [channelId]),
            db.query('SELECT * FROM vtt_encounters WHERE channel_id=$1', [channelId]),
            db.query('SELECT * FROM vtt_characters WHERE channel_id=$1 ORDER BY name', [channelId]),
            db.query(`
                SELECT vr.*, u.username, u.avatar
                FROM vtt_dice_rolls vr
                LEFT JOIN users u ON u.id = vr.user_id
                WHERE vr.channel_id=$1
                ORDER BY vr.created_at DESC
                LIMIT 50
            `, [channelId]),
        ]);

        const isGM = await _isGM(req.session.user.id, serverId, null);

        res.json({
            map:       mapRes.rows[0] || null,
            tokens:    tokensRes.rows,
            encounter: encounterRes.rows[0] || null,
            characters: charsRes.rows,
            isGM,
            recent_rolls: rollsRes.rows,
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
        if (!await _isGM(req.session.user.id, serverId, null))
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
        if (!await _isGM(req.session.user.id, serverId, null))
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
    const { x = 0, y = 0, size = 1, size_x = 1, size_y = 1, label = '' } = req.body;
    try {
        const serverId = await _getChannelServer(channelId);
        if (!serverId) return res.status(404).json({ error: 'VTT channel not found' });

        const imageUrl = req.file ? `/uploads/vtt/tokens/${req.file.filename}` : null;
        const id = generateSnowflake();

        const r = await db.query(
            `INSERT INTO vtt_tokens (id, channel_id, owner_id, x, y, size, size_x, size_y, image_url, label)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [id, channelId, req.session.user.id, x, y, size, size_x, size_y, imageUrl, label]
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

        const isGM = await _isGM(req.session.user.id, serverId, null);
        // Players can only move their own token; GM can move any
        if (!isGM && token.owner_id !== req.session.user.id)
            return res.status(403).json({ error: 'You can only move your own token' });

        const { x, y, size, size_x, size_y, label, hp, hp_max, conditions, owner_id } = req.body;
        const sets = [], vals = [];
        if (x          !== undefined) { sets.push(`x=${sets.length+1}`);          vals.push(x); }
        if (y          !== undefined) { sets.push(`y=${sets.length+1}`);          vals.push(y); }
        if (size       !== undefined) { sets.push(`size=${sets.length+1}`);       vals.push(size); }
        if (size_x     !== undefined) { sets.push(`size_x=${sets.length+1}`);     vals.push(size_x); }
        if (size_y     !== undefined) { sets.push(`size_y=${sets.length+1}`);     vals.push(size_y); }
        if (label      !== undefined) { sets.push(`label=${sets.length+1}`);      vals.push(label); }
        if (hp         !== undefined) { sets.push(`hp=${sets.length+1}`);         vals.push(hp); }
        if (hp_max     !== undefined) { sets.push(`hp_max=${sets.length+1}`);     vals.push(hp_max); }
        if (conditions !== undefined) { sets.push(`conditions=${sets.length+1}`); vals.push(JSON.stringify(conditions)); }
        if (owner_id   !== undefined && isGM) { sets.push(`owner_id=${sets.length+1}`); vals.push(owner_id || null); }

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

        const isGM = await _isGM(req.session.user.id, serverId, null);
        if (!isGM && tokenRes.rows[0].owner_id !== req.session.user.id)
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
        if (!await _isGM(req.session.user.id, serverId, null))
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

        const isGM = await _isGM(req.session.user.id, serverId, null);
        // Players see only their own; GM sees all
        const r = isGM
            ? await db.query('SELECT * FROM vtt_characters WHERE channel_id=$1 ORDER BY name', [channelId])
            : await db.query('SELECT * FROM vtt_characters WHERE channel_id=$1 AND user_id=$2 ORDER BY name', [channelId, req.session.user.id]);

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

        const isGM = await _isGM(req.session.user.id, serverId, null);
        // NPCs (user_id=null) only creatable by GM
        const ownerId = req.body.is_npc && isGM ? null : req.session.user.id;

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

        const isGM = await _isGM(req.session.user.id, serverId, null);
        if (!isGM && charRes.rows[0].user_id !== req.session.user.id)
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

        const isGM = await _isGM(req.session.user.id, serverId, null);
        if (!isGM && charRes.rows[0].user_id !== req.session.user.id)
            return res.status(403).json({ error: 'You can only delete your own character' });

        await db.query('DELETE FROM vtt_characters WHERE id=$1', [charId]);
        res.json({ success: true });
    } catch (e) {
        log(tags.error, 'vttController.deleteCharacter:', e.message);
        res.status(500).json({ error: 'Failed to delete character' });
    }
}

// ── DnDBeyond Import ──────────────────────────────────────────────────────────

const _DNDB_STAT_MAP   = { 1:'str', 2:'dex', 3:'con', 4:'int', 5:'wis', 6:'cha' };
const _DNDB_ALIGNMENTS = {
    1:'Lawful Good', 2:'Neutral Good', 3:'Chaotic Good',
    4:'Lawful Neutral', 5:'True Neutral', 6:'Chaotic Neutral',
    7:'Lawful Evil', 8:'Neutral Evil', 9:'Chaotic Evil',
};
const _DNDB_SAVE_MAP = {
    'strength-saving-throws':'str', 'dexterity-saving-throws':'dex',
    'constitution-saving-throws':'con', 'intelligence-saving-throws':'int',
    'wisdom-saving-throws':'wis', 'charisma-saving-throws':'cha',
};
// DnDBeyond subType → our skill key (hyphen-to-underscore, with exceptions)
function _dndbSkillSubtype(subType) {
    return subType.replace(/-/g, '_');
}

function _mapDndbeyondData(data) {
    const VALID_SKILL_KEYS = new Set([
        'acrobatics','animal_handling','arcana','athletics','deception',
        'history','insight','intimidation','investigation','medicine',
        'nature','perception','performance','persuasion','religion',
        'sleight_of_hand','stealth','survival',
    ]);

    // Ability scores
    // Step 1: base scores from character creation
    const ability_scores = {};
    for (const s of (data.stats || [])) {
        const key = _DNDB_STAT_MAP[s.id];
        if (key) ability_scores[key] = s.value || 10;
    }

    // Step 2: sum all ability score bonuses from every modifier category
    // (race, feat, background, class, item, etc.)
    const allMods = Object.values(data.modifiers || {}).flat();
    for (const m of allMods) {
        if (m.type !== 'bonus' || !m.statId || !(m.statId in _DNDB_STAT_MAP)) continue;
        const key = _DNDB_STAT_MAP[m.statId];
        ability_scores[key] = (ability_scores[key] || 10) + (m.fixedValue ?? m.value ?? 0);
    }

    // Step 3: apply manual bonusStats (rare, but respected when set)
    for (const s of (data.bonusStats || [])) {
        if (!s.value || !_DNDB_STAT_MAP[s.id]) continue;
        const key = _DNDB_STAT_MAP[s.id];
        ability_scores[key] = (ability_scores[key] || 10) + s.value;
    }

    // Step 4: overrideStats are DnDBeyond's own final value — take them as gospel
    for (const s of (data.overrideStats || [])) {
        if (s.value == null || !_DNDB_STAT_MAP[s.id]) continue;
        ability_scores[_DNDB_STAT_MAP[s.id]] = s.value;
    }

    // Proficiency bonus — DnDB API returns null; derive from total character level
    const totalLevel = (data.classes || []).reduce((sum, c) => sum + (c.level || 0), 0) || 1;
    const proficiency_bonus = Math.ceil(totalLevel / 4) + 1;

    // Saving throw proficiencies
    const saving_throw_profs = allMods
        .filter(m => m.type === 'proficiency' && _DNDB_SAVE_MAP[m.subType])
        .map(m => _DNDB_SAVE_MAP[m.subType])
        .filter((v, i, a) => a.indexOf(v) === i); // unique

    // Skill proficiencies
    const skill_profs = allMods
        .filter(m => m.type === 'proficiency')
        .map(m => _dndbSkillSubtype(m.subType))
        .filter(k => VALID_SKILL_KEYS.has(k))
        .filter((v, i, a) => a.indexOf(v) === i); // unique

    // HP
    const hp_max  = data.baseHitPoints || 0;
    const hp      = hp_max - (data.removedHitPoints || 0);
    const hp_temp = data.temporaryHitPoints || 0;

    // AC — base 10, then check equipped armor
    let ac = 10;
    const dexMod = Math.floor(((ability_scores.dex || 10) - 10) / 2);
    const equippedArmor = (data.inventory || []).filter(i =>
        i.equipped && i.definition?.filterType === 'Armor'
    );
    if (equippedArmor.length) {
        // armorTypeId: 1=light,2=medium,3=heavy,4=shield
        const armor = equippedArmor.find(i => i.definition?.armorTypeId !== 4);
        const shield = equippedArmor.find(i => i.definition?.armorTypeId === 4);
        if (armor) {
            const base = armor.definition.armorClass || 10;
            const typeId = armor.definition.armorTypeId;
            ac = typeId === 1 ? base + dexMod          // light: full dex
               : typeId === 2 ? base + Math.min(dexMod, 2) // medium: dex capped at +2
               : base;                                  // heavy: no dex
        } else {
            ac = 10 + dexMod; // no armor — unarmored
        }
        if (shield) ac += 2;
    } else {
        ac = 10 + dexMod;
    }

    // Hit dice from primary class definition
    const hitDice = cls_def?.hitDice ? `1d${cls_def.hitDice}` : '1d8';

    // Initiative — dex mod plus any flat initiative bonuses (e.g. Alert feat)
    const initiativeBonus = allMods
        .filter(m => m.type === 'bonus' && m.subType === 'initiative')
        .reduce((sum, m) => sum + (m.fixedValue ?? m.value ?? 0), dexMod);

    // Proficiencies text — armor, weapon, tool proficiencies + languages + resistances/senses
    const ARMOR_WEAPON_PROFS  = new Set(['light-armor','medium-armor','heavy-armor','shields',
        'simple-weapons','martial-weapons','firearms']);
    const armorWeaponLines = [];
    const toolLines        = [];
    const languageLines    = [];
    const resistanceLines  = [];
    const senseLines       = [];
    for (const m of allMods) {
        const fn = m.friendlySubtypeName || m.subType || '';
        if (m.type === 'proficiency' && ARMOR_WEAPON_PROFS.has(m.subType)) {
            armorWeaponLines.push(fn);
        } else if (m.type === 'proficiency' && m.subType?.includes('-tools')) {
            toolLines.push(fn);
        } else if (m.type === 'language') {
            languageLines.push(fn);
        } else if (m.type === 'resistance' || m.type === 'immunity') {
            resistanceLines.push(`${fn} (${m.type})`);
        } else if (m.type === 'set-base' && m.subType === 'darkvision') {
            senseLines.push(`Darkvision ${m.fixedValue ?? 60}ft`);
        }
    }
    const profParts = [];
    if (armorWeaponLines.length) profParts.push(`Armor & Weapons: ${[...new Set(armorWeaponLines)].join(', ')}`);
    if (toolLines.length)        profParts.push(`Tools: ${[...new Set(toolLines)].join(', ')}`);
    if (languageLines.length)    profParts.push(`Languages: ${[...new Set(languageLines)].join(', ')}`);
    if (resistanceLines.length)  profParts.push(`Resistances: ${[...new Set(resistanceLines)].join(', ')}`);
    if (senseLines.length)       profParts.push(`Senses: ${[...new Set(senseLines)].join(', ')}`);
    const proficiencies_text = profParts.join('\n');

    // Class / level / race / background
    const primaryClass = data.classes?.[0];
    const className    = primaryClass?.definition?.name || '';
    const level        = primaryClass?.level || 1;
    const race         = data.race?.fullName || data.race?.baseRaceName || '';
    const background   = data.background?.definition?.name || '';
    const alignment    = _DNDB_ALIGNMENTS[data.alignmentId] || '';

    // Currency
    const raw = data.currencies || {};
    const currency = { cp: raw.cp || 0, sp: raw.sp || 0, gp: raw.gp || 0, pp: raw.pp || 0 };

    // Personality — lives in data.traits, each field is its own key
    const traits = data.traits || {};
    const notes  = data.notes  || {};
    const personality_traits  = traits.personalityTraits || '';
    const ideals = traits.ideals || '';
    const bonds  = traits.bonds  || '';
    const flaws  = traits.flaws  || '';

    // Notes — backstory + structured note fields from data.notes
    const backstory           = notes.backstory      || '';
    const notes_organizations = notes.organizations  || '';
    const notes_allies        = notes.allies         || '';
    const notes_enemies       = notes.enemies        || '';
    const notes_text          = notes.otherNotes     || '';

    // Inventory — every item as a structured object
    const inventory = (data.inventory || []).map(item => ({
        name:     item.definition?.name     || '',
        quantity: item.quantity             || 1,
        equipped: item.equipped             || false,
        type:     item.definition?.filterType || '',
        weight:   item.definition?.weight   || 0,
    }));

    // Attacks — built from equipped (and unequipped) weapon items
    const strMod = Math.floor(((ability_scores.str || 10) - 10) / 2);
    const attacks = (data.inventory || [])
        .filter(i => i.definition?.filterType === 'Weapon')
        .map(item => {
            const dfn   = item.definition;
            const props = (dfn.properties || []).map(p => p.name || '');
            const isFinesse = props.includes('Finesse');
            const isRanged  = dfn.attackType === 2;
            const abilMod   = (isFinesse && dexMod > strMod) || isRanged ? dexMod : strMod;
            const toHitNum  = abilMod + proficiency_bonus;
            const dmgBonus  = abilMod > 0 ? `+${abilMod}` : abilMod < 0 ? `${abilMod}` : '';
            return {
                name:    dfn.name || '',
                to_hit:  toHitNum >= 0 ? `+${toHitNum}` : `${toHitNum}`,
                damage:  `${dfn.damage?.diceString || '1d4'}${dmgBonus}`,
            };
        });

    // Spells — classSpells is the main source; data.spells holds race/background/feat spells
    const scAbilId = data.classes?.[0]?.definition?.spellCastingAbilityId;
    const scAbil   = _DNDB_STAT_MAP[scAbilId] || '';
    const scMod    = scAbil ? Math.floor(((ability_scores[scAbil] || 10) - 10) / 2) : 0;
    const saveDC   = scAbil ? 8 + proficiency_bonus + scMod : 0;
    const spellAtkNum = proficiency_bonus + scMod;

    const rawSpells = [];
    // Primary source: classSpells (the real prepared/known list)
    for (const cs of (data.classSpells || [])) {
        for (const sp of (cs.spells || [])) rawSpells.push(sp);
    }
    // Secondary: race/background/feat innate spells
    for (const entries of Object.values(data.spells || {})) {
        if (Array.isArray(entries)) for (const sp of entries) rawSpells.push(sp);
    }

    const spellList = rawSpells.map(sp => ({
        name:       sp.definition?.name   || '',
        level:      sp.definition?.level  ?? 0,
        school:     sp.definition?.school || '',
        prepared:   sp.prepared || sp.alwaysPrepared || false,
        components: (sp.definition?.components || [])
            .map(c => c === 1 ? 'V' : c === 2 ? 'S' : c === 3 ? 'M' : '').join(''),
    }));

    // Spell slots: prefer regular spellSlots; fall back to pactMagic for warlocks
    const rawSlots = (data.spellSlots || []).some(s => s.available > 0)
        ? data.spellSlots
        : (data.pactMagic || []);
    const slots = {};
    for (const s of rawSlots) {
        if (s.available > 0 || s.used > 0) {
            slots[s.level] = { total: s.available || 0, used: s.used || 0 };
        }
    }

    const spells = rawSpells.length ? {
        ability:      scAbil,
        save_dc:      saveDC,
        attack_bonus: spellAtkNum >= 0 ? `+${spellAtkNum}` : `${spellAtkNum}`,
        slots,
        list: spellList,
    } : {};

    // Features & Traits — class features + racial traits + feats (names only, one per line)
    const classFeatureNames = (data.classes || [])
        .flatMap(c => (c.classFeatures || []).map(cf => cf.definition?.name || '').filter(Boolean));
    const racialTraitNames = (data.race?.racialTraits || [])
        .map(t => t.definition?.name || '').filter(Boolean);
    const featNames = (data.feats || [])
        .map(f => f.definition?.name || '').filter(Boolean);
    const features_traits = [...classFeatureNames, ...racialTraitNames, ...featNames].join('\n');

    // Inspiration & death saves (top-level booleans/objects)
    const inspiration     = data.inspiration || false;
    const rawDeathSaves   = data.deathSaves  || {};
    const death_saves_success = rawDeathSaves.successCount || 0;
    const death_saves_fail    = rawDeathSaves.failCount    || 0;

    // Physical appearance — all stored flat at the top level
    const gender = data.gender || '';
    const hair   = data.hair   || '';
    const eyes   = data.eyes   || '';
    const skin   = data.skin   || '';
    const height = data.height ? String(data.height) : '';
    const weight = data.weight ? String(data.weight) : '';

    return {
        class: className,
        level,
        race,
        background,
        alignment,
        xp: data.currentXp || 0,
        proficiency_bonus,
        ability_scores,
        saving_throw_profs,
        skill_profs,
        hp,
        hp_max,
        hp_temp,
        ac,
        speed,
        initiative_bonus: initiativeBonus,
        hit_dice: hitDice,
        inspiration,
        death_saves_success,
        death_saves_fail,
        currency,
        inventory,
        attacks,
        spells,
        features_traits,
        proficiencies_text,
        personality_traits,
        ideals,
        bonds,
        flaws,
        backstory,
        notes_organizations,
        notes_allies,
        notes_enemies,
        notes_text,
        gender,
        hair,
        eyes,
        skin,
        height,
        weight,
        faith: data.faith || '',
        age:   data.age   ? String(data.age) : '',
    };
}

export async function importDndbeyond(req, res) {
    const { channelId } = req.params;
    const { characterId, charId } = req.body;

    if (!characterId) return res.status(400).json({ error: 'characterId is required' });

    // Strip to bare numeric ID in case a full URL was passed
    const id = String(characterId).replace(/\D/g, '');
    if (!id) return res.status(400).json({ error: 'Invalid characterId' });

    try {
        const serverId = await _getChannelServer(channelId);
        if (!serverId) return res.status(404).json({ error: 'VTT channel not found' });

        // Fetch from DnDBeyond public character service
        const dndRes = await fetch(
            `https://character-service.dndbeyond.com/character/v5/character/${id}`,
            { headers: { 'Accept': 'application/json' } }
        );
        if (!dndRes.ok) {
            return res.status(502).json({ error: 'Failed to fetch character from DnDBeyond. Make sure the character is set to public.' });
        }
        const dndJson = await dndRes.json();
        if (!dndJson.success || !dndJson.data) {
            return res.status(502).json({ error: 'DnDBeyond returned an unexpected response.' });
        }

        const sheet_data = _mapDndbeyondData(dndJson.data);
        const charName   = dndJson.data.name || 'Imported Character';

        let character;

        if (charId) {
            // Patch existing character
            const existing = await db.query(
                'SELECT user_id FROM vtt_characters WHERE id=$1 AND channel_id=$2',
                [charId, channelId]
            );
            if (!existing.rows.length) return res.status(404).json({ error: 'Character not found' });

            const isGM = await _isGM(req.session.user.id, serverId, null);
            if (!isGM && existing.rows[0].user_id !== req.session.user.id)
                return res.status(403).json({ error: 'You can only import into your own character' });

            const r = await db.query(
                `UPDATE vtt_characters
                 SET name=$1, system='dnd5e', sheet_data=$2, updated_at=NOW()
                 WHERE id=$3 RETURNING *`,
                [charName, JSON.stringify(sheet_data), charId]
            );
            character = r.rows[0];
        } else {
            // Create new character
            const r = await db.query(
                `INSERT INTO vtt_characters (id, channel_id, user_id, system, name, sheet_data)
                 VALUES ($1,$2,$3,'dnd5e',$4,$5) RETURNING *`,
                [generateSnowflake(), channelId, req.session.user.id, charName, JSON.stringify(sheet_data)]
            );
            character = r.rows[0];
        }

        res.json({ character });
    } catch (e) {
        log(tags.error, 'vttController.importDndbeyond:', e.message);
        res.status(500).json({ error: 'Failed to import character' });
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

        // Check if this user has a linked dddice account
        const userRow = await db.query('SELECT dddice_token, dddice_theme FROM users WHERE id=$1', [req.session.user.id]);
        const linkedToken = userRow.rows[0]?.dddice_token;
        const linkedTheme = userRow.rows[0]?.dddice_theme;

        let sessionToken, theme;

        if (linkedToken) {
            // Use their real account token
            sessionToken = linkedToken;
            theme = linkedTheme || 'nexusguild-mmji72re';
        } else {
            // Create a guest user (no auth) — returns a short-lived fetch token
            const guestRes = await fetch('https://dddice.com/api/1.0/user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            if (!guestRes.ok) throw new Error('Failed to create dddice guest user');
            const guestData = await guestRes.json();
            const fetchToken = guestData.data;

            // Exchange the fetch token for a full API token
            const apiTokenRes = await fetch('https://dddice.com/api/1.0/user/token', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${fetchToken}`, 'Content-Type': 'application/json' }
            });
            const apiTokenData = await apiTokenRes.json();
            sessionToken = apiTokenRes.ok ? (apiTokenData.data || fetchToken) : fetchToken;

            // Add the NexusGuild dice theme to the guest's dice box via share code
            await fetch('https://dddice.com/api/1.0/share/614648f2-1bee-11f1-9b69-969c76305473', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
            });

            theme = 'nexusguild-mmji72re';
        }

        // Join the user/guest to the room
        await fetch(`https://dddice.com/api/1.0/room/${roomSlug}/participant`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        });

        res.json({
            guestToken: sessionToken,
            roomSlug,
            theme,
        });
    } catch (e) {
        log(tags.error, 'vttController.getDddiceToken:', e.message);
        res.status(500).json({ error: 'Failed to get dddice session' });
    }
}

// ── dddice roll (client-side logging endpoint) ───────────────────────────────

export async function dddiceRoll(req, res) {
    const { channelId } = req.params;
    const { notation, total, dice, dddice_roll_id, modifier = 0 } = req.body;
    try {
        // Validate required fields
        if (!notation || total === undefined || !dice || !Array.isArray(dice)) {
            return res.status(400).json({ error: 'Missing required fields: notation, total, dice' });
        }

        const serverId = await _getChannelServer(channelId);
        if (!serverId) return res.status(404).json({ error: 'VTT channel not found' });

        // Verify server membership
        const memberCheck = await db.query(
            'SELECT 1 FROM server_members WHERE server_id=$1 AND user_id=$2',
            [serverId, req.session.user.id]
        );
        if (!memberCheck.rows.length) {
            return res.status(403).json({ error: 'Not a server member' });
        }

        // Store roll in database
        const rollId = generateSnowflake();
        await db.query(
            `INSERT INTO vtt_dice_rolls (id, channel_id, user_id, notation, total, dice, dddice_roll_id, modifier)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [rollId, channelId, req.session.user.id, notation, total, JSON.stringify(dice), dddice_roll_id, modifier]
        );

        // Broadcast to channel for sync (optional)
        const io = req.app.get('io');
        if (io) {
            io.to(`channel:${channelId}`).emit('vtt_dice_rolled', {
                id: rollId,
                channelId,
                userId: req.session.user.id,
                username: req.session.user.username,
                notation,
                total,
                dice,
                dddice_roll_id,
                modifier,
                created_at: new Date().toISOString()
            });
        }

        res.json({ success: true, id: rollId });
    } catch (e) {
        log(tags.error, 'vttController.dddiceRoll:', e.message);
        res.status(500).json({ error: 'Failed to log roll' });
    }
}
