// ─── PAHS Grid Renderer ───────────────────────────────────────────────────────

export const MACHINE_COLORS = {
    hub:        { fill: '#1a4a99', border: '#2a7fff', label: 'Hub' },
    power_pole: { fill: '#7a6010', border: '#f4c842', label: 'Power Pole' },
    smelter:    { fill: '#7a2020', border: '#e55050', label: 'Smelter' },
    crusher:    { fill: '#5a1f7a', border: '#9b59b6', label: 'Crusher' },
    assembler:  { fill: '#0d5a4a', border: '#1abc9c', label: 'Assembler' },
};

export const ITEM_COLORS = {
    ferrite_ore:     '#b87333',
    pyrene_ore:      '#ff6b6b',
    ferrite_ingot:   '#cd9020',
    pyrene_crystal:  '#e91e63',
    ferrite_powder:  '#d4a056',
    pyrene_dust:     '#ff4081',
    component:       '#00bcd4',
};

const BELT_COLOR   = '#1e2a38';
const BELT_BORDER  = '#2e3e50';
const BELT_ARROW   = '#3a7ab8';

export class PAHSRenderer {
    constructor(canvas) {
        this.canvas  = canvas;
        this.ctx     = canvas.getContext('2d');
        this.cam     = { x: 0, y: 0 };
        this.zoom    = 14;
        this.gridSize = 64;

        this.machines    = [];
        this.belts       = [];
        this._beltMap    = new Map(); // "x,y" → belt

        this.tool        = 'select';
        this.placingType = null;
        this.rotation    = 0;
        this.showPower   = false;
        this.hoverTile   = null;
        this.selectedId  = null;

        // Belt drag state
        this._beltDrag   = null; // { cells: [{x,y,direction}], lastTile: {x,y} }
        this._pendingBelts = []; // cells being drawn (preview)

        // Pan drag state
        this._panDrag    = null; // { startX, startY, camX, camY }

        // Callbacks
        this.onTileClick        = null; // (tx, ty)
        this.onMachineClick     = null; // (machine)
        this.onBeltCommit       = null; // (cells: [{x,y,direction}])
        this.onEraseClick       = null; // (tx, ty)
        this.onHoverChange      = null; // (tx, ty) or null
        this.onOutputPortClick  = null; // (machine, portKey, screenX, screenY)

        this._raf = requestAnimationFrame(() => this._loop());
        this._bindEvents();
    }

    // ─── Data ─────────────────────────────────────────────────────────────────

    load(machines, belts, gridSize = 64) {
        this.gridSize = gridSize;
        this.machines = machines;
        this.belts    = belts;
        this._buildBeltMap();
    }

    setMachines(machines) {
        this.machines = machines;
    }

    setBelts(belts) {
        this.belts = belts;
        this._buildBeltMap();
    }

    _buildBeltMap() {
        this._beltMap.clear();
        for (const b of this.belts) this._beltMap.set(`${b.x},${b.y}`, b);
    }

    fitToGrid() {
        const W = this.canvas.clientWidth;
        const H = this.canvas.clientHeight;
        const fitZoom = Math.floor(Math.min(W, H) / (this.gridSize + 2));
        this.zoom = Math.max(4, fitZoom);
        this.cam  = { x: -1, y: -1 };
    }

    // ─── RAF Loop ─────────────────────────────────────────────────────────────

    _loop() {
        this._syncSize();
        this._render();
        this._raf = requestAnimationFrame(() => this._loop());
    }

    _syncSize() {
        const W = this.canvas.clientWidth  | 0;
        const H = this.canvas.clientHeight | 0;
        if (this.canvas.width !== W || this.canvas.height !== H) {
            this.canvas.width  = W;
            this.canvas.height = H;
        }
    }

    destroy() {
        cancelAnimationFrame(this._raf);
        this._unbindEvents();
    }

    // ─── Rendering ────────────────────────────────────────────────────────────

    _render() {
        const { ctx, canvas, zoom, cam, gridSize } = this;
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        // Background
        ctx.fillStyle = '#080c12';
        ctx.fillRect(0, 0, W, H);

        // Grid cells
        this._renderGrid(W, H);

        // Power coverage overlay
        if (this.showPower) this._renderPowerCoverage(W, H);

        // Belt cells
        this._renderBelts(W, H);

        // Pending belt preview
        if (this._pendingBelts.length) this._renderPendingBelts(W, H);

        // Machine footprints
        this._renderMachines(W, H);

        // Hover / placement preview
        this._renderHover(W, H);

        // Port indicators (on top of machines)
        this._renderPorts(W, H);

        // Selection highlight
        this._renderSelection(W, H);
    }

    _tileToScreen(tx, ty) {
        const { cam, zoom, canvas } = this;
        return {
            sx: (tx - cam.x) * zoom,
            sy: (ty - cam.y) * zoom,
        };
    }

    _screenToTile(sx, sy) {
        const { cam, zoom } = this;
        return {
            tx: Math.floor(sx / zoom + cam.x),
            ty: Math.floor(sy / zoom + cam.y),
        };
    }

    _renderGrid(W, H) {
        const { ctx, cam, zoom, gridSize } = this;
        const startX = Math.max(0, Math.floor(cam.x));
        const startY = Math.max(0, Math.floor(cam.y));
        const endX   = Math.min(gridSize, Math.ceil(cam.x + W / zoom) + 1);
        const endY   = Math.min(gridSize, Math.ceil(cam.y + H / zoom) + 1);

        // Cell backgrounds
        ctx.fillStyle = '#0c1118';
        for (let ty = startY; ty < endY; ty++) {
            for (let tx = startX; tx < endX; tx++) {
                const { sx, sy } = this._tileToScreen(tx, ty);
                ctx.fillRect(sx + 0.5, sy + 0.5, zoom - 1, zoom - 1);
            }
        }

        // Grid lines
        ctx.strokeStyle = '#1a2434';
        ctx.lineWidth   = 0.5;
        ctx.beginPath();
        for (let tx = startX; tx <= endX; tx++) {
            const sx = (tx - cam.x) * zoom;
            ctx.moveTo(sx, (startY - cam.y) * zoom);
            ctx.lineTo(sx, (endY   - cam.y) * zoom);
        }
        for (let ty = startY; ty <= endY; ty++) {
            const sy = (ty - cam.y) * zoom;
            ctx.moveTo((startX - cam.x) * zoom, sy);
            ctx.lineTo((endX   - cam.x) * zoom, sy);
        }
        ctx.stroke();

        // Grid border
        ctx.strokeStyle = '#2e4060';
        ctx.lineWidth   = 1.5;
        ctx.strokeRect(
            (0 - cam.x) * zoom,
            (0 - cam.y) * zoom,
            gridSize * zoom,
            gridSize * zoom
        );
    }

    _renderBelts(W, H) {
        const { ctx, cam, zoom } = this;
        for (const belt of this.belts) {
            const { sx, sy } = this._tileToScreen(belt.x, belt.y);
            if (sx + zoom < 0 || sx > W || sy + zoom < 0 || sy > H) continue;
            this._drawBeltCell(ctx, sx, sy, zoom, belt.direction, belt.item_type);
        }
    }

    _drawBeltCell(ctx, sx, sy, zoom, direction, itemType) {
        // Belt background
        ctx.fillStyle = BELT_COLOR;
        ctx.fillRect(sx + 1, sy + 1, zoom - 2, zoom - 2);
        ctx.strokeStyle = BELT_BORDER;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(sx + 1, sy + 1, zoom - 2, zoom - 2);

        // Arrow
        const cx = sx + zoom / 2;
        const cy = sy + zoom / 2;
        const as = Math.max(2, zoom * 0.25); // arrow size
        ctx.fillStyle = BELT_ARROW;
        ctx.beginPath();
        const rot = { N: -Math.PI/2, S: Math.PI/2, E: 0, W: Math.PI }[direction] || 0;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.moveTo(as, 0);
        ctx.lineTo(-as * 0.6, -as * 0.6);
        ctx.lineTo(-as * 0.6,  as * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // Item dot
        if (itemType && ITEM_COLORS[itemType]) {
            const r = Math.max(1.5, zoom * 0.18);
            ctx.fillStyle = ITEM_COLORS[itemType];
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    _renderPendingBelts(W, H) {
        const { ctx, cam, zoom } = this;
        for (const cell of this._pendingBelts) {
            const { sx, sy } = this._tileToScreen(cell.x, cell.y);
            ctx.globalAlpha = 0.55;
            this._drawBeltCell(ctx, sx, sy, zoom, cell.direction, null);
            ctx.globalAlpha = 1;
        }
    }

    _renderMachines(W, H) {
        const { ctx, cam, zoom } = this;
        for (const m of this.machines) {
            const { sx, sy } = this._tileToScreen(m.x, m.y);
            const pw = m.size * zoom;
            if (sx + pw < 0 || sx > W || sy + pw < 0 || sy > H) continue;
            const cfg = MACHINE_COLORS[m.machine_type] || { fill: '#222', border: '#666', label: m.machine_type };
            const alpha = (m.enabled === false) ? 0.45 : 1;
            ctx.globalAlpha = alpha;

            // Fill
            ctx.fillStyle = cfg.fill;
            ctx.fillRect(sx + 1, sy + 1, pw - 2, pw - 2);
            // Border
            ctx.strokeStyle = (m.id === this.selectedId) ? '#fff' : cfg.border;
            ctx.lineWidth = (m.id === this.selectedId) ? 2 : 1.5;
            ctx.strokeRect(sx + 1, sy + 1, pw - 2, pw - 2);

            // Label (only if zoom large enough)
            if (zoom >= 10) {
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.font = `bold ${Math.min(11, zoom * 0.7)}px monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const short = m.machine_type === 'power_pole' ? 'PP' : cfg.label.slice(0, 3).toUpperCase();
                ctx.fillText(short, sx + pw / 2, sy + pw / 2);
            }

            // Powered indicator dot
            if (m.machine_type !== 'hub' && m.machine_type !== 'power_pole') {
                const dotR = Math.max(1.5, zoom * 0.15);
                ctx.fillStyle = m.powered ? '#2ecc71' : '#e74c3c';
                ctx.beginPath();
                ctx.arc(sx + pw - dotR - 2, sy + dotR + 2, dotR, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.globalAlpha = 1;
        }
    }

    _renderPorts(W, H) {
        if (this.zoom < 8) return;
        const { ctx, cam, zoom } = this;
        const r = Math.max(2, zoom * 0.2);
        for (const m of this.machines) {
            if (!m.ports) continue;
            const portConfig = m.port_config || {};
            for (const pt of (m.ports.inputs || [])) {
                const { sx, sy } = this._tileToScreen(pt.x, pt.y);
                ctx.fillStyle = 'rgba(46,204,113,0.8)';
                ctx.beginPath();
                ctx.arc(sx + zoom / 2, sy + zoom / 2, r, 0, Math.PI * 2);
                ctx.fill();
            }
            for (const pt of (m.ports.outputs || [])) {
                const { sx, sy } = this._tileToScreen(pt.x, pt.y);
                const filter = pt.portKey ? portConfig[pt.portKey] : null;
                // Filtered ports show item color; unfiltered show red
                ctx.fillStyle = filter ? (ITEM_COLORS[filter] || 'rgba(231,76,60,0.8)') : 'rgba(231,76,60,0.8)';
                ctx.beginPath();
                ctx.arc(sx + zoom / 2, sy + zoom / 2, r, 0, Math.PI * 2);
                ctx.fill();
                // Ring around filtered ports to indicate they're configured
                if (filter) {
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.arc(sx + zoom / 2, sy + zoom / 2, r + 1.5, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }
        }
    }

    _renderPowerCoverage(W, H) {
        const { ctx, cam, zoom } = this;
        for (const m of this.machines) {
            if (m.machine_type !== 'power_pole' && m.machine_type !== 'hub') continue;
            const range = m.machine_type === 'hub' ? 100 : 6;
            const cx = (m.x + m.size / 2 - cam.x) * zoom;
            const cy = (m.y + m.size / 2 - cam.y) * zoom;
            const r  = range * zoom;
            const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            grd.addColorStop(0, 'rgba(244,200,66,0.06)');
            grd.addColorStop(1, 'rgba(244,200,66,0)');
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    _renderHover(W, H) {
        const { ctx, cam, zoom, hoverTile, tool, placingType } = this;
        if (!hoverTile) return;
        const { tx, ty } = hoverTile;

        if (tool === 'select' || tool === 'erase') {
            const { sx, sy } = this._tileToScreen(tx, ty);
            ctx.strokeStyle = tool === 'erase' ? 'rgba(231,76,60,0.7)' : 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 1;
            ctx.strokeRect(sx + 0.5, sy + 0.5, zoom - 1, zoom - 1);
            return;
        }

        if (tool === 'belt' && !this._beltDrag) {
            const { sx, sy } = this._tileToScreen(tx, ty);
            ctx.fillStyle = 'rgba(58,122,184,0.35)';
            ctx.fillRect(sx + 1, sy + 1, zoom - 2, zoom - 2);
            return;
        }

        if (tool === 'place' && placingType) {
            const size = this._sizeFor(placingType);
            const { sx, sy } = this._tileToScreen(tx, ty);
            const pw = size * zoom;
            const cfg = MACHINE_COLORS[placingType] || { fill: '#222', border: '#aaa' };
            const inBounds = tx >= 0 && ty >= 0 && tx + size <= this.gridSize && ty + size <= this.gridSize;
            ctx.globalAlpha = 0.5;
            ctx.fillStyle   = cfg.fill;
            ctx.fillRect(sx + 1, sy + 1, pw - 2, pw - 2);
            ctx.strokeStyle = inBounds ? cfg.border : '#e74c3c';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(sx + 1, sy + 1, pw - 2, pw - 2);
            ctx.globalAlpha = 1;
        }
    }

    _renderSelection(W, H) {
        if (!this.selectedId) return;
        const m = this.machines.find(m => m.id === this.selectedId);
        if (!m) return;
        const { ctx, cam, zoom } = this;
        const { sx, sy } = this._tileToScreen(m.x, m.y);
        const pw = m.size * zoom;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 2;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(sx, sy, pw, pw);
        ctx.setLineDash([]);
    }

    _sizeFor(type) {
        return { hub: 6, power_pole: 1, smelter: 3, crusher: 4, assembler: 4 }[type] || 1;
    }

    // ─── Events ───────────────────────────────────────────────────────────────

    _bindEvents() {
        this._onMouseDown = this._mouseDown.bind(this);
        this._onMouseMove = this._mouseMove.bind(this);
        this._onMouseUp   = this._mouseUp.bind(this);
        this._onWheel     = this._wheel.bind(this);
        this._onContextMenu = e => e.preventDefault();

        this.canvas.addEventListener('mousedown',   this._onMouseDown);
        this.canvas.addEventListener('mousemove',   this._onMouseMove);
        this.canvas.addEventListener('mouseup',     this._onMouseUp);
        this.canvas.addEventListener('mouseleave',  this._onMouseUp);
        this.canvas.addEventListener('wheel',       this._onWheel, { passive: false });
        this.canvas.addEventListener('contextmenu', this._onContextMenu);
    }

    _unbindEvents() {
        this.canvas.removeEventListener('mousedown',   this._onMouseDown);
        this.canvas.removeEventListener('mousemove',   this._onMouseMove);
        this.canvas.removeEventListener('mouseup',     this._onMouseUp);
        this.canvas.removeEventListener('mouseleave',  this._onMouseUp);
        this.canvas.removeEventListener('wheel',       this._onWheel);
        this.canvas.removeEventListener('contextmenu', this._onContextMenu);
    }

    _mouseDown(e) {
        const rect  = this.canvas.getBoundingClientRect();
        const sx    = e.clientX - rect.left;
        const sy    = e.clientY - rect.top;
        const { tx, ty } = this._screenToTile(sx, sy);

        // Middle mouse or right mouse = pan
        if (e.button === 1 || e.button === 2) {
            this._panDrag = { startX: sx, startY: sy, camX: this.cam.x, camY: this.cam.y };
            return;
        }

        if (e.button !== 0) return;

        if (this.tool === 'belt') {
            this._beltDrag = { cells: [], lastTile: { x: tx, y: ty } };
            this._pendingBelts = [{ x: tx, y: ty, direction: 'E' }];
            return;
        }

        if (this.tool === 'place') {
            if (this.onTileClick) this.onTileClick(tx, ty);
            return;
        }

        if (this.tool === 'erase') {
            if (this.onEraseClick) this.onEraseClick(tx, ty);
            return;
        }

        // select tool — check output port hit first, then machine hit
        if (this.tool === 'select') {
            const portHit = this._outputPortAt(tx, ty);
            if (portHit && this.onOutputPortClick) {
                const { sx, sy } = this._tileToScreen(tx, ty);
                const rect = this.canvas.getBoundingClientRect();
                this.onOutputPortClick(portHit.machine, portHit.portKey,
                    rect.left + sx + this.zoom / 2,
                    rect.top  + sy + this.zoom / 2);
                return;
            }
            const hit = this._machineAt(tx, ty);
            if (hit) {
                this.selectedId = hit.id;
                if (this.onMachineClick) this.onMachineClick(hit);
            } else {
                this.selectedId = null;
                if (this.onMachineClick) this.onMachineClick(null);
            }
        }
    }

    _mouseMove(e) {
        const rect  = this.canvas.getBoundingClientRect();
        const sx    = e.clientX - rect.left;
        const sy    = e.clientY - rect.top;
        const { tx, ty } = this._screenToTile(sx, sy);

        // Pan
        if (this._panDrag) {
            const dx = (sx - this._panDrag.startX) / this.zoom;
            const dy = (sy - this._panDrag.startY) / this.zoom;
            this.cam.x = this._panDrag.camX - dx;
            this.cam.y = this._panDrag.camY - dy;
        }

        // Update hover
        if (!this.hoverTile || this.hoverTile.tx !== tx || this.hoverTile.ty !== ty) {
            this.hoverTile = { tx, ty };
            if (this.onHoverChange) this.onHoverChange(tx, ty);
        }

        // Belt drag
        if (this._beltDrag && e.buttons === 1) {
            const last = this._beltDrag.lastTile;
            if (tx !== last.x || ty !== last.y) {
                const dx = tx - last.x;
                const dy = ty - last.y;
                const dir = Math.abs(dx) >= Math.abs(dy)
                    ? (dx > 0 ? 'E' : 'W')
                    : (dy > 0 ? 'S' : 'N');
                this._pendingBelts.push({ x: tx, y: ty, direction: dir });
                this._beltDrag.lastTile = { x: tx, y: ty };
            }
        }
    }

    _mouseUp(e) {
        if (this._panDrag) { this._panDrag = null; return; }

        if (this._beltDrag && e.type !== 'mouseleave') {
            const cells = [...this._pendingBelts];
            this._beltDrag    = null;
            this._pendingBelts = [];
            if (cells.length && this.onBeltCommit) this.onBeltCommit(cells);
        } else {
            this._beltDrag    = null;
            this._pendingBelts = [];
        }
    }

    _wheel(e) {
        e.preventDefault();
        const rect  = this.canvas.getBoundingClientRect();
        const sx    = e.clientX - rect.left;
        const sy    = e.clientY - rect.top;
        const { tx, ty } = this._screenToTile(sx, sy);

        const delta   = e.deltaY < 0 ? 1 : -1;
        const oldZoom = this.zoom;
        this.zoom     = Math.max(4, Math.min(48, this.zoom + delta * 2));

        // Zoom toward cursor
        this.cam.x = tx - (tx - this.cam.x) * (oldZoom / this.zoom);
        this.cam.y = ty - (ty - this.cam.y) * (oldZoom / this.zoom);
    }

    _machineAt(tx, ty) {
        for (const m of this.machines) {
            if (tx >= m.x && tx < m.x + m.size && ty >= m.y && ty < m.y + m.size) return m;
        }
        return null;
    }

    _outputPortAt(tx, ty) {
        for (const m of this.machines) {
            if (!m.ports) continue;
            for (const pt of (m.ports.outputs || [])) {
                if (pt.x === tx && pt.y === ty && pt.portKey) return { machine: m, portKey: pt.portKey };
            }
        }
        return null;
    }
}
