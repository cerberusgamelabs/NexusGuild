import { generateTerrain, TERRAIN_NAMES } from './mapgen.js';
import { NICRenderer, NODE_CONFIG } from './renderer.js';

// ─── Client Constants ─────────────────────────────────────────────────────────
const MINER_UPGRADE_COSTS = { 2: { ferrite: 60, pyrene: 30 }, 3: { ferrite: 150, pyrene: 75 } };
const MAX_MINER_TIER      = 3;
const RECRUIT_COST        = { ferrite: 80, pyrene: 40 };
const MAX_OPERATIVES      = 5;

// ─── State ────────────────────────────────────────────────────────────────────
let renderer  = null;
let player    = null;
let region    = null;
let selectedNode = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
    player = await checkAuth();
    if (!player) return;

    updatePAHSPanel(player);
    await showRegionList();

    // Refresh PAHS every 30s to pick up production ticks and resolve arrived operatives
    setInterval(async () => {
        const fresh = await fetchMe();
        if (fresh) { player = fresh; updatePAHSPanel(fresh); }
        if (renderer) { renderer.setOperatives(myOperativesInRegion()); renderer.setPaths(buildPaths()); }
        if (selectedNode) renderNodeInfo(selectedNode);
    }, 30_000);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function checkAuth() {
    try {
        const res = await fetch('/api/nic/me', { credentials: 'include' });
        if (res.status === 401) {
            window.location.href = `https://app.nexusguild.gg?returnTo=${encodeURIComponent('https://nic.nexusguild.gg/')}`;
            return null;
        }
        if (!res.ok) throw new Error('Server error');
        return await res.json();
    } catch (err) {
        showToast('Could not connect to NIC server.', 'error');
        return null;
    }
}

async function fetchMe() {
    try {
        const res = await fetch('/api/nic/me', { credentials: 'include' });
        if (!res.ok) return null;
        return await res.json();
    } catch { return null; }
}

// ─── Region List ──────────────────────────────────────────────────────────────
async function showRegionList() {
    setView('list');
    const list = document.getElementById('regionList');
    list.innerHTML = '<div class="loading">Loading regions…</div>';
    try {
        const res = await fetch('/api/nic/regions', { credentials: 'include' });
        const regions = await res.json();
        if (!regions.length) {
            list.innerHTML = '<div class="empty">No regions yet. Create one to begin.</div>';
            return;
        }
        const visIcon = { public: '🌐', guild: '🏰', invite: '🔒' };
        list.innerHTML = regions.map(r => `
            <div class="region-card" onclick="loadRegion('${r.id}')">
                <div class="region-name">
                    ${escHtml(r.name)}
                    <span class="vis-badge vis-${r.visibility}">${visIcon[r.visibility] || ''} ${r.visibility}</span>
                </div>
                <div class="region-meta">
                    ${r.server_name ? `<span>📡 ${escHtml(r.server_name)}</span>` : '<span>Global</span>'}
                    <span>⛏ ${r.resource_count} nodes</span>
                    <span>🚩 ${r.entry_count} entries</span>
                </div>
            </div>
        `).join('');
    } catch {
        list.innerHTML = '<div class="empty error">Failed to load regions.</div>';
    }
}

// ─── Load Region ──────────────────────────────────────────────────────────────
function buildNodes(r) {
    return [
        ...r.resource_nodes.map(n => ({ ...n, node_category: 'resource' })),
        ...r.research_nodes.map(n => ({ ...n, node_category: 'research' })),
        ...r.entry_points.map(n =>   ({ ...n, node_category: 'entry' })),
        ...r.structures.map(n =>     ({ ...n, node_category: 'structure' })),
        ...(r.foreign_operatives || [])
            .filter(op => op.status === 'deployed')
            .map(op => ({ ...op, node_category: 'operative' })),
    ];
}

function myOperativesInRegion() {
    if (!region || !player?.operatives) return [];
    return player.operatives.filter(op =>
        (op.status === 'deployed' || op.status === 'traveling') && op.region_id === region.id
    );
}

// Refresh map data without resetting camera/zoom
async function refreshRegionData() {
    if (!region) return;
    try {
        const [regionRes, freshPlayer] = await Promise.all([
            fetch(`/api/nic/regions/${region.id}`, { credentials: 'include' }),
            fetchMe(),
        ]);
        if (!regionRes.ok) return;
        region = await regionRes.json();
        if (freshPlayer) { player = freshPlayer; updatePAHSPanel(freshPlayer); }
        if (renderer) {
            renderer.setNodes(buildNodes(region));
            renderer.setOperatives(myOperativesInRegion());
            renderer.setPaths(buildPaths());
        }
        if (selectedNode) renderNodeInfo(selectedNode);
    } catch { /* silent */ }
}

window.loadRegion = async function(id) {
    setView('map');
    document.getElementById('mapLoading').style.display = 'flex';

    try {
        const res = await fetch(`/api/nic/regions/${id}`, { credentials: 'include' });
        if (!res.ok) throw new Error('Not found');
        region = await res.json();
    } catch {
        showToast('Failed to load region.', 'error');
        showRegionList();
        return;
    }

    document.getElementById('regionTitle').textContent = region.name;

    const terrain = generateTerrain(region.seed);

    if (!renderer) {
        const canvas = document.getElementById('mapCanvas');
        renderer = new NICRenderer(canvas);
        canvas.addEventListener('tilehover', e => onTileHover(e.detail));
        canvas.addEventListener('tileclick', e => onTileClick(e.detail));
    }

    renderer.load(terrain, buildNodes(region));
    renderer.setOperatives(myOperativesInRegion());
    renderer.setPaths(buildPaths());
    renderer.centerOn(128, 128);
    renderer.zoom = 2;

    document.getElementById('mapLoading').style.display = 'none';
};

// ─── Create Region ────────────────────────────────────────────────────────────
window.openCreateRegion = function() {
    if (player?.own_region) {
        showToast('You already own a region. Delete it first to create a new one.', 'error');
        return;
    }
    const guilds = player?.guilds || [];
    if (!guilds.length) {
        showToast('You need to be in a NexusGuild guild to create a region.', 'error');
        return;
    }
    const guildOptions = guilds.map(g =>
        `<option value="${escHtml(g.id)}">${escHtml(g.name)}</option>`
    ).join('');

    const modal = document.getElementById('createRegionModal');
    modal.innerHTML = `
        <div class="modal-backdrop" onclick="closeCreateRegionModal()"></div>
        <div class="modal-box">
            <div class="modal-header">
                <span>Create Region</span>
                <button class="modal-close" onclick="closeCreateRegionModal()">✕</button>
            </div>
            <div class="modal-body">
                <label class="modal-label">Region Name</label>
                <input class="modal-input" id="newRegionName" type="text" maxlength="60" value="New Region" />

                <label class="modal-label">Link to Guild</label>
                <select class="modal-input" id="newRegionGuild" onchange="onVisibilityChange(document.getElementById('newRegionVisibility').value)">
                    ${guildOptions}
                </select>

                <label class="modal-label">Visibility</label>
                <select class="modal-input" id="newRegionVisibility" onchange="onVisibilityChange(this.value)">
                    <option value="guild" selected>Guild — guildmates only</option>
                    <option value="invite">Invite — guildmates + invited players</option>
                    <option value="public">Public — anyone can enter</option>
                </select>

                <div id="visibilityWarning" class="modal-warning"></div>

                <button class="btn btn-primary" style="width:100%;margin-top:12px" onclick="submitCreateRegion()">Create Region</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';

    // Show initial warning
    onVisibilityChange('guild');
};

window.onVisibilityChange = function(val) {
    const warn = document.getElementById('visibilityWarning');
    if (!warn) return;
    if (val === 'guild') {
        warn.textContent = '⚠ Guildmates of the linked guild will always be able to see and enter this region.';
    } else if (val === 'invite') {
        warn.textContent = '⚠ Guildmates will always have access. You can also invite specific players via the region settings.';
    } else if (val === 'public') {
        warn.textContent = '⚠ Anyone on NIC will be able to see and enter this region, including guildmates.';
    }
};

window.closeCreateRegionModal = function() {
    document.getElementById('createRegionModal').style.display = 'none';
};

window.submitCreateRegion = async function() {
    const name = document.getElementById('newRegionName').value.trim() || 'New Region';
    const serverId = document.getElementById('newRegionGuild').value;
    const visibility = document.getElementById('newRegionVisibility').value;
    if (!serverId) { showToast('Please select a guild.', 'error'); return; }
    closeCreateRegionModal();
    await createRegion(name, serverId, visibility);
};

async function createRegion(name, serverId, visibility = 'guild') {
    try {
        const res = await fetch('/api/nic/regions', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, server_id: serverId, visibility }),
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error || 'Failed to create region.', 'error'); return; }
        player = await fetchMe();
        updatePAHSPanel(player);
        showToast('Region created!', 'success');
        await loadRegion(data.id);
    } catch {
        showToast('Failed to create region.', 'error');
    }
}

// ─── Tile Interaction ─────────────────────────────────────────────────────────
function onTileHover({ tile, terrain, node }) {
    const bar = document.getElementById('tileBar');
    if (terrain === null || terrain === undefined) { bar.textContent = ''; return; }
    let text = `(${tile.x}, ${tile.y})  ${TERRAIN_NAMES[terrain]}`;
    if (node) {
        if (node.node_category === 'resource')  text += `  ·  ${capitalize(node.resource_type)} [${node.purity}]`;
        else if (node.node_category === 'research') text += `  ·  Research Node (${node.tech_id})`;
        else if (node.node_category === 'entry')    text += `  ·  Entry Point`;
        else if (node.node_category === 'structure') text += `  ·  ${capitalize(node.structure_type)} (${node.owner_name})`;
    }
    bar.textContent = text;
}

function onTileClick({ tile, node }) {
    const panel = document.getElementById('infoPanel');
    if (!node) { panel.classList.remove('open'); selectedNode = null; return; }
    selectedNode = node;
    panel.classList.add('open');
    renderNodeInfo(node);
}

function renderNodeInfo(node) {
    const panel = document.getElementById('infoPanelBody');

    if (node.node_category === 'resource') {
        const cfg = NODE_CONFIG.resource?.[node.resource_type]?.[node.purity] ?? {};
        const minerStructure = region?.structures?.find(s => s.node_id === node.id && s.structure_type === 'miner');
        const hasMiner = !!minerStructure;
        const deployedHere = player?.operatives?.find(op =>
            op.status === 'deployed' && op.tile_x === node.tile_x && op.tile_y === node.tile_y
        );
        const deployedElsewhere = player?.operatives?.find(op =>
            op.status === 'deployed' && !(op.tile_x === node.tile_x && op.tile_y === node.tile_y)
        );
        const travelingHere = player?.operatives?.find(op =>
            op.status === 'traveling' &&
            op.task?.target_tile_x === node.tile_x && op.task?.target_tile_y === node.tile_y
        );
        const travelingElsewhere = player?.operatives?.find(op =>
            op.status === 'traveling' &&
            !(op.task?.target_tile_x === node.tile_x && op.task?.target_tile_y === node.tile_y)
        );
        const idleOp = player?.operatives?.find(op => op.status === 'idle');
        const availableOp = idleOp || deployedElsewhere || travelingElsewhere;

        const actions = [];
        if (deployedHere && !hasMiner)
            actions.push(`<button class="btn btn-primary" onclick="buildMiner('${deployedHere.id}','${node.id}')">⚙ Build Miner (30 Ferrite + 10 Pyrene)</button>`);
        if (availableOp && !deployedHere && !travelingHere) {
            const label = availableOp.status === 'traveling' ? 'Redirect' : (deployedElsewhere ? 'Redeploy' : 'Deploy');
            actions.push(`<button class="btn btn-ghost" onclick="deployOperative('${availableOp.id}','${node.id}')">🚀 ${label} ${escHtml(availableOp.name)}</button>`);
        }
        if (deployedHere)
            actions.push(`<button class="btn btn-ghost" onclick="recallOperative('${deployedHere.id}')">↩ Recall ${escHtml(deployedHere.name)}</button>`);
        if (travelingHere)
            actions.push(`<button class="btn btn-ghost" onclick="recallOperative('${travelingHere.id}')">↩ Recall ${escHtml(travelingHere.name)}</button>`);
        if (travelingElsewhere && !travelingHere)
            actions.push(`<button class="btn btn-ghost" onclick="recallOperative('${travelingElsewhere.id}')">↩ Recall ${escHtml(travelingElsewhere.name)}</button>`);
        if (hasMiner && minerStructure.tier < MAX_MINER_TIER) {
            const nextTier = minerStructure.tier + 1;
            const cost = MINER_UPGRADE_COSTS[nextTier];
            actions.push(`<button class="btn btn-ghost" onclick="upgradeMiner('${minerStructure.id}')">⬆ Upgrade T${minerStructure.tier}→T${nextTier} (${cost.ferrite}F + ${cost.pyrene}P)</button>`);
        }

        panel.innerHTML = `
            <div class="info-row"><span class="info-label">Type</span><span class="info-val">${capitalize(node.resource_type)}</span></div>
            <div class="info-row"><span class="info-label">Purity</span><span class="info-val purity-${node.purity}">${capitalize(node.purity)}</span></div>
            <div class="info-row"><span class="info-label">Rate</span><span class="info-val">${cfg.rate ?? '—'}</span></div>
            <div class="info-row"><span class="info-label">Miner</span><span class="info-val">${hasMiner ? `✅ T${minerStructure.tier} Active` : '—'}</span></div>
            <div class="info-row"><span class="info-label">Tile</span><span class="info-val">(${node.tile_x}, ${node.tile_y})</span></div>
            <div class="info-actions">${actions.join('')}</div>
        `;
    } else if (node.node_category === 'research') {
        panel.innerHTML = `
            <div class="info-row"><span class="info-label">Tech</span><span class="info-val">${node.tech_id}</span></div>
            <div class="info-row"><span class="info-label">Status</span><span class="info-val">${node.discovered ? 'Discovered' : 'Undiscovered'}</span></div>
            <div class="info-row"><span class="info-label">Tile</span><span class="info-val">(${node.tile_x}, ${node.tile_y})</span></div>
        `;
    } else if (node.node_category === 'entry') {
        const opHere = player?.operatives?.find(op =>
            op.status === 'deployed' && op.tile_x === node.tile_x && op.tile_y === node.tile_y
        );
        const travelingHere = player?.operatives?.find(op =>
            op.status === 'traveling' &&
            op.task?.target_tile_x === node.tile_x && op.task?.target_tile_y === node.tile_y
        );
        const availableOp = player?.operatives?.find(op =>
            op.status === 'idle' ||
            (op.status === 'deployed' && !(op.tile_x === node.tile_x && op.tile_y === node.tile_y)) ||
            (op.status === 'traveling' && !(op.task?.target_tile_x === node.tile_x && op.task?.target_tile_y === node.tile_y))
        );
        const epActions = [];
        if (!opHere && !travelingHere && availableOp) {
            const label = availableOp.status === 'traveling' ? 'Redirect' : 'Send';
            epActions.push(`<button class="btn btn-ghost" onclick="moveOperative('${availableOp.id}',${node.tile_x},${node.tile_y})">🚶 ${label} ${escHtml(availableOp.name)} here</button>`);
        }
        if (opHere)
            epActions.push(`<button class="btn btn-ghost" onclick="recallOperative('${opHere.id}')">↩ Recall ${escHtml(opHere.name)}</button>`);
        if (travelingHere)
            epActions.push(`<button class="btn btn-ghost" onclick="recallOperative('${travelingHere.id}')">↩ Recall ${escHtml(travelingHere.name)} (in transit)</button>`);
        panel.innerHTML = `
            <div class="info-row"><span class="info-label">Type</span><span class="info-val">Entry Point</span></div>
            <div class="info-row"><span class="info-label">Tile</span><span class="info-val">(${node.tile_x}, ${node.tile_y})</span></div>
            <div class="info-actions">${epActions.join('')}</div>
        `;
    } else if (node.node_category === 'structure') {
        panel.innerHTML = `
            <div class="info-row"><span class="info-label">Type</span><span class="info-val">${capitalize(node.structure_type)} T${node.tier}</span></div>
            <div class="info-row"><span class="info-label">Owner</span><span class="info-val">${escHtml(node.owner_name ?? 'Unknown')}</span></div>
            <div class="info-row"><span class="info-label">Power</span><span class="info-val">${node.power_draw ?? 10} MW</span></div>
            <div class="info-row"><span class="info-label">Tile</span><span class="info-val">(${node.tile_x}, ${node.tile_y})</span></div>
        `;
    }
}

// ─── Actions ──────────────────────────────────────────────────────────────────
window.deployOperative = async function(opId, nodeId) {
    try {
        const res = await fetch(`/api/nic/operatives/${opId}/deploy`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ region_id: region.id, node_id: nodeId }),
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error, 'error'); return; }
        showToast(`Operative en route — ETA ${data.minutes} min`, 'success');
        player = await fetchMe();
        updatePAHSPanel(player);
        if (renderer) { renderer.setOperatives(myOperativesInRegion()); renderer.setPaths(buildPaths()); }
        if (selectedNode) renderNodeInfo(selectedNode);
    } catch {
        showToast('Failed to deploy operative.', 'error');
    }
};

window.recallOperative = async function(opId) {
    try {
        const res = await fetch(`/api/nic/operatives/${opId}/recall`, {
            method: 'POST', credentials: 'include',
        });
        if (!res.ok) { showToast((await res.json()).error, 'error'); return; }
        showToast('Operative recalled.', 'success');
        player = await fetchMe();
        updatePAHSPanel(player);
        if (renderer) { renderer.setOperatives(myOperativesInRegion()); renderer.setPaths(buildPaths()); }
        if (selectedNode) renderNodeInfo(selectedNode);
    } catch {
        showToast('Failed to recall operative.', 'error');
    }
};

window.moveOperative = async function(opId, tileX, tileY) {
    try {
        const res = await fetch(`/api/nic/operatives/${opId}/move`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ region_id: region.id, tile_x: tileX, tile_y: tileY }),
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error, 'error'); return; }
        showToast(`Operative en route — ETA ${data.minutes} min`, 'success');
        player = await fetchMe();
        updatePAHSPanel(player);
        if (renderer) { renderer.setOperatives(myOperativesInRegion()); renderer.setPaths(buildPaths()); }
        if (selectedNode) renderNodeInfo(selectedNode);
    } catch { showToast('Failed to move operative.', 'error'); }
};

window.upgradeMiner = async function(structureId) {
    try {
        const res = await fetch(`/api/nic/structures/${structureId}/upgrade`, {
            method: 'POST', credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error, 'error'); return; }
        showToast(`Miner upgraded to Tier ${data.tier}!`, 'success');
        await refreshRegionData();
    } catch { showToast('Failed to upgrade miner.', 'error'); }
};

window.recruitOperative = async function() {
    try {
        const res = await fetch('/api/nic/operatives/recruit', {
            method: 'POST', credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error, 'error'); return; }
        showToast(`${data.name} recruited!`, 'success');
        player = await fetchMe();
        updatePAHSPanel(player);
    } catch { showToast('Failed to recruit operative.', 'error'); }
};

window.buildMiner = async function(opId, nodeId) {
    try {
        const res = await fetch('/api/nic/structures/build', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operative_id: opId, node_id: nodeId }),
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error, 'error'); return; }
        showToast('Miner constructed!', 'success');
        await refreshRegionData();
    } catch {
        showToast('Failed to build miner.', 'error');
    }
};

// ─── Path Building ────────────────────────────────────────────────────────────
function buildPaths() {
    if (!region) return [];
    const myPaths = (player?.operatives || [])
        .filter(op => op.status === 'traveling' && op.task?.region_id === region.id)
        .map(op => {
            const task = op.task;
            return {
                from:    { x: task.from_tile_x,   y: task.from_tile_y },
                to:      { x: task.target_tile_x, y: task.target_tile_y },
                eta:     new Date(task.eta).getTime(),
                totalMs: new Date(task.eta).getTime() - new Date(task.started_at).getTime(),
                label:   op.name,
            };
        });
    const foreignPaths = (region.foreign_operatives || [])
        .filter(op => op.status === 'traveling' && op.task)
        .map(op => {
            const task = op.task;
            return {
                from:      { x: task.from_tile_x,   y: task.from_tile_y },
                to:        { x: task.target_tile_x, y: task.target_tile_y },
                eta:       new Date(task.eta).getTime(),
                totalMs:   new Date(task.eta).getTime() - new Date(task.started_at).getTime(),
                label:     `${op.owner_name}: ${op.name}`,
                lineColor: 'rgba(255, 100, 100, 0.35)',
                dotColor:  '#ff6464',
            };
        });
    return [...myPaths, ...foreignPaths];
}

// ─── PAHS Panel ───────────────────────────────────────────────────────────────
function updatePAHSPanel(p) {
    document.getElementById('pahsUsername').textContent = p.user_id;
    document.getElementById('pahsPower').textContent = `${p.power_used} / ${p.power_capacity} MW`;
    document.getElementById('pahsPowerBar').style.width = `${Math.min(100, (p.power_used / p.power_capacity) * 100)}%`;

    const resources = p.resources || {};
    document.getElementById('pahsFerrite').textContent = (resources.ferrite ?? 0).toLocaleString();
    document.getElementById('pahsPyrene').textContent  = (resources.pyrene  ?? 0).toLocaleString();

    const opCount = (p.operatives || []).length;
    const canRecruit = opCount < MAX_OPERATIVES &&
        (p.resources?.ferrite ?? 0) >= RECRUIT_COST.ferrite &&
        (p.resources?.pyrene  ?? 0) >= RECRUIT_COST.pyrene;
    const recruitBtn = opCount < MAX_OPERATIVES
        ? `<button class="btn btn-ghost" style="width:100%;font-size:10px;margin-top:6px" onclick="recruitOperative()" ${canRecruit ? '' : 'disabled title="Need more resources"'}>+ Recruit (${RECRUIT_COST.ferrite}F + ${RECRUIT_COST.pyrene}P)</button>`
        : '';

    const opList = document.getElementById('operativeList');
    opList.innerHTML = (p.operatives || []).map(op => {
        let statusText = capitalize(op.status);
        let etaText = '';
        if (op.status === 'traveling' && op.task?.eta) {
            const msLeft = new Date(op.task.eta) - Date.now();
            if (msLeft > 0) {
                const minsLeft = Math.ceil(msLeft / 60_000);
                etaText = `<span class="op-eta">ETA ${minsLeft}m</span>`;
            } else {
                statusText = 'Arriving…';
            }
        } else if (op.status === 'deployed') {
            statusText = `Deployed (${op.tile_x},${op.tile_y})`;
        }
        const canRecall = op.status === 'traveling' || op.status === 'deployed';
        return `
            <div class="operative ${op.status}">
                <span class="op-name">${escHtml(op.name)}</span>
                <span class="op-status">${statusText}${etaText}</span>
                ${canRecall ? `<button class="op-recall-btn" onclick="recallOperative('${op.id}')" title="Recall">↩</button>` : ''}
            </div>
        `;
    }).join('') || '<div class="empty-ops">No operatives</div>';
    opList.innerHTML += recruitBtn;
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function setView(view) {
    document.getElementById('viewList').style.display = view === 'list' ? 'flex' : 'none';
    document.getElementById('viewMap').style.display  = view === 'map'  ? 'flex' : 'none';
}

window.backToList = function() {
    region = null; selectedNode = null;
    document.getElementById('infoPanel').classList.remove('open');
    showRegionList();
};

window.closeInfoPanel = function() {
    document.getElementById('infoPanel').classList.remove('open');
    selectedNode = null;
    if (renderer) renderer.selected = null;
    renderer?._dirty();
};

function showToast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = `nic-toast ${type}`;
    t.textContent = msg;
    document.getElementById('toastArea').appendChild(t);
    setTimeout(() => t.remove(), 3500);
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
