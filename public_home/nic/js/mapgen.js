// NIC Map Generation — mirrors nic-server.js exactly (same seed = same map)

export const REGION_SIZE = 256;

export const TERRAIN = { DEEP_WATER: 0, WATER: 1, SAND: 2, DIRT: 3, GRASS: 4, FOREST: 5, STONE: 6, MOUNTAIN: 7 };

export const TERRAIN_NAMES = ['Deep Water', 'Water', 'Sand', 'Dirt', 'Grass', 'Forest', 'Stone', 'Mountain'];

export const TERRAIN_COLORS = [
    '#1a3a5c', // deep water
    '#2e6b9e', // water
    '#c8a96e', // sand
    '#7a5c3a', // dirt
    '#3d7a35', // grass
    '#255c1e', // forest
    '#6e6e6e', // stone
    '#b0b0b0', // mountain
];

// For ImageData (pre-rendered overview)
export const TERRAIN_COLORS_RGB = [
    [26,  58,  92],
    [46,  107, 158],
    [200, 169, 110],
    [122, 92,  58],
    [61,  122, 53],
    [37,  92,  30],
    [110, 110, 110],
    [176, 176, 176],
];

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
        lerp(noise2(ix,     iy,     seed), noise2(ix + 1, iy,     seed), fx),
        lerp(noise2(ix,     iy + 1, seed), noise2(ix + 1, iy + 1, seed), fx),
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

export function getTile(x, y, seed) {
    const nx = x / REGION_SIZE, ny = y / REGION_SIZE;
    const dx = nx - 0.5, dy = ny - 0.5;
    const falloff = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2 * 1.2);
    const height = octaveNoise(nx * 4, ny * 4, seed) * falloff;
    const moisture = octaveNoise(nx * 3 + 1000, ny * 3 + 1000, (seed + 9999) >>> 0);
    if (height < 0.15) return TERRAIN.DEEP_WATER;
    if (height < 0.25) return TERRAIN.WATER;
    if (height < 0.30) return TERRAIN.SAND;
    if (height < 0.45) return moisture > 0.5 ? TERRAIN.GRASS : TERRAIN.DIRT;
    if (height < 0.62) return moisture > 0.4 ? TERRAIN.FOREST : TERRAIN.GRASS;
    if (height < 0.78) return TERRAIN.STONE;
    return TERRAIN.MOUNTAIN;
}

// Generates the full terrain Uint8Array for a region from seed
export function generateTerrain(seed) {
    const terrain = new Uint8Array(REGION_SIZE * REGION_SIZE);
    for (let y = 0; y < REGION_SIZE; y++) {
        for (let x = 0; x < REGION_SIZE; x++) {
            terrain[y * REGION_SIZE + x] = getTile(x, y, seed);
        }
    }
    return terrain;
}

// Simple hash for per-tile decorative variation (not terrain)
export function tileHash(x, y) {
    return hash(imul(hash(x | 0), 2654435761) ^ hash(y | 0)) / 0xffffffff;
}
