// File Location: /public/js/components/channelPerms.js

// ── Module state ──────────────────────────────────────────────────────────────
let _cpChannel    = null;
let _cpServerId   = null;
let _cpOverrides  = [];   // [{target_id, target_type, allow, deny, display_name, color}]
let _cpRoles      = [];   // all server roles
let _cpMembers    = [];   // all server members
let _cpSelectedId = null; // currently selected target_id
let _cpEveryoneRole = null;
let _cpEditState  = {};   // { [target_id]: { allow: BigInt, deny: BigInt } }

// ── Permission definitions shown in the editor ────────────────────────────────
const CP_PERMS = [
    { key: 'VIEW_CHANNEL',         name: 'View Channel',          value: 1024n },
    { key: 'MANAGE_CHANNELS',      name: 'Manage Channel',        value: 16n },
    { key: 'SEND_MESSAGES',        name: 'Send Messages',         value: 2048n },
    { key: 'READ_MESSAGE_HISTORY', name: 'Read Message History',  value: 65536n },
    { key: 'MANAGE_MESSAGES',      name: 'Manage Messages',       value: 8192n },
    { key: 'MENTION_EVERYONE',     name: 'Mention @everyone',     value: 131072n },
    { key: 'ADD_REACTIONS',        name: 'Add Reactions',         value: 64n },
    { key: 'ATTACH_FILES',         name: 'Attach Files',          value: 32768n },
    { key: 'EMBED_LINKS',          name: 'Embed Links',           value: 16384n },
];

// ── Open ──────────────────────────────────────────────────────────────────────
async function openChannelPerms(channel) {
    _cpChannel  = channel;
    _cpServerId = state.currentServer?.id;
    _cpOverrides  = [];
    _cpRoles      = [];
    _cpMembers    = [];
    _cpSelectedId = null;
    _cpEveryoneRole = null;
    _cpEditState  = {};

    try {
        const [overridesRes, rolesRes, membersRes] = await Promise.all([
            fetch(`/api/channels/${channel.id}/permissions`, { credentials: 'include' }),
            fetch(`/api/servers/${_cpServerId}/roles`, { credentials: 'include' }),
            fetch(`/api/servers/${_cpServerId}/members`, { credentials: 'include' }),
        ]);

        if (overridesRes.ok) {
            const d = await overridesRes.json();
            _cpOverrides    = d.overrides || [];
            _cpEveryoneRole = d.everyoneRole || null;
        }
        if (rolesRes.ok) {
            const d = await rolesRes.json();
            _cpRoles = d.roles || [];
        }
        if (membersRes.ok) {
            const d = await membersRes.json();
            _cpMembers = d.members || [];
        }
    } catch (err) {
        console.error('openChannelPerms fetch error:', err);
    }

    // Seed edit state from existing overrides
    _cpOverrides.forEach(o => {
        _cpEditState[o.target_id] = { allow: BigInt(o.allow), deny: BigInt(o.deny) };
    });

    // Always ensure @everyone is in the list first
    if (_cpEveryoneRole && !_cpOverrides.find(o => o.target_id === _cpEveryoneRole.id)) {
        _cpOverrides.unshift({
            target_id: _cpEveryoneRole.id,
            target_type: 'role',
            allow: '0',
            deny: '0',
            display_name: '@everyone',
            color: _cpEveryoneRole.color,
        });
        _cpEditState[_cpEveryoneRole.id] = { allow: 0n, deny: 0n };
    }

    // Select @everyone by default
    if (_cpEveryoneRole) _cpSelectedId = _cpEveryoneRole.id;

    _rebuildCPUI();
    document.getElementById('channelPermsOverlay').style.display = 'flex';
    document.getElementById('channelPermsOverlay').style.flexDirection = 'column';
}

// ── Close ─────────────────────────────────────────────────────────────────────
function closeChannelPerms() {
    document.getElementById('channelPermsOverlay').style.display = 'none';
    _cpChannel = null;
    _cpServerId = null;
    _cpOverrides = [];
    _cpRoles = [];
    _cpMembers = [];
    _cpSelectedId = null;
    _cpEveryoneRole = null;
    _cpEditState = {};
}

// ── Main UI builder ───────────────────────────────────────────────────────────
function _rebuildCPUI() {
    const overlay = document.getElementById('channelPermsOverlay');

    // Left panel: target list
    const leftItems = _cpOverrides.map(o => {
        const isSelected = o.target_id === _cpSelectedId;
        const dotColor = o.color || '#99aab5';
        return `<div class="chperms-target-item${isSelected ? ' active' : ''}"
                     onclick="selectCPTarget('${o.target_id}')">
            <span class="chperms-target-dot" style="background:${dotColor}"></span>
            ${_escHtml(o.display_name || o.target_id)}
        </div>`;
    }).join('');

    overlay.innerHTML = `
        <div class="chperms-header">
            <h2>Permissions — #${_escHtml(_cpChannel?.name || '')}</h2>
            <button class="chperms-close-btn" onclick="closeChannelPerms()">✕</button>
        </div>
        <div class="chperms-body">
            <div class="chperms-left">
                ${leftItems}
                <div class="chperms-add-btn" onclick="openAddCPTarget()">+ Add role or member</div>
            </div>
            <div class="chperms-right" id="cpRight">
                ${_buildCPEditor()}
            </div>
        </div>`;
}

// ── Select a target ───────────────────────────────────────────────────────────
function selectCPTarget(targetId) {
    _cpSelectedId = targetId;
    _rebuildCPUI();
}

// ── Right panel: permission editor ───────────────────────────────────────────
function _buildCPEditor() {
    if (!_cpSelectedId) return '<p class="chperms-placeholder">Select a role or member to edit permissions.</p>';

    const override = _cpOverrides.find(o => o.target_id === _cpSelectedId);
    if (!override) return '<p class="chperms-placeholder">No override found.</p>';

    const es = _cpEditState[_cpSelectedId] || { allow: 0n, deny: 0n };

    const rows = CP_PERMS.map(p => {
        const isAllow = !!(es.allow & p.value);
        const isDeny  = !!(es.deny  & p.value);
        // State: allow → deny → neutral cycling
        return `<div class="chperms-perm-row">
            <span class="chperms-perm-name">${_escHtml(p.name)}</span>
            <div class="chperms-state-btns">
                <button class="chperms-state-btn${isAllow ? ' active-allow' : ''}"
                        title="Allow"
                        onclick="setCPPerm('${p.key}', ${p.value}n, 'allow')">✓</button>
                <button class="chperms-state-btn${(!isAllow && !isDeny) ? ' active-allow' : ''}"
                        title="Neutral" style="${(!isAllow && !isDeny) ? 'background:#4e5058;color:#fff' : ''}"
                        onclick="setCPPerm('${p.key}', ${p.value}n, 'neutral')">—</button>
                <button class="chperms-state-btn${isDeny ? ' active-deny' : ''}"
                        title="Deny"
                        onclick="setCPPerm('${p.key}', ${p.value}n, 'deny')">✗</button>
            </div>
        </div>`;
    }).join('');

    const isEveryoneTarget = _cpEveryoneRole && _cpSelectedId === _cpEveryoneRole.id;

    return `
        <div class="chperms-perm-section">
            <div class="chperms-perm-section-title">Channel Permissions — ${_escHtml(override.display_name || _cpSelectedId)}</div>
            ${rows}
        </div>
        <div class="chperms-save-row">
            <button class="chperms-save-btn primary" onclick="saveCPOverride('${_cpSelectedId}')">Save</button>
            ${!isEveryoneTarget ? `<button class="chperms-save-btn danger" onclick="removeCPOverride('${_cpSelectedId}')">Remove Override</button>` : ''}
        </div>`;
}

// ── Set a permission state ────────────────────────────────────────────────────
function setCPPerm(key, value, state_) {
    if (!_cpSelectedId) return;
    if (!_cpEditState[_cpSelectedId]) _cpEditState[_cpSelectedId] = { allow: 0n, deny: 0n };
    const es = _cpEditState[_cpSelectedId];

    // Clear both bits first
    es.allow &= ~value;
    es.deny  &= ~value;

    if (state_ === 'allow') es.allow |= value;
    else if (state_ === 'deny') es.deny |= value;
    // neutral → both remain cleared

    // Re-render just the right panel
    const right = document.getElementById('cpRight');
    if (right) right.innerHTML = _buildCPEditor();
}

// ── Save override ─────────────────────────────────────────────────────────────
async function saveCPOverride(targetId) {
    const override = _cpOverrides.find(o => o.target_id === targetId);
    if (!override || !_cpChannel) return;

    const es = _cpEditState[targetId] || { allow: 0n, deny: 0n };

    try {
        const res = await fetch(`/api/channels/${_cpChannel.id}/permissions/${targetId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                target_type: override.target_type,
                allow: es.allow.toString(),
                deny:  es.deny.toString(),
            }),
        });
        if (res.ok) {
            // Update local override record
            override.allow = es.allow.toString();
            override.deny  = es.deny.toString();
            if (typeof showToast === 'function') showToast('Permissions saved.');
        } else {
            const d = await res.json();
            alert(d.error || 'Failed to save permissions.');
        }
    } catch (err) {
        console.error('saveCPOverride error:', err);
        alert('Failed to save permissions.');
    }
}

// ── Remove override ───────────────────────────────────────────────────────────
async function removeCPOverride(targetId) {
    if (!_cpChannel) return;
    try {
        const res = await fetch(`/api/channels/${_cpChannel.id}/permissions/${targetId}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        if (res.ok) {
            _cpOverrides = _cpOverrides.filter(o => o.target_id !== targetId);
            delete _cpEditState[targetId];
            _cpSelectedId = _cpEveryoneRole?.id || (_cpOverrides[0]?.target_id ?? null);
            _rebuildCPUI();
            if (typeof showToast === 'function') showToast('Override removed.');
        } else {
            const d = await res.json();
            alert(d.error || 'Failed to remove override.');
        }
    } catch (err) {
        console.error('removeCPOverride error:', err);
        alert('Failed to remove override.');
    }
}

// ── Add target picker ─────────────────────────────────────────────────────────
function openAddCPTarget() {
    const existingIds = new Set(_cpOverrides.map(o => o.target_id));

    // Build list of available roles and members not already in override list
    const availableRoles = _cpRoles.filter(r => !existingIds.has(r.id));
    const availableMembers = _cpMembers.filter(m => !existingIds.has(m.id));

    const pickerEl = document.createElement('div');
    pickerEl.className = 'chperms-picker-overlay';
    pickerEl.id = 'cpPickerOverlay';

    function _renderList(roleFilter, memberFilter) {
        const roleItems = availableRoles
            .filter(r => r.name.toLowerCase().includes(roleFilter))
            .map(r => `<div class="chperms-picker-item"
                             onclick="_submitAddCPTarget('${r.id}','role',${JSON.stringify(r.name)},${JSON.stringify(r.color || '#99aab5')})">
                <span class="chperms-target-dot" style="background:${r.color || '#99aab5'}"></span>
                ${_escHtml(r.name)} <span style="font-size:11px;color:#6b7280;margin-left:4px;">role</span>
            </div>`).join('');
        const memberItems = availableMembers
            .filter(m => (m.username || '').toLowerCase().includes(memberFilter))
            .map(m => `<div class="chperms-picker-item"
                             onclick="_submitAddCPTarget('${m.id}','member',${JSON.stringify(m.nickname || m.username)},null)">
                <span class="chperms-target-dot" style="background:#5865f2"></span>
                ${_escHtml(m.nickname || m.username)} <span style="font-size:11px;color:#6b7280;margin-left:4px;">member</span>
            </div>`).join('');
        return roleItems + (roleItems && memberItems ? '<div style="border-top:1px solid #3c3f45;margin:4px 0;"></div>' : '') + memberItems ||
               '<div style="color:#b5bac1;font-size:13px;padding:8px 10px;">No more roles or members to add.</div>';
    }

    pickerEl.innerHTML = `
        <div class="chperms-picker-box">
            <h3>Add Role or Member</h3>
            <input class="chperms-picker-search" id="cpPickerSearch" placeholder="Search..." oninput="_filterCPPicker(this.value)">
            <div class="chperms-picker-list" id="cpPickerList">${_renderList('', '')}</div>
            <button class="chperms-picker-close" onclick="document.getElementById('cpPickerOverlay')?.remove()">Cancel</button>
        </div>`;

    document.body.appendChild(pickerEl);

    // Store the renderer for filtering
    window._cpPickerRenderList = _renderList;

    // Close on backdrop click
    pickerEl.addEventListener('click', (e) => {
        if (e.target === pickerEl) pickerEl.remove();
    });

    pickerEl.querySelector('#cpPickerSearch')?.focus();
}

function _filterCPPicker(query) {
    const list = document.getElementById('cpPickerList');
    if (!list || !window._cpPickerRenderList) return;
    const q = query.toLowerCase();
    list.innerHTML = window._cpPickerRenderList(q, q);
}

function _submitAddCPTarget(targetId, targetType, displayName, color) {
    document.getElementById('cpPickerOverlay')?.remove();

    // Guard: already exists
    if (_cpOverrides.find(o => o.target_id === targetId)) {
        _cpSelectedId = targetId;
        _rebuildCPUI();
        return;
    }

    _cpOverrides.push({
        target_id: targetId,
        target_type: targetType,
        allow: '0',
        deny: '0',
        display_name: displayName,
        color: color || '#99aab5',
    });
    _cpEditState[targetId] = { allow: 0n, deny: 0n };
    _cpSelectedId = targetId;
    _rebuildCPUI();
}

// ── Utility ───────────────────────────────────────────────────────────────────
function _escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
