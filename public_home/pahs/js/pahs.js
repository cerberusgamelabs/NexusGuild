import { PAHSRenderer, MACHINE_COLORS } from './renderer.js';

// ─── State ────────────────────────────────────────────────────────────────────
let renderer = null;
let state    = { grid: null, machines: [], belts: [] };
let user     = null;
let pollTimer = null;
let currentTool = 'select';
let placingType = null;
let rotation    = 0;
let selectedMachine = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
    user = await checkAuth();
    if (!user) return;

    document.getElementById('pahsUsername').textContent = user.username;

    // Init grid (creates if missing)
    const gridRes = await apiFetch('/api/pahs/grid');
    if (!gridRes) return;

    await loadState();

    setupUI();
    setupRenderer();
    document.getElementById('loadingOverlay').classList.add('hidden');

    // Poll state every 12s (slightly longer than tick)
    pollTimer = setInterval(pollState, 12_000);
}

async function pollState() {
    await loadState();
}

async function loadState() {
    const data = await apiFetch('/api/pahs/state');
    if (!data) return;
    state = data;
    if (renderer) {
        renderer.load(state.machines, state.belts, state.grid.size);
    }
    updateSidebar();
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function checkAuth() {
    try {
        const res = await fetch('/api/nic/me', { credentials: 'include' });
        if (res.status === 401) {
            window.location.href = `https://app.nexusguild.gg?returnTo=${encodeURIComponent(window.location.href)}`;
            return null;
        }
        if (!res.ok) throw new Error('Server error');
        return await res.json();
    } catch {
        showToast('Could not connect to server.', 'error');
        return null;
    }
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
    try {
        const res = await fetch(url, { credentials: 'include', ...opts });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Server error' }));
            showToast(err.error || 'Request failed', 'error');
            return null;
        }
        return res.status === 204 ? {} : await res.json();
    } catch {
        showToast('Network error', 'error');
        return null;
    }
}

// ─── Renderer Setup ───────────────────────────────────────────────────────────
function setupRenderer() {
    const canvas = document.getElementById('gridCanvas');
    renderer = new PAHSRenderer(canvas);
    renderer.load(state.machines, state.belts, state.grid?.size || 64);
    renderer.fitToGrid();

    document.getElementById('gridSizeLabel').textContent =
        `${state.grid?.size || 64}×${state.grid?.size || 64}`;

    renderer.onHoverChange = (tx, ty) => {
        document.getElementById('tileCoord').textContent = `${tx}, ${ty}`;
    };

    renderer.onMachineClick = (m) => {
        selectedMachine = m;
        if (m) openInfoPanel(m);
        else   closeInfoPanel();
    };

    renderer.onTileClick = async (tx, ty) => {
        if (!placingType) return;
        const res = await apiFetch('/api/pahs/machines', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ machine_type: placingType, x: tx, y: ty, rotation }),
        });
        if (res) {
            showToast(`${placingType} placed`, 'success');
            await loadState();
        }
    };

    renderer.onOutputPortClick = (machine, portKey, screenX, screenY) => {
        openPortFilterPopup(machine, portKey, screenX, screenY);
    };

    renderer.onBeltCommit = async (cells) => {
        const res = await apiFetch('/api/pahs/belts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cells }),
        });
        if (res) await loadState();
    };

    renderer.onEraseClick = async (tx, ty) => {
        // Check machine first
        const hit = state.machines.find(m =>
            tx >= m.x && tx < m.x + m.size && ty >= m.y && ty < m.y + m.size
        );
        if (hit) {
            if (hit.machine_type === 'hub') { showToast('Cannot remove the Hub', 'error'); return; }
            const res = await apiFetch(`/api/pahs/machines/${hit.id}`, { method: 'DELETE' });
            if (res) { showToast('Machine removed', 'info'); await loadState(); }
            return;
        }
        // Check belt
        const belt = state.belts.find(b => b.x === tx && b.y === ty);
        if (belt) {
            const res = await apiFetch('/api/pahs/belts', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cells: [{ x: tx, y: ty }] }),
            });
            if (res) await loadState();
        }
    };
}

// ─── UI Setup ─────────────────────────────────────────────────────────────────
function setupUI() {
    // Tool buttons
    document.getElementById('toolPalette').addEventListener('click', e => {
        const btn = e.target.closest('.tool-btn');
        if (!btn) return;
        setTool(btn.dataset.tool);
    });

    // Machine palette
    document.getElementById('machinePalette').addEventListener('click', e => {
        const btn = e.target.closest('.machine-btn');
        if (!btn) return;
        setPlacingType(btn.dataset.type);
    });

    // Rotation
    document.getElementById('rotateGroup').addEventListener('click', e => {
        const btn = e.target.closest('.rotate-btn');
        if (!btn) return;
        rotation = parseInt(btn.dataset.rot, 10);
        if (renderer) renderer.rotation = rotation;
        document.querySelectorAll('.rotate-btn').forEach(b => b.classList.toggle('active', b === btn));
    });

    // Power coverage toggle
    document.getElementById('showPowerCoverage').addEventListener('change', e => {
        if (renderer) renderer.showPower = e.target.checked;
    });

    // Info panel close
    document.getElementById('infoPanelClose').addEventListener('click', closeInfoPanel);
}

// ─── Tool Management ──────────────────────────────────────────────────────────
function setTool(tool) {
    currentTool = tool;
    placingType = null;

    document.querySelectorAll('.tool-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tool === tool)
    );
    document.querySelectorAll('.machine-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('rotateRow').style.display = 'none';

    if (renderer) {
        renderer.tool        = tool;
        renderer.placingType = null;
    }

    updateToolHint();
}

function setPlacingType(type) {
    currentTool = 'place';
    placingType = type;

    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.machine-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.type === type)
    );
    document.getElementById('rotateRow').style.display = '';

    if (renderer) {
        renderer.tool        = 'place';
        renderer.placingType = type;
        renderer.rotation    = rotation;
    }

    updateToolHint();
}

// ─── Port Filter Popup ────────────────────────────────────────────────────────
const ITEM_OPTIONS = [
    { value: null,              label: '✕ None (disabled)' },
    { value: 'ferrite_ore',     label: 'Ferrite Ore' },
    { value: 'pyrene_ore',      label: 'Pyrene Ore' },
    { value: 'ferrite_ingot',   label: 'Ferrite Ingot' },
    { value: 'pyrene_crystal',  label: 'Pyrene Crystal' },
    { value: 'ferrite_powder',  label: 'Ferrite Powder' },
    { value: 'pyrene_dust',     label: 'Pyrene Dust' },
    { value: 'component',       label: 'Component' },
];

function openPortFilterPopup(machine, portKey, screenX, screenY) {
    closePortFilterPopup();
    const current = (machine.port_config || {})[portKey] || null;

    const popup = document.createElement('div');
    popup.id = 'portFilterPopup';
    popup.style.cssText = `
        position: fixed;
        left: ${screenX}px; top: ${screenY}px;
        transform: translate(-50%, 8px);
        background: #0f1218; border: 1px solid #2a7fff;
        border-radius: 6px; padding: 8px 0;
        z-index: 100; min-width: 160px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.6);
        font-size: 12px;
    `;

    const label = document.createElement('div');
    label.textContent = `Port ${portKey} Filter`;
    label.style.cssText = 'padding: 4px 12px 6px; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: #5a7a99; text-transform: uppercase; border-bottom: 1px solid #1e2a38; margin-bottom: 4px;';
    popup.appendChild(label);

    for (const opt of ITEM_OPTIONS) {
        const item = document.createElement('div');
        item.textContent = opt.label;
        item.style.cssText = `padding: 5px 12px; cursor: pointer; color: ${opt.value === current ? '#2a7fff' : '#c8d4e0'}; background: ${opt.value === current ? 'rgba(42,127,255,0.1)' : 'transparent'};`;
        item.addEventListener('mouseenter', () => item.style.background = 'rgba(42,127,255,0.15)');
        item.addEventListener('mouseleave', () => item.style.background = opt.value === current ? 'rgba(42,127,255,0.1)' : 'transparent');
        item.addEventListener('mousedown', async (e) => {
            e.stopPropagation();
            closePortFilterPopup();
            const res = await apiFetch(`/api/pahs/machines/${machine.id}/port-filter`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ portKey, itemType: opt.value }),
            });
            if (res) {
                showToast(opt.value ? `Port ${portKey} → ${opt.label}` : `Port ${portKey} filter cleared`, 'info');
                await loadState();
            }
        });
        popup.appendChild(item);
    }

    document.body.appendChild(popup);
    // Close on outside mousedown
    const onOutside = (e) => { if (!popup.contains(e.target)) closePortFilterPopup(); };
    setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
    popup._onOutside = onOutside;
}

function closePortFilterPopup() {
    const popup = document.getElementById('portFilterPopup');
    if (!popup) return;
    if (popup._onOutside) document.removeEventListener('mousedown', popup._onOutside);
    popup.remove();
}

function updateToolHint() {
    const hints = {
        select: 'Click a machine to inspect it — click a red output port to set its filter',
        belt:   'Click and drag to draw belt segments',
        erase:  'Click to remove a machine or belt cell',
        place:  placingType ? `Click to place ${placingType} (R key to rotate)` : 'Select a machine type',
    };
    document.getElementById('toolHint').textContent = hints[currentTool] || '';
}

// R key to rotate
document.addEventListener('keydown', e => {
    if (e.key === 'r' || e.key === 'R') {
        const rots = [0, 90, 180, 270];
        rotation = rots[(rots.indexOf(rotation) + 1) % rots.length];
        if (renderer) renderer.rotation = rotation;
        document.querySelectorAll('.rotate-btn').forEach(b =>
            b.classList.toggle('active', parseInt(b.dataset.rot, 10) === rotation)
        );
    }
    if (e.key === 'Escape') {
        setTool('select');
        closeInfoPanel();
    }
});

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function updateSidebar() {
    // Power calc: sum generation and draw
    let gen = 0, draw = 0;
    const MC = {
        hub:        { powerGen: 100, powerDraw: 0 },
        power_pole: { powerGen: 0,   powerDraw: 0 },
        smelter:    { powerGen: 0,   powerDraw: 15 },
        crusher:    { powerGen: 0,   powerDraw: 20 },
        assembler:  { powerGen: 0,   powerDraw: 25 },
    };
    for (const m of state.machines) {
        const cfg = MC[m.machine_type];
        if (!cfg) continue;
        if (m.enabled !== false || m.machine_type === 'hub') {
            gen  += cfg.powerGen;
            draw += cfg.powerDraw;
        }
    }
    document.getElementById('powerDisplay').textContent = `${draw} / ${gen} MW`;
    const pct = gen > 0 ? Math.min(100, (draw / gen) * 100) : 0;
    document.getElementById('powerBar').style.width = `${pct}%`;
    document.getElementById('powerBar').style.background = pct > 90 ? '#e74c3c' : '#2a7fff';

    // Hub storage
    const hub = state.machines.find(m => m.machine_type === 'hub');
    const hubEl = document.getElementById('hubStorage');
    if (!hub) {
        hubEl.innerHTML = '<span class="dim">No hub placed</span>';
    } else {
        const st = hub.storage || {};
        const inp = st.input  || {};
        const out = st.output || {};
        const allKeys = new Set([...Object.keys(inp), ...Object.keys(out)]);
        if (!allKeys.size) {
            hubEl.innerHTML = '<span class="dim">Empty</span>';
        } else {
            hubEl.innerHTML = [...allKeys].map(k => {
                const i = inp[k] || 0, o = out[k] || 0;
                return `<div class="storage-row"><span class="s-label">${formatItem(k)}</span><span class="s-val">${i} in / ${o} out</span></div>`;
            }).join('');
        }
    }
}

function formatItem(key) {
    return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Info Panel ───────────────────────────────────────────────────────────────
function openInfoPanel(m) {
    selectedMachine = m;
    const cfg = MACHINE_COLORS[m.machine_type] || { label: m.machine_type };
    document.getElementById('infoPanelTitle').textContent = cfg.label || m.machine_type;

    const isHub = m.machine_type === 'hub';
    const st    = m.storage || {};
    let html = '';

    // Position / size
    html += `<div class="info-row"><span class="info-label">Position</span><span class="info-val">${m.x}, ${m.y}</span></div>`;
    html += `<div class="info-row"><span class="info-label">Size</span><span class="info-val">${m.size}×${m.size}</span></div>`;
    html += `<div class="info-row"><span class="info-label">Rotation</span><span class="info-val">${m.rotation}°</span></div>`;

    if (!isHub) {
        const powText = m.powered ? '<span class="powered-yes">✓ Yes</span>' : '<span class="powered-no">✗ No</span>';
        const enaText = m.enabled !== false
            ? '<span class="enabled-yes">Online</span>'
            : '<span class="enabled-no">Offline</span>';
        html += `<div class="info-row"><span class="info-label">Powered</span><span class="info-val">${powText}</span></div>`;
        html += `<div class="info-row"><span class="info-label">Status</span><span class="info-val">${enaText}</span></div>`;
    }

    // Storage
    if (m.machine_type !== 'power_pole') {
        html += `<div class="info-section"><div class="info-section-label">Storage</div>`;
        html += `<table class="storage-table">`;
        if (isHub) {
            const inp = st.input  || {};
            const out = st.output || {};
            const allKeys = new Set([...Object.keys(inp), ...Object.keys(out)]);
            html += `<tr><td colspan="2" class="sub-label">Incoming</td></tr>`;
            if ([...allKeys].some(k => inp[k] > 0)) {
                for (const k of allKeys) if (inp[k] > 0) html += `<tr><td>${formatItem(k)}</td><td>${inp[k]} / 1000</td></tr>`;
            } else { html += `<tr><td colspan="2" style="color:var(--text-dim)">Empty</td></tr>`; }
            html += `<tr><td colspan="2" class="sub-label">Outgoing</td></tr>`;
            if ([...allKeys].some(k => out[k] > 0)) {
                for (const k of allKeys) if (out[k] > 0) html += `<tr><td>${formatItem(k)}</td><td>${out[k]} / 1000</td></tr>`;
            } else { html += `<tr><td colspan="2" style="color:var(--text-dim)">Empty</td></tr>`; }
        } else {
            const inp = st.input || {};
            const out = st.output || {};
            const inKeys  = Object.keys(inp).filter(k => inp[k] > 0);
            const outKeys = Object.keys(out).filter(k => out[k] > 0);
            html += `<tr><td colspan="2" class="sub-label">Input</td></tr>`;
            if (inKeys.length) {
                for (const k of inKeys) html += `<tr><td>${formatItem(k)}</td><td>${inp[k]}</td></tr>`;
            } else {
                html += `<tr><td colspan="2" style="color:var(--text-dim)">Empty</td></tr>`;
            }
            html += `<tr><td colspan="2" class="sub-label">Output</td></tr>`;
            if (outKeys.length) {
                for (const k of outKeys) html += `<tr><td>${formatItem(k)}</td><td>${out[k]}</td></tr>`;
            } else {
                html += `<tr><td colspan="2" style="color:var(--text-dim)">Empty</td></tr>`;
            }
        }
        html += `</table></div>`;
    }

    // Actions
    if (!isHub) {
        const enaLabel = m.enabled !== false ? 'Disable Machine' : 'Enable Machine';
        html += `<div class="info-section" style="border-top:none">
            <div class="info-section-label">Rotation</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px">
                ${[0,90,180,270].map(r => `<button class="rotate-btn${m.rotation===r?' active':''}" data-rot="${r}">${['↑ N','→ E','↓ S','← W'][[0,90,180,270].indexOf(r)]}</button>`).join('')}
            </div>
            <button class="btn btn-ghost" id="btnToggle">${enaLabel}</button>
            <button class="btn btn-danger" id="btnRemove" style="margin-top:4px">Remove</button>
        </div>`;
    }

    document.getElementById('infoPanelBody').innerHTML = html;

    document.getElementById('infoPanelBody').querySelectorAll('.rotate-btn[data-rot]').forEach(btn => {
        btn.addEventListener('click', () => rotateMachine(m.id, parseInt(btn.dataset.rot, 10)));
    });
    document.getElementById('btnToggle')?.addEventListener('click', () => toggleMachine(m.id));
    document.getElementById('btnRemove')?.addEventListener('click', () => removeMachine(m.id));

    document.getElementById('infoPanel').classList.add('open');
}

function closeInfoPanel() {
    document.getElementById('infoPanel').classList.remove('open');
    selectedMachine = null;
    if (renderer) renderer.selectedId = null;
}

async function rotateMachine(id, rot) {
    const res = await apiFetch(`/api/pahs/machines/${id}/rotate`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotation: rot }),
    });
    if (res) {
        await loadState();
        const m = state.machines.find(m => m.id === id);
        if (m) openInfoPanel(m);
    }
}

async function toggleMachine(id) {
    const res = await apiFetch(`/api/pahs/machines/${id}/toggle`, { method: 'PATCH' });
    if (res) {
        await loadState();
        // Re-open panel with fresh data
        const m = state.machines.find(m => m.id === id);
        if (m) openInfoPanel(m);
    }
}

async function removeMachine(id) {
    const res = await apiFetch(`/api/pahs/machines/${id}`, { method: 'DELETE' });
    if (res) {
        showToast('Machine removed', 'info');
        closeInfoPanel();
        await loadState();
    }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
    const area = document.getElementById('toastArea');
    const el   = document.createElement('div');
    el.className = `pahs-toast ${type}`;
    el.textContent = msg;
    area.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
