// Proprietary — Cerberus Game Labs. See LICENSE for terms.
import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import { createClient as createRedisClient } from 'redis';
import { RedisStore } from 'connect-redis';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import db from './config/database.js';
import { generateSnowflake } from './utils/functions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
const PORT = 3008;

// ─── Shared Redis session (same store as main app) ────────────────────────────
const redisClient = createRedisClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', err => console.error('[nic] Redis error:', err));
await redisClient.connect();

app.use(express.json());
app.use(session({
    store: new RedisStore({ client: redisClient, prefix: 'ng_sess:' }),
    secret: process.env.SESSION_SECRET || 'nexusguild-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        ...(process.env.NODE_ENV === 'production' && { domain: '.nexusguild.gg' })
    }
}));

app.use(express.static(path.join(__dirname, 'public_home/nic')));

function requireAuth(req, res, next) {
    if (!req.session?.user) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

// ─── Constants ────────────────────────────────────────────────────────────────
const PRODUCTION_RATES    = { impure: 2, normal: 5, pure: 10 };   // per minute at tier 1
const TICK_MS             = 60_000;
const MINER_COST          = { ferrite: 30, pyrene: 10 };
const MINER_POWER_DRAW    = 10;
const MINER_UPGRADE_COSTS = { 2: { ferrite: 60, pyrene: 30 }, 3: { ferrite: 150, pyrene: 75 } };
const MAX_MINER_TIER      = 3;
const RECRUIT_COST        = { ferrite: 80, pyrene: 40 };
const MAX_OPERATIVES      = 5;
const GREEK_NAMES         = ['Alpha','Beta','Gamma','Delta','Epsilon','Zeta','Eta','Theta','Iota','Kappa'];
const BOOTSTRAP_RESOURCES = { ferrite: 100, pyrene: 40 };

// ─── PAHS Constants ───────────────────────────────────────────────────────────
const PAHS_TICK_MS = 10_000;
const MINER_TRANSFER_RATES = { 1: 10, 2: 25, 3: 60 };
const MACHINE_CONFIGS = {
    hub:         { size: 6,  powerGen: 100, powerDraw: 0,  storageCap: 1000, inputFaces: ['N','S'], outputFaces: ['E','W'], inputsPerFace: 6, outputsPerFace: 3, recipes: null },
    power_pole:  { size: 1,  powerGen: 0,   powerDraw: 0,  storageCap: 0,    inputFaces: [],        outputFaces: [],        recipes: null, range: 6 },
    smelter:     { size: 3,  powerGen: 0,   powerDraw: 15, storageCap: 50,   inputFaces: ['W'],     outputFaces: ['E'],     recipes: [
        { inputs: { ferrite_ore: 1 }, outputs: { ferrite_ingot: 1 } },
        { inputs: { pyrene_ore: 1  }, outputs: { pyrene_crystal: 1 } },
    ]},
    crusher:     { size: 4,  powerGen: 0,   powerDraw: 20, storageCap: 75,   inputFaces: ['W'],     outputFaces: ['E'],     recipes: [
        { inputs: { ferrite_ore: 1 }, outputs: { ferrite_powder: 2 } },
        { inputs: { pyrene_ore: 1  }, outputs: { pyrene_dust: 2 } },
    ]},
    assembler:   { size: 4,  powerGen: 0,   powerDraw: 25, storageCap: 100,  inputFaces: ['W','N'], outputFaces: ['E'],     recipes: [
        { inputs: { ferrite_ingot: 1, pyrene_crystal: 1 }, outputs: { component: 1 } },
    ]},
};
const FACE_ROTATE = {
    0:   { N:'N', E:'E', S:'S', W:'W' },
    90:  { N:'E', E:'S', S:'W', W:'N' },
    180: { N:'S', E:'W', S:'N', W:'E' },
    270: { N:'W', E:'N', S:'E', W:'S' },
};

// ─── Map Generation ───────────────────────────────────────────────────────────
const REGION_SIZE = 256;

function imul(a, b) { return Math.imul(a, b); }
function hash(n) {
    n = imul(n ^ (n >>> 16), 0x45d9f3b);
    n = imul(n ^ (n >>> 16), 0x45d9f3b);
    return (n ^ (n >>> 16)) >>> 0;
}
function noise2(x, y, seed) {
    return hash(hash(x | 0) ^ imul(hash(y | 0), 2654435761) ^ imul(hash(seed | 0), 2246822519)) / 0xffffffff;
}
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(t) { return t * t * (3 - 2 * t); }
function smoothNoise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smoothstep(x - ix), fy = smoothstep(y - iy);
    return lerp(
        lerp(noise2(ix, iy, seed),     noise2(ix + 1, iy,     seed), fx),
        lerp(noise2(ix, iy + 1, seed), noise2(ix + 1, iy + 1, seed), fx),
        fy
    );
}
function octaveNoise(x, y, seed, octaves = 6, persistence = 0.5, lacunarity = 2.0) {
    let value = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
        value += smoothNoise(x * freq, y * freq, (seed + i * 7919) >>> 0) * amp;
        max += amp; amp *= persistence; freq *= lacunarity;
    }
    return value / max;
}

const T = { DEEP_WATER: 0, WATER: 1, SAND: 2, DIRT: 3, GRASS: 4, FOREST: 5, STONE: 6, MOUNTAIN: 7 };

function getTerrain(x, y, seed) {
    const nx = x / REGION_SIZE, ny = y / REGION_SIZE;
    const dx = nx - 0.5, dy = ny - 0.5;
    const falloff = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2 * 1.2);
    const height = octaveNoise(nx * 4, ny * 4, seed) * falloff;
    const moisture = octaveNoise(nx * 3 + 1000, ny * 3 + 1000, (seed + 9999) >>> 0);
    if (height < 0.15) return T.DEEP_WATER;
    if (height < 0.25) return T.WATER;
    if (height < 0.30) return T.SAND;
    if (height < 0.45) return moisture > 0.5 ? T.GRASS : T.DIRT;
    if (height < 0.62) return moisture > 0.4 ? T.FOREST : T.GRASS;
    if (height < 0.78) return T.STONE;
    return T.MOUNTAIN;
}

function generateNodes(seed) {
    const resourceNodes = [], placed = [];
    const MIN_SPACING = 12;

    for (let attempt = 0; resourceNodes.length < 40 && attempt < 3000; attempt++) {
        const x = Math.floor(noise2(attempt * 2, seed, 0x1a2b3c) * REGION_SIZE);
        const y = Math.floor(noise2(attempt * 2 + 1, seed, 0x4d5e6f) * REGION_SIZE);
        const terrain = getTerrain(x, y, seed);
        if (terrain < T.DIRT || terrain > T.STONE) continue;
        let tooClose = false;
        for (const p of placed) {
            if (Math.hypot(p.x - x, p.y - y) < MIN_SPACING) { tooClose = true; break; }
        }
        if (tooClose) continue;
        placed.push({ x, y });
        const purity = noise2(x, y, seed ^ 0xdeadbeef);
        const type = noise2(x + 500, y + 500, seed ^ 0xcafe1234) < 0.55 ? 'ferrite' : 'pyrene';
        const purityLabel = purity < 0.5 ? 'impure' : purity < 0.82 ? 'normal' : 'pure';
        resourceNodes.push({ x, y, resource_type: type, purity: purityLabel });
    }

    const researchNodes = [];
    for (let attempt = 0; researchNodes.length < 5 && attempt < 1000; attempt++) {
        const x = Math.floor(noise2(attempt * 3, seed, 0xaabbcc) * REGION_SIZE);
        const y = Math.floor(noise2(attempt * 3 + 1, seed, 0xddeeff) * REGION_SIZE);
        const terrain = getTerrain(x, y, seed);
        if (terrain !== T.STONE && terrain !== T.MOUNTAIN) continue;
        let tooClose = false;
        for (const p of [...placed, ...researchNodes]) {
            if (Math.hypot(p.x - x, p.y - y) < 24) { tooClose = true; break; }
        }
        if (tooClose) continue;
        researchNodes.push({ x, y, tech_id: 'basic_mining', discovered: false });
        placed.push({ x, y });
    }

    const entryPoints = [];
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 3 / 2]) {
        const cx = 128 + Math.cos(angle) * 50;
        const cy = 128 + Math.sin(angle) * 50;
        let best = null, bestDist = Infinity;
        for (let dx = -25; dx <= 25; dx++) {
            for (let dy = -25; dy <= 25; dy++) {
                const tx = Math.round(cx + dx), ty = Math.round(cy + dy);
                if (tx < 0 || tx >= REGION_SIZE || ty < 0 || ty >= REGION_SIZE) continue;
                const terrain = getTerrain(tx, ty, seed);
                if (terrain < T.SAND) continue;
                const dist = Math.hypot(dx, dy);
                if (dist < bestDist) { bestDist = dist; best = { x: tx, y: ty }; }
            }
        }
        if (best) entryPoints.push({ ...best });
    }

    return { resourceNodes, researchNodes, entryPoints };
}

// ─── Production Tick ──────────────────────────────────────────────────────────
async function runProductionTick() {
    try {
        const { rows: miners } = await db.query(`
            SELECT s.id, s.owner_id, s.node_id, s.last_produced_at, s.tier,
                   n.resource_type, n.purity
            FROM nic_structures s
            JOIN nic_resource_nodes n ON n.id = s.node_id
            WHERE s.structure_type = 'miner' AND s.active = true AND s.node_id IS NOT NULL
        `);

        const now = new Date();
        for (const miner of miners) {
            const last = miner.last_produced_at ? new Date(miner.last_produced_at) : new Date(now - TICK_MS);
            const intervals = Math.floor((now - last) / TICK_MS);
            if (intervals < 1) continue;

            const tierMult = Math.pow(2, (miner.tier || 1) - 1);
            const amount = (PRODUCTION_RATES[miner.purity] ?? 2) * tierMult * intervals;
            const resource = miner.resource_type;

            await db.query(`
                UPDATE nic_players
                SET resources = jsonb_set(
                    resources,
                    ARRAY[$1],
                    (COALESCE((resources->>$1)::int, 0) + $2)::text::jsonb
                )
                WHERE user_id = $3
            `, [resource, amount, miner.owner_id]);

            await db.query(
                `UPDATE nic_structures SET last_produced_at = $1 WHERE id = $2`,
                [now, miner.id]
            );

            // Transfer to PAHS hub storage
            const transferRate = MINER_TRANSFER_RATES[miner.tier] || 10;
            const hubRes = await db.query(`
                SELECT m.id, m.storage FROM pahs_machines m
                JOIN pahs_grids g ON g.id = m.grid_id
                WHERE g.user_id = $1 AND m.machine_type = 'hub'
                LIMIT 1
            `, [miner.owner_id]);
            if (hubRes.rows.length) {
                const hub = hubRes.rows[0];
                const st = hub.storage || {};
                const key = miner.resource_type === 'ferrite' ? 'ferrite_ore' : 'pyrene_ore';
                const buf = st.input || {};
                const space = 1000 - (buf[key] || 0);
                const toTransfer = Math.min(transferRate * intervals, space);
                if (toTransfer > 0) {
                    buf[key] = (buf[key] || 0) + toTransfer;
                    st.input = buf;
                    await db.query('UPDATE pahs_machines SET storage = $1 WHERE id = $2',
                        [JSON.stringify(st), hub.id]);
                }
            }
        }
    } catch (err) {
        console.error('[NIC] Production tick error:', err);
    }
}

setInterval(runProductionTick, TICK_MS);
runProductionTick();

// ─── Operative helpers ────────────────────────────────────────────────────────

// Interpolate current position for a traveling operative
function interpolatePosition(op) {
    if (op.status !== 'traveling' || !op.task) return null;
    const startedAt = new Date(op.task.started_at).getTime();
    const eta = new Date(op.task.eta).getTime();
    const progress = Math.min(1, (Date.now() - startedAt) / (eta - startedAt));
    return {
        x: Math.round(op.task.from_tile_x + (op.task.target_tile_x - op.task.from_tile_x) * progress),
        y: Math.round(op.task.from_tile_y + (op.task.target_tile_y - op.task.from_tile_y) * progress),
    };
}

// Find nearest active entry point to a destination tile
async function getNearestEntryPoint(regionId, destX, destY) {
    const { rows } = await db.query(
        'SELECT tile_x, tile_y FROM nic_entry_points WHERE region_id = $1',
        [regionId]
    );
    if (!rows.length) return { x: 128, y: 128 };
    let best = rows[0], bestDist = Infinity;
    for (const ep of rows) {
        const d = Math.hypot(ep.tile_x - destX, ep.tile_y - destY);
        if (d < bestDist) { bestDist = d; best = ep; }
    }
    return { x: best.tile_x, y: best.tile_y };
}

// Resolve travel completion lazily (called before any operative-dependent action)
async function resolveTravel(operativeId) {
    const { rows } = await db.query('SELECT * FROM nic_operatives WHERE id = $1', [operativeId]);
    if (!rows.length) return null;
    const op = rows[0];
    if (op.status !== 'traveling' || !op.task?.eta) return op;
    if (new Date() < new Date(op.task.eta)) return op; // still en route

    // Recall travel — arrived at entry point, go idle
    if (op.task.recall) {
        await db.query(`
            UPDATE nic_operatives
            SET status = 'idle', region_id = NULL, tile_x = NULL, tile_y = NULL, task = NULL
            WHERE id = $1
        `, [operativeId]);
        return { ...op, status: 'idle', tile_x: null, tile_y: null, region_id: null };
    }

    // Arrived — update position and status
    await db.query(`
        UPDATE nic_operatives
        SET status = 'deployed',
            region_id = $1,
            tile_x = $2,
            tile_y = $3,
            task = task || '{"arrived": true}'::jsonb
        WHERE id = $4
    `, [op.task.region_id, op.task.target_tile_x, op.task.target_tile_y, operativeId]);

    return { ...op, status: 'deployed', tile_x: op.task.target_tile_x, tile_y: op.task.target_tile_y };
}

// ─── PAHS Helpers ─────────────────────────────────────────────────────────────

function getPortCells(machine) {
    const cfg = MACHINE_CONFIGS[machine.machine_type];
    if (!cfg) return { inputs: [], outputs: [] };
    const { x, y, size, rotation } = machine;
    const rot = FACE_ROTATE[rotation] || FACE_ROTATE[0];
    // Evenly distribute 'count' ports across a face of 'size' cells
    // Formula: offset = floor(size * (2i + 1) / (2 * count)) → centers each port in its slot
    const faceCells = (localFace, count, isOutput) => {
        const gf = rot[localFace];
        const cells = [];
        for (let i = 0; i < count; i++) {
            const offset = Math.floor(size * (2 * i + 1) / (2 * count));
            const cell = { portKey: isOutput ? `${localFace}:${i}` : undefined };
            if (gf === 'N') { cell.x = x + offset; cell.y = y - 1; }
            else if (gf === 'S') { cell.x = x + offset; cell.y = y + size; }
            else if (gf === 'E') { cell.x = x + size;   cell.y = y + offset; }
            else if (gf === 'W') { cell.x = x - 1;      cell.y = y + offset; }
            if (cell.x !== undefined) cells.push(cell);
        }
        return cells;
    };
    const inCount  = cfg.inputsPerFace  || 1;
    const outCount = cfg.outputsPerFace || 1;
    return {
        inputs:  (cfg.inputFaces  || []).flatMap(f => faceCells(f, inCount,  false)),
        outputs: (cfg.outputFaces || []).flatMap(f => faceCells(f, outCount, true)),
    };
}

function isPowered(machine, allMachines) {
    if (machine.machine_type === 'hub') return true;
    const poles = allMachines.filter(m => m.machine_type === 'power_pole' && m.enabled);
    for (const pole of poles) {
        for (let dx = 0; dx < machine.size; dx++) {
            for (let dy = 0; dy < machine.size; dy++) {
                if (Math.hypot(machine.x + dx - pole.x, machine.y + dy - pole.y) <= 6) return true;
            }
        }
    }
    return false;
}

function storageTotal(storage) {
    if (!storage) return 0;
    return Object.values(storage).reduce((a, b) => a + (b || 0), 0);
}

// ─── PNG preview generator ────────────────────────────────────────────────────
const _crcTable = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[i] = c >>> 0;
    }
    return t;
})();

function _crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = _crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function _pngChunk(type, data) {
    const typeB = Buffer.from(type, 'ascii');
    const lenB  = Buffer.allocUnsafe(4); lenB.writeUInt32BE(data.length, 0);
    const crcIn = Buffer.concat([typeB, data]);
    const crcB  = Buffer.allocUnsafe(4); crcB.writeUInt32BE(_crc32(crcIn), 0);
    return Buffer.concat([lenB, typeB, data, crcB]);
}

// Terrain colors matching renderer.js
const TERRAIN_RGB = [
    [15, 30, 80],     // DEEP_WATER
    [20, 60, 140],    // WATER
    [194, 178, 128],  // SAND
    [139, 115, 85],   // DIRT
    [80, 160, 60],    // GRASS
    [30, 100, 30],    // FOREST
    [120, 120, 120],  // STONE
    [200, 200, 210],  // MOUNTAIN
];

const _previewCache = new Map(); // regionId → Buffer

function buildTerrainPreview(seed) {
    const W = REGION_SIZE, H = REGION_SIZE;
    const scanline = W * 3 + 1;
    const raw = Buffer.allocUnsafe(H * scanline);
    for (let y = 0; y < H; y++) {
        raw[y * scanline] = 0;
        for (let x = 0; x < W; x++) {
            const t = getTerrain(x, y, seed);
            const [r, g, b] = TERRAIN_RGB[t] || [0, 0, 0];
            const off = y * scanline + 1 + x * 3;
            raw[off] = r; raw[off + 1] = g; raw[off + 2] = b;
        }
    }
    const ihdr = Buffer.allocUnsafe(13);
    ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const compressed = zlib.deflateSync(raw);
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        _pngChunk('IHDR', ihdr),
        _pngChunk('IDAT', compressed),
        _pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

// ─── Region access helper ─────────────────────────────────────────────────────
async function canAccessRegion(region, userId) {
    if (region.visibility === 'public') return true;
    if (region.owner_id === userId) return true;
    if (!region.server_id) return false;
    // Guild members always have access (guild + invite visibility)
    const memberRes = await db.query(
        'SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2',
        [region.server_id, userId]
    );
    if (memberRes.rows.length) return true;
    // Invite: also check invite table for non-guild members
    if (region.visibility === 'invite') {
        const invRes = await db.query(
            'SELECT 1 FROM nic_region_invites WHERE region_id = $1 AND user_id = $2',
            [region.id, userId]
        );
        return invRes.rows.length > 0;
    }
    return false;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Get or init player PAHS
app.get('/api/nic/me', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    try {
        // Init player row
        await db.query(
            `INSERT INTO nic_players (user_id, resources) VALUES ($1, $2::jsonb)
             ON CONFLICT (user_id) DO UPDATE SET resources = EXCLUDED.resources
             WHERE nic_players.resources = '{}'::jsonb`,
            [userId, JSON.stringify(BOOTSTRAP_RESOURCES)]
        );
        // Give starter operative if none
        const ops = await db.query('SELECT * FROM nic_operatives WHERE user_id = $1', [userId]);
        if (!ops.rows.length) {
            await db.query(
                `INSERT INTO nic_operatives (id, user_id, name, operative_type) VALUES ($1, $2, $3, 'worker')`,
                [generateSnowflake(), userId, 'Operative Alpha']
            );
        }

        // Resolve any completed travel
        const operatives = await db.query('SELECT * FROM nic_operatives WHERE user_id = $1', [userId]);
        const resolvedOps = await Promise.all(operatives.rows.map(op =>
            op.status === 'traveling' ? resolveTravel(op.id) : op
        ));

        const [playerRes, powerRes, guildsRes] = await Promise.all([
            db.query('SELECT * FROM nic_players WHERE user_id = $1', [userId]),
            db.query(`SELECT COALESCE(SUM(power_draw), 0) AS used
                      FROM nic_structures WHERE owner_id = $1 AND active = true`, [userId]),
            db.query(`SELECT s.id, s.name, s.icon, s.owner_id
                      FROM server_members sm JOIN servers s ON s.id = sm.server_id
                      WHERE sm.user_id = $1 ORDER BY s.name`, [userId]),
        ]);
        const p = playerRes.rows[0];
        // Include own region if any
        const ownRegion = await db.query(
            `SELECT id, name, visibility, server_id FROM nic_regions WHERE owner_id = $1 AND status = 'active' LIMIT 1`,
            [userId]
        );
        res.json({
            ...p,
            power_used: parseInt(powerRes.rows[0].used),
            operatives: resolvedOps,
            guilds: guildsRes.rows,
            own_region: ownRegion.rows[0] || null,
        });
    } catch (err) {
        console.error('[NIC] /me error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// List accessible regions
app.get('/api/nic/regions', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    try {
        const result = await db.query(`
            SELECT r.*, s.name as server_name,
                   (SELECT COUNT(*) FROM nic_resource_nodes n WHERE n.region_id = r.id) as resource_count,
                   (SELECT COUNT(*) FROM nic_entry_points e WHERE e.region_id = r.id) as entry_count
            FROM nic_regions r
            LEFT JOIN servers s ON r.server_id = s.id
            WHERE r.status = 'active'
              AND (
                r.visibility = 'public'
                OR r.owner_id = $1
                OR (r.server_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM server_members sm WHERE sm.server_id = r.server_id AND sm.user_id = $1
                ))
                OR EXISTS (
                    SELECT 1 FROM nic_region_invites i WHERE i.region_id = r.id AND i.user_id = $1
                )
              )
            ORDER BY r.created_at DESC
            LIMIT 50
        `, [userId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Get single region
app.get('/api/nic/regions/:id', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    try {
        const region = await db.query('SELECT * FROM nic_regions WHERE id = $1', [req.params.id]);
        if (!region.rows.length) return res.status(404).json({ error: 'Not found' });
        if (!await canAccessRegion(region.rows[0], userId)) return res.status(403).json({ error: 'Access denied' });

        const [resourceNodes, researchNodes, entryPoints, structures, foreignOps] = await Promise.all([
            db.query('SELECT * FROM nic_resource_nodes WHERE region_id = $1', [req.params.id]),
            db.query('SELECT * FROM nic_research_nodes WHERE region_id = $1', [req.params.id]),
            db.query('SELECT * FROM nic_entry_points WHERE region_id = $1', [req.params.id]),
            db.query(`SELECT s.*, u.username as owner_name
                      FROM nic_structures s
                      LEFT JOIN users u ON u.id = s.owner_id
                      WHERE s.region_id = $1`, [req.params.id]),
            db.query(`SELECT o.id, o.name, o.status, o.tile_x, o.tile_y, o.task,
                             u.username as owner_name
                      FROM nic_operatives o
                      JOIN users u ON u.id = o.user_id
                      WHERE o.region_id = $1 AND o.user_id != $2
                        AND o.status IN ('deployed', 'traveling')`,
                [req.params.id, req.session.user.id]),
        ]);

        res.json({
            ...region.rows[0],
            resource_nodes:     resourceNodes.rows,
            research_nodes:     researchNodes.rows,
            entry_points:       entryPoints.rows,
            structures:         structures.rows,
            foreign_operatives: foreignOps.rows,
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Create a region
app.post('/api/nic/regions', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    try {
        // One region per user
        const existing = await db.query(
            `SELECT id FROM nic_regions WHERE owner_id = $1 AND status = 'active'`, [userId]
        );
        if (existing.rows.length) return res.status(400).json({ error: 'You already own a region. Delete it first to create a new one.' });

        const seed = (Math.random() * 0x7fffffff) | 0;
        const id = generateSnowflake();
        const name = (req.body.name || 'New Region').slice(0, 60);
        const serverId = req.body.server_id || null;
        const visibility = ['public', 'guild', 'invite'].includes(req.body.visibility)
            ? req.body.visibility : 'guild';

        // Validate server membership if linking a guild
        if (serverId) {
            const mem = await db.query(
                'SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2',
                [serverId, userId]
            );
            if (!mem.rows.length) return res.status(403).json({ error: 'Not a member of that guild' });
        }

        const { resourceNodes, researchNodes, entryPoints } = generateNodes(seed);

        await db.query(
            `INSERT INTO nic_regions (id, server_id, owner_id, name, seed, visibility) VALUES ($1,$2,$3,$4,$5,$6)`,
            [id, serverId, userId, name, seed, visibility]
        );
        for (const n of resourceNodes) {
            await db.query(
                `INSERT INTO nic_resource_nodes (id, region_id, tile_x, tile_y, resource_type, purity) VALUES ($1,$2,$3,$4,$5,$6)`,
                [generateSnowflake(), id, n.x, n.y, n.resource_type, n.purity]
            );
        }
        for (const n of researchNodes) {
            await db.query(
                `INSERT INTO nic_research_nodes (id, region_id, tile_x, tile_y, tech_id, discovered) VALUES ($1,$2,$3,$4,$5,$6)`,
                [generateSnowflake(), id, n.x, n.y, n.tech_id, n.discovered]
            );
        }
        for (const ep of entryPoints) {
            await db.query(
                `INSERT INTO nic_entry_points (id, region_id, tile_x, tile_y) VALUES ($1,$2,$3,$4)`,
                [generateSnowflake(), id, ep.x, ep.y]
            );
        }

        res.json({ id, seed, name });
    } catch (err) {
        console.error('[NIC] create region error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Deploy operative to a resource node
app.post('/api/nic/operatives/:id/deploy', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    const { region_id, node_id } = req.body;
    try {
        const opRes = await db.query(
            'SELECT * FROM nic_operatives WHERE id = $1 AND user_id = $2',
            [req.params.id, userId]
        );
        if (!opRes.rows.length) return res.status(404).json({ error: 'Operative not found' });
        const op = opRes.rows[0];

        const nodeRes = await db.query('SELECT * FROM nic_resource_nodes WHERE id = $1', [node_id]);
        if (!nodeRes.rows.length) return res.status(404).json({ error: 'Node not found' });
        const node = nodeRes.rows[0];

        // Travel distance from current position
        let fromX, fromY;
        if (op.status === 'traveling') {
            const pos = interpolatePosition(op);
            fromX = pos.x; fromY = pos.y;
        } else if (op.status === 'deployed' && op.region_id === region_id) {
            fromX = op.tile_x ?? 128; fromY = op.tile_y ?? 128;
        } else {
            const ep = await getNearestEntryPoint(region_id, node.tile_x, node.tile_y);
            fromX = ep.x; fromY = ep.y;
        }
        const distance = Math.ceil(Math.hypot(node.tile_x - fromX, node.tile_y - fromY));
        const eta = new Date(Date.now() + distance * TICK_MS);

        const task = {
            type: 'travel',
            region_id,
            node_id,
            from_tile_x: fromX,
            from_tile_y: fromY,
            target_tile_x: node.tile_x,
            target_tile_y: node.tile_y,
            started_at: new Date().toISOString(),
            eta: eta.toISOString(),
        };

        await db.query(`
            UPDATE nic_operatives
            SET status = 'traveling', region_id = $1, task = $2::jsonb
            WHERE id = $3
        `, [region_id, JSON.stringify(task), req.params.id]);

        res.json({ eta: eta.toISOString(), distance, minutes: distance });
    } catch (err) {
        console.error('[NIC] deploy error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Recall operative — routes to nearest entry point, then goes idle on arrival
app.post('/api/nic/operatives/:id/recall', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    try {
        const opRes = await db.query(
            'SELECT * FROM nic_operatives WHERE id = $1 AND user_id = $2',
            [req.params.id, userId]
        );
        if (!opRes.rows.length) return res.status(404).json({ error: 'Operative not found' });
        const op = opRes.rows[0];

        // If idle or no region, nothing to do
        if (op.status === 'idle' || !op.region_id) {
            await db.query(
                `UPDATE nic_operatives SET status = 'idle', region_id = NULL, tile_x = NULL, tile_y = NULL, task = NULL WHERE id = $1`,
                [req.params.id]
            );
            return res.json({ ok: true });
        }

        // Compute current position
        let fromX, fromY;
        if (op.status === 'traveling') {
            const pos = interpolatePosition(op);
            fromX = pos.x; fromY = pos.y;
        } else {
            fromX = op.tile_x ?? 128; fromY = op.tile_y ?? 128;
        }

        // Find nearest entry point from current position
        const ep = await getNearestEntryPoint(op.region_id, fromX, fromY);

        // Already at the entry point — go idle immediately
        if (fromX === ep.x && fromY === ep.y) {
            await db.query(
                `UPDATE nic_operatives SET status = 'idle', region_id = NULL, tile_x = NULL, tile_y = NULL, task = NULL WHERE id = $1`,
                [req.params.id]
            );
            return res.json({ ok: true });
        }

        const distance = Math.ceil(Math.hypot(ep.x - fromX, ep.y - fromY));
        const eta = new Date(Date.now() + distance * TICK_MS);
        const task = {
            type: 'recall',
            recall: true,
            region_id: op.region_id,
            from_tile_x: fromX,
            from_tile_y: fromY,
            target_tile_x: ep.x,
            target_tile_y: ep.y,
            started_at: new Date().toISOString(),
            eta: eta.toISOString(),
        };

        await db.query(
            `UPDATE nic_operatives SET status = 'traveling', task = $1::jsonb WHERE id = $2`,
            [JSON.stringify(task), req.params.id]
        );

        res.json({ ok: true, minutes: distance });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Build a miner at operative's current location
app.post('/api/nic/structures/build', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    const { operative_id, node_id } = req.body;
    try {
        const op = await resolveTravel(operative_id);
        if (!op) return res.status(404).json({ error: 'Operative not found' });
        if (op.user_id !== userId) return res.status(403).json({ error: 'Forbidden' });
        if (op.status !== 'deployed') return res.status(400).json({ error: 'Operative is not deployed at a location' });

        const nodeRes = await db.query('SELECT * FROM nic_resource_nodes WHERE id = $1', [node_id]);
        if (!nodeRes.rows.length) return res.status(404).json({ error: 'Node not found' });
        const node = nodeRes.rows[0];

        if (op.tile_x !== node.tile_x || op.tile_y !== node.tile_y) {
            return res.status(400).json({ error: 'Operative is not at this node' });
        }

        // Check for existing miner
        const existing = await db.query(
            `SELECT id FROM nic_structures WHERE node_id = $1 AND structure_type = 'miner'`,
            [node_id]
        );
        if (existing.rows.length) return res.status(400).json({ error: 'A miner already exists at this node' });

        // Check resources and power
        const [playerRes, powerRes] = await Promise.all([
            db.query('SELECT * FROM nic_players WHERE user_id = $1', [userId]),
            db.query(`SELECT COALESCE(SUM(power_draw), 0) AS used
                      FROM nic_structures WHERE owner_id = $1 AND active = true`, [userId]),
        ]);
        const p = playerRes.rows[0];
        const res_ = p.resources || {};
        const powerUsed = parseInt(powerRes.rows[0].used);
        const powerCap  = p.power_capacity;

        if ((res_.ferrite ?? 0) < MINER_COST.ferrite)
            return res.status(400).json({ error: `Not enough Ferrite (need ${MINER_COST.ferrite})` });
        if ((res_.pyrene ?? 0) < MINER_COST.pyrene)
            return res.status(400).json({ error: `Not enough Pyrene (need ${MINER_COST.pyrene})` });
        if (powerUsed + MINER_POWER_DRAW > powerCap)
            return res.status(400).json({ error: 'Not enough power capacity' });

        // Deduct resources
        await db.query(`
            UPDATE nic_players SET
                resources = resources
                    || jsonb_build_object('ferrite', (COALESCE((resources->>'ferrite')::int,0) - $1))
                    || jsonb_build_object('pyrene',  (COALESCE((resources->>'pyrene')::int,0)  - $2))
            WHERE user_id = $3
        `, [MINER_COST.ferrite, MINER_COST.pyrene, userId]);

        const structureId = generateSnowflake();
        await db.query(`
            INSERT INTO nic_structures
                (id, region_id, owner_id, tile_x, tile_y, structure_type, tier, power_draw, node_id, active, last_produced_at)
            VALUES ($1, $2, $3, $4, $5, 'miner', 1, $6, $7, true, NOW())
        `, [structureId, node.region_id, userId, node.tile_x, node.tile_y, MINER_POWER_DRAW, node_id]);


        res.json({ id: structureId, message: 'Miner constructed!' });
    } catch (err) {
        console.error('[NIC] build error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Move operative to any valid tile (for power plant construction etc.)
app.post('/api/nic/operatives/:id/move', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    const { region_id, tile_x, tile_y } = req.body;
    try {
        const opRes = await db.query(
            'SELECT * FROM nic_operatives WHERE id = $1 AND user_id = $2',
            [req.params.id, userId]
        );
        if (!opRes.rows.length) return res.status(404).json({ error: 'Operative not found' });
        const op = opRes.rows[0];

        const tx = parseInt(tile_x), ty = parseInt(tile_y);
        if (isNaN(tx) || isNaN(ty) || tx < 0 || tx >= REGION_SIZE || ty < 0 || ty >= REGION_SIZE)
            return res.status(400).json({ error: 'Invalid tile coordinates' });

        let fromX, fromY;
        if (op.status === 'traveling') {
            const pos = interpolatePosition(op);
            fromX = pos.x; fromY = pos.y;
        } else if (op.status === 'deployed' && op.region_id === region_id) {
            fromX = op.tile_x ?? 128; fromY = op.tile_y ?? 128;
        } else {
            const ep = await getNearestEntryPoint(region_id, tx, ty);
            fromX = ep.x; fromY = ep.y;
        }
        const distance = Math.ceil(Math.hypot(tx - fromX, ty - fromY));
        const eta = new Date(Date.now() + distance * TICK_MS);

        const task = {
            type: 'move',
            region_id,
            from_tile_x: fromX,
            from_tile_y: fromY,
            target_tile_x: tx,
            target_tile_y: ty,
            started_at: new Date().toISOString(),
            eta: eta.toISOString(),
        };

        await db.query(
            `UPDATE nic_operatives SET status = 'traveling', region_id = $1, task = $2::jsonb WHERE id = $3`,
            [region_id, JSON.stringify(task), req.params.id]
        );
        res.json({ eta: eta.toISOString(), distance, minutes: distance });
    } catch (err) {
        console.error('[NIC] move error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Upgrade a miner structure
app.post('/api/nic/structures/:id/upgrade', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    try {
        const structRes = await db.query(
            'SELECT * FROM nic_structures WHERE id = $1 AND owner_id = $2',
            [req.params.id, userId]
        );
        if (!structRes.rows.length) return res.status(404).json({ error: 'Structure not found' });
        const s = structRes.rows[0];
        if (s.structure_type !== 'miner') return res.status(400).json({ error: 'Only miners can be upgraded' });
        if (s.tier >= MAX_MINER_TIER) return res.status(400).json({ error: 'Already at max tier' });

        const nextTier = s.tier + 1;
        const cost = MINER_UPGRADE_COSTS[nextTier];

        const playerRes = await db.query('SELECT * FROM nic_players WHERE user_id = $1', [userId]);
        const res_ = playerRes.rows[0].resources || {};
        if ((res_.ferrite ?? 0) < cost.ferrite)
            return res.status(400).json({ error: `Not enough Ferrite (need ${cost.ferrite})` });
        if ((res_.pyrene ?? 0) < cost.pyrene)
            return res.status(400).json({ error: `Not enough Pyrene (need ${cost.pyrene})` });

        await db.query(`
            UPDATE nic_players SET
                resources = resources
                    || jsonb_build_object('ferrite', (COALESCE((resources->>'ferrite')::int,0) - $1))
                    || jsonb_build_object('pyrene',  (COALESCE((resources->>'pyrene')::int,0)  - $2))
            WHERE user_id = $3
        `, [cost.ferrite, cost.pyrene, userId]);

        await db.query('UPDATE nic_structures SET tier = $1 WHERE id = $2', [nextTier, req.params.id]);
        res.json({ tier: nextTier });
    } catch (err) {
        console.error('[NIC] upgrade error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Recruit a new operative
app.post('/api/nic/operatives/recruit', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    try {
        const opsRes = await db.query('SELECT name FROM nic_operatives WHERE user_id = $1', [userId]);
        if (opsRes.rows.length >= MAX_OPERATIVES)
            return res.status(400).json({ error: `Max operatives (${MAX_OPERATIVES}) reached` });

        const playerRes = await db.query('SELECT * FROM nic_players WHERE user_id = $1', [userId]);
        const res_ = playerRes.rows[0].resources || {};
        if ((res_.ferrite ?? 0) < RECRUIT_COST.ferrite)
            return res.status(400).json({ error: `Not enough Ferrite (need ${RECRUIT_COST.ferrite})` });
        if ((res_.pyrene ?? 0) < RECRUIT_COST.pyrene)
            return res.status(400).json({ error: `Not enough Pyrene (need ${RECRUIT_COST.pyrene})` });

        const usedNames = new Set(opsRes.rows.map(o => o.name.replace('Operative ', '')));
        const codename = GREEK_NAMES.find(n => !usedNames.has(n)) ?? `Operative-${opsRes.rows.length + 1}`;

        await db.query(`
            UPDATE nic_players SET
                resources = resources
                    || jsonb_build_object('ferrite', (COALESCE((resources->>'ferrite')::int,0) - $1))
                    || jsonb_build_object('pyrene',  (COALESCE((resources->>'pyrene')::int,0)  - $2))
            WHERE user_id = $3
        `, [RECRUIT_COST.ferrite, RECRUIT_COST.pyrene, userId]);

        const id = generateSnowflake();
        await db.query(
            `INSERT INTO nic_operatives (id, user_id, name, operative_type) VALUES ($1, $2, $3, 'worker')`,
            [id, userId, `Operative ${codename}`]
        );
        res.json({ id, name: `Operative ${codename}` });
    } catch (err) {
        console.error('[NIC] recruit error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Region terrain preview (PNG) — cached per region
app.get('/api/nic/regions/:id/preview', async (req, res) => {
    try {
        if (_previewCache.has(req.params.id)) {
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'public, max-age=86400');
            return res.send(_previewCache.get(req.params.id));
        }
        const result = await db.query('SELECT seed FROM nic_regions WHERE id = $1', [req.params.id]);
        if (!result.rows.length) return res.status(404).end();
        const png = buildTerrainPreview(result.rows[0].seed);
        _previewCache.set(req.params.id, png);
        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(png);
    } catch (err) {
        console.error('[NIC] preview error:', err);
        res.status(500).end();
    }
});

// Invite a user to a region (owner only)
app.post('/api/nic/regions/:id/invites', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    const { username } = req.body;
    try {
        const regionRes = await db.query('SELECT * FROM nic_regions WHERE id = $1', [req.params.id]);
        if (!regionRes.rows.length) return res.status(404).json({ error: 'Region not found' });
        if (regionRes.rows[0].owner_id !== userId) return res.status(403).json({ error: 'Not your region' });
        if (regionRes.rows[0].visibility !== 'invite') return res.status(400).json({ error: 'Region is not invite-only' });

        const userRes = await db.query('SELECT id FROM users WHERE username = $1', [username]);
        if (!userRes.rows.length) return res.status(404).json({ error: 'User not found' });

        await db.query(
            `INSERT INTO nic_region_invites (region_id, user_id, invited_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [req.params.id, userRes.rows[0].id, userId]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Remove an invite
app.delete('/api/nic/regions/:id/invites/:userId', requireAuth, async (req, res) => {
    const ownerId = req.session.user.id;
    try {
        const regionRes = await db.query('SELECT owner_id FROM nic_regions WHERE id = $1', [req.params.id]);
        if (!regionRes.rows.length) return res.status(404).json({ error: 'Not found' });
        if (regionRes.rows[0].owner_id !== ownerId) return res.status(403).json({ error: 'Not your region' });
        await db.query('DELETE FROM nic_region_invites WHERE region_id = $1 AND user_id = $2', [req.params.id, req.params.userId]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Update region visibility
app.patch('/api/nic/regions/:id', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    const { visibility } = req.body;
    if (!['public', 'guild', 'invite'].includes(visibility))
        return res.status(400).json({ error: 'Invalid visibility' });
    try {
        const result = await db.query(
            `UPDATE nic_regions SET visibility = $1 WHERE id = $2 AND owner_id = $3 RETURNING *`,
            [visibility, req.params.id, userId]
        );
        if (!result.rows.length) return res.status(403).json({ error: 'Not your region' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── PAHS Routes ──────────────────────────────────────────────────────────────

// Get or init player grid
app.get('/api/pahs/grid', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    try {
        let gridRes = await db.query('SELECT * FROM pahs_grids WHERE user_id = $1', [userId]);
        let grid = gridRes.rows[0];
        if (!grid) {
            const gridId = generateSnowflake();
            await db.query('INSERT INTO pahs_grids (id, user_id) VALUES ($1, $2)', [gridId, userId]);
            // Place hub at center
            const size = 64, hubSize = 6;
            const hx = Math.floor((size - hubSize) / 2);
            const hy = Math.floor((size - hubSize) / 2);
            const hubId = generateSnowflake();
            await db.query(
                `INSERT INTO pahs_machines (id, grid_id, machine_type, x, y, size, rotation, storage)
                 VALUES ($1,$2,'hub',$3,$4,6,0,'{"input":{},"output":{}}')`,
                [hubId, gridId, hx, hy]
            );
            grid = { id: gridId, user_id: userId, size };
        }
        res.json(grid);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Get full grid state
app.get('/api/pahs/state', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    try {
        const gridRes = await db.query('SELECT * FROM pahs_grids WHERE user_id = $1', [userId]);
        if (!gridRes.rows.length) return res.status(404).json({ error: 'No grid' });
        const grid = gridRes.rows[0];
        const [machines, belts] = await Promise.all([
            db.query('SELECT * FROM pahs_machines WHERE grid_id = $1', [grid.id]),
            db.query('SELECT * FROM pahs_belts WHERE grid_id = $1', [grid.id]),
        ]);
        // Annotate machines with port positions and power status
        const annotated = machines.rows.map(m => ({
            ...m,
            ports: getPortCells(m),
            powered: isPowered(m, machines.rows),
            port_config: m.port_config || {},
        }));
        res.json({ grid, machines: annotated, belts: belts.rows });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Place machine
app.post('/api/pahs/machines', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    const { machine_type, x, y, rotation = 0 } = req.body;
    try {
        const cfg = MACHINE_CONFIGS[machine_type];
        if (!cfg) return res.status(400).json({ error: 'Unknown machine type' });
        if (machine_type === 'hub') return res.status(400).json({ error: 'Hub already placed' });
        const gridRes = await db.query('SELECT * FROM pahs_grids WHERE user_id = $1', [userId]);
        if (!gridRes.rows.length) return res.status(404).json({ error: 'No grid' });
        const grid = gridRes.rows[0];
        if (x < 0 || y < 0 || x + cfg.size > grid.size || y + cfg.size > grid.size)
            return res.status(400).json({ error: 'Out of bounds' });
        // Collision check
        const existing = await db.query('SELECT * FROM pahs_machines WHERE grid_id = $1', [grid.id]);
        for (const m of existing.rows) {
            const overlap = x < m.x + m.size && x + cfg.size > m.x && y < m.y + m.size && y + cfg.size > m.y;
            if (overlap) return res.status(400).json({ error: 'Space occupied' });
        }
        const id = generateSnowflake();
        const initStorage = (cfg.storageCap > 0 && cfg.recipes) ? { input: {}, output: {} } : {};
        await db.query(
            'INSERT INTO pahs_machines (id, grid_id, machine_type, x, y, size, rotation, storage) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [id, grid.id, machine_type, x, y, cfg.size, rotation, JSON.stringify(initStorage)]
        );
        res.json({ id, machine_type, x, y, size: cfg.size, rotation });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Remove machine
app.delete('/api/pahs/machines/:id', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    try {
        const m = await db.query(
            'SELECT m.* FROM pahs_machines m JOIN pahs_grids g ON g.id = m.grid_id WHERE m.id = $1 AND g.user_id = $2',
            [req.params.id, userId]
        );
        if (!m.rows.length) return res.status(404).json({ error: 'Not found' });
        if (m.rows[0].machine_type === 'hub') return res.status(400).json({ error: 'Cannot remove hub' });
        await db.query('DELETE FROM pahs_machines WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Rotate machine
app.patch('/api/pahs/machines/:id/rotate', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    const { rotation } = req.body;
    if (![0, 90, 180, 270].includes(rotation)) return res.status(400).json({ error: 'Invalid rotation' });
    try {
        const m = await db.query(
            'SELECT m.* FROM pahs_machines m JOIN pahs_grids g ON g.id = m.grid_id WHERE m.id = $1 AND g.user_id = $2',
            [req.params.id, userId]
        );
        if (!m.rows.length) return res.status(404).json({ error: 'Not found' });
        if (m.rows[0].machine_type === 'hub') return res.status(400).json({ error: 'Cannot rotate hub' });
        await db.query('UPDATE pahs_machines SET rotation = $1 WHERE id = $2', [rotation, req.params.id]);
        res.json({ rotation });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Set output port filter
app.patch('/api/pahs/machines/:id/port-filter', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    const { portKey, itemType } = req.body; // itemType null = clear filter
    if (!portKey) return res.status(400).json({ error: 'portKey required' });
    try {
        const m = await db.query(
            'SELECT m.* FROM pahs_machines m JOIN pahs_grids g ON g.id = m.grid_id WHERE m.id = $1 AND g.user_id = $2',
            [req.params.id, userId]
        );
        if (!m.rows.length) return res.status(404).json({ error: 'Not found' });
        const portConfig = m.rows[0].port_config || {};
        if (itemType) portConfig[portKey] = itemType;
        else delete portConfig[portKey];
        await db.query('UPDATE pahs_machines SET port_config = $1 WHERE id = $2',
            [JSON.stringify(portConfig), req.params.id]);
        res.json({ port_config: portConfig });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Toggle machine enabled
app.patch('/api/pahs/machines/:id/toggle', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    try {
        const m = await db.query(
            'SELECT m.* FROM pahs_machines m JOIN pahs_grids g ON g.id = m.grid_id WHERE m.id = $1 AND g.user_id = $2',
            [req.params.id, userId]
        );
        if (!m.rows.length) return res.status(404).json({ error: 'Not found' });
        const newEnabled = !m.rows[0].enabled;
        await db.query('UPDATE pahs_machines SET enabled = $1 WHERE id = $2', [newEnabled, req.params.id]);
        res.json({ enabled: newEnabled });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Place belt cell(s)
app.post('/api/pahs/belts', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    const { cells } = req.body; // [{ x, y, direction }]
    try {
        const gridRes = await db.query('SELECT * FROM pahs_grids WHERE user_id = $1', [userId]);
        if (!gridRes.rows.length) return res.status(404).json({ error: 'No grid' });
        const grid = gridRes.rows[0];
        const machines = await db.query('SELECT * FROM pahs_machines WHERE grid_id = $1', [grid.id]);
        for (const cell of cells) {
            // Check not inside a machine footprint
            const inside = machines.rows.some(m =>
                cell.x >= m.x && cell.x < m.x + m.size && cell.y >= m.y && cell.y < m.y + m.size
            );
            if (inside) continue; // skip silently
            const id = generateSnowflake();
            await db.query(
                'INSERT INTO pahs_belts (id, grid_id, x, y, direction) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (grid_id, x, y) DO UPDATE SET direction = $5',
                [id, grid.id, cell.x, cell.y, cell.direction]
            );
        }
        res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Remove belt cell(s)
app.delete('/api/pahs/belts', requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    const { cells } = req.body; // [{ x, y }]
    try {
        const gridRes = await db.query('SELECT * FROM pahs_grids WHERE user_id = $1', [userId]);
        if (!gridRes.rows.length) return res.status(404).json({ error: 'No grid' });
        const grid = gridRes.rows[0];
        for (const cell of cells) {
            await db.query('DELETE FROM pahs_belts WHERE grid_id = $1 AND x = $2 AND y = $3',
                [grid.id, cell.x, cell.y]);
        }
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Serve PAHS page
app.use('/pahs', express.static(path.join(__dirname, 'public_home/pahs')));

// ─── PAHS Tick ────────────────────────────────────────────────────────────────

async function runPAHSTick() {
    try {
        const { rows: grids } = await db.query('SELECT * FROM pahs_grids');
        for (const grid of grids) await processPAHSGrid(grid);
    } catch (err) { console.error('[PAHS] tick error:', err); }
}

async function processPAHSGrid(grid) {
    const [{ rows: machines }, { rows: belts }] = await Promise.all([
        db.query('SELECT * FROM pahs_machines WHERE grid_id = $1', [grid.id]),
        db.query('SELECT * FROM pahs_belts WHERE grid_id = $1', [grid.id]),
    ]);
    const HUB_ITEM_CAP = 1000;
    const beltMap = new Map(belts.map(b => [`${b.x},${b.y}`, b]));
    const inputPortMap  = new Map();
    const outputPortMap = new Map();
    for (const m of machines) {
        const ports = getPortCells(m);
        ports.inputs.forEach(p  => inputPortMap.set(`${p.x},${p.y}`, m));
        ports.outputs.forEach(p => outputPortMap.set(`${p.x},${p.y}`, m));
    }

    // 0. Hub internal transfer: move items from input buffer to output buffer (up to per-item cap)
    for (const machine of machines) {
        if (machine.machine_type !== 'hub') continue;
        const st = machine.storage || {};
        st.input  = st.input  || {};
        st.output = st.output || {};
        let changed = false;
        for (const [item, amt] of Object.entries(st.input)) {
            if (amt <= 0) continue;
            const space = HUB_ITEM_CAP - (st.output[item] || 0);
            const move  = Math.min(amt, space);
            if (move <= 0) continue;
            st.input[item]  -= move;
            if (st.input[item] <= 0) delete st.input[item];
            st.output[item] = (st.output[item] || 0) + move;
            changed = true;
        }
        if (changed) {
            await db.query('UPDATE pahs_machines SET storage = $1 WHERE id = $2',
                [JSON.stringify(st), machine.id]);
            machine.storage = st;
        }
    }

    // 1. Machine output push to adjacent empty belts
    for (const machine of machines) {
        if (!machine.enabled || !isPowered(machine, machines)) continue;
        const ports = getPortCells(machine);
        const storage = machine.storage || {};
        const isHub = machine.machine_type === 'hub';
        const portConfig = machine.port_config || {};
        let storageUpdated = false;
        for (const outPort of ports.outputs) {
            const key = `${outPort.x},${outPort.y}`;
            const belt = beltMap.get(key);
            if (!belt || belt.item_type) continue;
            let item = null;
            if (isHub) {
                const outBuf = storage.output || {};
                const filter = outPort.portKey ? portConfig[outPort.portKey] : null;
                if (filter && outBuf[filter] > 0) item = filter;
            } else {
                item = Object.keys(storage.output || {}).find(k => storage.output[k] > 0) || null;
            }
            if (!item) continue;
            if (isHub) {
                storage.output[item]--;
                if (storage.output[item] <= 0) delete storage.output[item];
            } else {
                storage.output[item]--;
                if (storage.output[item] <= 0) delete storage.output[item];
            }
            await db.query('UPDATE pahs_belts SET item_type = $1 WHERE grid_id = $2 AND x = $3 AND y = $4',
                [item, grid.id, outPort.x, outPort.y]);
            storageUpdated = true;
            belt.item_type = item;
        }
        if (storageUpdated) {
            await db.query('UPDATE pahs_machines SET storage = $1 WHERE id = $2',
                [JSON.stringify(storage), machine.id]);
        }
    }

    // 2. Advance belt items (front to back)
    const getDelta = d => d==='N'?{dx:0,dy:-1}:d==='S'?{dx:0,dy:1}:d==='E'?{dx:1,dy:0}:{dx:-1,dy:0};
    const moved = new Set();
    const tryDeliver = async (belt, destMachine) => {
        const cfg = MACHINE_CONFIGS[destMachine.machine_type];
        const st = destMachine.storage || {};
        const isHub = destMachine.machine_type === 'hub';
        const inputBuf = isHub ? (st.input || {}) : (st.input || {});
        const canAccept = (inputBuf[belt.item_type] || 0) < (isHub ? HUB_ITEM_CAP : cfg.storageCap);
        if (!canAccept) return false;
        inputBuf[belt.item_type] = (inputBuf[belt.item_type] || 0) + 1;
        st.input = inputBuf;
        if (isHub) st.output = st.output || {};
        await db.query('UPDATE pahs_machines SET storage = $1 WHERE id = $2',
            [JSON.stringify(st), destMachine.id]);
        await db.query('UPDATE pahs_belts SET item_type = NULL WHERE grid_id = $1 AND x = $2 AND y = $3',
            [grid.id, belt.x, belt.y]);
        belt.item_type = null;
        moved.add(`${belt.x},${belt.y}`);
        destMachine.storage = st;
        return true;
    };
    // Two-pass heuristic: process cells closer to destination first
    for (let pass = 0; pass < 2; pass++) {
        for (const belt of belts) {
            if (!belt.item_type || moved.has(`${belt.x},${belt.y}`)) continue;
            // If this belt cell IS an input port, deliver directly
            const selfMachine = inputPortMap.get(`${belt.x},${belt.y}`);
            if (selfMachine) { await tryDeliver(belt, selfMachine); continue; }
            const { dx, dy } = getDelta(belt.direction);
            const nx = belt.x + dx, ny = belt.y + dy;
            const nKey = `${nx},${ny}`;
            const nextBelt = beltMap.get(nKey);
            const destMachine = inputPortMap.get(nKey);
            if (destMachine && !nextBelt) {
                await tryDeliver(belt, destMachine);
            } else if (nextBelt && !nextBelt.item_type && !moved.has(nKey)) {
                await db.query('UPDATE pahs_belts SET item_type = $1 WHERE grid_id = $2 AND x = $3 AND y = $4',
                    [belt.item_type, grid.id, nx, ny]);
                await db.query('UPDATE pahs_belts SET item_type = NULL WHERE grid_id = $1 AND x = $2 AND y = $3',
                    [grid.id, belt.x, belt.y]);
                nextBelt.item_type = belt.item_type;
                belt.item_type = null;
                moved.add(nKey);
            }
        }
    }

    // 3. Machine processing
    for (const machine of machines) {
        if (!machine.enabled || !isPowered(machine, machines)) continue;
        const cfg = MACHINE_CONFIGS[machine.machine_type];
        if (!cfg?.recipes) continue;
        const st = machine.storage || {};
        st.input  = st.input  || {};
        st.output = st.output || {};
        for (const recipe of cfg.recipes) {
            let canRun = true;
            for (const [item, amt] of Object.entries(recipe.inputs)) {
                if ((st.input[item] || 0) < amt) { canRun = false; break; }
            }
            const outNeeded = Object.values(recipe.outputs).reduce((a,b)=>a+b,0);
            if (storageTotal(st.output) + outNeeded > cfg.storageCap) canRun = false;
            if (!canRun) continue;
            for (const [item, amt] of Object.entries(recipe.inputs))  st.input[item]  -= amt;
            for (const [item, amt] of Object.entries(recipe.outputs)) st.output[item] = (st.output[item]||0) + amt;
            await db.query('UPDATE pahs_machines SET storage = $1 WHERE id = $2',
                [JSON.stringify(st), machine.id]);
            machine.storage = st;
            break;
        }
    }
}

setInterval(runPAHSTick, PAHS_TICK_MS);

// ─── PAHS Table Init ──────────────────────────────────────────────────────────
async function initPAHSTables() {
    try {
        await db.query(`CREATE TABLE IF NOT EXISTS pahs_grids (
            id VARCHAR(20) PRIMARY KEY,
            user_id VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE UNIQUE,
            size INTEGER DEFAULT 64,
            created_at TIMESTAMP DEFAULT NOW()
        )`);
        await db.query(`CREATE TABLE IF NOT EXISTS pahs_machines (
            id VARCHAR(20) PRIMARY KEY,
            grid_id VARCHAR(20) REFERENCES pahs_grids(id) ON DELETE CASCADE,
            machine_type VARCHAR(50) NOT NULL,
            x INTEGER NOT NULL, y INTEGER NOT NULL, size INTEGER NOT NULL,
            rotation INTEGER DEFAULT 0, enabled BOOLEAN DEFAULT TRUE,
            storage JSONB DEFAULT '{}', created_at TIMESTAMP DEFAULT NOW()
        )`);
        await db.query(`CREATE TABLE IF NOT EXISTS pahs_belts (
            id VARCHAR(20) PRIMARY KEY,
            grid_id VARCHAR(20) REFERENCES pahs_grids(id) ON DELETE CASCADE,
            x INTEGER NOT NULL, y INTEGER NOT NULL,
            direction VARCHAR(2) NOT NULL, item_type VARCHAR(50) DEFAULT NULL,
            UNIQUE(grid_id, x, y)
        )`);
        await db.query(`ALTER TABLE pahs_machines ADD COLUMN IF NOT EXISTS port_config JSONB DEFAULT '{}'`);
        console.log('[PAHS] Tables ready');
    } catch (err) {
        console.error('[PAHS] Table init error:', err.message);
    }
}

app.listen(PORT, async () => {
    console.log(`[NIC] Server running on port ${PORT}`);
    await initPAHSTables();
});
