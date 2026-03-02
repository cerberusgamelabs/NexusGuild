// Ascension skill tree renderer

// ── Public API ────────────────────────────────────────────────────────────────

async function renderUserSkillTree(container) {
    try {
        const [nodesRes, balRes, unlocksRes] = await Promise.all([
            fetch('/api/ascension/nodes?type=user', { credentials: 'include' }).then(r => r.json()),
            fetch('/api/ascension/balance',          { credentials: 'include' }).then(r => r.json()),
            fetch('/api/ascension/unlocks',          { credentials: 'include' }).then(r => r.json())
        ]);
        _renderTree(container, nodesRes.nodes || [], unlocksRes.unlocks || [], balRes.balance || 0, 'user', null);
    } catch {
        container.innerHTML = '<p style="color:#f23f43;font-size:13px;">Failed to load skill tree.</p>';
    }
}

async function renderServerSkillTree(container, serverId) {
    try {
        const [nodesRes, balRes, unlocksRes] = await Promise.all([
            fetch('/api/ascension/nodes?type=server',                     { credentials: 'include' }).then(r => r.json()),
            fetch(`/api/ascension/servers/${serverId}/balance`,           { credentials: 'include' }).then(r => r.json()),
            fetch(`/api/ascension/servers/${serverId}/unlocks`,           { credentials: 'include' }).then(r => r.json())
        ]);
        _renderTree(container, nodesRes.nodes || [], unlocksRes.unlocks || [], balRes.balance || 0, 'server', serverId);
    } catch {
        container.innerHTML = '<p style="color:#f23f43;font-size:13px;">Failed to load skill tree.</p>';
    }
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _buildTiers(nodes) {
    const map = new Map();
    for (const n of nodes) {
        if (!map.has(n.tier)) map.set(n.tier, []);
        map.get(n.tier).push(n);
    }
    // Already sorted by API (tier, sort_order) — ensure key order
    return new Map([...map.entries()].sort((a, b) => a[0] - b[0]));
}

function _nodeState(node, unlocks, balance, allNodes) {
    const unlockMap = new Map(unlocks.map(u => [u.node_id, u]));
    const own = unlockMap.get(node.id);
    if (own) return own.is_active ? 'unlocked' : 'suspended';

    if (node.parent_id) {
        const parentUnlock = unlockMap.get(node.parent_id);
        if (!parentUnlock || !parentUnlock.is_active) return 'locked-prereq';
    }

    return balance >= node.cost ? 'unlockable' : 'locked-points';
}

function _renderTree(container, nodes, unlocks, balance, type, serverId) {
    const tiers = _buildTiers(nodes);

    let tiersHtml = '';
    for (const [, tierNodes] of tiers) {
        let nodesHtml = '';
        for (const node of tierNodes) {
            const st = _nodeState(node, unlocks, balance, nodes);
            const costLabel = st === 'unlocked' ? '✓ Unlocked'
                : st === 'suspended' ? '⚠ Suspended'
                : `${node.cost} pts`;
            const reEnableBtn = (st === 'suspended' && type === 'server')
                ? `<button class="stn-reenable-btn" onclick="_enableServerNode('${serverId}','${node.id}',this.closest('.skill-tree-wrap').parentElement)">Re-enable</button>`
                : '';
            nodesHtml += `
                <div class="skill-tree-node ${st}" data-node-id="${node.id}" title="${escapeHtml(node.description || node.name)}">
                    <div class="stn-icon">${node.icon || '⭐'}</div>
                    <div class="stn-name">${escapeHtml(node.name)}</div>
                    <div class="stn-cost">${costLabel}</div>
                    ${reEnableBtn}
                </div>`;
        }
        tiersHtml += `<div class="skill-tree-tier">${nodesHtml}</div>`;
    }

    container.innerHTML = `
        <div class="skill-tree-wrap">
            <svg class="skill-tree-svg" xmlns="http://www.w3.org/2000/svg"></svg>
            <div class="skill-tree-tiers">${tiersHtml}</div>
        </div>`;

    // Bind click handlers on unlockable nodes
    container.querySelectorAll('.skill-tree-node.unlockable').forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
            const nodeId = el.dataset.nodeId;
            if (type === 'server') _unlockServerNode(serverId, nodeId, container);
            else _unlockNode(nodeId, container);
        });
    });

    // Draw connector lines after layout
    requestAnimationFrame(() => _drawLines(container, nodes, unlocks));
}

function _drawLines(container, nodes, unlocks) {
    const svg = container.querySelector('.skill-tree-svg');
    const wrap = container.querySelector('.skill-tree-wrap');
    if (!svg || !wrap) return;

    const unlockMap = new Map(unlocks.map(u => [u.node_id, u]));
    const wrapRect = wrap.getBoundingClientRect();

    for (const node of nodes) {
        if (!node.parent_id) continue;
        const childEl  = wrap.querySelector(`[data-node-id="${node.id}"]`);
        const parentEl = wrap.querySelector(`[data-node-id="${node.parent_id}"]`);
        if (!childEl || !parentEl) continue;

        const cRect = childEl.getBoundingClientRect();
        const pRect = parentEl.getBoundingClientRect();

        const x1 = pRect.left + pRect.width / 2 - wrapRect.left;
        const y1 = pRect.bottom - wrapRect.top;
        const x2 = cRect.left + cRect.width / 2 - wrapRect.left;
        const y2 = cRect.top - wrapRect.top;

        const parentUnlock = unlockMap.get(node.parent_id);
        const childUnlock  = unlockMap.get(node.id);
        let lineClass = '';
        if (parentUnlock?.is_active && childUnlock?.is_active) lineClass = 'active';
        else if (childUnlock && !childUnlock.is_active) lineClass = 'suspended-link';

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        if (lineClass) line.setAttribute('class', lineClass);
        svg.appendChild(line);
    }
}

async function _unlockNode(nodeId, container) {
    const res = await fetch(`/api/ascension/unlock/${nodeId}`, {
        method: 'POST',
        credentials: 'include'
    });
    if (res.ok) {
        showToast('Node unlocked!');
        renderUserSkillTree(container);
    } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to unlock', true);
    }
}

async function _unlockServerNode(serverId, nodeId, container) {
    const res = await fetch(`/api/ascension/servers/${serverId}/unlock/${nodeId}`, {
        method: 'POST',
        credentials: 'include'
    });
    if (res.ok) {
        showToast('Server node unlocked!');
        renderServerSkillTree(container, serverId);
    } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to unlock', true);
    }
}

async function _enableServerNode(serverId, nodeId, container) {
    const res = await fetch(`/api/ascension/servers/${serverId}/unlocks/${nodeId}/enable`, {
        method: 'PATCH',
        credentials: 'include'
    });
    if (res.ok) {
        showToast('Node re-enabled!');
        renderServerSkillTree(container, serverId);
    } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to re-enable', true);
    }
}
