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
let _vttDiceTheme = 'dddice-bees';
let _vttSession  = null;     // { map, tokens, encounter, characters, isGM }
let _dragState   = null;     // { tokenId, startX, startY, offsetX, offsetY }

// ── Open / Close ──────────────────────────────────────────────────────────────

async function openVTTView(channel) {
    _vttChannel = channel;

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
                    <span class="vtt-tool-sep"></span>
                    <button class="vtt-tool-btn" title="Roll Dice" onclick="vttRollPrompt()">🎲</button>
                    <button class="vtt-tool-btn" title="Character Sheet" onclick="vttOpenSheet()">📋</button>
                    <button class="vtt-tool-btn" title="Initiative Tracker" onclick="vttToggleTracker()">⚔️</button>
                </div>
                <div id="vttFogTools" class="vtt-fog-tools" style="display:none">
                    <button onclick="vttFogMode('paint')">🌫️ Paint</button>
                    <button onclick="vttFogMode('erase')">☀️ Erase</button>
                    <button class="vtt-tool-btn-sm" onclick="document.getElementById('vttFogTools').style.display='none'">✕</button>
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
                <div id="vttRollLog" class="vtt-panel vtt-roll-log">
                    <div class="vtt-panel-header">🎲 Roll Log</div>
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
}

// ── Session Load ──────────────────────────────────────────────────────────────

async function _loadSession() {
    if (!_vttChannel) return;
    try {
        const res = await fetch(`/api/vtt/${_vttChannel.id}/session`, { credentials: 'include' });
        if (!res.ok) return;
        _vttSession = await res.json();

        if (_vttSession.isGM) _showGMTools();
        if (_vttSession.map)  _renderMap(_vttSession.map);
        _vttSession.tokens.forEach(_renderToken);
        _renderEncounter(_vttSession.encounter);
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
            g.fill({ color: 0x000000, alpha: 0.85 });
            _layers.fog.addChild(g);
        });
    });
}

// ── Tokens ────────────────────────────────────────────────────────────────────

async function _renderToken(token) {
    if (!_layers.tokens || !_pixiApp) return;

    const container = new PIXI.Container();
    container.label = `token_${token.id}`;
    container.x = token.x;
    container.y = token.y;
    container.eventMode = 'static';
    container.cursor = 'pointer';

    const cellSize = _vttSession?.map?.grid_size || 64;
    const size = (token.size || 1) * cellSize;

    // Token circle / image
    let graphic;
    if (token.image_url) {
        try {
            const tex = await PIXI.Assets.load(token.image_url);
            graphic = new PIXI.Sprite(tex);
            graphic.width  = size;
            graphic.height = size;
            graphic.anchor.set(0.5);
        } catch {
            graphic = _makeTokenCircle(size);
        }
    } else {
        graphic = _makeTokenCircle(size);
    }
    container.addChild(graphic);

    // Label
    if (token.label) {
        const label = new PIXI.Text({ text: token.label, style: { fontSize: 11, fill: 0xffffff, dropShadow: true } });
        label.anchor.set(0.5, 0);
        label.y = size / 2 + 2;
        container.addChild(label);
    }

    // HP bar
    if (token.hp_max) {
        const bar = _makeHpBar(token.hp, token.hp_max, size);
        bar.y = -(size / 2) - 8;
        bar.x = -(size / 2);
        container.addChild(bar);
    }

    // Drag
    _attachTokenDrag(container, token);

    _layers.tokens.addChild(container);
    _tokenSprites[token.id] = container;
}

function _makeTokenCircle(size) {
    const g = new PIXI.Graphics();
    g.circle(0, 0, size / 2);
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

function _attachTokenDrag(container, token) {
    container.on('pointerdown', (e) => {
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
        _saveTokenPosition(token.id, container.x, container.y);
        _dragState = null;
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

let _activeFogMode = null;

function vttToggleFogTool() {
    const panel = document.getElementById('vttFogTools');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
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
    _saveFog(fog);
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
        _vttDiceTheme = diceTheme || 'dddice-bees';

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

        // ThreeDDiceRollEvent may not be a global in the browser CDN build
        const rollEvent = (typeof ThreeDDiceRollEvent !== 'undefined')
            ? ThreeDDiceRollEvent
            : 'roll';
        _dddice.on(rollEvent, (roll) => {
            _logRoll(roll);
        });
    } catch (e) {
        console.warn('[VTT] dddice init failed:', e);
    }
}

function _teardownDddice() {
    if (_dddice) { try { _dddice.clear(); } catch {} _dddice = null; }
    document.getElementById('vttDddiceCanvas')?.remove();
}

function _logRoll(roll) {
    const list = document.getElementById('vttRollLogList');
    if (!list) return;
    const total = roll.total_value ?? roll.values?.reduce((s, v) => s + v.value, 0) ?? '?';
    const name  = roll.user?.username || 'Unknown';
    const entry = document.createElement('div');
    entry.className = 'vtt-roll-entry';
    entry.innerHTML = `<span class="vtt-roll-name">${name}</span> rolled <strong>${total}</strong>`;
    list.prepend(entry);
    // Keep last 50 rolls
    while (list.children.length > 50) list.removeChild(list.lastChild);
}

// ── Dice Roll Prompt ──────────────────────────────────────────────────────────

async function vttRollPrompt() {
    const notation = prompt('Dice notation (e.g. 1d20, 2d6):');
    if (!notation || !_vttChannel) return;
    const theme = _vttDiceTheme || 'dddice-bees';
    // Parse simple NdX notation into dice array
    const dice = _parseDiceNotation(notation.trim(), theme);
    if (!dice.length) { console.warn('[VTT] Could not parse notation:', notation); return; }
    try {
        const res = await fetch(`/api/vtt/${_vttChannel.id}/roll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ dice })
        });
        if (!res.ok) console.warn('[VTT] Roll failed:', res.status, await res.text());
    } catch (e) {
        console.warn('[VTT] Roll failed:', e);
    }
}

function _parseDiceNotation(notation, theme) {
    // Supports: d20, 2d6, 1d20, d6
    const dice = [];
    const parts = notation.toLowerCase().split('+').flatMap(p => p.split(' ')).filter(Boolean);
    for (const part of parts) {
        const m = part.match(/^(\d*)d(\d+)$/);
        if (m) {
            const count = parseInt(m[1] || '1', 10);
            const type  = `d${m[2]}`;
            for (let i = 0; i < count; i++) dice.push({ type, theme });
        }
    }
    return dice;
}

// ── Add Token Prompt ──────────────────────────────────────────────────────────

function vttAddTokenPrompt() {
    const label = prompt('Token label (name):');
    if (!label || !_vttChannel) return;
    const form = new FormData();
    form.append('label', label);
    form.append('x', 100);
    form.append('y', 100);
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

function _renderSheet() {
    const panel = document.getElementById('vttSheetPanel');
    if (!panel || !_vttSession) return;

    const chars = _vttSession.characters || [];
    const myChar = chars.find(c => c.user_id === state.currentUser?.id) || null;

    panel.innerHTML = `
        <div class="vtt-sheet-header">
            <span>📋 Character Sheet</span>
            <button class="vtt-btn-sm" onclick="document.getElementById('vttSheetPanel').style.display='none'">✕</button>
        </div>
        ${myChar ? _renderSheetContent(myChar) : `
            <div class="vtt-empty" style="padding:16px">No character yet.
                <button class="vtt-btn-sm" onclick="vttCreateCharPrompt()">Create</button>
            </div>
        `}
    `;
}

function _renderSheetContent(char) {
    const d = char.sheet_data || {};
    if (char.system === 'dnd5e') return _renderDnd5eSheet(char, d);
    if (char.system === 'pf2e')  return _renderPf2eSheet(char, d);
    return _renderGenericSheet(char, d);
}

function _renderGenericSheet(char, d) {
    return `
        <div class="vtt-sheet-body">
            <div class="vtt-sheet-name">${char.name}</div>
            <div class="vtt-sheet-row">
                <label>HP</label>
                <input class="vtt-input" type="number" value="${d.hp ?? ''}" style="width:50px"
                       onchange="vttUpdateSheetField('hp', this.value)"> /
                <input class="vtt-input" type="number" value="${d.hp_max ?? ''}" style="width:50px"
                       onchange="vttUpdateSheetField('hp_max', this.value)">
            </div>
            <div class="vtt-sheet-row">
                <label>AC</label>
                <input class="vtt-input" type="number" value="${d.ac ?? ''}" style="width:50px"
                       onchange="vttUpdateSheetField('ac', this.value)">
            </div>
            <div class="vtt-sheet-row">
                <label>Initiative bonus</label>
                <input class="vtt-input" type="number" value="${d.initiative_bonus ?? 0}" style="width:50px"
                       onchange="vttUpdateSheetField('initiative_bonus', this.value)">
            </div>
            <div class="vtt-sheet-row">
                <label>Notes</label>
                <textarea class="vtt-input" rows="3" style="width:100%"
                          onchange="vttUpdateSheetField('notes', this.value)">${d.notes ?? ''}</textarea>
            </div>
        </div>`;
}

function _renderDnd5eSheet(char, d) {
    const abs = d.ability_scores || {};
    const mod = s => Math.floor(((s || 10) - 10) / 2);
    const fmt = n => n >= 0 ? `+${n}` : `${n}`;
    const prof = d.proficiency_bonus || 2;

    const abilityRow = (key) => `
        <div class="vtt-ability">
            <div class="vtt-ability-name">${key.toUpperCase()}</div>
            <div class="vtt-ability-score">${abs[key] || 10}</div>
            <div class="vtt-ability-mod">${fmt(mod(abs[key]))}</div>
            <button class="vtt-roll-btn" onclick="vttRollAbility('${key}',${mod(abs[key])})">🎲</button>
        </div>`;

    return `
        <div class="vtt-sheet-body">
            <div class="vtt-sheet-name">${char.name}</div>
            <div class="vtt-sheet-meta">${d.race || ''} ${d.class || ''} ${d.level ? 'Lv.' + d.level : ''}</div>
            <div class="vtt-sheet-row">
                <span class="vtt-stat-pill">HP ${d.hp ?? '?'}/${d.hp_max ?? '?'}</span>
                <span class="vtt-stat-pill">AC ${d.ac ?? '?'}</span>
                <span class="vtt-stat-pill">Speed ${d.speed ?? 30}ft</span>
                <span class="vtt-stat-pill">Prof ${fmt(prof)}</span>
            </div>
            <div class="vtt-abilities">
                ${['str','dex','con','int','wis','cha'].map(abilityRow).join('')}
            </div>
            <div class="vtt-sheet-row" style="margin-top:8px">
                <strong>Saving Throws</strong>
            </div>
            ${['str','dex','con','int','wis','cha'].map(a => {
                const bonus = mod(abs[a]) + ((d.saving_throw_profs||[]).includes(a) ? prof : 0);
                return `<div class="vtt-save-row">
                    <span>${a.toUpperCase()}</span>
                    <span>${fmt(bonus)}</span>
                    <button class="vtt-roll-btn" onclick="vttRollSave('${a}',${bonus})">🎲</button>
                </div>`;
            }).join('')}
            <div class="vtt-sheet-section">Attacks</div>
            ${(d.attacks||[]).map(atk => `
                <div class="vtt-attack-row">
                    <span>${atk.name}</span>
                    <span>${atk.to_hit}</span>
                    <span>${atk.damage}</span>
                    <button class="vtt-roll-btn" onclick="vttRollAttack('${atk.name}','${atk.to_hit}','${atk.damage}')">🎲</button>
                </div>`).join('') || '<div class="vtt-empty">No attacks</div>'}
        </div>`;
}

function _renderPf2eSheet(char, d) {
    const abs = d.ability_scores || {};
    const mod = s => Math.floor(((s || 10) - 10) / 2);
    const fmt = n => n >= 0 ? `+${n}` : `${n}`;
    const lvl = d.level || 1;
    const rankBonus = { untrained: Math.max(0, lvl - 2), trained: lvl + 2, expert: lvl + 4, master: lvl + 6, legendary: lvl + 8 };
    const profs = d.proficiencies || {};

    return `
        <div class="vtt-sheet-body">
            <div class="vtt-sheet-name">${char.name}</div>
            <div class="vtt-sheet-meta">${d.ancestry || ''} ${d.class || ''} ${lvl ? 'Lv.' + lvl : ''}</div>
            <div class="vtt-sheet-row">
                <span class="vtt-stat-pill">HP ${d.hp ?? '?'}/${d.hp_max ?? '?'}</span>
                <span class="vtt-stat-pill">AC ${d.ac ?? '?'}</span>
                <span class="vtt-stat-pill">Hero ${d.hero_points ?? 0}</span>
            </div>
            <div class="vtt-sheet-section">Saving Throws</div>
            ${['fort','ref','will'].map(sv => {
                const rank = profs[sv] || 'untrained';
                const bonus = mod(abs[sv === 'fort' ? 'con' : sv === 'ref' ? 'dex' : 'wis']) + (rankBonus[rank] || 0);
                return `<div class="vtt-save-row">
                    <span>${sv.toUpperCase()} (${rank})</span>
                    <span>${fmt(bonus)}</span>
                    <button class="vtt-roll-btn" onclick="vttQuickRoll('${sv} save',${bonus})">🎲</button>
                </div>`;
            }).join('')}
        </div>`;
}

// ── Sheet Roll Helpers ────────────────────────────────────────────────────────

function vttRollAbility(ability, mod) {
    _quickRoll(`${ability.toUpperCase()} Check`, `1d20${mod >= 0 ? '+' : ''}${mod}`);
}

function vttRollSave(ability, bonus) {
    _quickRoll(`${ability.toUpperCase()} Save`, `1d20${bonus >= 0 ? '+' : ''}${bonus}`);
}

function vttRollAttack(name, toHit, damage) {
    _quickRoll(`${name} Attack`, `1d20${toHit}`);
    _quickRoll(`${name} Damage`, damage);
}

function vttQuickRoll(label, bonus) {
    _quickRoll(label, `1d20${bonus >= 0 ? '+' : ''}${bonus}`);
}

function _quickRoll(label, notation) {
    if (!_dddice) {
        _logRoll({ user: { username: state.currentUser?.username || 'You' }, total_value: label + ': ' + notation });
        return;
    }
    try {
        _dddice.roll([{ type: notation, theme: _vttDiceTheme || 'dddice-bees' }]);
    } catch (e) {
        console.warn('[VTT] Roll error:', e);
    }
}

// ── Create Character ──────────────────────────────────────────────────────────

function vttCreateCharPrompt() {
    const name = prompt('Character name:');
    if (!name || !_vttChannel) return;
    const system = prompt('System (generic, dnd5e, pf2e):', 'generic') || 'generic';
    fetch(`/api/vtt/${_vttChannel.id}/characters`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, system, sheet_data: {} })
    }).then(r => r.json()).then(({ character }) => {
        if (character) {
            if (!_vttSession) _vttSession = { characters: [] };
            _vttSession.characters = [...(_vttSession.characters || []), character];
            _renderSheet();
        }
    });
}

async function vttUpdateSheetField(field, value) {
    if (!_vttChannel || !_vttSession) return;
    const myChar = (_vttSession.characters || []).find(c => c.user_id === state.currentUser?.id);
    if (!myChar) return;
    const sheet = { ...(myChar.sheet_data || {}), [field]: isNaN(value) ? value : Number(value) };
    await fetch(`/api/vtt/${_vttChannel.id}/characters/${myChar.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet_data: sheet })
    });
    myChar.sheet_data = sheet;
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
}

function _removeSocketListeners() {
    if (!state.socket) return;
    state.socket.off('vtt_map_updated',       _onMapUpdated);
    state.socket.off('vtt_token_added',       _onTokenAdded);
    state.socket.off('vtt_token_moved',       _onTokenMoved);
    state.socket.off('vtt_token_removed',     _onTokenRemoved);
    state.socket.off('vtt_encounter_updated', _onEncounterUpdated);
    state.socket.off('vtt_fog_updated',       _onFogUpdated);
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
    if (sprite && !_dragState?.tokenId === token.id) {
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
