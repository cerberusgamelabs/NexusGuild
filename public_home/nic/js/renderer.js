import {
    REGION_SIZE, TERRAIN, TERRAIN_COLORS, TERRAIN_COLORS_RGB, TERRAIN_NAMES,
    generateTerrain, tileHash
} from './mapgen.js';

// ─── Node config ──────────────────────────────────────────────────────────────
export const NODE_CONFIG = {
    resource: {
        ferrite: {
            impure: { color: '#8B4513', border: '#5a2a00', label: 'Ferrite Node', purity: 'Impure', rate: '2/min' },
            normal: { color: '#CD7F32', border: '#8B5A00', label: 'Ferrite Node', purity: 'Normal', rate: '5/min' },
            pure:   { color: '#FFD700', border: '#B8860B', label: 'Ferrite Node', purity: 'Pure',   rate: '10/min' },
        },
        pyrene: {
            impure: { color: '#2a2a2a', border: '#111',    label: 'Pyrene Node',  purity: 'Impure', rate: '2/min' },
            normal: { color: '#4a4a4a', border: '#222',    label: 'Pyrene Node',  purity: 'Normal', rate: '5/min' },
            pure:   { color: '#8a8a8a', border: '#555',    label: 'Pyrene Node',  purity: 'Pure',   rate: '10/min' },
        },
    },
    research: { color: '#00e5ff', border: '#0077aa', label: 'Research Node' },
    entry:    { color: '#4488ff', border: '#1144cc', label: 'Entry Point'   },
    structure: {
        miner:   { color: '#ff8800', border: '#994400', label: 'Miner' },
        default: { color: '#ff8800', border: '#994400', label: 'Structure' },
    },
    operative: { color: '#ff5555', border: '#aa2222', label: 'Agent' },
};

function nodeStyle(node) {
    if (node.node_category === 'research')  return NODE_CONFIG.research;
    if (node.node_category === 'entry')     return NODE_CONFIG.entry;
    if (node.node_category === 'operative') return NODE_CONFIG.operative;
    if (node.node_category === 'structure') return NODE_CONFIG.structure[node.structure_type] ?? NODE_CONFIG.structure.default;
    return NODE_CONFIG.resource?.[node.resource_type]?.[node.purity] ?? { color: '#fff', border: '#888', label: 'Unknown' };
}

// ─── Renderer ─────────────────────────────────────────────────────────────────
export class NICRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        this.terrain = null;  // Uint8Array[256*256]
        this.nodes   = [];    // combined array of all overlay objects

        this.cam  = { x: 128, y: 128 };  // map-space center of viewport (tile coords)
        this.zoom = 2;                    // pixels per tile
        this.MIN_ZOOM = 1;
        this.MAX_ZOOM = 48;

        this.drag      = false;
        this.dragStart = { x: 0, y: 0 };
        this.camStart  = { x: 0, y: 0 };
        this.hasDragged = false;

        this.hovered     = null;  // { x, y }
        this.selected    = null;  // node object or null
        this.paths       = [];    // [{ from:{x,y}, to:{x,y}, eta, totalMs, color, label }]
        this._operatives = [];    // my operatives in this region
        this._animating  = false;

        // Pre-rendered 1px-per-tile overview
        this.overview      = null;  // OffscreenCanvas
        this.overviewDirty = true;

        this._rafPending = false;

        this._bindEvents();
        this._observeResize();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    setPaths(paths) {
        this.paths = paths || [];
        this._dirty();
        if (this.paths.length && !this._animating) {
            this._animating = true;
            const tick = () => {
                if (!this.paths.length) { this._animating = false; return; }
                this._dirty();
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        }
    }

    load(terrain, nodes) {
        this.terrain       = terrain;
        this.nodes         = nodes;
        this.overviewDirty = true;
        this._dirty();
    }

    setNodes(nodes) {
        this.nodes = nodes;
        this._dirty();
    }

    setOperatives(ops) {
        this._operatives = ops || [];
        this._dirty();
    }

    centerOn(tx, ty) {
        this.cam.x = Math.max(0, Math.min(REGION_SIZE - 1, tx));
        this.cam.y = Math.max(0, Math.min(REGION_SIZE - 1, ty));
        this._dirty();
    }

    // ── Rendering ─────────────────────────────────────────────────────────────

    _dirty() {
        if (this._rafPending) return;
        this._rafPending = true;
        requestAnimationFrame(() => { this._rafPending = false; this._render(); });
    }

    _render() {
        if (!this.terrain) return;
        const { ctx, canvas, cam, zoom } = this;
        const W = canvas.width, H = canvas.height;

        ctx.fillStyle = '#0a0a0f';
        ctx.fillRect(0, 0, W, H);

        if (zoom <= 3) {
            this._renderOverview(W, H);
        } else {
            this._renderTiles(W, H);
        }

        this._renderPaths(W, H);
        this._renderNodes(W, H);
        this._renderOperatives(W, H);
        this._renderHover(W, H);
        this._renderMinimap(W, H);
    }

    _buildOverview() {
        this.overview = new OffscreenCanvas(REGION_SIZE, REGION_SIZE);
        const oc  = this.overview;
        const ctx = oc.getContext('2d');
        const img = ctx.createImageData(REGION_SIZE, REGION_SIZE);
        const d   = img.data;
        for (let i = 0; i < REGION_SIZE * REGION_SIZE; i++) {
            const [r, g, b] = TERRAIN_COLORS_RGB[this.terrain[i]];
            d[i * 4]     = r;
            d[i * 4 + 1] = g;
            d[i * 4 + 2] = b;
            d[i * 4 + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        this.overviewDirty = false;
    }

    _renderOverview(W, H) {
        if (this.overviewDirty) this._buildOverview();
        const { ctx, cam, zoom } = this;
        const ox = W / 2 - cam.x * zoom;
        const oy = H / 2 - cam.y * zoom;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.overview, ox, oy, REGION_SIZE * zoom, REGION_SIZE * zoom);
    }

    _renderTiles(W, H) {
        const { ctx, cam, zoom } = this;
        const startX = Math.max(0,          Math.floor(cam.x - W / (2 * zoom)));
        const startY = Math.max(0,          Math.floor(cam.y - H / (2 * zoom)));
        const endX   = Math.min(REGION_SIZE - 1, Math.ceil(cam.x + W / (2 * zoom)));
        const endY   = Math.min(REGION_SIZE - 1, Math.ceil(cam.y + H / (2 * zoom)));

        for (let ty = startY; ty <= endY; ty++) {
            for (let tx = startX; tx <= endX; tx++) {
                const t  = this.terrain[ty * REGION_SIZE + tx];
                const sx = Math.floor((tx - cam.x) * zoom + W / 2);
                const sy = Math.floor((ty - cam.y) * zoom + H / 2);
                const sz = Math.ceil(zoom);

                ctx.fillStyle = TERRAIN_COLORS[t];
                ctx.fillRect(sx, sy, sz, sz);

                // Autotile borders — bleed neighbor color along shared edges
                if (zoom >= 6) {
                    this._drawBorders(tx, ty, t, sx, sy, sz);
                }

                // Per-tile terrain decoration
                if (zoom >= 12) {
                    this._drawTerrainDecor(ctx, t, tx, ty, sx, sy, sz);
                }
            }
        }
    }

    _drawBorders(tx, ty, t, sx, sy, sz) {
        const ctx = this;
        const get = (x, y) => {
            if (x < 0 || x >= REGION_SIZE || y < 0 || y >= REGION_SIZE) return t;
            return this.terrain[y * REGION_SIZE + x];
        };
        const bw = Math.max(1, Math.floor(sz * 0.15));
        const c  = this.ctx;

        const drawBorder = (neighbor, x, y, w, h) => {
            if (neighbor === t) return;
            c.fillStyle = TERRAIN_COLORS[neighbor];
            c.globalAlpha = 0.35;
            c.fillRect(x, y, w, h);
            c.globalAlpha = 1;
        };

        drawBorder(get(tx,   ty-1), sx,        sy,        sz, bw);
        drawBorder(get(tx,   ty+1), sx,        sy+sz-bw,  sz, bw);
        drawBorder(get(tx-1, ty),   sx,        sy,        bw, sz);
        drawBorder(get(tx+1, ty),   sx+sz-bw,  sy,        bw, sz);
    }

    _drawTerrainDecor(ctx, t, tx, ty, sx, sy, sz) {
        const h1 = tileHash(tx, ty);
        const h2 = tileHash(tx + 500, ty + 500);

        if (t === TERRAIN.FOREST) {
            // Tree canopy blobs
            ctx.fillStyle = 'rgba(0,20,0,0.45)';
            const r = Math.max(1, sz * 0.28);
            ctx.beginPath();
            ctx.arc(sx + sz * (0.25 + h1 * 0.5), sy + sz * (0.25 + h2 * 0.5), r, 0, Math.PI * 2);
            ctx.fill();
        } else if (t === TERRAIN.MOUNTAIN) {
            // Snow peak triangle
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            const px = sx + sz * (0.3 + h1 * 0.4);
            ctx.beginPath();
            ctx.moveTo(px, sy + sz * 0.15);
            ctx.lineTo(px + sz * 0.22, sy + sz * 0.72);
            ctx.lineTo(px - sz * 0.18, sy + sz * 0.72);
            ctx.closePath();
            ctx.fill();
        } else if (t === TERRAIN.STONE) {
            // Rock pebble
            ctx.fillStyle = 'rgba(0,0,0,0.15)';
            ctx.fillRect(
                sx + Math.floor(sz * (0.2 + h1 * 0.4)),
                sy + Math.floor(sz * (0.2 + h2 * 0.4)),
                Math.max(1, Math.floor(sz * 0.2)),
                Math.max(1, Math.floor(sz * 0.15))
            );
        }
    }

    _renderPaths(W, H) {
        if (!this.paths.length) return;
        const { ctx, cam, zoom } = this;
        const now = Date.now();

        for (const path of this.paths) {
            const sx1 = (path.from.x - cam.x + 0.5) * zoom + W / 2;
            const sy1 = (path.from.y - cam.y + 0.5) * zoom + H / 2;
            const sx2 = (path.to.x   - cam.x + 0.5) * zoom + W / 2;
            const sy2 = (path.to.y   - cam.y + 0.5) * zoom + H / 2;

            const remaining = path.eta - now;
            const progress  = path.totalMs > 0
                ? Math.max(0, Math.min(1, 1 - remaining / path.totalMs))
                : 1;

            // Dashed travel line
            ctx.save();
            ctx.strokeStyle = path.lineColor || 'rgba(100, 200, 255, 0.45)';
            ctx.lineWidth   = Math.max(1, zoom * 0.12);
            ctx.setLineDash([Math.max(2, zoom * 0.4), Math.max(2, zoom * 0.25)]);
            ctx.beginPath();
            ctx.moveTo(sx1, sy1);
            ctx.lineTo(sx2, sy2);
            ctx.stroke();
            ctx.setLineDash([]);

            // Animated progress dot
            const px = sx1 + (sx2 - sx1) * progress;
            const py = sy1 + (sy2 - sy1) * progress;
            const r  = Math.max(3, zoom * 0.3);
            ctx.beginPath();
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.fillStyle = path.dotColor || '#64c8ff';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Operative name label at high zoom
            if (zoom >= 8 && path.label) {
                ctx.fillStyle = 'rgba(200, 230, 255, 0.9)';
                ctx.font = `${Math.max(9, Math.floor(zoom * 0.3))}px monospace`;
                ctx.textAlign = 'center';
                ctx.fillText(path.label, px, py - r - 3);
            }

            ctx.restore();
        }
    }

    _renderNodes(W, H) {
        const { ctx, cam, zoom } = this;
        const minZ = 2;
        if (zoom < minZ) return;

        for (const node of this.nodes) {
            const tx = node.tile_x, ty = node.tile_y;
            // Rough cull
            if (Math.abs(tx - cam.x) * zoom > W / 2 + 32) continue;
            if (Math.abs(ty - cam.y) * zoom > H / 2 + 32) continue;

            const sx = (tx - cam.x + 0.5) * zoom + W / 2;
            const sy = (ty - cam.y + 0.5) * zoom + H / 2;
            const style = nodeStyle(node);
            const r = Math.max(2, zoom * 0.38);

            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.fillStyle = style.color;
            ctx.fill();
            ctx.strokeStyle = style.border;
            ctx.lineWidth = Math.max(1, zoom * 0.1);
            ctx.stroke();

            // Purity ring for resource nodes
            if (node.purity === 'pure' && zoom >= 6) {
                ctx.beginPath();
                ctx.arc(sx, sy, r + Math.max(1, zoom * 0.15), 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            // Label at high zoom
            if (zoom >= 20 && style.label) {
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.font = `${Math.floor(zoom * 0.35)}px monospace`;
                ctx.textAlign = 'center';
                ctx.fillText(style.purity ? `${style.purity}` : style.label, sx, sy + r + zoom * 0.45);
            }

            // Selected ring
            if (this.selected === node) {
                ctx.beginPath();
                ctx.arc(sx, sy, r + Math.max(2, zoom * 0.25), 0, Math.PI * 2);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }
    }

    _renderOperatives(W, H) {
        if (!this._operatives?.length) return;
        const { ctx, cam, zoom } = this;
        const now = Date.now();

        for (const op of this._operatives) {
            let tx, ty;
            if (op.status === 'deployed') {
                if (op.tile_x == null || op.tile_y == null) continue;
                tx = op.tile_x; ty = op.tile_y;
            } else if (op.status === 'traveling' && op.task) {
                const startedAt = new Date(op.task.started_at).getTime();
                const eta       = new Date(op.task.eta).getTime();
                const progress  = Math.max(0, Math.min(1, (now - startedAt) / (eta - startedAt)));
                tx = op.task.from_tile_x + (op.task.target_tile_x - op.task.from_tile_x) * progress;
                ty = op.task.from_tile_y + (op.task.target_tile_y - op.task.from_tile_y) * progress;
            } else {
                continue;
            }

            const sx = (tx - cam.x + 0.5) * zoom + W / 2;
            const sy = (ty - cam.y + 0.5) * zoom + H / 2;
            const r  = Math.max(3, zoom * 0.44);

            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.fillStyle = NODE_CONFIG.operative.color;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(1.5, zoom * 0.12);
            ctx.stroke();

            if (zoom >= 10 && op.name) {
                ctx.fillStyle = 'rgba(255, 210, 210, 0.95)';
                ctx.font = `bold ${Math.max(9, Math.floor(zoom * 0.3))}px monospace`;
                ctx.textAlign = 'center';
                ctx.fillText(op.name, sx, sy - r - 3);
            }
        }
    }

    _renderHover(W, H) {
        if (!this.hovered) return;
        const { ctx, cam, zoom } = this;
        const { x, y } = this.hovered;
        if (x < 0 || x >= REGION_SIZE || y < 0 || y >= REGION_SIZE) return;

        const sx = Math.floor((x - cam.x) * zoom + W / 2);
        const sy = Math.floor((y - cam.y) * zoom + H / 2);
        const sz = Math.ceil(zoom);

        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(sx + 0.5, sy + 0.5, sz - 1, sz - 1);
    }

    _renderMinimap(W, H) {
        if (!this.overview || this.overviewDirty) return;
        const ctx = this.ctx;
        const mw = 128, mh = 128;
        const mx = W - mw - 12, my = 12;

        ctx.globalAlpha = 0.82;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.overview, mx, my, mw, mh);
        ctx.globalAlpha = 1;

        // Node dots on minimap
        for (const node of this.nodes) {
            const style = nodeStyle(node);
            const nx = mx + (node.tile_x / REGION_SIZE) * mw;
            const ny = my + (node.tile_y / REGION_SIZE) * mh;
            ctx.fillStyle = style.color;
            ctx.fillRect(nx - 1, ny - 1, 3, 3);
        }

        // Viewport rect
        const scale = mw / REGION_SIZE;
        const { cam, zoom, canvas } = this;
        const vw = Math.min(mw, (canvas.width  / zoom) * scale);
        const vh = Math.min(mh, (canvas.height / zoom) * scale);
        const vx = mx + (cam.x - canvas.width  / zoom / 2) * scale;
        const vy = my + (cam.y - canvas.height / zoom / 2) * scale;

        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 1;
        ctx.strokeRect(vx, vy, vw, vh);

        // Border
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.strokeRect(mx, my, mw, mh);
    }

    // ── Input ─────────────────────────────────────────────────────────────────

    screenToTile(sx, sy) {
        const W = this.canvas.width, H = this.canvas.height;
        return {
            x: Math.floor((sx - W / 2) / this.zoom + this.cam.x),
            y: Math.floor((sy - H / 2) / this.zoom + this.cam.y),
        };
    }

    getNodeAt(tx, ty) {
        return this.nodes.find(n => n.tile_x === tx && n.tile_y === ty) || null;
    }

    _bindEvents() {
        const c = this.canvas;

        c.addEventListener('mousedown', e => {
            this.drag      = true;
            this.hasDragged = false;
            this.dragStart = { x: e.clientX, y: e.clientY };
            this.camStart  = { x: this.cam.x, y: this.cam.y };
        });

        window.addEventListener('mouseup', e => {
            if (!this.drag) return;
            this.drag = false;
            if (!this.hasDragged) {
                const rect = c.getBoundingClientRect();
                const tile = this.screenToTile(e.clientX - rect.left, e.clientY - rect.top);
                const node = this.getNodeAt(tile.x, tile.y);
                this.selected = node;
                this._dirty();
                c.dispatchEvent(new CustomEvent('tileclick', { detail: { tile, node } }));
            }
        });

        window.addEventListener('mousemove', e => {
            const rect = c.getBoundingClientRect();
            const lx = e.clientX - rect.left;
            const ly = e.clientY - rect.top;

            if (this.drag) {
                const dx = e.clientX - this.dragStart.x;
                const dy = e.clientY - this.dragStart.y;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.hasDragged = true;
                if (this.hasDragged) {
                    this.cam.x = Math.max(0, Math.min(REGION_SIZE - 1, this.camStart.x - dx / this.zoom));
                    this.cam.y = Math.max(0, Math.min(REGION_SIZE - 1, this.camStart.y - dy / this.zoom));
                    this._dirty();
                }
            }

            const t = this.screenToTile(lx, ly);
            if (!this.hovered || t.x !== this.hovered.x || t.y !== this.hovered.y) {
                this.hovered = t;
                this._dirty();
                const terrain = (t.x >= 0 && t.x < REGION_SIZE && t.y >= 0 && t.y < REGION_SIZE)
                    ? this.terrain[t.y * REGION_SIZE + t.x] : null;
                c.dispatchEvent(new CustomEvent('tilehover', {
                    detail: { tile: t, terrain, node: this.getNodeAt(t.x, t.y) }
                }));
            }
        });

        c.addEventListener('wheel', e => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
            this.zoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, this.zoom * factor));
            this._dirty();
        }, { passive: false });

        // Touch support (basic pan)
        let lastTouch = null;
        c.addEventListener('touchstart', e => {
            if (e.touches.length === 1) {
                lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                this.camStart = { x: this.cam.x, y: this.cam.y };
            }
        }, { passive: true });
        c.addEventListener('touchmove', e => {
            if (e.touches.length === 1 && lastTouch) {
                e.preventDefault();
                const dx = e.touches[0].clientX - lastTouch.x;
                const dy = e.touches[0].clientY - lastTouch.y;
                this.cam.x = Math.max(0, Math.min(REGION_SIZE - 1, this.camStart.x - dx / this.zoom));
                this.cam.y = Math.max(0, Math.min(REGION_SIZE - 1, this.camStart.y - dy / this.zoom));
                this._dirty();
            }
        }, { passive: false });
    }

    _observeResize() {
        const ro = new ResizeObserver(() => {
            this.canvas.width  = this.canvas.offsetWidth;
            this.canvas.height = this.canvas.offsetHeight;
            this._dirty();
        });
        ro.observe(this.canvas);
        this.canvas.width  = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
    }
}
