// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /public/js/components/vttView.js
// Requires: PixiJS v8 (CDN), dddice SDK (CDN), voicePanel.js

// ── State ─────────────────────────────────────────────────────────────────────

let _vttChannel  = null;
let _pixiApp     = null;
let _layers      = {};
let _mapSprite   = null;
let _tokenSprites = {};      // tokenId → { container, sprite }
let _dddice      = null;
let _vttDiceTheme = 'nexusguild-mmji72re';
let _vttSession  = null;     // { map, tokens, encounter, characters, isGM }
let _dragState   = null;     // { tokenId, startX, startY, offsetX, offsetY }
let _pendingRolls = [];      // Queue of { modifier, notation } for our own rolls (to match roll events)
let _loggedRollIds = new Set(); // DB row IDs already shown in roll log (avoid duplicates)
let _diceBuilder   = {};     // { d4, d6, d8, d10, d12, d20, d100, modifier }

const _DIE_SVGS = {
    d4:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,3 22,21 2,21"/><line x1="12" y1="21" x2="12" y2="3" stroke-width="1"/></svg>`,
    d6:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>`,
    d8:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 22,12 12,22 2,12"/><line x1="2" y1="12" x2="22" y2="12" stroke-width="1"/></svg>`,
    d10:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 21,9 18,21 6,21 3,9"/></svg>`,
    d12:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 19,7 22,15 16,22 8,22 2,15 5,7"/></svg>`,
    d20:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 22,20 2,20"/><line x1="7" y1="20" x2="12" y2="10"/><line x1="12" y1="10" x2="17" y2="20"/></svg>`,
    d100: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><text x="12" y="16" text-anchor="middle" font-size="7" fill="currentColor" stroke="none">%</text></svg>`,
};
let _activeFogMode = null;   // 'paint' | 'erase' | null
let _fogPainting = false;    // true while dragging to paint fog
let _lastFogCell = null;     // {row, col} to avoid redundant updates while dragging
let _fogSaveTimeout = null;  // debounce timer for fog saves

// ── Open / Close ──────────────────────────────────────────────────────────────

async function openVTTView(channel) {
    _vttChannel = channel;
    _pendingRolls = [];
    _loggedRollIds = new Set();
    _diceBuilder = { d4:0, d6:0, d8:0, d10:0, d12:0, d20:0, d100:0, modifier:0 };

    if (typeof closeForumView === 'function') closeForumView();

    const container = document.getElementById('messagesContainer');
    if (!container) return;

    container.innerHTML = `
        <div id="vttRoot" class="vtt-root">
            <div id="vttCanvasWrap" class="vtt-canvas-wrap">
                <canvas id="vttCanvas"></canvas>
                <div id="vttToolbar" class="vtt-toolbar">
                    <button class="vtt-tool-btn" id="vttBtnAddToken" title="Add Token" onclick="vttAddTokenPrompt()">🧍</button>
                    <button class="vtt-tool-btn" id="vttBtnUploadMap" title="Upload Map" style="display:none" onclick="vttUploadMapPrompt()">🗺️</button>
                    <button class="vtt-tool-btn" id="vttBtnFog" title="Toggle Fog" style="display:none" onclick="vttToggleFogTool()">🌫️</button>
                    <button class="vtt-tool-btn" id="vttBtnClearFog" title="Clear All Fog" style="display:none" onclick="vttClearFog()">☀️</button>
                    <span id="vttGridSizeWrap" class="vtt-grid-size-wrap" style="display:none" title="Grid Size (px)">
                        <span class="vtt-grid-label">⊞</span>
                        <input type="number" id="vttGridSizeInput" class="vtt-input vtt-grid-input" min="16" max="512" step="8" value="64" onchange="vttSetGridSize(this.value)">
                    </span>
                    <span class="vtt-tool-sep"></span>
                    <button class="vtt-tool-btn" title="Roll Dice" onclick="vttRollPrompt()">🎲</button>
                    <button class="vtt-tool-btn" title="Character Sheet" onclick="vttOpenSheet()">📋</button>
                    <button class="vtt-tool-btn" title="Initiative Tracker" onclick="vttToggleTracker()">⚔️</button>
                </div>
                <div id="vttFogTools" class="vtt-fog-tools" style="display:none">
                    <button onclick="vttFogMode('paint')">🌫️ Paint</button>
                    <button onclick="vttFogMode('erase')">☀️ Erase</button>
                    <button class="vtt-tool-btn-sm" onclick="vttCloseFogTools()">✕</button>
                </div>
            </div>
            <div id="vttSidebar" class="vtt-sidebar">
                <div id="vttVoiceBar" class="vtt-voice-bar">
                    <span id="vttVoiceStatus">🔊 Connecting...</span>
                    <button class="vtt-btn-sm" onclick="leaveVTT()">Leave</button>
                </div>
                <div id="vttTrackerPanel" class="vtt-panel">
                    <div class="vtt-panel-header">
                        <span>⚔️ Initiative</span>
                        <button id="vttStartCombat" class="vtt-btn-sm" style="display:none" onclick="vttStartCombat()">▶ Start</button>
                        <button id="vttNextTurn"    class="vtt-btn-sm" style="display:none" onclick="vttNextTurn()">Next ▶</button>
                        <button id="vttEndCombat"   class="vtt-btn-sm vtt-btn-danger" style="display:none" onclick="vttEndCombat()">■ End</button>
                    </div>
                    <div id="vttCombatList" class="vtt-combatant-list"></div>
                    <div id="vttAddCombatant" style="display:none; margin-top:8px;">
                        <input id="vttCombatantName" class="vtt-input" placeholder="Name" style="width:100%;margin-bottom:4px;">
                        <input id="vttCombatantInit" class="vtt-input" placeholder="Initiative" type="number" style="width:60px;">
                        <button class="vtt-btn-sm" onclick="vttAddCombatant()">Add</button>
                    </div>
                </div>
                <div class="vtt-panel vtt-dice-builder-panel">
                    <div class="vtt-panel-header">
                        <span>🎲 Dice Builder</span>
                        <div style="display:flex;gap:4px">
                            <button class="vtt-btn-sm" onclick="vttClearBuilder()">Clear</button>
                            <button class="vtt-btn-sm vtt-btn-primary" onclick="vttRollBuilder()">Roll</button>
                        </div>
                    </div>
                    <div class="vtt-die-grid">
                        ${['d4','d6','d8','d10','d12','d20','d100'].map(t => `
                            <div class="vtt-die-item">
                                <div class="vtt-die-icon">${_DIE_SVGS[t]}</div>
                                <div class="vtt-die-label">${t}</div>
                                <div class="vtt-die-controls">
                                    <button class="vtt-die-btn" onclick="vttBuilderAdjust('${t}',-1)">−</button>
                                    <span id="vttDie_${t}" class="vtt-die-count">0</span>
                                    <button class="vtt-die-btn" onclick="vttBuilderAdjust('${t}',1)">+</button>
                                </div>
                            </div>`).join('')}
                    </div>
                    <div class="vtt-die-modifier-row">
                        <span class="vtt-die-mod-label">Modifier</span>
                        <button class="vtt-die-btn" onclick="vttBuilderModAdjust(-1)">−</button>
                        <span id="vttBuilderModVal" class="vtt-die-count">+0</span>
                        <button class="vtt-die-btn" onclick="vttBuilderModAdjust(1)">+</button>
                    </div>
                </div>
                <div id="vttRollLog" class="vtt-panel vtt-roll-log">
                    <div class="vtt-panel-header">📜 Roll Log</div>
                    <div id="vttRollLogList"></div>
                </div>
            </div>
        </div>
        <!-- Character sheet modal rendered inline -->
        <div id="vttSheetPanel" class="vtt-sheet-panel" style="display:none"></div>
    `;

    await _initPixi();
    _loadSession();
    _joinVoice();
    _initSocketListeners();
}

function closeVTTView() {
    _teardownPixi();
    _teardownDddice();
    _removeSocketListeners();
    _vttChannel  = null;
    _vttSession  = null;
    _tokenSprites = {};
    _pendingRolls = [];
    _loggedRollIds = new Set();
    _diceBuilder = { d4:0, d6:0, d8:0, d10:0, d12:0, d20:0, d100:0, modifier:0 };
    _activeFogMode = null;
    _fogPainting = false;
    _lastFogCell = null;
    if (_fogSaveTimeout) clearTimeout(_fogSaveTimeout);
}

// ── Voice ─────────────────────────────────────────────────────────────────────

function _joinVoice() {
    if (!_vttChannel || !state.currentServer) return;
    if (typeof joinVoice === 'function') {
        joinVoice(_vttChannel.id, state.currentServer.id);
        document.getElementById('vttVoiceStatus').textContent = '🔊 Voice connected';
    }
}

function leaveVTT() {
    if (typeof leaveVoice === 'function') leaveVoice();
    const container = document.getElementById('messagesContainer');
    if (container) container.innerHTML = '';
    closeVTTView();
}

// ── PixiJS ────────────────────────────────────────────────────────────────────

async function _initPixi() {
    const canvas = document.getElementById('vttCanvas');
    const wrap   = document.getElementById('vttCanvasWrap');
    if (!canvas || !wrap || typeof PIXI === 'undefined') return;

    _pixiApp = new PIXI.Application();
    await _pixiApp.init({
        canvas,
        width:           wrap.clientWidth,
        height:          wrap.clientHeight,
        backgroundColor: 0x1a1a2e,
        resolution:      window.devicePixelRatio || 1,
        autoDensity:     true,
    });

    // Layers
    _layers.map      = new PIXI.Container(); _layers.map.label      = 'map';
    _layers.grid     = new PIXI.Container(); _layers.grid.label     = 'grid';
    _layers.fog      = new PIXI.Container(); _layers.fog.label      = 'fog';
    _layers.tokens   = new PIXI.Container(); _layers.tokens.label   = 'tokens';
    _layers.ui       = new PIXI.Container(); _layers.ui.label       = 'ui';

    _pixiApp.stage.addChild(_layers.map, _layers.grid, _layers.fog, _layers.tokens, _layers.ui);

    // Pan / zoom on stage
    _initPanZoom();

    // Resize handler
    _vttResizeObserver = new ResizeObserver(() => {
        if (_pixiApp) {
            _pixiApp.renderer.resize(wrap.clientWidth, wrap.clientHeight);
        }
    });
    _vttResizeObserver.observe(wrap);
}

let _vttResizeObserver = null;
let _fogMode = null;  // 'paint' | 'erase' | null

function _teardownPixi() {
    if (_vttResizeObserver) { _vttResizeObserver.disconnect(); _vttResizeObserver = null; }
    if (_pixiApp) { _pixiApp.destroy(false); _pixiApp = null; }
    _layers = {};
    _mapSprite = null;
}

// ── Pan / Zoom ────────────────────────────────────────────────────────────────

function _initPanZoom() {
    const stage = _pixiApp.stage;
    const view  = _pixiApp.canvas;
    view.addEventListener('contextmenu', e => e.preventDefault());

    let isPanning = false, panStart = { x: 0, y: 0 }, stageStart = { x: 0, y: 0 };

    view.addEventListener('pointerdown', (e) => {
        if (e.button === 1 || (e.button === 0 && e.altKey)) {
            isPanning = true;
            panStart  = { x: e.clientX, y: e.clientY };
            stageStart = { x: stage.x, y: stage.y };
            e.preventDefault();
        }
    });
    view.addEventListener('pointermove', (e) => {
        if (!isPanning) return;
        stage.x = stageStart.x + (e.clientX - panStart.x);
        stage.y = stageStart.y + (e.clientY - panStart.y);
    });
    view.addEventListener('pointerup',   () => { isPanning = false; });
    view.addEventListener('pointerleave',() => { isPanning = false; });
    view.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const rect   = view.getBoundingClientRect();
        const localX = (e.clientX - rect.left - stage.x) / stage.scale.x;
        const localY = (e.clientY - rect.top  - stage.y) / stage.scale.y;
        stage.scale.x = Math.min(4, Math.max(0.2, stage.scale.x * factor));
        stage.scale.y = stage.scale.x;
        stage.x = e.clientX - rect.left - localX * stage.scale.x;
        stage.y = e.clientY - rect.top  - localY * stage.scale.y;
    }, { passive: false });

    // Additional: left-click drag to pan (when not in fog mode)
    let mapPanning = false, mapPanStart = { x: 0, y: 0 }, mapStageStart = { x: 0, y: 0 };
    view.addEventListener('pointerdown', (e) => {
        if (e.button === 0 && !e.altKey && !_activeFogMode && !_dragState) {
            mapPanning = true;
            mapPanStart = { x: e.clientX, y: e.clientY };
            mapStageStart = { x: stage.x, y: stage.y };
            e.preventDefault();
        }
    });
    view.addEventListener('pointermove', (e) => {
        if (mapPanning) {
            stage.x = mapStageStart.x + (e.clientX - mapPanStart.x);
            stage.y = mapStageStart.y + (e.clientY - mapPanStart.y);
        }
        // Fog painting also handled on same move (separate flag)
        if (_fogPainting) {
            _paintFogAtEvent(e);
        }
    });
    view.addEventListener('pointerup',   () => { mapPanning = false; });
    view.addEventListener('pointerleave',() => { mapPanning = false; });

    // Fog painting
    view.addEventListener('pointerdown', (e) => {
        if (e.button === 0 && _activeFogMode && !_dragState) {
            _fogPainting = true;
            _lastFogCell = null;
            _paintFogAtEvent(e);
            e.preventDefault();
        }
    });
    view.addEventListener('pointermove', (e) => {
        if (_fogPainting) {
            _paintFogAtEvent(e);
        }
    });
    view.addEventListener('pointerup', () => {
        if (_fogPainting) {
            _fogPainting = false;
            _lastFogCell = null;
            _debouncedSaveFog();
        }
    });
    view.addEventListener('pointerleave', () => {
        if (_fogPainting) {
            _fogPainting = false;
            _lastFogCell = null;
            _debouncedSaveFog();
        }
    });
}

// ── Session Load ──────────────────────────────────────────────────────────────

async function _loadSession() {
    if (!_vttChannel) return;
    try {
        const res = await fetch(`/api/vtt/${_vttChannel.id}/session`, { credentials: 'include' });
        if (!res.ok) return;
        _vttSession = await res.json();

        if (_vttSession.isGM) _showGMTools();
        if (_vttSession.map) {
            _renderMap(_vttSession.map);
            const gridInput = document.getElementById('vttGridSizeInput');
            if (gridInput) gridInput.value = _vttSession.map.grid_size || 64;
        }
        (_vttSession.tokens || []).forEach(_renderToken);
        _renderEncounter(_vttSession.encounter);
        // Render recent dice rolls from history (oldest-first so prepend puts newest on top)
        if (Array.isArray(_vttSession.recent_rolls)) {
            [..._vttSession.recent_rolls].reverse().forEach(r => {
                _loggedRollIds.add(r.id); // prevent vtt_dice_rolled socket from re-logging
                _logRoll({ total_value: r.total, user: { username: r.username }, values: r.dice }, 0, r.notation);
            });
        }
        _initDddice();
    } catch (e) {
        console.error('[VTT] Failed to load session:', e);
    }
}

// ── Map Rendering ─────────────────────────────────────────────────────────────

async function _renderMap(map) {
    if (!map?.map_url || !_pixiApp || !_layers.map) return;
    if (_mapSprite) _layers.map.removeChild(_mapSprite);

    const texture = await PIXI.Assets.load(map.map_url);
    _mapSprite = new PIXI.Sprite(texture);
    _mapSprite.label = 'map-bg';
    _layers.map.addChild(_mapSprite);

    _drawGrid(map.grid_size || 64, _mapSprite.width, _mapSprite.height);
    if (map.fog_data) _renderFog(map.fog_data, map.grid_size || 64);
}

function _drawGrid(cellSize, mapW, mapH) {
    if (!_layers.grid) return;
    _layers.grid.removeChildren();
    const g = new PIXI.Graphics();
    for (let x = 0; x <= mapW; x += cellSize) {
        g.moveTo(x, 0).lineTo(x, mapH);
    }
    for (let y = 0; y <= mapH; y += cellSize) {
        g.moveTo(0, y).lineTo(mapW, y);
    }
    g.stroke({ color: 0xffffff, alpha: 0.15, width: 1 });
    _layers.grid.addChild(g);
}

function _renderFog(fogData, cellSize) {
    if (!_layers.fog || !fogData) return;
    _layers.fog.removeChildren();
    fogData.forEach((row, rowIdx) => {
        row.forEach((fogged, colIdx) => {
            if (!fogged) return;
            const g = new PIXI.Graphics();
            g.rect(colIdx * cellSize, rowIdx * cellSize, cellSize, cellSize);
            g.fill({ color: 0x000000, alpha: 1.0 });
            _layers.fog.addChild(g);
        });
    });
}

// ── Fog Painting ───────────────────────────────────────────────────────────────

function _paintFogAtEvent(e) {
    if (!_vttSession?.map || !_pixiApp) return;
    const stage = _pixiApp.stage;
    const scale = stage.scale.x;
    const view = _pixiApp.canvas;
    const rect = view.getBoundingClientRect();
    const worldX = (e.clientX - rect.left - stage.x) / scale;
    const worldY = (e.clientY - rect.top - stage.y) / scale;
    const gridSize = _vttSession.map.grid_size || 64;
    const col = Math.floor(worldX / gridSize);
    const row = Math.floor(worldY / gridSize);
    // Get or initialize fog_data
    let fogData = _vttSession.map.fog_data;
    if (!fogData) {
        const cols = Math.ceil((_mapSprite?.width || 0) / gridSize);
        const rows = Math.ceil((_mapSprite?.height || 0) / gridSize);
        fogData = Array.from({ length: rows }, () => Array(cols).fill(false));
        _vttSession.map.fog_data = fogData;
    }
    const rows = fogData.length;
    const cols = fogData[0]?.length || 0;
    if (row < 0 || row >= rows || col < 0 || col >= cols) return;
    if (_lastFogCell && _lastFogCell.row === row && _lastFogCell.col === col) return;
    const value = _activeFogMode === 'paint' ? true : false;
    fogData[row][col] = value;
    _lastFogCell = { row, col };
    _renderFog(fogData, gridSize);
}

function _debouncedSaveFog() {
    if (_fogSaveTimeout) clearTimeout(_fogSaveTimeout);
    _fogSaveTimeout = setTimeout(() => {
        if (_vttSession?.map) {
            _saveFog(_vttSession.map.fog_data);
        }
    }, 500);
}

// ── Tokens ────────────────────────────────────────────────────────────────────

async function _renderToken(token) {
    if (!_layers.tokens || !_pixiApp) return;

    // Remove any existing sprite for this token before re-rendering
    const existing = _tokenSprites[token.id];
    if (existing) { _layers.tokens.removeChild(existing); delete _tokenSprites[token.id]; }

    const container = new PIXI.Container();
    container.label = `token_${token.id}`;
    container.x = token.x;
    container.y = token.y;
    container.eventMode = 'static';
    container.cursor = 'pointer';

    const cellSize = _vttSession?.map?.grid_size || 64;
    const sizeX = token.size_x || token.size || 1;
    const sizeY = token.size_y || token.size || 1;
    const tokenW = sizeX * cellSize;
    const tokenH = sizeY * cellSize;

    // Token shape / image
    let graphic;
    if (token.image_url) {
        try {
            const tex = await PIXI.Assets.load(token.image_url);
            graphic = new PIXI.Sprite(tex);
            graphic.width  = tokenW;
            graphic.height = tokenH;
            graphic.anchor.set(0.5);
        } catch {
            graphic = _makeTokenShape(tokenW, tokenH);
        }
    } else {
        graphic = _makeTokenShape(tokenW, tokenH);
    }
    container.addChild(graphic);

    // Label
    if (token.label) {
        const label = new PIXI.Text({ text: token.label, style: { fontSize: 11, fill: 0xffffff, dropShadow: true } });
        label.anchor.set(0.5, 0);
        label.y = tokenH / 2 + 2;
        container.addChild(label);
    }

    // HP bar
    if (token.hp_max) {
        const bar = _makeHpBar(token.hp, token.hp_max, tokenW);
        bar.y = -(tokenH / 2) - 8;
        bar.x = -(tokenW / 2);
        container.addChild(bar);
    }

    // Drag + right-click
    _attachTokenDrag(container, token, sizeX, sizeY);

    _layers.tokens.addChild(container);
    _tokenSprites[token.id] = container;
}

function _makeTokenShape(w, h) {
    const g = new PIXI.Graphics();
    if (w === h) {
        g.circle(0, 0, w / 2);
    } else {
        const r = Math.min(w, h) * 0.15;
        g.roundRect(-w / 2, -h / 2, w, h, r);
    }
    g.fill({ color: 0x5865f2 });
    g.stroke({ color: 0xffffff, width: 2 });
    return g;
}

function _makeHpBar(hp, hpMax, width) {
    const g = new PIXI.Graphics();
    const pct = Math.max(0, Math.min(1, hp / hpMax));
    const color = pct > 0.5 ? 0x57f287 : pct > 0.25 ? 0xfee75c : 0xed4245;
    g.rect(0, 0, width, 5).fill(0x2f3136);
    g.rect(0, 0, width * pct, 5).fill(color);
    return g;
}

function _attachTokenDrag(container, token, sizeX = 1, sizeY = 1) {
    container.on('pointerdown', (e) => {
        if (e.button === 2) {
            e.stopPropagation();
            _showTokenContextMenu(e.client.x, e.client.y, token);
            return;
        }
        if (e.button !== 0) return;
        _dragState = { tokenId: token.id, container };
        const pos = e.global;
        _dragState.offsetX = pos.x / _pixiApp.stage.scale.x - container.x - _pixiApp.stage.x / _pixiApp.stage.scale.x;
        _dragState.offsetY = pos.y / _pixiApp.stage.scale.y - container.y - _pixiApp.stage.y / _pixiApp.stage.scale.y;
        e.stopPropagation();
    });

    _pixiApp.stage.eventMode = 'static';
    _pixiApp.stage.on('pointermove', (e) => {
        if (!_dragState || _dragState.tokenId !== token.id) return;
        const stageX = _pixiApp.stage.x, stageY = _pixiApp.stage.y;
        const scale  = _pixiApp.stage.scale.x;
        container.x = (e.global.x - stageX) / scale - _dragState.offsetX;
        container.y = (e.global.y - stageY) / scale - _dragState.offsetY;
    });

    _pixiApp.stage.on('pointerup', () => {
        if (!_dragState || _dragState.tokenId !== token.id) return;
        const gs = _vttSession?.map?.grid_size || 64;
        const halfW = sizeX * gs / 2;
        const halfH = sizeY * gs / 2;
        const snappedX = Math.round((container.x - halfW) / gs) * gs + halfW;
        const snappedY = Math.round((container.y - halfH) / gs) * gs + halfH;
        container.x = snappedX;
        container.y = snappedY;
        _saveTokenPosition(token.id, snappedX, snappedY);
        _dragState = null;
    });
}

function _showTokenContextMenu(clientX, clientY, token) {
    document.getElementById('vttTokenCtxMenu')?.remove();
    const isGM = _vttSession?.isGM;
    const isOwner = token.owner_id === state.currentUser?.id;
    if (!isGM && !isOwner) return;

    const menu = document.createElement('div');
    menu.id = 'vttTokenCtxMenu';
    menu.className = 'vtt-ctx-menu';
    menu.style.cssText = `position:fixed;left:${clientX}px;top:${clientY}px;z-index:9999;`;

    if (isGM) {
        menu.innerHTML = `
            <div class="vtt-ctx-item" onclick="vttEditTokenSize('${token.id}')">📐 Edit Size</div>
            <div class="vtt-ctx-item" onclick="vttAssignToken('${token.id}')">👤 Assign to Player</div>
            <div class="vtt-ctx-item vtt-ctx-danger" onclick="vttRemoveToken('${token.id}')">🗑️ Remove</div>
        `;
    } else {
        menu.innerHTML = `<div class="vtt-ctx-item vtt-ctx-danger" onclick="vttRemoveToken('${token.id}')">🗑️ Remove</div>`;
    }

    document.body.appendChild(menu);
    const close = (e) => {
        if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', close); }
    };
    setTimeout(() => document.addEventListener('pointerdown', close), 0);
}

async function vttRemoveToken(tokenId) {
    document.getElementById('vttTokenCtxMenu')?.remove();
    if (!_vttChannel) return;
    await fetch(`/api/vtt/${_vttChannel.id}/tokens/${tokenId}`, { method: 'DELETE', credentials: 'include' });
}

function vttEditTokenSize(tokenId) {
    document.getElementById('vttTokenCtxMenu')?.remove();
    if (!_vttChannel || !_vttSession) return;
    const token = (_vttSession.tokens || []).find(t => t.id === tokenId);
    if (!token) return;

    const customHTML = `
        <div style="display:flex;gap:10px">
            <div style="flex:1">
                <label style="display:block;margin-bottom:4px;font-weight:600">Width (cells):</label>
                <input type="number" id="editSizeXInput" class="modal-input" min="1" max="10" value="${token.size_x || 1}" style="width:100%">
            </div>
            <div style="flex:1">
                <label style="display:block;margin-bottom:4px;font-weight:600">Height (cells):</label>
                <input type="number" id="editSizeYInput" class="modal-input" min="1" max="10" value="${token.size_y || 1}" style="width:100%">
            </div>
        </div>
    `;
    showModal({
        title: `Edit Token: ${token.label || 'Token'}`,
        customHTML,
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            { text: 'Save', style: 'primary', action: async () => {
                const sx = Math.max(1, parseInt(document.getElementById('editSizeXInput')?.value) || 1);
                const sy = Math.max(1, parseInt(document.getElementById('editSizeYInput')?.value) || 1);
                closeModal();
                const res = await fetch(`/api/vtt/${_vttChannel.id}/tokens/${tokenId}`, {
                    method: 'PATCH', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ size_x: sx, size_y: sy })
                });
                if (res.ok) {
                    const { token: updated } = await res.json();
                    // Re-render updated token
                    const sprite = _tokenSprites[tokenId];
                    if (sprite) { _layers.tokens?.removeChild(sprite); delete _tokenSprites[tokenId]; }
                    const idx = (_vttSession.tokens || []).findIndex(t => t.id === tokenId);
                    if (idx !== -1) _vttSession.tokens[idx] = updated;
                    _renderToken(updated);
                }
            }}
        ]
    });
}

function vttAssignToken(tokenId) {
    document.getElementById('vttTokenCtxMenu')?.remove();
    if (!_vttChannel || !_vttSession) return;
    const token = (_vttSession.tokens || []).find(t => t.id === tokenId);
    if (!token) return;

    const members = (state.members || []).filter(m => !m.bot);
    const optionsHTML = [
        `<option value="">Unassigned</option>`,
        ...members.map(m => `<option value="${m.id}" ${m.id === token.owner_id ? 'selected' : ''}>${m.username}</option>`)
    ].join('');

    const customHTML = `
        <div>
            <label style="display:block;margin-bottom:6px;font-weight:600">Assign "${token.label || 'Token'}" to:</label>
            <select id="assignPlayerSelect" class="modal-input" style="width:100%">${optionsHTML}</select>
        </div>
    `;
    showModal({
        title: 'Assign Token',
        customHTML,
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            { text: 'Assign', style: 'primary', action: async () => {
                const userId = document.getElementById('assignPlayerSelect')?.value || null;
                closeModal();
                await fetch(`/api/vtt/${_vttChannel.id}/tokens/${tokenId}`, {
                    method: 'PATCH', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ owner_id: userId })
                });
                const idx = (_vttSession.tokens || []).findIndex(t => t.id === tokenId);
                if (idx !== -1) _vttSession.tokens[idx].owner_id = userId;
            }}
        ]
    });
}

async function _saveTokenPosition(tokenId, x, y) {
    if (!_vttChannel) return;
    await fetch(`/api/vtt/${_vttChannel.id}/tokens/${tokenId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y })
    });
}

// ── Fog of War ────────────────────────────────────────────────────────────────

function vttToggleFogTool() {
    const panel = document.getElementById('vttFogTools');
    if (panel) {
        const showing = panel.style.display !== 'none';
        if (showing) {
            // Hide and clear state
            vttCloseFogTools();
        } else {
            panel.style.display = 'flex';
        }
    }
}

function vttCloseFogTools() {
    const panel = document.getElementById('vttFogTools');
    if (panel) panel.style.display = 'none';
    _activeFogMode = null;
    _fogPainting = false;
    const canvas = document.getElementById('vttCanvas');
    if (canvas) canvas.style.cursor = '';
}

function vttFogMode(mode) {
    _activeFogMode = mode;
    const canvas = document.getElementById('vttCanvas');
    if (canvas) canvas.style.cursor = mode === 'paint' ? 'cell' : 'crosshair';
}

function vttClearFog() {
    if (!_vttSession?.map) return;
    const map = _vttSession.map;
    const cols = Math.ceil((_mapSprite?.width || 0) / (map.grid_size || 64));
    const rows = Math.ceil((_mapSprite?.height || 0) / (map.grid_size || 64));
    const fog = Array.from({ length: rows }, () => Array(cols).fill(false));
    // Update local state immediately
    map.fog_data = fog;
    _renderFog(fog, map.grid_size);
    _saveFog(fog);
}

function _resizeFogData(oldFog, oldSize, newSize, mapW, mapH) {
    const newCols = Math.ceil(mapW / newSize);
    const newRows = Math.ceil(mapH / newSize);
    return Array.from({ length: newRows }, (_, r) =>
        Array.from({ length: newCols }, (_, c) => {
            const wx = (c + 0.5) * newSize;
            const wy = (r + 0.5) * newSize;
            return oldFog?.[Math.floor(wy / oldSize)]?.[Math.floor(wx / oldSize)] ?? false;
        })
    );
}

async function vttSetGridSize(sizeStr) {
    if (!_vttChannel || !_vttSession?.map || !_mapSprite) return;
    const oldSize = _vttSession.map.grid_size || 64;
    const newSize = Math.max(16, Math.min(512, parseInt(sizeStr, 10) || 64));
    if (newSize === oldSize) return;

    let newFog = null;
    if (_vttSession.map.fog_data) {
        newFog = _resizeFogData(_vttSession.map.fog_data, oldSize, newSize, _mapSprite.width, _mapSprite.height);
        _vttSession.map.fog_data = newFog;
    }
    _vttSession.map.grid_size = newSize;
    _drawGrid(newSize, _mapSprite.width, _mapSprite.height);
    if (newFog) _renderFog(newFog, newSize);

    await fetch(`/api/vtt/${_vttChannel.id}/map`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grid_size: newSize, ...(newFog && { fog_data: newFog }) })
    });
}

async function _saveFog(fogData) {
    if (!_vttChannel) return;
    await fetch(`/api/vtt/${_vttChannel.id}/map`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fog_data: fogData })
    });
}

// ── dddice ────────────────────────────────────────────────────────────────────

async function _initDddice() {
    if (typeof ThreeDDice === 'undefined') return;
    try {
        const res = await fetch(`/api/vtt/${_vttChannel.id}/dddice`, { credentials: 'include' });
        if (!res.ok) return;
        const { guestToken, roomSlug, theme: diceTheme } = await res.json();
        _vttDiceTheme = diceTheme || 'nexusguild-mmji72re';

        const canvas = document.createElement('canvas');
        canvas.id = 'vttDddiceCanvas';
        canvas.className = 'vtt-dice-canvas';
        document.getElementById('vttCanvasWrap')?.appendChild(canvas);

        _dddice = new ThreeDDice(canvas, guestToken);
        _dddice.start();

        // api is only available after connect()
        await _dddice.connect(roomSlug);

        // Load the account's available theme
        try {
            const themeRes = await _dddice.api.theme.get(_vttDiceTheme);
            if (themeRes?.data) {
                await _dddice.loadTheme(themeRes.data);
                await _dddice.loadThemeResources(_vttDiceTheme);
            }
        } catch { /* non-fatal */ }

        // Subscribe to every plausible dddice roll event name — only one will fire,
        // deduplication by roll.id prevents double-handling.
        const _handleDddiceRoll = (roll) => {
            const eventKey = roll?.id ? `ev_${roll.id}` : null;
            if (eventKey && _loggedRollIds.has(eventKey)) return;
            if (eventKey) _loggedRollIds.add(eventKey);

            const pending = _pendingRolls.length > 0 ? _pendingRolls.shift() : null;
            if (pending) {
                // Don't log here — vtt_dice_rolled socket event is the single log source
                _postRollToServer(roll, pending.modifier, pending.notation);
            }
            // Mark dddice roll ID so server broadcast doesn't duplicate it in the log
            if (roll?.id) _loggedRollIds.add(roll.id);
        };

        const knownEvents = new Set(['roll:added', 'roll:created', 'roll:finished', 'roll:updated', 'roll']);
        for (const ev of knownEvents) _dddice.on(ev, _handleDddiceRoll);
        // Also subscribe to any enum values the CDN exports
        if (typeof ThreeDDiceRollEvent !== 'undefined') {
            for (const ev of Object.values(ThreeDDiceRollEvent)) {
                if (typeof ev === 'string' && !knownEvents.has(ev)) _dddice.on(ev, _handleDddiceRoll);
            }
        }
    } catch (e) {
        console.warn('[VTT] dddice init failed:', e);
    }
}

function _teardownDddice() {
    if (_dddice) { try { _dddice.clear(); } catch {} _dddice = null; }
    document.getElementById('vttDddiceCanvas')?.remove();
}

function _logRoll(roll, modifier = 0, notation = null) {
    const list = document.getElementById('vttRollLogList');
    if (!list) return;
    let total = roll.total_value ?? roll.values?.reduce((s, v) => s + (v.value || 0), 0) ?? '?';
    if (typeof total === 'number') total += modifier;
    const name = roll.user?.username || 'Unknown';
    let entryHTML;
    if (notation) {
        entryHTML = `<span class="vtt-roll-name">${name}</span> ${notation} = <strong>${total}</strong>`;
    } else {
        entryHTML = `<span class="vtt-roll-name">${name}</span> rolled <strong>${total}</strong>`;
    }
    const entry = document.createElement('div');
    entry.className = 'vtt-roll-entry';
    entry.innerHTML = entryHTML;
    list.prepend(entry);
    // Keep last 50 rolls
    while (list.children.length > 50) list.removeChild(list.lastChild);
}

// ── Local dice simulator (fallback when dddice is unavailable) ───────────────

function _simRoll(parsed) {
    let total = parsed.modifier;
    const values = [];
    for (const die of parsed.dice) {
        const sides = parseInt(die.type.slice(1), 10);
        const val = Math.floor(Math.random() * sides) + 1;
        total += val;
        values.push({ value: val });
    }
    return {
        total_value: total,
        values,
        user: { username: state.currentUser?.username || 'You' }
    };
}

// Send a roll to our server for persistence
async function _postRollToServer(roll, modifier, notation) {
    if (!_vttChannel) return;
    // Compute total (including modifier)
    let total = roll.total_value ?? roll.values?.reduce((s, v) => s + (v.value || 0), 0) ?? 0;
    if (typeof total === 'number') total += modifier;
    // dice array from roll result
    const dice = roll.dice || roll.values || [];
    // Validate required fields
    if (!notation || total === undefined || !dice || dice.length === 0) {
        console.warn('[VTT] Skipping invalid roll:', { roll, modifier, notation, total, dice });
        return;
    }
    const payload = {
        notation,
        total,
        dice,
        dddice_roll_id: roll.id,
        modifier
    };
    try {
        await fetch(`/api/vtt/${_vttChannel.id}/roll`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.warn('[VTT] Failed to log roll to server:', e);
    }
}

// ── Dice Roll Prompt ──────────────────────────────────────────────────────────

async function vttRollPrompt() {
    if (!_vttChannel) return;

    const notationInput = document.getElementById('modalInput');
    const modalError = document.getElementById('modalError');

    // Reset modal state
    if (notationInput) notationInput.value = '';
    if (modalError) modalError.style.display = 'none';

    showModal({
        title: 'Roll Dice',
        message: 'Enter dice notation (e.g. 1d20, 2d6+3):',
        inputType: 'text',
        inputPlaceholder: '1d20',
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            { text: 'Roll', style: 'primary', action: () => {
                const val = notationInput?.value?.trim();
                if (!val) {
                    modalError.textContent = 'Please enter a dice notation';
                    modalError.style.display = 'block';
                    return;
                }
                closeModal();
                _executeRoll(val);
            }}
        ],
        onEnter: () => {
            const val = notationInput?.value?.trim();
            if (!val) {
                modalError.textContent = 'Please enter a dice notation';
                modalError.style.display = 'block';
                return;
            }
            closeModal();
            _executeRoll(val);
        }
    });
}

function _executeRoll(notation) {
    const trimmed = notation.trim();
    const parsed = _parseDiceNotation(trimmed, _vttDiceTheme);
    if (!parsed.dice.length) {
        console.warn('[VTT] Could not parse notation:', trimmed);
        return;
    }
    if (!_dddice) {
        _postRollToServer(_simRoll(parsed), 0, trimmed);
        return;
    }
    _pendingRolls.push({ modifier: parsed.modifier, notation: trimmed });
    try {
        _dddice.roll(parsed.dice);
    } catch (e) {
        _pendingRolls.pop();
        console.warn('[VTT] Roll error:', e);
    }
}

function _parseDiceNotation(notation, theme) {
    // Supports: d20, 2d6, 1d20, d6, and trailing modifiers like 2d6+3 or 1d20-2
    let str = notation.trim().toLowerCase().replace(/\s/g, '');
    let modifier = 0;

    // Extract trailing +/- integer
    const modMatch = str.match(/([+-]\d+)$/);
    if (modMatch) {
        modifier = parseInt(modMatch[1], 10);
        str = str.slice(0, -modMatch[1].length);
    }

    // Split remaining dice groups (e.g., "2d6+1d4" -> ["2d6","1d4"])
    const parts = str.split('+');
    const dice = [];

    for (const part of parts) {
        const m = part.match(/^(\d*)d(\d+)$/);
        if (m) {
            const count = parseInt(m[1] || '1', 10);
            const rawType = `d${m[2]}`;
            const type = rawType === 'd100' ? 'd10x' : rawType;
            for (let i = 0; i < count; i++) {
                dice.push({ type, theme });
            }
        }
    }

    return { dice, modifier };
}

// ── Add Token Prompt ──────────────────────────────────────────────────────────

function vttAddTokenPrompt() {
    if (!_vttChannel) return;

    const customHTML = `
        <div style="margin-bottom:10px">
            <label style="display:block;margin-bottom:4px;font-weight:600">Label:</label>
            <input type="text" id="addTokenLabel" class="modal-input" placeholder="Token name" style="width:100%">
        </div>
        <div style="display:flex;gap:8px">
            <div style="flex:1">
                <label style="display:block;margin-bottom:4px;font-weight:600">Width (cells):</label>
                <input type="number" id="addTokenSizeX" class="modal-input" min="1" max="10" value="1" style="width:100%">
            </div>
            <div style="flex:1">
                <label style="display:block;margin-bottom:4px;font-weight:600">Height (cells):</label>
                <input type="number" id="addTokenSizeY" class="modal-input" min="1" max="10" value="1" style="width:100%">
            </div>
        </div>
        <p id="addTokenErr" style="color:#ed4245;display:none;margin-top:8px;margin-bottom:0"></p>
    `;

    showModal({
        title: 'Add Token',
        customHTML,
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            { text: 'Add', style: 'primary', action: () => {
                const label = document.getElementById('addTokenLabel')?.value.trim();
                if (!label) {
                    const err = document.getElementById('addTokenErr');
                    if (err) { err.textContent = 'Please enter a label'; err.style.display = 'block'; }
                    return;
                }
                const sx = Math.max(1, parseInt(document.getElementById('addTokenSizeX')?.value) || 1);
                const sy = Math.max(1, parseInt(document.getElementById('addTokenSizeY')?.value) || 1);
                closeModal();
                _executeAddToken(label, sx, sy);
            }}
        ]
    });
}
function _executeAddToken(label, sizeX = 1, sizeY = 1) {
    if (!_vttChannel) return;
    const gs = _vttSession?.map?.grid_size || 64;
    const form = new FormData();
    form.append('label', label);
    form.append('x', gs * sizeX / 2);
    form.append('y', gs * sizeY / 2);
    form.append('size_x', sizeX);
    form.append('size_y', sizeY);
    fetch(`/api/vtt/${_vttChannel.id}/tokens`, {
        method: 'POST',
        credentials: 'include',
        body: form
    }).then(r => r.json()).then(({ token }) => {
        if (token) _renderToken(token);
    });
}

// ── Upload Map ────────────────────────────────────────────────────────────────

function vttUploadMapPrompt() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
        if (!input.files[0] || !_vttChannel) return;
        const form = new FormData();
        form.append('map', input.files[0]);
        const res = await fetch(`/api/vtt/${_vttChannel.id}/map/upload`, {
            method: 'POST',
            credentials: 'include',
            body: form
        });
        if (res.ok) {
            const { map } = await res.json();
            _vttSession = _vttSession || {};
            _vttSession.map = map;
            _renderMap(map);
        }
    };
    input.click();
}

// ── GM Tools ─────────────────────────────────────────────────────────────────

function _showGMTools() {
    const btn = document.getElementById('vttBtnUploadMap');
    if (btn) btn.style.display = '';
    const fog = document.getElementById('vttBtnFog');
    if (fog) fog.style.display = '';
    const clr = document.getElementById('vttBtnClearFog');
    if (clr) clr.style.display = '';
    const gridWrap = document.getElementById('vttGridSizeWrap');
    if (gridWrap) gridWrap.style.display = '';
    const startBtn = document.getElementById('vttStartCombat');
    if (startBtn) startBtn.style.display = '';
    const addRow = document.getElementById('vttAddCombatant');
    if (addRow) addRow.style.display = '';
}

// ── Initiative Tracker ────────────────────────────────────────────────────────

function vttToggleTracker() {
    const panel = document.getElementById('vttTrackerPanel');
    if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

function _renderEncounter(encounter) {
    const list = document.getElementById('vttCombatList');
    if (!list) return;

    if (!encounter || !encounter.is_active) {
        list.innerHTML = '<div class="vtt-empty">No active encounter.</div>';
        _syncCombatButtons(false);
        return;
    }

    _syncCombatButtons(true);
    const combatants = [...(encounter.combatants || [])].sort((a, b) => b.initiative - a.initiative);
    list.innerHTML = combatants.map((c, idx) => {
        const isActive = idx === encounter.active_index;
        return `<div class="vtt-combatant${isActive ? ' vtt-active-turn' : ''}">
            <span class="vtt-init-badge">${c.initiative}</span>
            <span class="vtt-combatant-name">${c.name}</span>
            ${c.hp_max ? `<span class="vtt-hp-pill">${c.hp}/${c.hp_max}</span>` : ''}
            ${(encounter.combatants || []).length > 0 && _vttSession?.isGM
                ? `<button class="vtt-btn-sm" onclick="vttRemoveCombatant('${c.id}')">✕</button>`
                : ''}
        </div>`;
    }).join('');
}

function _syncCombatButtons(isActive) {
    const start = document.getElementById('vttStartCombat');
    const next  = document.getElementById('vttNextTurn');
    const end   = document.getElementById('vttEndCombat');
    if (start) start.style.display = isActive ? 'none' : '';
    if (next)  next.style.display  = isActive ? '' : 'none';
    if (end)   end.style.display   = isActive ? '' : 'none';
}

function vttAddCombatant() {
    const name = document.getElementById('vttCombatantName')?.value?.trim();
    const init = parseInt(document.getElementById('vttCombatantInit')?.value) || 0;
    if (!name || !_vttSession || !_vttChannel) return;

    const combatants = [...(_vttSession.encounter?.combatants || [])];
    combatants.push({ id: Date.now().toString(), name, initiative: init, hp: null, hp_max: null, conditions: [] });
    _saveEncounter({ combatants });
}

function vttRemoveCombatant(id) {
    if (!_vttSession?.encounter) return;
    const combatants = (_vttSession.encounter.combatants || []).filter(c => c.id !== id);
    _saveEncounter({ combatants });
}

function vttStartCombat() {
    _saveEncounter({ is_active: true, round: 1, active_index: 0 });
}

function vttNextTurn() {
    if (!_vttSession?.encounter) return;
    const len = (_vttSession.encounter.combatants || []).length;
    if (!len) return;
    let next = (_vttSession.encounter.active_index + 1) % len;
    const round = next === 0 ? (_vttSession.encounter.round || 1) + 1 : _vttSession.encounter.round;
    _saveEncounter({ active_index: next, round });
}

function vttEndCombat() {
    _saveEncounter({ is_active: false, round: 1, active_index: 0 });
}

async function _saveEncounter(patch) {
    if (!_vttChannel) return;
    const res = await fetch(`/api/vtt/${_vttChannel.id}/encounter`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(_vttSession?.encounter || {}), ...patch })
    });
    if (res.ok) {
        const { encounter } = await res.json();
        if (_vttSession) _vttSession.encounter = encounter;
        _renderEncounter(encounter);
    }
}

// ── Character Sheet ───────────────────────────────────────────────────────────

function vttOpenSheet() {
    const panel = document.getElementById('vttSheetPanel');
    if (!panel) return;
    panel.style.display = panel.style.display === 'none' ? '' : 'none';
    if (panel.style.display === '') _renderSheet();
}

function _initSheetDrag(panel) {
    const header = panel.querySelector('.vtt-sheet-header');
    if (!header) return;
    header.style.cursor = 'grab';
    let dragging = false, ox = 0, oy = 0;
    header.addEventListener('pointerdown', (e) => {
        if (e.target.tagName === 'BUTTON') return; // don't drag when clicking buttons
        dragging = true;
        const rect = panel.getBoundingClientRect();
        ox = e.clientX - rect.left;
        oy = e.clientY - rect.top;
        header.style.cursor = 'grabbing';
        header.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    header.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const wrap = document.getElementById('vttRoot');
        const bounds = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
        const x = Math.max(bounds.left, Math.min(e.clientX - ox, bounds.right  - panel.offsetWidth));
        const y = Math.max(bounds.top,  Math.min(e.clientY - oy, bounds.bottom - panel.offsetHeight));
        panel.style.left   = (x - bounds.left) + 'px';
        panel.style.top    = (y - bounds.top)  + 'px';
        panel.style.right  = 'auto';
    });
    header.addEventListener('pointerup', () => { dragging = false; header.style.cursor = 'grab'; });
}

function _renderSheet() {
    const panel = document.getElementById('vttSheetPanel');
    if (!panel || !_vttSession) return;

    const chars = _vttSession.characters || [];
    const myChar = chars.find(c => c.user_id === state.currentUser?.id) || null;
    const canDelete = myChar && (myChar.user_id === state.currentUser?.id || _vttSession.isGM);

    panel.innerHTML = `
        <div class="vtt-sheet-header">
            <span>📋 Character Sheet</span>
            ${myChar && myChar.system === 'dnd5e' ? `<button class="vtt-btn-sm" title="Re-import from DnDBeyond" onclick="vttImportDndbeyond('${myChar.id}')">⬇ DnDBeyond</button>` : ''}
            ${!myChar ? `<button class="vtt-btn-sm" onclick="vttImportDndbeyond()">⬇ Import DnDBeyond</button>` : ''}
            ${canDelete ? `<button class="vtt-btn-sm vtt-btn-danger" onclick="vttDeleteCharacter('${myChar.id}')">Delete</button>` : ''}
            <button class="vtt-btn-sm" onclick="document.getElementById('vttSheetPanel').style.display='none'">✕</button>
        </div>
        ${myChar ? _renderSheetContent(myChar) : `
            <div class="vtt-empty" style="padding:16px">No character yet.
                <button class="vtt-btn-sm" onclick="vttCreateCharPrompt()">Create</button>
            </div>
        `}
    `;
    _initSheetDrag(panel);
}

function _renderSheetContent(char) {
    const d = char.sheet_data || {};
    if (char.system === 'dnd5e') return _renderDnd5eSheet(char, d);
    if (char.system === 'pf2e')  return _renderPf2eSheet(char, d);
    return _renderGenericSheet(char, d);
}

const _DND5E_SKILLS = [
    { key:'acrobatics',      label:'Acrobatics',      ab:'dex' },
    { key:'animal_handling', label:'Animal Handling',  ab:'wis' },
    { key:'arcana',          label:'Arcana',           ab:'int' },
    { key:'athletics',       label:'Athletics',        ab:'str' },
    { key:'deception',       label:'Deception',        ab:'cha' },
    { key:'history',         label:'History',          ab:'int' },
    { key:'insight',         label:'Insight',          ab:'wis' },
    { key:'intimidation',    label:'Intimidation',     ab:'cha' },
    { key:'investigation',   label:'Investigation',    ab:'int' },
    { key:'medicine',        label:'Medicine',         ab:'wis' },
    { key:'nature',          label:'Nature',           ab:'int' },
    { key:'perception',      label:'Perception',       ab:'wis' },
    { key:'performance',     label:'Performance',      ab:'cha' },
    { key:'persuasion',      label:'Persuasion',       ab:'cha' },
    { key:'religion',        label:'Religion',         ab:'int' },
    { key:'sleight_of_hand', label:'Sleight of Hand',  ab:'dex' },
    { key:'stealth',         label:'Stealth',          ab:'dex' },
    { key:'survival',        label:'Survival',         ab:'wis' },
];

function _renderGenericSheet(char, d) {
    return `
        <div class="vtt-sheet-body">
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Character Name</label>
                <input class="vtt-input vtt-sheet-full" type="text" value="${char.name || ''}"
                       oninput="vttSheetEdit('_name', this.value)">
            </div>
            <div class="vtt-sheet-3col">
                <div class="vtt-sheet-field-group">
                    <label class="vtt-sheet-label">Current HP</label>
                    <input class="vtt-input" type="number" value="${d.hp ?? ''}"
                           oninput="vttSheetEdit('hp', +this.value)">
                </div>
                <div class="vtt-sheet-field-group">
                    <label class="vtt-sheet-label">Max HP</label>
                    <input class="vtt-input" type="number" value="${d.hp_max ?? ''}"
                           oninput="vttSheetEdit('hp_max', +this.value)">
                </div>
                <div class="vtt-sheet-field-group">
                    <label class="vtt-sheet-label">AC</label>
                    <input class="vtt-input" type="number" value="${d.ac ?? ''}"
                           oninput="vttSheetEdit('ac', +this.value)">
                </div>
            </div>
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Notes</label>
                <textarea class="vtt-input vtt-sheet-textarea"
                          oninput="vttSheetEdit('notes', this.value)">${d.notes ?? ''}</textarea>
            </div>
        </div>`;
}

// ── D&D 5e Tab System ─────────────────────────────────────────────────────────

const _DND5E_TABS = [
    { id: 'main',       label: 'Main'               },
    { id: 'actions',    label: 'Actions'             },
    { id: 'spells',     label: 'Spells'              },
    { id: 'inventory',  label: 'Inventory'           },
    { id: 'features',   label: 'Features & Traits'  },
    { id: 'background', label: 'Background'          },
    { id: 'notes',      label: 'Notes'               },
    { id: 'extras',     label: 'Extras'              },
];

function _injectDnd5eTabStyles() {
    if (_dnd5eTabStyleOk) return;
    _dnd5eTabStyleOk = true;
    const style = document.createElement('style');
    style.textContent = `
        /* vtt-tab-bar — sits at top of sheet panel, always visible */
        .vtt-tab-bar {
            display: flex;
            flex-wrap: wrap;
            gap: 2px;
            padding: 6px 8px 0;
            background: var(--bg-secondary, #2b2d31);
            border-bottom: 1px solid var(--border-color, #1e1f22);
            flex-shrink: 0;
        }
        .vtt-tab-btn {
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            color: var(--text-muted, #949ba4);
            cursor: pointer;
            font-size: 11px;
            font-weight: 500;
            padding: 4px 8px 6px;
            white-space: nowrap;
            transition: color 0.1s, border-color 0.1s;
        }
        .vtt-tab-btn:hover { color: var(--text-primary, #dde1e6); }
        .vtt-tab-btn-active {
            border-bottom-color: #5865f2;
            color: #fff;
        }
        /* Tab body scrolls independently */
        #vttSheetTabBody {
            flex: 1 1 auto;
            overflow-y: auto;
            padding: 0;
        }
        /* Spell slot grid */
        .vtt-spell-slots {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 6px;
            margin-bottom: 10px;
        }
        .vtt-spell-slot-box {
            background: var(--bg-tertiary, #1e1f22);
            border-radius: 6px;
            padding: 6px;
            text-align: center;
        }
        .vtt-spell-slot-box .vtt-slot-level {
            font-size: 10px;
            color: var(--text-muted, #949ba4);
            margin-bottom: 4px;
        }
        .vtt-spell-slot-box .vtt-slot-inputs {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            font-size: 11px;
            color: var(--text-muted, #949ba4);
        }
        .vtt-spell-slot-box input[type=number] {
            width: 44px;
            text-align: center;
            /* hide spin buttons so they don't overlap the value */
            -moz-appearance: textfield;
        }
        .vtt-spell-slot-box input[type=number]::-webkit-inner-spin-button,
        .vtt-spell-slot-box input[type=number]::-webkit-outer-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }
        /* Spell list rows */
        .vtt-spell-row {
            display: grid;
            grid-template-columns: 16px 1fr 40px 40px 24px;
            gap: 4px;
            align-items: center;
            padding: 3px 0;
            border-bottom: 1px solid var(--border-color, #1e1f22);
            font-size: 12px;
        }
        .vtt-spell-row:last-child { border-bottom: none; }
        .vtt-spell-level-header {
            font-size: 11px;
            font-weight: 600;
            color: var(--text-muted, #949ba4);
            text-transform: uppercase;
            letter-spacing: .5px;
            margin: 8px 0 4px;
        }
        /* Exhaustion pips */
        .vtt-exhaustion-pips {
            display: flex;
            gap: 6px;
            margin-top: 6px;
        }
        .vtt-exhaustion-pip {
            width: 22px;
            height: 22px;
            border-radius: 50%;
            border: 2px solid var(--text-muted, #949ba4);
            cursor: pointer;
            background: none;
            transition: background 0.15s, border-color 0.15s;
        }
        .vtt-exhaustion-pip.active {
            background: #ed4245;
            border-color: #ed4245;
        }
        /* Inventory list */
        .vtt-inventory-list { margin-bottom: 8px; }
        .vtt-inventory-row {
            display: grid;
            grid-template-columns: 18px 1fr 36px auto 24px;
            gap: 6px;
            align-items: center;
            padding: 4px 0;
            border-bottom: 1px solid var(--border-color, #1e1f22);
            font-size: 12px;
        }
        .vtt-inventory-row:last-child { border-bottom: none; }
        .vtt-inv-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .vtt-inv-qty  { color: var(--text-muted, #949ba4); text-align: right; }
        .vtt-inv-type { color: var(--text-muted, #949ba4); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    `;
    document.head.appendChild(style);
}

// Public: called by tab button onclick handlers
function vttSetSheetTab(tab) {
    _activeSheetTab = tab;
    const myChar = _getMyChar();
    if (!myChar) return;
    const d = myChar.sheet_data || {};
    // Swap body content
    const body = document.getElementById('vttSheetTabBody');
    if (body) body.innerHTML = _dnd5eTabContent(tab, myChar, d);
    // Update button active states
    document.querySelectorAll('.vtt-tab-btn').forEach(btn => {
        btn.classList.toggle('vtt-tab-btn-active', btn.dataset.tab === tab);
    });
}

// Dispatcher — returns HTML string for tab body
function _dnd5eTabContent(tab, char, d) {
    switch (tab) {
        case 'main':       return _dnd5eTabMain(char, d);
        case 'actions':    return _dnd5eTabActions(char, d);
        case 'spells':     return _dnd5eTabSpells(char, d);
        case 'inventory':  return _dnd5eTabInventory(char, d);
        case 'features':   return _dnd5eTabFeatures(char, d);
        case 'background': return _dnd5eTabBackground(char, d);
        case 'notes':      return _dnd5eTabNotes(char, d);
        case 'extras':     return _dnd5eTabExtras(char, d);
        default:           return _dnd5eTabMain(char, d);
    }
}

// ── Tab: Main ─────────────────────────────────────────────────────────────────
function _dnd5eTabMain(char, d) {
    const abs  = d.ability_scores || {};
    const mod  = s => Math.floor(((s || 10) - 10) / 2);
    const fmt  = n => n >= 0 ? `+${n}` : `${n}`;
    const prof = d.proficiency_bonus || 2;
    const saveProfs  = d.saving_throw_profs || [];
    const skillProfs = d.skill_profs || [];
    const passPerc   = 10 + mod(abs['wis']) + (skillProfs.includes('perception') ? prof : 0);

    const abilityBox = (key) => {
        const score = abs[key] || 10;
        const m = mod(score);
        return `
        <div class="vtt-ability">
            <div class="vtt-ability-name">${key.toUpperCase()}</div>
            <div class="vtt-ability-mod" id="vttMod_${key}">${fmt(m)}</div>
            <input type="number" class="vtt-ability-score-input" min="1" max="30" value="${score}"
                   oninput="vttSheetEditScore('${key}', +this.value)">
            <button class="vtt-roll-btn" id="vttAbilBtn_${key}"
                    onclick="vttRollAbility('${key}',${m})">🎲</button>
        </div>`;
    };

    const saveRow = (a) => {
        const hasPr = saveProfs.includes(a);
        const bonus = mod(abs[a]) + (hasPr ? prof : 0);
        return `<div class="vtt-save-row">
            <input type="checkbox" class="vtt-prof-check" ${hasPr ? 'checked' : ''}
                   onchange="vttSheetToggle('saving_throw_profs','${a}')">
            <span class="vtt-save-row-name">${a.toUpperCase()}</span>
            <span id="vttSaveBonus_${a}">${fmt(bonus)}</span>
            <button class="vtt-roll-btn" id="vttSaveBtn_${a}"
                    onclick="vttRollSave('${a}',${bonus})">🎲</button>
        </div>`;
    };

    const skillRow = (sk) => {
        const hasPr = skillProfs.includes(sk.key);
        const bonus = mod(abs[sk.ab]) + (hasPr ? prof : 0);
        return `<div class="vtt-save-row">
            <input type="checkbox" class="vtt-prof-check" ${hasPr ? 'checked' : ''}
                   onchange="vttSheetToggle('skill_profs','${sk.key}')">
            <span class="vtt-save-row-name">${sk.label} <span class="vtt-skill-ab">(${sk.ab.toUpperCase()})</span></span>
            <span id="vttSkillBonus_${sk.key}">${fmt(bonus)}</span>
            <button class="vtt-roll-btn" onclick="vttRollSkill('${sk.label}','${sk.ab}',${bonus})">🎲</button>
        </div>`;
    };

    return `<div class="vtt-sheet-body">

        <!-- Identity strip -->
        <div class="vtt-sheet-field-group">
            <label class="vtt-sheet-label">Character Name</label>
            <input class="vtt-input vtt-sheet-full" type="text" value="${char.name || ''}"
                   oninput="vttSheetEdit('_name', this.value)">
        </div>
        <div class="vtt-sheet-3col">
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Class</label>
                <input class="vtt-input" type="text" value="${d.class || ''}"
                       oninput="vttSheetEdit('class', this.value)">
            </div>
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Level</label>
                <input class="vtt-input" type="number" min="1" max="20" value="${d.level || 1}"
                       oninput="vttSheetEdit('level', +this.value)">
            </div>
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Prof Bonus</label>
                <input class="vtt-input" type="number" min="2" max="9" value="${prof}"
                       oninput="vttSheetEdit('proficiency_bonus', +this.value)">
            </div>
        </div>
        <div class="vtt-sheet-2col">
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Player Name</label>
                <input class="vtt-input" type="text" value="${d.player_name || ''}"
                       oninput="vttSheetEdit('player_name', this.value)">
            </div>
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Experience</label>
                <input class="vtt-input" type="number" value="${d.xp || 0}"
                       oninput="vttSheetEdit('xp', +this.value)">
            </div>
        </div>

        <!-- Combat stats -->
        <div class="vtt-sheet-section">Combat</div>
        <div class="vtt-sheet-3col">
            <div class="vtt-sheet-combat-box">
                <input class="vtt-input" type="number" value="${d.ac || 10}"
                       oninput="vttSheetEdit('ac', +this.value)">
                <label class="vtt-sheet-label">Armor Class</label>
            </div>
            <div class="vtt-sheet-combat-box">
                <input class="vtt-input" type="number" value="${d.initiative_bonus ?? mod(abs['dex'])}"
                       oninput="vttSheetEdit('initiative_bonus', +this.value)">
                <label class="vtt-sheet-label">Initiative</label>
            </div>
            <div class="vtt-sheet-combat-box">
                <input class="vtt-input" type="number" value="${d.speed || 30}"
                       oninput="vttSheetEdit('speed', +this.value)">
                <label class="vtt-sheet-label">Speed (ft)</label>
            </div>
        </div>
        <div class="vtt-sheet-3col">
            <div class="vtt-sheet-combat-box">
                <input class="vtt-input" type="number" value="${d.hp ?? 0}"
                       oninput="vttSheetEdit('hp', +this.value)">
                <label class="vtt-sheet-label">Current HP</label>
            </div>
            <div class="vtt-sheet-combat-box">
                <input class="vtt-input" type="number" value="${d.hp_max ?? 0}"
                       oninput="vttSheetEdit('hp_max', +this.value)">
                <label class="vtt-sheet-label">HP Max</label>
            </div>
            <div class="vtt-sheet-combat-box">
                <input class="vtt-input" type="number" value="${d.hp_temp ?? 0}"
                       oninput="vttSheetEdit('hp_temp', +this.value)">
                <label class="vtt-sheet-label">Temp HP</label>
            </div>
        </div>
        <div class="vtt-sheet-3col">
            <div class="vtt-sheet-combat-box">
                <input class="vtt-input" type="text" value="${d.hit_dice || '1d8'}"
                       oninput="vttSheetEdit('hit_dice', this.value)">
                <label class="vtt-sheet-label">Hit Dice</label>
            </div>
            <div class="vtt-sheet-combat-box" style="grid-column:span 2">
                <div class="vtt-sheet-passive" style="margin:0">
                    Passive Perception: <strong id="vttPassivePerc">${passPerc}</strong>
                </div>
            </div>
        </div>

        <!-- Death Saves -->
        <div class="vtt-sheet-section">Death Saves</div>
        <div class="vtt-sheet-death-saves">
            <div class="vtt-sheet-death-row">
                <span>Successes</span>
                ${[0,1,2].map(i => `<input type="checkbox" ${(d.death_saves_success||0) > i ? 'checked' : ''}
                    onchange="vttSheetDeathSave('success', ${i}, this.checked)">`).join('')}
            </div>
            <div class="vtt-sheet-death-row">
                <span>Failures</span>
                ${[0,1,2].map(i => `<input type="checkbox" ${(d.death_saves_fail||0) > i ? 'checked' : ''}
                    onchange="vttSheetDeathSave('fail', ${i}, this.checked)">`).join('')}
            </div>
        </div>

        <!-- Ability Scores -->
        <div class="vtt-sheet-section">Ability Scores</div>
        <div class="vtt-abilities">
            ${['str','dex','con','int','wis','cha'].map(abilityBox).join('')}
        </div>

        <!-- Saving Throws -->
        <div class="vtt-sheet-section">Saving Throws</div>
        <div class="vtt-save-list">
            ${['str','dex','con','int','wis','cha'].map(saveRow).join('')}
        </div>

        <!-- Skills -->
        <div class="vtt-sheet-section">Skills</div>
        <div class="vtt-save-list">
            ${_DND5E_SKILLS.map(skillRow).join('')}
        </div>

    </div>`;
}

// ── Tab: Actions ──────────────────────────────────────────────────────────────
function _dnd5eTabActions(char, d) {
    const attacks = d.attacks || [];
    return `<div class="vtt-sheet-body">

        <!-- Attacks -->
        <div class="vtt-sheet-section vtt-sheet-section-btn">
            <span>Attacks & Spellcasting</span>
            <button class="vtt-btn-sm" onclick="vttAddAttack()">+ Add</button>
        </div>
        <div id="vttAttackList">
            ${attacks.length ? attacks.map((atk,i) => `
            <div class="vtt-attack-row">
                <input class="vtt-input vtt-atk-name" type="text" value="${atk.name || ''}" placeholder="Name"
                       oninput="vttEditAttack(${i},'name',this.value)">
                <input class="vtt-input vtt-atk-stat" type="text" value="${atk.to_hit || ''}" placeholder="Hit"
                       oninput="vttEditAttack(${i},'to_hit',this.value)">
                <input class="vtt-input vtt-atk-stat" type="text" value="${atk.damage || ''}" placeholder="Dmg"
                       oninput="vttEditAttack(${i},'damage',this.value)">
                <button class="vtt-roll-btn" onclick="vttRollAttack('${atk.name}','${atk.to_hit}','${atk.damage}')">🎲</button>
                <button class="vtt-roll-btn" style="color:#ed4245" onclick="vttRemoveAttack(${i})">✕</button>
            </div>`).join('') : `<div class="vtt-empty">No attacks yet — click + Add to create one.</div>`}
        </div>

        <!-- Custom actions placeholder -->
        <div class="vtt-sheet-section">Other Actions</div>
        <textarea class="vtt-input vtt-sheet-textarea" rows="4"
                  placeholder="Bonus actions, reactions, special abilities…"
                  oninput="vttSheetEdit('custom_actions', this.value)">${d.custom_actions || ''}</textarea>

        <!-- Proficiencies & Languages -->
        <div class="vtt-sheet-section">Proficiencies & Languages</div>
        <textarea class="vtt-input vtt-sheet-textarea" placeholder="Armor, weapons, tools, languages…"
                  oninput="vttSheetEdit('proficiencies_text', this.value)">${d.proficiencies_text || ''}</textarea>

    </div>`;
}

// ── Tab: Spells ───────────────────────────────────────────────────────────────
function _dnd5eTabSpells(char, d) {
    const spells     = d.spells || {};
    const slots      = spells.slots || {};
    const spellList  = spells.list  || [];
    const spellAbil  = spells.ability     || '';
    const saveDC     = spells.save_dc     || '';
    const atkBonus   = spells.attack_bonus || '';

    const ABILITIES = ['str','dex','con','int','wis','cha'];
    const slotLevels = [1,2,3,4,5,6,7,8,9];

    // Group spells by level, tracking the global list index for each entry
    const byLevel = {};
    spellList.forEach((sp, globalIdx) => {
        const lvl = sp.level ?? 0;
        if (!byLevel[lvl]) byLevel[lvl] = [];
        byLevel[lvl].push({ ...sp, _globalIdx: globalIdx });
    });
    const levelLabel = l => l === 0 ? 'Cantrips' : `Level ${l}`;

    const spellRows = Object.keys(byLevel).sort((a,b) => a-b).map(lvl => `
        <div class="vtt-spell-level-header">${levelLabel(Number(lvl))}</div>
        ${byLevel[lvl].map(sp => `
        <div class="vtt-spell-row">
            <input type="checkbox" title="Prepared" ${sp.prepared ? 'checked' : ''}
                   onchange="vttSheetEditSpell(${sp._globalIdx},'prepared',this.checked)">
            <span style="font-size:12px">${sp.name || '—'}</span>
            <span style="color:var(--text-muted,#949ba4);font-size:11px">${sp.school || ''}</span>
            <span style="color:var(--text-muted,#949ba4);font-size:11px">${sp.components || ''}</span>
            <button class="vtt-roll-btn" title="Roll spell attack"
                    onclick="vttQuickRoll('${(sp.name||'Spell').replace(/'/g,'\\x27')} Atk','${atkBonus}')">🎲</button>
        </div>`).join('')}
    `).join('');

    return `<div class="vtt-sheet-body">

        <!-- Spellcasting info -->
        <div class="vtt-sheet-section">Spellcasting</div>
        <div class="vtt-sheet-3col">
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Ability</label>
                <select class="vtt-input" onchange="vttSheetEditNested('spells','ability',this.value)">
                    <option value="">—</option>
                    ${ABILITIES.map(a => `<option value="${a}" ${spellAbil===a?'selected':''}>${a.toUpperCase()}</option>`).join('')}
                </select>
            </div>
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Save DC</label>
                <input class="vtt-input" type="number" value="${saveDC}"
                       oninput="vttSheetEditNested('spells','save_dc',+this.value)">
            </div>
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Atk Bonus</label>
                <input class="vtt-input" type="text" value="${atkBonus}"
                       oninput="vttSheetEditNested('spells','attack_bonus',this.value)">
            </div>
        </div>

        <!-- Spell slots -->
        <div class="vtt-sheet-section">Spell Slots</div>
        <div class="vtt-spell-slots">
            ${slotLevels.map(lvl => {
                const sl = slots[lvl] || { total: 0, used: 0 };
                return `<div class="vtt-spell-slot-box">
                    <div class="vtt-slot-level">Level ${lvl}</div>
                    <div class="vtt-slot-inputs">
                        <input class="vtt-input" type="number" min="0" max="9" value="${sl.used ?? 0}" title="Used"
                               oninput="vttSheetEditSpellSlot(${lvl},'used',+this.value)">
                        <span>/</span>
                        <input class="vtt-input" type="number" min="0" max="9" value="${sl.total ?? 0}" title="Total"
                               oninput="vttSheetEditSpellSlot(${lvl},'total',+this.value)">
                    </div>
                </div>`;
            }).join('')}
        </div>

        <!-- Spell list -->
        <div class="vtt-sheet-section">
            <span>Spell List</span>
        </div>
        ${spellList.length
            ? `<div>${spellRows}</div>`
            : `<div class="vtt-empty" style="padding:12px 0">No spells yet. Import from DnDBeyond or add manually.</div>`}

    </div>`;
}

// ── Tab: Inventory ────────────────────────────────────────────────────────────
function _dnd5eTabInventory(char, d) {
    const items = d.inventory || [];
    const EQUIPPABLE = new Set(['Armor', 'Weapon', 'Other Gear']);

    const itemRows = items.map((item, i) => {
        const canEquip = EQUIPPABLE.has(item.type);
        const equippedChk = canEquip
            ? `<input type="checkbox" title="Equipped" ${item.equipped ? 'checked' : ''}
                   onchange="vttToggleInventoryEquip(${i}, this.checked)">`
            : `<span style="display:inline-block;width:16px"></span>`;
        return `
        <div class="vtt-inventory-row">
            ${equippedChk}
            <span class="vtt-inv-name">${item.name || '—'}</span>
            <span class="vtt-inv-qty" title="Quantity">×${item.quantity || 1}</span>
            <span class="vtt-inv-type">${item.type || ''}</span>
            <button class="vtt-roll-btn" style="color:#ed4245;flex-shrink:0"
                    onclick="vttRemoveInventoryItem(${i})">✕</button>
        </div>`;
    }).join('');

    return `<div class="vtt-sheet-body">

        <!-- Currency -->
        <div class="vtt-sheet-section">Currency</div>
        <div class="vtt-sheet-currency">
            ${['cp','sp','ep','gp','pp'].map(c => `
            <div class="vtt-sheet-combat-box">
                <input class="vtt-input" type="number" value="${(d.currency||{})[c] || 0}"
                       oninput="vttSheetEditNested('currency','${c}',+this.value)">
                <label class="vtt-sheet-label">${c.toUpperCase()}</label>
            </div>`).join('')}
        </div>

        <!-- Item list -->
        <div class="vtt-sheet-section vtt-sheet-section-btn">
            <span>Items</span>
            <button class="vtt-btn-sm" onclick="vttAddInventoryItem()">+ Add</button>
        </div>
        ${items.length
            ? `<div class="vtt-inventory-list">${itemRows}</div>`
            : `<div class="vtt-empty">No items. Click + Add or import from DnDBeyond.</div>`}

    </div>`;
}

// ── Tab: Features & Traits ────────────────────────────────────────────────────
function _dnd5eTabFeatures(char, d) {
    return `<div class="vtt-sheet-body">

        <div class="vtt-sheet-section">Features & Traits</div>
        <textarea class="vtt-input vtt-sheet-textarea" rows="8"
                  placeholder="Class features, racial traits, feats, special abilities…"
                  oninput="vttSheetEdit('features_traits', this.value)">${d.features_traits || d.features || ''}</textarea>

    </div>`;
}

// ── Tab: Background ───────────────────────────────────────────────────────────
function _dnd5eTabBackground(char, d) {
    return `<div class="vtt-sheet-body">

        <!-- Identity details -->
        <div class="vtt-sheet-section">Character Details</div>
        <div class="vtt-sheet-3col">
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Race</label>
                <input class="vtt-input" type="text" value="${d.race || ''}"
                       oninput="vttSheetEdit('race', this.value)">
            </div>
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Background</label>
                <input class="vtt-input" type="text" value="${d.background || ''}"
                       oninput="vttSheetEdit('background', this.value)">
            </div>
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Alignment</label>
                <input class="vtt-input" type="text" value="${d.alignment || ''}"
                       oninput="vttSheetEdit('alignment', this.value)">
            </div>
        </div>
        <div class="vtt-sheet-3col">
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Faith</label>
                <input class="vtt-input" type="text" value="${d.faith || ''}"
                       oninput="vttSheetEdit('faith', this.value)">
            </div>
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Age</label>
                <input class="vtt-input" type="text" value="${d.age || ''}"
                       oninput="vttSheetEdit('age', this.value)">
            </div>
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Gender</label>
                <input class="vtt-input" type="text" value="${d.gender || ''}"
                       oninput="vttSheetEdit('gender', this.value)">
            </div>
        </div>

        <!-- Physical appearance -->
        <div class="vtt-sheet-section">Appearance</div>
        <div class="vtt-sheet-3col">
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Height</label>
                <input class="vtt-input" type="text" value="${d.height || ''}"
                       oninput="vttSheetEdit('height', this.value)">
            </div>
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Weight</label>
                <input class="vtt-input" type="text" value="${d.weight || ''}"
                       oninput="vttSheetEdit('weight', this.value)">
            </div>
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Hair</label>
                <input class="vtt-input" type="text" value="${d.hair || ''}"
                       oninput="vttSheetEdit('hair', this.value)">
            </div>
        </div>
        <div class="vtt-sheet-3col">
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Eyes</label>
                <input class="vtt-input" type="text" value="${d.eyes || ''}"
                       oninput="vttSheetEdit('eyes', this.value)">
            </div>
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Skin</label>
                <input class="vtt-input" type="text" value="${d.skin || ''}"
                       oninput="vttSheetEdit('skin', this.value)">
            </div>
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Lifestyle</label>
                <input class="vtt-input" type="text" value="${d.lifestyle || ''}"
                       oninput="vttSheetEdit('lifestyle', this.value)">
            </div>
        </div>

        <!-- Personality -->
        <div class="vtt-sheet-section">Personality</div>
        <div class="vtt-sheet-field-group">
            <label class="vtt-sheet-label">Personality Traits</label>
            <textarea class="vtt-input vtt-sheet-textarea"
                      oninput="vttSheetEdit('personality_traits', this.value)">${d.personality_traits || ''}</textarea>
        </div>
        <div class="vtt-sheet-field-group">
            <label class="vtt-sheet-label">Ideals</label>
            <textarea class="vtt-input vtt-sheet-textarea"
                      oninput="vttSheetEdit('ideals', this.value)">${d.ideals || ''}</textarea>
        </div>
        <div class="vtt-sheet-field-group">
            <label class="vtt-sheet-label">Bonds</label>
            <textarea class="vtt-input vtt-sheet-textarea"
                      oninput="vttSheetEdit('bonds', this.value)">${d.bonds || ''}</textarea>
        </div>
        <div class="vtt-sheet-field-group">
            <label class="vtt-sheet-label">Flaws</label>
            <textarea class="vtt-input vtt-sheet-textarea"
                      oninput="vttSheetEdit('flaws', this.value)">${d.flaws || ''}</textarea>
        </div>

        <!-- Backstory -->
        <div class="vtt-sheet-section">Backstory</div>
        <textarea class="vtt-input vtt-sheet-textarea" rows="5" placeholder="Character backstory…"
                  oninput="vttSheetEdit('backstory', this.value)">${d.backstory || ''}</textarea>

    </div>`;
}

// ── Tab: Notes ────────────────────────────────────────────────────────────────
function _dnd5eTabNotes(char, d) {
    return `<div class="vtt-sheet-body">

        <div class="vtt-sheet-field-group">
            <label class="vtt-sheet-label">Organizations</label>
            <textarea class="vtt-input vtt-sheet-textarea" rows="3"
                      placeholder="Guilds, factions, groups…"
                      oninput="vttSheetEdit('notes_organizations', this.value)">${d.notes_organizations || ''}</textarea>
        </div>
        <div class="vtt-sheet-field-group">
            <label class="vtt-sheet-label">Allies</label>
            <textarea class="vtt-input vtt-sheet-textarea" rows="3"
                      placeholder="Friends, contacts, companions…"
                      oninput="vttSheetEdit('notes_allies', this.value)">${d.notes_allies || ''}</textarea>
        </div>
        <div class="vtt-sheet-field-group">
            <label class="vtt-sheet-label">Enemies</label>
            <textarea class="vtt-input vtt-sheet-textarea" rows="3"
                      placeholder="Rivals, foes, nemeses…"
                      oninput="vttSheetEdit('notes_enemies', this.value)">${d.notes_enemies || ''}</textarea>
        </div>
        <div class="vtt-sheet-field-group">
            <label class="vtt-sheet-label">Backstory</label>
            <textarea class="vtt-input vtt-sheet-textarea" rows="4"
                      placeholder="Character history and origin…"
                      oninput="vttSheetEdit('backstory', this.value)">${d.backstory || ''}</textarea>
        </div>
        <div class="vtt-sheet-field-group">
            <label class="vtt-sheet-label">Other Notes</label>
            <textarea class="vtt-input vtt-sheet-textarea" rows="4"
                      placeholder="Session notes, quest tracking, reminders…"
                      oninput="vttSheetEdit('notes_text', this.value)">${d.notes_text || ''}</textarea>
        </div>

    </div>`;
}

// ── Tab: Extras ───────────────────────────────────────────────────────────────
function _dnd5eTabExtras(char, d) {
    const exhaustion = d.exhaustion ?? 0;
    const EXHAUSTION_EFFECTS = [
        'No effect',
        'Disadvantage on ability checks',
        'Speed halved',
        'Disadvantage on attacks & saves',
        'HP maximum halved',
        'Speed reduced to 0',
        'Death',
    ];
    return `<div class="vtt-sheet-body">

        <!-- Inspiration -->
        <div class="vtt-sheet-section">Inspiration</div>
        <div style="display:flex;align-items:center;gap:10px;padding:4px 0 10px">
            <input type="checkbox" class="vtt-inspiration-check" id="vttInspChk" ${d.inspiration ? 'checked' : ''}
                   onchange="vttSheetEdit('inspiration', this.checked)">
            <label for="vttInspChk" style="cursor:pointer">Inspiration</label>
        </div>

        <!-- Exhaustion -->
        <div class="vtt-sheet-section">Exhaustion</div>
        <div style="margin-bottom:6px;font-size:12px;color:var(--text-muted,#949ba4)">
            Level ${exhaustion}${exhaustion > 0 ? ` — ${EXHAUSTION_EFFECTS[exhaustion]}` : ' — No effect'}
        </div>
        <div class="vtt-exhaustion-pips">
            ${[1,2,3,4,5,6].map(lvl => `
            <button class="vtt-exhaustion-pip ${exhaustion >= lvl ? 'active' : ''}"
                    title="Level ${lvl}: ${EXHAUSTION_EFFECTS[lvl]}"
                    onclick="vttSheetEdit('exhaustion', ${exhaustion === lvl ? lvl - 1 : lvl}); vttSetSheetTab('extras')"
            ></button>`).join('')}
        </div>
        <p style="font-size:11px;color:var(--text-muted,#949ba4);margin-top:6px">
            Click a pip to set exhaustion level. Click the active pip to reduce by one.
        </p>

    </div>`;
}

// ── Spell data helpers ────────────────────────────────────────────────────────

// Edit a field on a spell in spells.list by index
function vttSheetEditSpell(idx, field, value) {
    const myChar = _getMyChar();
    if (!myChar) return;
    const d = myChar.sheet_data || (myChar.sheet_data = {});
    if (!d.spells) d.spells = {};
    if (!d.spells.list) d.spells.list = [];
    if (!d.spells.list[idx]) return;
    d.spells.list[idx][field] = value;
    _debouncedSheetSave();
}

// Edit used/total on a spell slot level
function vttSheetEditSpellSlot(level, field, value) {
    const myChar = _getMyChar();
    if (!myChar) return;
    const d = myChar.sheet_data || (myChar.sheet_data = {});
    if (!d.spells) d.spells = {};
    if (!d.spells.slots) d.spells.slots = {};
    if (!d.spells.slots[level]) d.spells.slots[level] = { total: 0, used: 0 };
    d.spells.slots[level][field] = value;
    _debouncedSheetSave();
}

// ── Inventory helpers ─────────────────────────────────────────────────────────

function vttToggleInventoryEquip(idx, equipped) {
    const myChar = _getMyChar();
    if (!myChar) return;
    const d = myChar.sheet_data || (myChar.sheet_data = {});
    if (!d.inventory?.[idx]) return;
    d.inventory[idx].equipped = equipped;
    _debouncedSheetSave();
}

function vttRemoveInventoryItem(idx) {
    const myChar = _getMyChar();
    if (!myChar) return;
    const d = myChar.sheet_data || (myChar.sheet_data = {});
    if (!d.inventory) return;
    d.inventory.splice(idx, 1);
    _debouncedSheetSave();
    vttSetSheetTab('inventory');
}

function vttAddInventoryItem() {
    showModal({
        title: 'Add Item',
        inputType: 'text',
        inputPlaceholder: 'Item name',
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            { text: 'Add', style: 'primary', action: () => {
                const name = getModalInputValue().trim();
                if (!name) { showModalError('Please enter an item name'); return; }
                closeModal();
                const myChar = _getMyChar();
                if (!myChar) return;
                const d = myChar.sheet_data || (myChar.sheet_data = {});
                if (!d.inventory) d.inventory = [];
                d.inventory.push({ name, quantity: 1, equipped: false, type: '', weight: 0 });
                _debouncedSheetSave();
                vttSetSheetTab('inventory');
            }}
        ],
        onEnter: null
    });
}

// ── Main entry point ──────────────────────────────────────────────────────────

function _renderDnd5eSheet(char, d) {
    _injectDnd5eTabStyles();

    const tabBar = `
        <div class="vtt-tab-bar">
            ${_DND5E_TABS.map(t => `
            <button class="vtt-tab-btn ${_activeSheetTab === t.id ? 'vtt-tab-btn-active' : ''}"
                    data-tab="${t.id}"
                    onclick="vttSetSheetTab('${t.id}')">${t.label}</button>
            `).join('')}
        </div>`;

    return `${tabBar}<div id="vttSheetTabBody">${_dnd5eTabContent(_activeSheetTab, char, d)}</div>`;
}

const _PF2E_SKILLS = [
    { key:'acrobatics',  label:'Acrobatics',  ab:'dex' },
    { key:'arcana',      label:'Arcana',       ab:'int' },
    { key:'athletics',   label:'Athletics',    ab:'str' },
    { key:'crafting',    label:'Crafting',     ab:'int' },
    { key:'deception',   label:'Deception',    ab:'cha' },
    { key:'diplomacy',   label:'Diplomacy',    ab:'cha' },
    { key:'intimidation',label:'Intimidation', ab:'cha' },
    { key:'medicine',    label:'Medicine',     ab:'wis' },
    { key:'nature',      label:'Nature',       ab:'wis' },
    { key:'occultism',   label:'Occultism',    ab:'int' },
    { key:'performance', label:'Performance',  ab:'cha' },
    { key:'religion',    label:'Religion',     ab:'wis' },
    { key:'society',     label:'Society',      ab:'int' },
    { key:'stealth',     label:'Stealth',      ab:'dex' },
    { key:'survival',    label:'Survival',     ab:'wis' },
    { key:'thievery',    label:'Thievery',     ab:'dex' },
];

const _PF2E_RANKS = ['untrained','trained','expert','master','legendary'];
const _PF2E_RANK_LABELS = { untrained:'U', trained:'T', expert:'E', master:'M', legendary:'L' };

function _pf2eBonus(lvl, rankName, abilMod) {
    if (!rankName || rankName === 'untrained') return abilMod;
    const bonus = { trained: lvl + 2, expert: lvl + 4, master: lvl + 6, legendary: lvl + 8 };
    return abilMod + (bonus[rankName] ?? 0);
}

function _pf2eRankSelect(field, current, onchangeFn) {
    return `<select class="vtt-rank-select" onchange="${onchangeFn}">
        ${_PF2E_RANKS.map(r => `<option value="${r}" ${r === (current||'untrained') ? 'selected' : ''}>${_PF2E_RANK_LABELS[r]}</option>`).join('')}
    </select>`;
}

function _renderPf2eSheet(char, d) {
    const abs  = d.ability_scores || {};
    const profs = d.pf2e_profs || {};
    const mod  = s => Math.floor(((s || 10) - 10) / 2);
    const fmt  = n => n >= 0 ? `+${n}` : `${n}`;
    const lvl  = d.level || 1;

    const abilityBox = (key) => {
        const score = abs[key] || 10;
        const m = mod(score);
        return `
        <div class="vtt-ability">
            <div class="vtt-ability-name">${key.toUpperCase()}</div>
            <div class="vtt-ability-mod" id="vttMod_${key}">${fmt(m)}</div>
            <input type="number" class="vtt-ability-score-input" min="1" max="30" value="${score}"
                   oninput="vttSheetEditScore('${key}', +this.value)">
            <button class="vtt-roll-btn" id="vttAbilBtn_${key}"
                    onclick="vttRollAbility('${key}',${m})">🎲</button>
        </div>`;
    };

    const saveRow = (sv, abKey) => {
        const rank  = profs[`save_${sv}`] || 'untrained';
        const bonus = _pf2eBonus(lvl, rank, mod(abs[abKey]));
        return `<div class="vtt-save-row">
            ${_pf2eRankSelect(`save_${sv}`, rank, `vttSheetEditNested('pf2e_profs','save_${sv}',this.value);vttPf2eRefreshSave('${sv}')`)}
            <span class="vtt-save-row-name">${sv === 'fort' ? 'Fortitude' : sv === 'ref' ? 'Reflex' : 'Will'} <span class="vtt-skill-ab">(${abKey.toUpperCase()})</span></span>
            <span id="vttPf2eSave_${sv}">${fmt(bonus)}</span>
            <button class="vtt-roll-btn" id="vttPf2eSaveBtn_${sv}"
                    onclick="vttRollSave('${sv}',${bonus})">🎲</button>
        </div>`;
    };

    const percRank  = profs['perception'] || 'untrained';
    const percBonus = _pf2eBonus(lvl, percRank, mod(abs['wis']));

    const skillRow = (sk) => {
        const rank  = profs[sk.key] || 'untrained';
        const bonus = _pf2eBonus(lvl, rank, mod(abs[sk.ab]));
        return `<div class="vtt-save-row">
            ${_pf2eRankSelect(sk.key, rank, `vttSheetEditNested('pf2e_profs','${sk.key}',this.value);vttPf2eRefreshSkill('${sk.key}')`)}
            <span class="vtt-save-row-name">${sk.label} <span class="vtt-skill-ab">(${sk.ab.toUpperCase()})</span></span>
            <span id="vttPf2eSkill_${sk.key}">${fmt(bonus)}</span>
            <button class="vtt-roll-btn" onclick="vttRollSkill('${sk.label}','${sk.ab}',${bonus})">🎲</button>
        </div>`;
    };

    const lore1Rank  = profs['lore1'] || 'untrained';
    const lore1Bonus = _pf2eBonus(lvl, lore1Rank, mod(abs['int']));
    const lore2Rank  = profs['lore2'] || 'untrained';
    const lore2Bonus = _pf2eBonus(lvl, lore2Rank, mod(abs['int']));

    const classDCRank  = profs['class_dc'] || 'untrained';
    const keyAbMod     = mod(abs[d.key_ability || 'str']);
    const classDC      = 10 + lvl + (classDCRank !== 'untrained' ? { trained:2, expert:4, master:6, legendary:8 }[classDCRank] ?? 0 : 0) + keyAbMod;

    const attacks = d.attacks || [];

    return `
        <div class="vtt-sheet-body">

            <!-- Identity -->
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Character Name</label>
                <input class="vtt-input vtt-sheet-full" type="text" value="${char.name || ''}"
                       oninput="vttSheetEdit('_name', this.value)">
            </div>
            <div class="vtt-sheet-3col">
                <div class="vtt-sheet-field-group">
                    <label class="vtt-sheet-label">Class</label>
                    <input class="vtt-input" type="text" value="${d.class || ''}"
                           oninput="vttSheetEdit('class', this.value)">
                </div>
                <div class="vtt-sheet-field-group">
                    <label class="vtt-sheet-label">Level</label>
                    <input class="vtt-input" type="number" min="1" max="20" value="${lvl}"
                           oninput="vttSheetEdit('level', +this.value)">
                </div>
                <div class="vtt-sheet-field-group">
                    <label class="vtt-sheet-label">Key Ability</label>
                    <select class="vtt-input" oninput="vttSheetEdit('key_ability', this.value)">
                        ${['str','dex','con','int','wis','cha'].map(a =>
                            `<option value="${a}" ${(d.key_ability||'str') === a ? 'selected':''}>${a.toUpperCase()}</option>`
                        ).join('')}
                    </select>
                </div>
            </div>
            <div class="vtt-sheet-3col">
                <div class="vtt-sheet-field-group">
                    <label class="vtt-sheet-label">Ancestry</label>
                    <input class="vtt-input" type="text" value="${d.ancestry || ''}"
                           oninput="vttSheetEdit('ancestry', this.value)">
                </div>
                <div class="vtt-sheet-field-group">
                    <label class="vtt-sheet-label">Heritage</label>
                    <input class="vtt-input" type="text" value="${d.heritage || ''}"
                           oninput="vttSheetEdit('heritage', this.value)">
                </div>
                <div class="vtt-sheet-field-group">
                    <label class="vtt-sheet-label">Background</label>
                    <input class="vtt-input" type="text" value="${d.background || ''}"
                           oninput="vttSheetEdit('background', this.value)">
                </div>
            </div>
            <div class="vtt-sheet-3col">
                <div class="vtt-sheet-field-group">
                    <label class="vtt-sheet-label">Deity</label>
                    <input class="vtt-input" type="text" value="${d.deity || ''}"
                           oninput="vttSheetEdit('deity', this.value)">
                </div>
                <div class="vtt-sheet-field-group">
                    <label class="vtt-sheet-label">Alignment</label>
                    <input class="vtt-input" type="text" value="${d.alignment || ''}"
                           oninput="vttSheetEdit('alignment', this.value)">
                </div>
                <div class="vtt-sheet-field-group">
                    <label class="vtt-sheet-label">Player</label>
                    <input class="vtt-input" type="text" value="${d.player_name || ''}"
                           oninput="vttSheetEdit('player_name', this.value)">
                </div>
            </div>

            <!-- Combat -->
            <div class="vtt-sheet-section">Combat</div>
            <div class="vtt-sheet-3col">
                <div class="vtt-sheet-combat-box">
                    <input class="vtt-input" type="number" value="${d.hp ?? 0}"
                           oninput="vttSheetEdit('hp', +this.value)">
                    <label class="vtt-sheet-label">Current HP</label>
                </div>
                <div class="vtt-sheet-combat-box">
                    <input class="vtt-input" type="number" value="${d.hp_max ?? 0}"
                           oninput="vttSheetEdit('hp_max', +this.value)">
                    <label class="vtt-sheet-label">Max HP</label>
                </div>
                <div class="vtt-sheet-combat-box">
                    <input class="vtt-input" type="number" value="${d.hp_temp ?? 0}"
                           oninput="vttSheetEdit('hp_temp', +this.value)">
                    <label class="vtt-sheet-label">Temp HP</label>
                </div>
            </div>
            <div class="vtt-sheet-3col">
                <div class="vtt-sheet-combat-box">
                    <input class="vtt-input" type="number" value="${d.ac ?? 10}"
                           oninput="vttSheetEdit('ac', +this.value)">
                    <label class="vtt-sheet-label">AC</label>
                </div>
                <div class="vtt-sheet-combat-box">
                    <input class="vtt-input" type="number" value="${d.speed ?? 25}"
                           oninput="vttSheetEdit('speed', +this.value)">
                    <label class="vtt-sheet-label">Speed (ft)</label>
                </div>
                <div class="vtt-sheet-combat-box">
                    <input class="vtt-input" type="number" min="0" max="3" value="${d.hero_points ?? 1}"
                           oninput="vttSheetEdit('hero_points', +this.value)">
                    <label class="vtt-sheet-label">Hero Points</label>
                </div>
            </div>
            <div class="vtt-sheet-3col">
                <div class="vtt-sheet-combat-box">
                    <div style="display:flex;align-items:center;gap:4px;justify-content:center">
                        ${_pf2eRankSelect('class_dc', classDCRank, `vttSheetEditNested('pf2e_profs','class_dc',this.value)`)}
                        <span id="vttPf2eClassDC">${classDC}</span>
                    </div>
                    <label class="vtt-sheet-label">Class DC</label>
                </div>
                <div class="vtt-sheet-combat-box">
                    <input class="vtt-input" type="number" value="${d.shield_hp ?? 0}"
                           oninput="vttSheetEdit('shield_hp', +this.value)">
                    <label class="vtt-sheet-label">Shield HP</label>
                </div>
                <div class="vtt-sheet-combat-box">
                    <input class="vtt-input" type="number" value="${d.shield_bt ?? 0}"
                           oninput="vttSheetEdit('shield_bt', +this.value)">
                    <label class="vtt-sheet-label">Shield BT</label>
                </div>
            </div>

            <!-- Ability Scores -->
            <div class="vtt-sheet-section">Ability Scores</div>
            <div class="vtt-abilities">
                ${['str','dex','con','int','wis','cha'].map(abilityBox).join('')}
            </div>

            <!-- Perception -->
            <div class="vtt-sheet-section">Perception</div>
            <div class="vtt-save-row">
                ${_pf2eRankSelect('perception', percRank, `vttSheetEditNested('pf2e_profs','perception',this.value);vttPf2eRefreshSkill('perception')`)}
                <span class="vtt-save-row-name">Perception <span class="vtt-skill-ab">(WIS)</span></span>
                <span id="vttPf2eSkill_perception">${fmt(percBonus)}</span>
                <button class="vtt-roll-btn" onclick="vttRollSkill('Perception','wis',${percBonus})">🎲</button>
            </div>

            <!-- Saving Throws -->
            <div class="vtt-sheet-section">Saving Throws</div>
            <div class="vtt-save-list">
                ${saveRow('fort','con')}
                ${saveRow('ref','dex')}
                ${saveRow('will','wis')}
            </div>

            <!-- Skills -->
            <div class="vtt-sheet-section">Skills</div>
            <div class="vtt-save-list">
                ${_PF2E_SKILLS.map(skillRow).join('')}
                <div class="vtt-save-row">
                    ${_pf2eRankSelect('lore1', lore1Rank, `vttSheetEditNested('pf2e_profs','lore1',this.value)`)}
                    <input class="vtt-input vtt-save-row-name" type="text" value="${d.lore1_name || ''}" placeholder="Lore (name)…"
                           oninput="vttSheetEdit('lore1_name', this.value)" style="height:22px;padding:1px 4px">
                    <span id="vttPf2eSkill_lore1">${fmt(lore1Bonus)}</span>
                    <button class="vtt-roll-btn" onclick="vttRollSkill(document.getElementById('vttLore1Name')?.value||'Lore','int',${lore1Bonus})">🎲</button>
                </div>
                <div class="vtt-save-row">
                    ${_pf2eRankSelect('lore2', lore2Rank, `vttSheetEditNested('pf2e_profs','lore2',this.value)`)}
                    <input class="vtt-input vtt-save-row-name" type="text" value="${d.lore2_name || ''}" placeholder="Lore (name)…"
                           oninput="vttSheetEdit('lore2_name', this.value)" style="height:22px;padding:1px 4px">
                    <span id="vttPf2eSkill_lore2">${fmt(lore2Bonus)}</span>
                    <button class="vtt-roll-btn" onclick="vttRollSkill(document.getElementById('vttLore2Name')?.value||'Lore','int',${lore2Bonus})">🎲</button>
                </div>
            </div>

            <!-- Attacks -->
            <div class="vtt-sheet-section vtt-sheet-section-btn">
                <span>Attacks & Strikes</span>
                <button class="vtt-btn-sm" onclick="vttAddAttack()">+ Add</button>
            </div>
            <div id="vttAttackList">
                ${attacks.length ? attacks.map((atk,i) => `
                <div class="vtt-attack-row">
                    <input class="vtt-input vtt-atk-name" type="text" value="${atk.name || ''}" placeholder="Name"
                           oninput="vttEditAttack(${i},'name',this.value)">
                    <input class="vtt-input vtt-atk-stat" type="text" value="${atk.to_hit || ''}" placeholder="Hit"
                           oninput="vttEditAttack(${i},'to_hit',this.value)">
                    <input class="vtt-input vtt-atk-stat" type="text" value="${atk.damage || ''}" placeholder="Dmg"
                           oninput="vttEditAttack(${i},'damage',this.value)">
                    <button class="vtt-roll-btn" onclick="vttRollAttack('${atk.name}','${atk.to_hit}','${atk.damage}')">🎲</button>
                    <button class="vtt-roll-btn" style="color:#ed4245" onclick="vttRemoveAttack(${i})">✕</button>
                </div>`).join('') : `<div class="vtt-empty">No attacks</div>`}
            </div>

            <!-- Equipment -->
            <div class="vtt-sheet-section">Bulk & Currency</div>
            <div class="vtt-sheet-3col">
                <div class="vtt-sheet-field-group">
                    <label class="vtt-sheet-label">Bulk Carried</label>
                    <input class="vtt-input" type="text" value="${d.bulk_carried ?? ''}"
                           oninput="vttSheetEdit('bulk_carried', this.value)">
                </div>
                <div class="vtt-sheet-field-group">
                    <label class="vtt-sheet-label">Bulk Limit</label>
                    <input class="vtt-input" type="text" value="${d.bulk_limit ?? ''}"
                           oninput="vttSheetEdit('bulk_limit', this.value)">
                </div>
                <div class="vtt-sheet-field-group">
                    <label class="vtt-sheet-label">Resonance</label>
                    <input class="vtt-input" type="number" value="${d.resonance ?? 0}"
                           oninput="vttSheetEdit('resonance', +this.value)">
                </div>
            </div>
            <div class="vtt-sheet-currency">
                ${['cp','sp','gp','pp'].map(c => `
                <div class="vtt-sheet-combat-box">
                    <input class="vtt-input" type="number" value="${(d.currency||{})[c] || 0}"
                           oninput="vttSheetEditNested('currency','${c}',+this.value)">
                    <label class="vtt-sheet-label">${c.toUpperCase()}</label>
                </div>`).join('')}
            </div>
            <textarea class="vtt-input vtt-sheet-textarea" placeholder="Equipment & items…"
                      oninput="vttSheetEdit('equipment', this.value)">${d.equipment || ''}</textarea>

            <!-- Feats & Abilities -->
            <div class="vtt-sheet-section">Feats & Class Abilities</div>
            <textarea class="vtt-input vtt-sheet-textarea" rows="4" placeholder="Feats, class features, ancestry abilities…"
                      oninput="vttSheetEdit('features', this.value)">${d.features || ''}</textarea>

            <!-- Languages & Proficiencies -->
            <div class="vtt-sheet-section">Languages & Proficiencies</div>
            <textarea class="vtt-input vtt-sheet-textarea" placeholder="Languages, armor proficiencies, weapon proficiencies…"
                      oninput="vttSheetEdit('proficiencies_text', this.value)">${d.proficiencies_text || ''}</textarea>

            <!-- Personality -->
            <div class="vtt-sheet-section">Personality & Backstory</div>
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Personality & Goals</label>
                <textarea class="vtt-input vtt-sheet-textarea"
                          oninput="vttSheetEdit('personality_traits', this.value)">${d.personality_traits || ''}</textarea>
            </div>
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Backstory</label>
                <textarea class="vtt-input vtt-sheet-textarea" rows="3"
                          oninput="vttSheetEdit('backstory', this.value)">${d.backstory || ''}</textarea>
            </div>
            <div class="vtt-sheet-field-group">
                <label class="vtt-sheet-label">Notes</label>
                <textarea class="vtt-input vtt-sheet-textarea"
                          oninput="vttSheetEdit('notes', this.value)">${d.notes || ''}</textarea>
            </div>

        </div>`;
}

// ── Sheet Roll Helpers ────────────────────────────────────────────────────────

function vttRollAbility(ability, mod) {
    _quickRoll(`${ability.toUpperCase()} Check`, `1d20${mod >= 0 ? '+' : ''}${mod}`);
}

function vttRollSave(ability, bonus) {
    _quickRoll(`${ability.toUpperCase()} Save`, `1d20${bonus >= 0 ? '+' : ''}${bonus}`);
}

function vttRollSkill(label, ability, bonus) {
    _quickRoll(`${label} (${ability.toUpperCase()})`, `1d20${bonus >= 0 ? '+' : ''}${bonus}`);
}

function vttRollAttack(name, toHit, damage) {
    _quickRoll(`${name} Attack`, `1d20${toHit}`);
    _quickRoll(`${name} Damage`, damage);
}

function vttQuickRoll(label, bonus) {
    _quickRoll(label, `1d20${bonus >= 0 ? '+' : ''}${bonus}`);
}

function _quickRoll(label, notation) {
    if (!_vttChannel) return;
    const parsed = _parseDiceNotation(notation, _vttDiceTheme);
    if (!parsed.dice.length) {
        _logRoll({ user: { username: state.currentUser?.username || 'You' } }, 0, `${label}: ${notation}`);
        return;
    }
    if (!_dddice) {
        _postRollToServer(_simRoll(parsed), 0, `${label}: ${notation}`);
        return;
    }
    // Queue this roll's modifier and formatted notation for when the roll event fires
    _pendingRolls.push({ modifier: parsed.modifier, notation: `${label}: ${notation}` });
    try {
        _dddice.roll(parsed.dice);
    } catch (e) {
        _pendingRolls.pop();
        console.warn('[VTT] Roll error:', e);
    }
}

// ── Create Character ──────────────────────────────────────────────────────────

function vttCreateCharPrompt() {
    if (!_vttChannel) return;

    const nameInput = document.getElementById('charNameInput');
    const systemSelect = document.getElementById('charSystemSelect');
    const modalError = document.getElementById('modalError');

    // Create customHTML for the modal (only once; we'll show it)
    const customHTML = `
        <div style="margin-bottom:12px">
            <label style="display:block;margin-bottom:4px;font-weight:600">Name:</label>
            <input type="text" id="charNameInput" class="modal-input" placeholder="Character name" style="width:100%">
        </div>
        <div>
            <label style="display:block;margin-bottom:4px;font-weight:600">System:</label>
            <select id="charSystemSelect" class="modal-input" style="width:100%">
                <option value="generic">Generic</option>
                <option value="dnd5e">D&D 5e</option>
                <option value="pf2e">Pathfinder 2e</option>
            </select>
        </div>
    `;

    // Reset fields each time
    setTimeout(() => {
        if (nameInput) nameInput.value = '';
        if (systemSelect) systemSelect.value = 'generic';
        if (modalError) modalError.style.display = 'none';
    }, 0);

    showModal({
        title: 'Create Character',
        customHTML,
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            { text: 'Create', style: 'primary', action: () => {
                const name = document.getElementById('charNameInput')?.value.trim();
                const system = document.getElementById('charSystemSelect')?.value || 'generic';
                if (!name) {
                    modalError.textContent = 'Please enter a name';
                    modalError.style.display = 'block';
                    return;
                }
                closeModal();
                _executeCreateCharacter(name, system);
            }}
        ]
    });
}

function _executeCreateCharacter(name, system) {
    if (!_vttChannel) return;
    fetch(`/api/vtt/${_vttChannel.id}/characters`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, system, sheet_data: {} })
    }).then(r => r.json()).then(({ character }) => {
        if (character) {
            if (!_vttSession) _vttSession = { characters: [] };
            _vttSession.characters = [...(_vttSession.characters || []), character];
            _activeSheetTab = 'main';
            _renderSheet();
        }
    });
}

// ── DnDBeyond Import ──────────────────────────────────────────────────────────

function vttImportDndbeyond(existingCharId) {
    if (!_vttChannel) return;

    showModal({
        title: existingCharId ? 'Re-import from DnDBeyond' : 'Import from DnDBeyond',
        message: 'Paste your DnDBeyond character URL or bare character ID. The character must be set to public.',
        inputType: 'text',
        inputPlaceholder: 'https://www.dndbeyond.com/characters/158808663',
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            {
                text: existingCharId ? 'Re-import' : 'Import',
                style: 'primary',
                action: async () => {
                    const raw = getModalInputValue().trim();
                    if (!raw) { showModalError('Please enter a character URL or ID'); return; }

                    // Accept full URL or bare ID
                    const match = raw.match(/(\d+)/);
                    if (!match) { showModalError('Could not find a character ID in that input'); return; }
                    const characterId = match[1];

                    closeModal();
                    try {
                        const res = await fetch(`/api/vtt/${_vttChannel.id}/characters/import-dndbeyond`, {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ characterId, charId: existingCharId || undefined })
                        });
                        const data = await res.json();
                        if (!res.ok) {
                            showModal({
                                title: 'Import Failed',
                                message: data.error || 'Something went wrong.',
                                buttons: [{ text: 'OK', style: 'primary', action: closeModal }]
                            });
                            return;
                        }
                        const { character } = data;
                        if (!_vttSession) _vttSession = { characters: [] };
                        if (existingCharId) {
                            _vttSession.characters = _vttSession.characters.map(c =>
                                c.id === existingCharId ? character : c
                            );
                        } else {
                            _vttSession.characters = [...(_vttSession.characters || []), character];
                        }
                        _renderSheet();
                        showToast(`${character.name} imported!`, 'success');
                    } catch (e) {
                        console.error('[VTT] DnDBeyond import error:', e);
                        showModal({
                            title: 'Import Failed',
                            message: 'Network error. Please try again.',
                            buttons: [{ text: 'OK', style: 'primary', action: closeModal }]
                        });
                    }
                }
            }
        ],
        onEnter: null  // don't fire on Enter — accidental submit risk
    });
}

// ── Sheet edit helpers ────────────────────────────────────────────────────────

let _sheetSaveTimer  = null;
let _activeSheetTab  = 'main';   // persists across re-renders; resets on new char creation
let _dnd5eTabStyleOk = false;    // CSS injection guard

function _getMyChar() {
    return (_vttSession?.characters || []).find(c => c.user_id === state.currentUser?.id) || null;
}

function _debouncedSheetSave() {
    if (_sheetSaveTimer) clearTimeout(_sheetSaveTimer);
    _sheetSaveTimer = setTimeout(async () => {
        const myChar = _getMyChar();
        if (!myChar || !_vttChannel) return;
        try {
            await fetch(`/api/vtt/${_vttChannel.id}/characters/${myChar.id}`, {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: myChar.name, sheet_data: myChar.sheet_data })
            });
        } catch(e) { console.warn('[VTT] Sheet save failed:', e); }
    }, 800);
}

function vttSheetEdit(field, value) {
    const myChar = _getMyChar();
    if (!myChar) return;
    if (!myChar.sheet_data) myChar.sheet_data = {};
    if (field === '_name') {
        myChar.name = value;
    } else {
        myChar.sheet_data[field] = value;
    }
    _debouncedSheetSave();
}

function vttSheetEditNested(parent, key, value) {
    const myChar = _getMyChar();
    if (!myChar) return;
    if (!myChar.sheet_data) myChar.sheet_data = {};
    if (!myChar.sheet_data[parent]) myChar.sheet_data[parent] = {};
    myChar.sheet_data[parent][key] = value;
    _debouncedSheetSave();
}

function vttSheetToggle(arrayField, key) {
    const myChar = _getMyChar();
    if (!myChar) return;
    const d = myChar.sheet_data || (myChar.sheet_data = {});
    const arr = d[arrayField] || [];
    const idx = arr.indexOf(key);
    if (idx === -1) arr.push(key); else arr.splice(idx, 1);
    d[arrayField] = arr;
    // Update relevant bonus displays
    const prof = d.proficiency_bonus || 2;
    const abs  = d.ability_scores || {};
    const modv = s => Math.floor(((s || 10) - 10) / 2);
    const fmt  = n => n >= 0 ? `+${n}` : `${n}`;
    if (arrayField === 'saving_throw_profs') {
        const bonus = modv(abs[key]) + (arr.includes(key) ? prof : 0);
        const el = document.getElementById(`vttSaveBonus_${key}`);
        const btn = document.getElementById(`vttSaveBtn_${key}`);
        if (el) el.textContent = fmt(bonus);
        if (btn) btn.setAttribute('onclick', `vttRollSave('${key}',${bonus})`);
    } else if (arrayField === 'skill_profs') {
        const sk = _DND5E_SKILLS.find(s => s.key === key);
        if (sk) {
            const bonus = modv(abs[sk.ab]) + (arr.includes(key) ? prof : 0);
            const el = document.getElementById(`vttSkillBonus_${key}`);
            if (el) el.textContent = fmt(bonus);
            if (sk.key === 'perception') {
                const pp = document.getElementById('vttPassivePerc');
                if (pp) pp.textContent = 10 + bonus;
            }
        }
    }
    _debouncedSheetSave();
}

function vttSheetEditScore(ability, value) {
    const myChar = _getMyChar();
    if (!myChar) return;
    const d = myChar.sheet_data || (myChar.sheet_data = {});
    if (!d.ability_scores) d.ability_scores = {};
    d.ability_scores[ability] = value;
    // Update modifier display
    const m = Math.floor(((value || 10) - 10) / 2);
    const fmt = n => n >= 0 ? `+${n}` : `${n}`;
    const modEl = document.getElementById(`vttMod_${ability}`);
    if (modEl) modEl.textContent = fmt(m);
    const btn = document.getElementById(`vttAbilBtn_${ability}`);
    if (btn) btn.setAttribute('onclick', `vttRollAbility('${ability}',${m})`);
    // Update saving throw if this ability has one
    const prof = d.proficiency_bonus || 2;
    const saves = d.saving_throw_profs || [];
    const sBonus = m + (saves.includes(ability) ? prof : 0);
    const sEl = document.getElementById(`vttSaveBonus_${ability}`);
    if (sEl) sEl.textContent = fmt(sBonus);
    const sBtn = document.getElementById(`vttSaveBtn_${ability}`);
    if (sBtn) sBtn.setAttribute('onclick', `vttRollSave('${ability}',${sBonus})`);
    // Update skills that use this ability
    const skillProfs = d.skill_profs || [];
    _DND5E_SKILLS.filter(s => s.ab === ability).forEach(sk => {
        const skBonus = m + (skillProfs.includes(sk.key) ? prof : 0);
        const skEl = document.getElementById(`vttSkillBonus_${sk.key}`);
        if (skEl) skEl.textContent = fmt(skBonus);
        if (sk.key === 'perception') {
            const pp = document.getElementById('vttPassivePerc');
            if (pp) pp.textContent = 10 + skBonus;
        }
    });
    _debouncedSheetSave();
}

// PF2e live bonus refresh (called from rank select onchange)
function vttPf2eRefreshSave(sv) {
    const myChar = _getMyChar();
    if (!myChar) return;
    const d = myChar.sheet_data || {};
    const abs = d.ability_scores || {};
    const lvl = d.level || 1;
    const abKey = sv === 'fort' ? 'con' : sv === 'ref' ? 'dex' : 'wis';
    const rank = (d.pf2e_profs || {})[`save_${sv}`] || 'untrained';
    const bonus = _pf2eBonus(lvl, rank, Math.floor(((abs[abKey] || 10) - 10) / 2));
    const fmt = n => n >= 0 ? `+${n}` : `${n}`;
    const el = document.getElementById(`vttPf2eSave_${sv}`);
    if (el) el.textContent = fmt(bonus);
    const btn = document.getElementById(`vttPf2eSaveBtn_${sv}`);
    if (btn) btn.setAttribute('onclick', `vttRollSave('${sv}',${bonus})`);
}

function vttPf2eRefreshSkill(key) {
    const myChar = _getMyChar();
    if (!myChar) return;
    const d = myChar.sheet_data || {};
    const abs = d.ability_scores || {};
    const lvl = d.level || 1;
    const sk = key === 'perception'
        ? { ab: 'wis' }
        : _PF2E_SKILLS.find(s => s.key === key) || { ab: 'int' };
    const rank = (d.pf2e_profs || {})[key] || 'untrained';
    const bonus = _pf2eBonus(lvl, rank, Math.floor(((abs[sk.ab] || 10) - 10) / 2));
    const fmt = n => n >= 0 ? `+${n}` : `${n}`;
    const el = document.getElementById(`vttPf2eSkill_${key}`);
    if (el) el.textContent = fmt(bonus);
}

function vttSheetDeathSave(type, index, checked) {
    const myChar = _getMyChar();
    if (!myChar) return;
    const d = myChar.sheet_data || (myChar.sheet_data = {});
    const field = type === 'success' ? 'death_saves_success' : 'death_saves_fail';
    // Count = highest checked index + 1
    d[field] = checked ? index + 1 : index;
    _debouncedSheetSave();
}

function vttAddAttack() {
    const myChar = _getMyChar();
    if (!myChar) return;
    const d = myChar.sheet_data || (myChar.sheet_data = {});
    if (!d.attacks) d.attacks = [];
    d.attacks.push({ name: '', to_hit: '+0', damage: '1d6' });
    _debouncedSheetSave();
    _renderSheet();
}

function vttRemoveAttack(idx) {
    const myChar = _getMyChar();
    if (!myChar) return;
    const d = myChar.sheet_data || {};
    if (!d.attacks) return;
    d.attacks.splice(idx, 1);
    _debouncedSheetSave();
    _renderSheet();
}

function vttEditAttack(idx, field, value) {
    const myChar = _getMyChar();
    if (!myChar) return;
    const d = myChar.sheet_data || {};
    if (!d.attacks?.[idx]) return;
    d.attacks[idx][field] = value;
    _debouncedSheetSave();
}

// Keep legacy vttUpdateSheetField for any remaining callers
function vttUpdateSheetField(field, value) {
    vttSheetEdit(field, value);
}

async function vttDeleteCharacter(charId) {
    if (!_vttChannel || !_vttSession) return;
    const chars = _vttSession.characters || [];
    const char = chars.find(c => c.id === charId);
    if (!char) return;

    showModal({
        title: 'Delete Character',
        message: `Delete "${char.name}"? This action cannot be undone.`,
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            {
                text: 'Delete',
                style: 'danger',
                action: async () => {
                    closeModal();
                    try {
                        const res = await fetch(`/api/vtt/${_vttChannel.id}/characters/${charId}`, {
                            method: 'DELETE',
                            credentials: 'include'
                        });
                        if (res.ok) {
                            _vttSession.characters = chars.filter(c => c.id !== charId);
                            _renderSheet();
                        } else {
                            const err = await res.json();
                            showModal({
                                title: 'Error',
                                message: err.error || 'Failed to delete character',
                                buttons: [{ text: 'OK', style: 'primary', action: closeModal }]
                            });
                        }
                    } catch (e) {
                        console.error('[VTT] Delete character error:', e);
                        showModal({
                            title: 'Error',
                            message: 'Network error. Please try again.',
                            buttons: [{ text: 'OK', style: 'primary', action: closeModal }]
                        });
                    }
                }
            }
        ]
    });
}

// ── Dice Builder ──────────────────────────────────────────────────────────────

function vttBuilderAdjust(type, delta) {
    _diceBuilder[type] = Math.max(0, (_diceBuilder[type] || 0) + delta);
    const el = document.getElementById(`vttDie_${type}`);
    if (el) el.textContent = _diceBuilder[type];
    if (el) el.classList.toggle('vtt-die-count-active', _diceBuilder[type] > 0);
}

function vttBuilderModAdjust(delta) {
    _diceBuilder.modifier = (_diceBuilder.modifier || 0) + delta;
    const el = document.getElementById('vttBuilderModVal');
    if (el) el.textContent = (_diceBuilder.modifier >= 0 ? '+' : '') + _diceBuilder.modifier;
}

function vttClearBuilder() {
    ['d4','d6','d8','d10','d12','d20','d100'].forEach(t => {
        _diceBuilder[t] = 0;
        const el = document.getElementById(`vttDie_${t}`);
        if (el) { el.textContent = '0'; el.classList.remove('vtt-die-count-active'); }
    });
    _diceBuilder.modifier = 0;
    const modEl = document.getElementById('vttBuilderModVal');
    if (modEl) modEl.textContent = '+0';
}

function vttRollBuilder() {
    const parts = [];
    for (const t of ['d4','d6','d8','d10','d12','d20','d100']) {
        if (_diceBuilder[t] > 0) parts.push(`${_diceBuilder[t]}${t}`);
    }
    if (!parts.length) return;
    let notation = parts.join('+');
    if (_diceBuilder.modifier !== 0) notation += (_diceBuilder.modifier > 0 ? '+' : '') + _diceBuilder.modifier;
    _executeRoll(notation);
}

// ── Socket Listeners ──────────────────────────────────────────────────────────

function _initSocketListeners() {
    if (!state.socket) return;
    state.socket.on('vtt_map_updated',       _onMapUpdated);
    state.socket.on('vtt_token_added',       _onTokenAdded);
    state.socket.on('vtt_token_moved',       _onTokenMoved);
    state.socket.on('vtt_token_removed',     _onTokenRemoved);
    state.socket.on('vtt_encounter_updated', _onEncounterUpdated);
    state.socket.on('vtt_fog_updated',       _onFogUpdated);
    state.socket.on('vtt_dice_rolled',       _onDiceRolled);
}

function _removeSocketListeners() {
    if (!state.socket) return;
    state.socket.off('vtt_map_updated',       _onMapUpdated);
    state.socket.off('vtt_token_added',       _onTokenAdded);
    state.socket.off('vtt_token_moved',       _onTokenMoved);
    state.socket.off('vtt_token_removed',     _onTokenRemoved);
    state.socket.off('vtt_encounter_updated', _onEncounterUpdated);
    state.socket.off('vtt_fog_updated',       _onFogUpdated);
    state.socket.off('vtt_dice_rolled',       _onDiceRolled);
}

function _onMapUpdated({ map }) {
    if (_vttSession) _vttSession.map = map;
    _renderMap(map);
}

function _onTokenAdded({ token }) {
    if (_vttSession) _vttSession.tokens = [...(_vttSession.tokens || []), token];
    _renderToken(token);
}

function _onTokenMoved({ token }) {
    const sprite = _tokenSprites[token.id];
    if (sprite && !(_dragState?.tokenId === token.id)) {
        sprite.x = token.x;
        sprite.y = token.y;
    }
}

function _onTokenRemoved({ tokenId }) {
    const sprite = _tokenSprites[tokenId];
    if (sprite) { _layers.tokens?.removeChild(sprite); delete _tokenSprites[tokenId]; }
}

function _onEncounterUpdated({ encounter }) {
    if (_vttSession) _vttSession.encounter = encounter;
    _renderEncounter(encounter);
}

function _onFogUpdated({ map }) {
    if (_vttSession && map) { _vttSession.map = map; _renderFog(map.fog_data, map.grid_size || 64); }
}

function _onDiceRolled(rollData) {
    // Single source of truth for the log — deduplicate by DB row ID
    if (_loggedRollIds.has(rollData.id)) return;
    _loggedRollIds.add(rollData.id);
    _logRoll({ total_value: rollData.total, user: { username: rollData.username }, values: rollData.dice }, 0, rollData.notation);
}
