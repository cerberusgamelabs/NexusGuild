// ── Server Settings Overlay ───────────────────────────────────────────────────

// Permission flags — loaded from /api/permissions on first use
let _perm = null;

async function _loadPerms() {
    if (_perm) return;
    const res = await fetch('/api/permissions');
    _perm = await res.json();
}

const PERM_GROUPS = [
    {
        label: 'General',
        perms: [
            { key: 'VIEW_CHANNEL',          name: 'View Channels',        desc: 'Allows members to view channels' },
            { key: 'MANAGE_CHANNELS',       name: 'Manage Channels',      desc: 'Allows members to create, edit, or delete channels' },
            { key: 'MANAGE_GUILD',          name: 'Manage Server',        desc: 'Allows members to change server settings' },
            { key: 'MANAGE_ROLES',          name: 'Manage Roles',         desc: 'Allows members to create and manage roles' },
            { key: 'MANAGE_GUILD_EXPRESSIONS', name: 'Manage Expressions', desc: 'Allows members to add or remove custom emoji and stickers' },
            { key: 'CREATE_INSTANT_INVITE', name: 'Create Invite',        desc: 'Allows members to invite new people' },
            { key: 'VIEW_AUDIT_LOG',        name: 'View Audit Log',       desc: 'Allows members to view the server audit log' },
            { key: 'ADMINISTRATOR',         name: 'Administrator',        desc: 'Grants all permissions — use with care' },
        ]
    },
    {
        label: 'Text',
        perms: [
            { key: 'SEND_MESSAGES',       name: 'Send Messages',        desc: 'Allows members to send messages' },
            { key: 'MANAGE_MESSAGES',     name: 'Manage Messages',      desc: 'Allows members to delete others\' messages' },
            { key: 'EMBED_LINKS',         name: 'Embed Links',          desc: 'Links posted will show as embeds' },
            { key: 'ATTACH_FILES',        name: 'Attach Files',         desc: 'Allows members to upload files' },
            { key: 'READ_MESSAGE_HISTORY',name: 'Read Message History', desc: 'Allows members to read past messages in a channel' },
            { key: 'ADD_REACTIONS',       name: 'Add Reactions',        desc: 'Allows members to add emoji reactions' },
            { key: 'USE_EXTERNAL_EMOJIS', name: 'Use External Emojis',  desc: 'Allows members to use emojis from other servers' },
            { key: 'MENTION_EVERYONE',    name: 'Mention @everyone',    desc: 'Allows members to use @everyone and @here' },
        ]
    },
    {
        label: 'Voice',
        perms: [
            { key: 'CONNECT',          name: 'Connect',          desc: 'Allows members to join voice channels' },
            { key: 'SPEAK',            name: 'Speak',            desc: 'Allows members to speak in voice channels' },
            { key: 'STREAM',           name: 'Video',            desc: 'Allows members to share their screen or camera' },
            { key: 'USE_VAD',          name: 'Use Voice Activity', desc: 'Allows members to use voice activity detection instead of push-to-talk' },
            { key: 'PRIORITY_SPEAKER', name: 'Priority Speaker', desc: 'Allows members to speak over others (volume reduced for others)' },
            { key: 'MUTE_MEMBERS',     name: 'Mute Members',     desc: 'Allows members to mute others in voice' },
            { key: 'DEAFEN_MEMBERS',   name: 'Deafen Members',   desc: 'Allows members to deafen others in voice' },
            { key: 'MOVE_MEMBERS',     name: 'Move Members',     desc: 'Allows members to move others between channels' },
        ]
    },
    {
        label: 'Threads',
        perms: [
            { key: 'CREATE_PUBLIC_THREADS',    name: 'Create Public Threads',  desc: 'Allows members to create public threads' },
            { key: 'CREATE_PRIVATE_THREADS',   name: 'Create Private Threads', desc: 'Allows members to create private threads' },
            { key: 'MANAGE_THREADS',           name: 'Manage Threads',         desc: 'Allows members to rename, delete, and archive threads' },
            { key: 'SEND_MESSAGES_IN_THREADS', name: 'Send Messages in Threads', desc: 'Allows members to send messages in threads' },
        ]
    },
    {
        label: 'Nickname',
        perms: [
            { key: 'CHANGE_NICKNAME',  name: 'Change Nickname',  desc: 'Allows members to change their own nickname' },
            { key: 'MANAGE_NICKNAMES', name: 'Manage Nicknames', desc: 'Allows members to change others\' nicknames' },
        ]
    },
    {
        label: 'Members',
        perms: [
            { key: 'KICK_MEMBERS',    name: 'Kick Members',   desc: 'Allows members to kick other members' },
            { key: 'BAN_MEMBERS',     name: 'Ban Members',    desc: 'Allows members to ban other members' },
            { key: 'MODERATE_MEMBERS',name: 'Timeout Members',desc: 'Allows members to put others in timeout' },
        ]
    },
    {
        label: 'VTT',
        perms: [
            { key: 'VTT_GM', name: 'VTT Game Master', desc: 'Allows members to act as GM in VTT channels — upload maps, move all tokens, control fog of war, and manage encounters' },
        ]
    },
];

// State local to this module
let _settingsServerId = null;
let _settingsTab = 'overview';
let _selectedRoleId = null;
let _settingsRoles = [];
let _settingsMembersFilter = '';
let _dragSourceRoleId = null;

// ── Open / Close ─────────────────────────────────────────────────────────────

function openServerSettings(tab = 'overview') {
    if (!state.currentServer) return;
    _settingsServerId = state.currentServer.id;
    _settingsTab = tab;
    _selectedRoleId = null;

    document.getElementById('settingsSidebarServerName').textContent = state.currentServer.name;
    document.getElementById('serverSettingsOverlay').style.display = 'flex';

    // Trap Escape key
    document.addEventListener('keydown', _settingsEscHandler);

    switchSettingsTab(tab);
}

function closeServerSettings() {
    document.getElementById('serverSettingsOverlay').style.display = 'none';
    document.removeEventListener('keydown', _settingsEscHandler);
    _settingsServerId = null;
}

function _settingsEscHandler(e) {
    if (e.key === 'Escape') closeServerSettings();
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function switchSettingsTab(tab) {
    _settingsTab = tab;

    // Update nav button styles
    document.querySelectorAll('.settings-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    const content = document.getElementById('settingsContent');
    switch (tab) {
        case 'overview': renderOverviewTab(content); break;
        case 'roles':    renderRolesTab(content);    break;
        case 'members':  renderMembersTab(content);  break;
        case 'invites':  renderInvitesTab(content);  break;
        case 'emojis':     renderEmojisTab(content);      break;
        case 'ascension':  renderAscensionTab(content);   break;
        case 'audit':      renderAuditTab(content);       break;
        case 'webhooks':   renderWebhooksTab(content);    break;
        case 'reports':    renderReportsTab(content);     break;
        case 'nic':        renderNicTab(content);         break;
        case 'danger':     renderDangerZoneTab(content);  break;
    }
}

// Called by socket.js when role_updated fires
function refreshSettingsIfOpen(serverId) {
    const overlay = document.getElementById('serverSettingsOverlay');
    if (!overlay || overlay.style.display === 'none') return;
    if (serverId !== _settingsServerId) return;
    if (_settingsTab === 'roles') renderRolesTab(document.getElementById('settingsContent'));
    if (_settingsTab === 'members') renderMembersTab(document.getElementById('settingsContent'));
}

// ── Overview Tab ─────────────────────────────────────────────────────────────

function renderOverviewTab(container) {
    const server = state.currentServer;
    const iconHtml = server.icon && (server.icon.startsWith('/') || server.icon.startsWith('http'))
        ? `<img src="${server.icon}" alt="${escHtml(server.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`
        : `<span style="font-size:22px;font-weight:700;">${getInitials(server.name)}</span>`;

    container.innerHTML = `
        <h2 class="settings-section-title">Server Overview</h2>
        <div class="settings-field">
            <label class="settings-label">Server Icon</label>
            <div style="display:flex;align-items:center;gap:12px;">
                <div id="settingsIconPreview" class="settings-icon-preview">${iconHtml}</div>
                <button class="settings-btn secondary" onclick="document.getElementById('settingsIconInput').click()">Upload Image</button>
                <input type="file" id="settingsIconInput" accept="image/*" style="display:none" onchange="uploadServerIcon(event)">
            </div>
        </div>
        <div class="settings-field">
            <label class="settings-label">Server Name</label>
            <input class="settings-input" id="settingsServerName" type="text" value="${escHtml(server.name)}" maxlength="100">
        </div>
        <div id="settingsOverviewError" style="color:#f23f43;font-size:13px;margin-bottom:12px;display:none;"></div>
        <button class="settings-btn" onclick="saveServerOverview()">Save Changes</button>
    `;
}

async function uploadServerIcon(event) {
    const file = event.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
        const res = await fetch(`/api/servers/${_settingsServerId}/icon`, {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error || 'Upload failed', true); return; }
        // Update local state
        state.currentServer.icon = data.server.icon;
        const idx = state.servers.findIndex(s => s.id === _settingsServerId);
        if (idx !== -1) state.servers[idx].icon = data.server.icon;
        renderServerList();
        // Refresh preview
        const preview = document.getElementById('settingsIconPreview');
        if (preview) {
            preview.innerHTML = `<img src="${data.server.icon}" alt="${escHtml(state.currentServer.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
        }
        showToast('Server icon updated!');
    } catch (err) {
        showToast('Upload failed', true);
    }
}

async function saveServerOverview() {
    const name = document.getElementById('settingsServerName').value.trim();
    const errEl = document.getElementById('settingsOverviewError');
    errEl.style.display = 'none';
    if (!name) { errEl.textContent = 'Name cannot be empty.'; errEl.style.display = 'block'; return; }

    try {
        const res = await fetch(`/api/servers/${_settingsServerId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.error || 'Failed to save.'; errEl.style.display = 'block'; return; }

        // Update local state
        state.currentServer.name = data.server.name;
        const idx = state.servers.findIndex(s => s.id === _settingsServerId);
        if (idx !== -1) state.servers[idx].name = data.server.name;
        document.getElementById('currentServerName').textContent = data.server.name;
        document.getElementById('settingsSidebarServerName').textContent = data.server.name;
        renderServerList();
        showToast('Server name updated!');
    } catch (err) {
        errEl.textContent = 'Request failed.';
        errEl.style.display = 'block';
    }
}

// ── NIC Tab ───────────────────────────────────────────────────────────────────

async function renderNicTab(container) {
    container.innerHTML = '<p style="color:#949ba4">Loading NIC region…</p>';
    try {
        const res = await fetch(`/api/servers/${_settingsServerId}/nic-region`, { credentials: 'include' });
        const region = res.ok ? await res.json() : null;

        if (!region) {
            container.innerHTML = `
                <h2 class="settings-section-title">Nexus Industrial Complex</h2>
                <p style="color:#949ba4;margin-bottom:16px;">No region is linked to this guild. The guild owner can link one from <a href="https://nic.nexusguild.gg" target="_blank" style="color:#5865f2;">nic.nexusguild.gg</a>.</p>
            `;
            return;
        }

        const visLabel = { public: '🌐 Public', guild: '🏰 Guild', invite: '🔒 Invite' }[region.visibility] || region.visibility;
        container.innerHTML = `
            <h2 class="settings-section-title">Nexus Industrial Complex</h2>

            <div class="settings-field">
                <label class="settings-label">Linked Region</label>
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-weight:600;">${escHtml(region.name)}</span>
                    <span style="font-size:12px;color:#949ba4;">${visLabel}</span>
                    <a href="https://nic.nexusguild.gg" target="_blank" class="settings-btn secondary" style="text-decoration:none;padding:4px 10px;font-size:12px;">Open NIC ↗</a>
                </div>
                <p style="color:#949ba4;font-size:12px;margin-top:6px;">
                    ⛏ ${region.resource_count} resource nodes · 🏗 ${region.structure_count} active structures
                </p>
            </div>

            <div class="settings-field">
                <label class="settings-label">Show Minimap in Channel List</label>
                <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
                    <input type="checkbox" id="nicMinimapToggle" ${region.nic_minimap_enabled ? 'checked' : ''}>
                    <span style="color:#949ba4;font-size:13px;">Display a live terrain preview in the channels panel</span>
                </label>
                <button class="settings-btn" style="margin-top:10px;" onclick="saveNicSettings()">Save</button>
            </div>

            <div id="nicSettingsError" style="color:#f23f43;font-size:13px;display:none;"></div>
        `;
    } catch {
        container.innerHTML = '<p style="color:#f23f43">Failed to load NIC settings.</p>';
    }
}

async function saveNicSettings() {
    const minimap = document.getElementById('nicMinimapToggle')?.checked ?? false;
    const errEl = document.getElementById('nicSettingsError');
    errEl.style.display = 'none';
    try {
        const res = await fetch(`/api/servers/${_settingsServerId}/nic-settings`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ nic_minimap_enabled: minimap }),
        });
        if (!res.ok) throw new Error();
        // Refresh channel list so the card updates live
        if (state.currentServer?.id === _settingsServerId) {
            const nicRes = await fetch(`/api/servers/${_settingsServerId}/nic-region`, { credentials: 'include' });
            state.nicRegion = nicRes.ok ? await nicRes.json() : null;
            renderChannelList(state.channels, state.categories);
        }
        showToast('NIC settings saved!');
    } catch {
        errEl.textContent = 'Failed to save settings.';
        errEl.style.display = 'block';
    }
}

// ── Roles Tab ─────────────────────────────────────────────────────────────────

async function renderRolesTab(container) {
    container.innerHTML = '<p style="color:#949ba4">Loading roles…</p>';
    try {
        const [rolesRes] = await Promise.all([
            fetch(`/api/servers/${_settingsServerId}/roles`, { credentials: 'include' }),
            _loadPerms(),
        ]);
        _settingsRoles = (await rolesRes.json()).roles || [];
    } catch {
        container.innerHTML = '<p style="color:#f23f43">Failed to load roles.</p>';
        return;
    }

    _rebuildRolesUI(container);
}

function _rebuildRolesUI(container) {
    const listHtml = _settingsRoles.map(r => `
        <div class="role-item ${r.id === _selectedRoleId ? 'selected' : ''}"
             draggable="true"
             data-role-id="${r.id}"
             ondragstart="rolesDragStart(event,'${r.id}')"
             ondragover="rolesDragOver(event)"
             ondrop="rolesDrop(event,'${r.id}')"
             ondragend="rolesDragEnd(event)"
             onclick="selectSettingsRole('${r.id}')">
            <span class="role-drag-handle">&#x2807;</span>
            <span class="role-color-dot" style="background:${r.color}"></span>
            ${escHtml(r.name)}
            ${r.hoist ? '<span class="role-hoist-badge" title="Hoisted">H</span>' : ''}
        </div>
    `).join('');

    const editorHtml = _selectedRoleId ? _buildRoleEditor() : '<div class="role-editor-empty">Select a role to edit</div>';

    container.innerHTML = `
        <h2 class="settings-section-title">Roles</h2>
        <div class="roles-layout">
            <div class="roles-list-panel">
                <button class="add-role-btn" onclick="createSettingsRole()">+ Create Role</button>
                ${listHtml}
            </div>
            <div class="role-editor" id="roleEditorPanel">
                ${editorHtml}
            </div>
        </div>
    `;
}

function _buildRoleEditor() {
    const role = _settingsRoles.find(r => r.id === _selectedRoleId);
    if (!role) return '';
    const isEveryone = role.name === '@everyone';
    const perms = Number(role.permissions);

    const groupsHtml = PERM_GROUPS.map(g => `
        <div class="perm-group-title">${g.label}</div>
        ${g.perms.map(p => {
            const checked = (perms & _perm[p.key]) !== 0;
            return `
            <div class="perm-toggle-row">
                <div class="perm-toggle-label">
                    <div class="perm-toggle-name">${p.name}</div>
                    <div class="perm-toggle-desc">${p.desc}</div>
                </div>
                <label class="perm-toggle">
                    <input type="checkbox" data-perm="${_perm[p.key]}" ${checked ? 'checked' : ''}
                           onchange="onPermToggle(this)">
                    <span class="perm-toggle-slider"></span>
                </label>
            </div>`;
        }).join('')}
    `).join('');

    return `
        ${isEveryone ? '<p style="font-size:12px;color:#949ba4;margin-bottom:12px;">The @everyone role applies to all members. Its name cannot be changed, but permissions can.</p>' : ''}
        <div class="role-name-row">
            <div class="settings-field">
                <label class="settings-label">Role Name</label>
                <input class="settings-input" id="roleNameInput" type="text"
                       value="${escHtml(role.name)}" ${isEveryone ? 'readonly style="opacity:0.5;cursor:not-allowed;"' : ''} maxlength="100">
            </div>
            <div class="settings-field">
                <label class="settings-label">Color</label>
                <input type="color" id="roleColorInput" value="${role.color}"
                       style="width:48px;height:38px;padding:2px;border:none;border-radius:4px;cursor:pointer;background:#1e1f22;">
            </div>
        </div>
        <div id="roleEditorError" style="color:#f23f43;font-size:13px;margin-bottom:12px;display:none;"></div>
        ${!isEveryone ? `
        <div class="perm-toggle-row" style="margin-bottom:8px;">
            <div class="perm-toggle-label">
                <div class="perm-toggle-name">Display role members separately</div>
                <div class="perm-toggle-desc">Online members with this role appear in their own group in the member list</div>
            </div>
            <label class="perm-toggle">
                <input type="checkbox" id="roleHoistToggle" ${role.hoist ? 'checked' : ''}>
                <span class="perm-toggle-slider"></span>
            </label>
        </div>
        <div class="perm-toggle-row" style="margin-bottom:16px;">
            <div class="perm-toggle-label">
                <div class="perm-toggle-name">Allow anyone to @mention this role</div>
                <div class="perm-toggle-desc">Anyone can mention this role to notify all members who have it</div>
            </div>
            <label class="perm-toggle">
                <input type="checkbox" id="roleMentionableToggle" ${role.mentionable ? 'checked' : ''}>
                <span class="perm-toggle-slider"></span>
            </label>
        </div>` : ''}
        ${groupsHtml}
        <div style="margin-top:20px;display:flex;gap:8px;">
            <button class="settings-btn" onclick="saveSettingsRole()">Save Role</button>
            ${!isEveryone ? `<button class="settings-btn danger" onclick="deleteSettingsRole()">Delete Role</button>` : ''}
        </div>
    `;
}

function selectSettingsRole(roleId) {
    _selectedRoleId = roleId;
    const panel = document.getElementById('roleEditorPanel');
    if (panel) panel.innerHTML = _buildRoleEditor();

    // Update selected highlight in list
    document.querySelectorAll('.role-item').forEach(el => {
        el.classList.toggle('selected', el.querySelector('.role-color-dot') &&
            el.onclick?.toString().includes(roleId));
    });
    // Re-render the list panel to update selection
    const container = document.getElementById('settingsContent');
    _rebuildRolesUI(container);
}

// Live perm state tracked in a module-level var so Save can read it
let _editingPerms = 0;

function onPermToggle(checkbox) {
    // read current perms fresh from all checkboxes
    const allBoxes = document.querySelectorAll('#roleEditorPanel input[data-perm]');
    let perms = 0;
    allBoxes.forEach(cb => { if (cb.checked) perms |= Number(cb.dataset.perm); });
    _editingPerms = perms;
}

async function createSettingsRole() {
    try {
        const res = await fetch(`/api/servers/${_settingsServerId}/roles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name: 'New Role', color: '#99AAB5', permissions: '0' }),
        });
        if (!res.ok) { showToast('Failed to create role'); return; }
        const data = await res.json();
        _settingsRoles.push(data.role);
        _selectedRoleId = data.role.id;
        _rebuildRolesUI(document.getElementById('settingsContent'));
    } catch { showToast('Failed to create role'); }
}

async function saveSettingsRole() {
    const errEl = document.getElementById('roleEditorError');
    errEl.style.display = 'none';

    const name = document.getElementById('roleNameInput').value.trim();
    const color = document.getElementById('roleColorInput').value;

    // Compute current permissions from checkboxes
    let perms = 0;
    document.querySelectorAll('#roleEditorPanel input[data-perm]').forEach(cb => {
        if (cb.checked) perms |= Number(cb.dataset.perm);
    });
    const hoist = document.getElementById('roleHoistToggle')?.checked ?? false;
    const mentionable = document.getElementById('roleMentionableToggle')?.checked ?? false;

    try {
        const res = await fetch(`/api/servers/${_settingsServerId}/roles/${_selectedRoleId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name, color, permissions: String(perms), hoist, mentionable }),
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.error || 'Failed to save.'; errEl.style.display = 'block'; return; }

        // Update local cache
        const idx = _settingsRoles.findIndex(r => r.id === _selectedRoleId);
        if (idx !== -1) _settingsRoles[idx] = data.role;
        showToast('Role saved!');
        _rebuildRolesUI(document.getElementById('settingsContent'));
    } catch { errEl.textContent = 'Request failed.'; errEl.style.display = 'block'; }
}

async function deleteSettingsRole() {
    const role = _settingsRoles.find(r => r.id === _selectedRoleId);
    if (!role) return;
    showModal({
        title: 'Delete Role',
        message: `Delete role "${role.name}"? This cannot be undone.`,
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            {
                text: 'Delete', style: 'danger', action: async () => {
                    closeModal();
                    const res = await fetch(`/api/servers/${_settingsServerId}/roles/${_selectedRoleId}`, {
                        method: 'DELETE', credentials: 'include'
                    });
                    if (res.ok) {
                        _settingsRoles = _settingsRoles.filter(r => r.id !== _selectedRoleId);
                        _selectedRoleId = null;
                        _rebuildRolesUI(document.getElementById('settingsContent'));
                        showToast('Role deleted.');
                    } else {
                        showToast('Failed to delete role.');
                    }
                }
            }
        ]
    });
}

// ── Role Drag-to-Reorder ──────────────────────────────────────────────────────

function rolesDragStart(e, roleId) {
    _dragSourceRoleId = roleId;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('dragging');
}

function rolesDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.role-item').forEach(el => el.classList.remove('drag-over'));
    e.currentTarget.classList.add('drag-over');
}

function rolesDrop(e, targetRoleId) {
    e.preventDefault();
    if (!_dragSourceRoleId || _dragSourceRoleId === targetRoleId) return;
    const srcIdx = _settingsRoles.findIndex(r => r.id === _dragSourceRoleId);
    const tgtIdx = _settingsRoles.findIndex(r => r.id === targetRoleId);
    if (srcIdx === -1 || tgtIdx === -1) return;
    const [moved] = _settingsRoles.splice(srcIdx, 1);
    _settingsRoles.splice(tgtIdx, 0, moved);
    _rebuildRolesUI(document.getElementById('settingsContent'));
    saveRoleOrder();
}

function rolesDragEnd(e) {
    document.querySelectorAll('.role-item').forEach(el =>
        el.classList.remove('dragging', 'drag-over'));
    _dragSourceRoleId = null;
}

async function saveRoleOrder() {
    const orderedIds = _settingsRoles.filter(r => r.name !== '@everyone').map(r => r.id);
    try {
        const res = await fetch(`/api/servers/${_settingsServerId}/roles/reorder`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ order: orderedIds }),
        });
        if (!res.ok) showToast('Failed to save role order');
    } catch { showToast('Failed to save role order'); }
}

// ── Members Tab ───────────────────────────────────────────────────────────────

let _settingsMembers = [];
let _openMemberMenuId = null;

async function renderMembersTab(container) {
    container.innerHTML = '<p style="color:#949ba4">Loading members…</p>';
    try {
        const [membersRes, rolesRes] = await Promise.all([
            fetch(`/api/servers/${_settingsServerId}/settings/members`, { credentials: 'include' }),
            fetch(`/api/servers/${_settingsServerId}/roles`, { credentials: 'include' }),
        ]);
        _settingsMembers = (await membersRes.json()).members || [];
        _settingsRoles = (await rolesRes.json()).roles || [];
    } catch {
        container.innerHTML = '<p style="color:#f23f43">Failed to load members.</p>';
        return;
    }
    _rebuildMembersUI(container);
}

function _rebuildMembersUI(container) {
    const isOwner = state.currentServer?.owner_id === state.currentUser?.id;
    const filter = _settingsMembersFilter.toLowerCase();
    const filtered = filter
        ? _settingsMembers.filter(m => m.username.toLowerCase().includes(filter) || (m.nickname || '').toLowerCase().includes(filter))
        : _settingsMembers;

    const rowsHtml = filtered.map(m => {
        const initials = m.username.slice(0, 2).toUpperCase();
        const displayName = m.nickname ? `${escHtml(m.nickname)} <span style="color:#949ba4;font-size:12px;">(${escHtml(m.username)})</span>` : escHtml(m.username);
        const rolesHtml = (m.roles || []).map(r =>
            `<span class="member-role-chip" style="--role-color:${r.color}">${escHtml(r.name)}</span>`
        ).join('');
        const isSelf = m.id === state.currentUser?.id;
        const isMemberOwner = m.id === state.currentServer?.owner_id;
        const canKick = clientHasPermission(CLIENT_PERMS.KICK_MEMBERS) && !isSelf && !isMemberOwner;
        const canBan  = clientHasPermission(CLIENT_PERMS.BAN_MEMBERS)  && !isSelf && !isMemberOwner;
        const canManageNickOther = clientHasPermission(CLIENT_PERMS.MANAGE_NICKNAMES) && !isSelf;
        const canManageRoles = clientHasPermission(CLIENT_PERMS.MANAGE_ROLES);
        const hasOtherActions = canKick || canBan || canManageNickOther || canManageRoles;

        let actionsHtml = '';
        if (!isSelf && hasOtherActions) {
            let menuItems = '';
            if (canManageNickOther) menuItems += `<button onclick="openNicknameModal('${m.id}', '${escAttr(m.nickname || '')}')">Set Nickname</button>`;
            if (canManageRoles)     menuItems += `<button onclick="openRoleAssignMenu('${m.id}', event)">Assign Roles ▸</button>`;
            if (canKick)            menuItems += `<button class="danger" onclick="confirmKick('${m.id}', '${escAttr(m.username)}')">Kick Member</button>`;
            if (canBan)             menuItems += `<button class="danger" onclick="confirmBan('${m.id}', '${escAttr(m.username)}')">Ban Member</button>`;
            actionsHtml = `
                <button class="member-action-btn" onclick="toggleMemberActionsMenu('${m.id}', event)">Actions ▾</button>
                <div class="member-actions-menu" id="memberMenu_${m.id}" style="display:none;">
                    ${menuItems}
                </div>`;
        } else if (isSelf) {
            actionsHtml = `
                <button class="member-action-btn" onclick="toggleMemberActionsMenu('${m.id}', event)">Edit ▾</button>
                <div class="member-actions-menu" id="memberMenu_${m.id}" style="display:none;">
                    <button onclick="openNicknameModal('${m.id}', '${escAttr(m.nickname || '')}')">Set Nickname</button>
                    ${canManageRoles ? `<button onclick="openRoleAssignMenu('${m.id}', event)">Assign Roles ▸</button>` : ''}
                </div>`;
        }

        return `
            <tr>
                <td style="width:40px;">
                    <div class="member-avatar-initials">${initials}</div>
                </td>
                <td>${displayName}</td>
                <td><div style="display:flex;flex-wrap:wrap;">${rolesHtml || '<span style="color:#6d6f78;font-size:12px;">None</span>'}</div></td>
                <td style="width:80px;text-align:right;position:relative;">
                    ${actionsHtml}
                </td>
            </tr>
        `;
    }).join('');

    const nonEveryone = _settingsRoles.filter(r => r.name !== '@everyone');

    container.innerHTML = `
        <h2 class="settings-section-title">Members <span style="font-size:14px;color:#949ba4;font-weight:400;">(${_settingsMembers.length})</span></h2>
        <input class="members-search" type="text" placeholder="Search members…"
               value="${escHtml(_settingsMembersFilter)}"
               oninput="_settingsMembersFilter=this.value; _rebuildMembersUI(document.getElementById('settingsContent'))">
        <table class="members-table">
            <thead><tr>
                <th></th><th>User</th><th>Roles</th><th></th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
        </table>
        ${isOwner ? `
        <div style="margin-top:24px;">
            <h3 style="font-size:14px;color:#f2f3f5;margin-bottom:12px;">Bans</h3>
            <div id="settingsBansList"><button class="settings-btn secondary" onclick="loadSettingsBans()">View Bans</button></div>
        </div>` : ''}
    `;

    // Close any open action menu on outside click
    document.addEventListener('click', _closeMemberMenus, { once: true });
}

function toggleMemberActionsMenu(memberId, e) {
    e.stopPropagation();
    const menu = document.getElementById(`memberMenu_${memberId}`);
    const isOpen = menu.style.display !== 'none';
    // Close all
    document.querySelectorAll('.member-actions-menu').forEach(m => m.style.display = 'none');
    if (!isOpen) menu.style.display = 'block';
    _openMemberMenuId = isOpen ? null : memberId;
}

function _closeMemberMenus() {
    document.querySelectorAll('.member-actions-menu').forEach(m => m.style.display = 'none');
    _openMemberMenuId = null;
}

function openNicknameModal(memberId, currentNick) {
    _closeMemberMenus();
    showModal({
        title: 'Set Nickname',
        message: 'Enter a nickname (leave blank to clear)',
        inputType: 'text',
        inputValue: currentNick,
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            {
                text: 'Save', style: 'primary', action: async () => {
                    const nick = document.getElementById('modalInput').value.trim();
                    closeModal();
                    const res = await fetch(`/api/servers/${_settingsServerId}/members/${memberId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ nickname: nick }),
                    });
                    if (res.ok) {
                        const m = _settingsMembers.find(m => m.id === memberId);
                        if (m) m.nickname = nick || null;
                        _rebuildMembersUI(document.getElementById('settingsContent'));
                        // Also update the live sidebar member list
                        const stateMember = state.members.find(m => m.id === memberId);
                        if (stateMember) { stateMember.nickname = nick || null; renderMemberList(); renderMessages(); }
                        showToast('Nickname updated.');
                    } else { showToast('Failed to set nickname.'); }
                }
            }
        ]
    });
}

function openRoleAssignMenu(memberId, e) {
    e.stopPropagation();
    const member = _settingsMembers.find(m => m.id === memberId);
    if (!member) return;

    const assignable = _settingsRoles.filter(r => r.name !== '@everyone');
    const memberRoleIds = new Set((member.roles || []).map(r => r.id));

    const itemsHtml = assignable.map(r => `
        <label class="role-assign-item">
            <input type="checkbox" ${memberRoleIds.has(r.id) ? 'checked' : ''}
                   onchange="toggleMemberRole('${memberId}', '${r.id}', this.checked)">
            <span class="role-color-dot" style="background:${r.color}"></span>
            ${escHtml(r.name)}
        </label>
    `).join('');

    // Show in a modal for simplicity
    _closeMemberMenus();
    showModal({
        title: `Roles — ${member.username}`,
        message: assignable.length ? null : 'No roles to assign (create roles first).',
        buttons: [{ text: 'Done', style: 'primary', action: closeModal }]
    });

    if (assignable.length) {
        // Inject role list into modal body
        const msgEl = document.getElementById('modalMessage');
        const inputEl = document.getElementById('modalInput');
        inputEl.style.display = 'none';
        msgEl.style.display = 'block';
        msgEl.innerHTML = `<div class="role-assign-list">${itemsHtml}</div>`;
    }
}

async function toggleMemberRole(memberId, roleId, assign) {
    const url = `/api/servers/${_settingsServerId}/members/${memberId}/roles${assign ? '' : '/' + roleId}`;
    const method = assign ? 'POST' : 'DELETE';
    const body = assign ? JSON.stringify({ roleId }) : undefined;
    const headers = assign ? { 'Content-Type': 'application/json' } : {};

    const res = await fetch(url, { method, headers, credentials: 'include', body });
    if (res.ok) {
        const member = _settingsMembers.find(m => m.id === memberId);
        const role = _settingsRoles.find(r => r.id === roleId);
        if (member && role) {
            if (assign) {
                if (!member.roles.find(r => r.id === roleId)) member.roles.push(role);
            } else {
                member.roles = member.roles.filter(r => r.id !== roleId);
            }
        }
    } else {
        showToast('Failed to update role.');
    }
}

function confirmKick(memberId, username) {
    _closeMemberMenus();
    showModal({
        title: 'Kick Member',
        message: `Kick ${username} from the server?`,
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            {
                text: 'Kick', style: 'danger', action: async () => {
                    closeModal();
                    const res = await fetch(`/api/servers/${_settingsServerId}/members/${memberId}`, {
                        method: 'DELETE', credentials: 'include'
                    });
                    if (res.ok) {
                        _settingsMembers = _settingsMembers.filter(m => m.id !== memberId);
                        _rebuildMembersUI(document.getElementById('settingsContent'));
                        showToast(`${username} kicked.`);
                    } else { const d = await res.json(); showToast(d.error || 'Failed to kick.'); }
                }
            }
        ]
    });
}

function confirmBan(memberId, username) {
    _closeMemberMenus();
    showModal({
        title: 'Ban Member',
        message: `Ban ${username}? They won't be able to rejoin via invite.`,
        inputType: 'text',
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            {
                text: 'Ban', style: 'danger', action: async () => {
                    const reason = document.getElementById('modalInput').value.trim();
                    closeModal();
                    const res = await fetch(`/api/servers/${_settingsServerId}/bans/${memberId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ reason }),
                    });
                    if (res.ok) {
                        _settingsMembers = _settingsMembers.filter(m => m.id !== memberId);
                        _rebuildMembersUI(document.getElementById('settingsContent'));
                        showToast(`${username} banned.`);
                    } else { const d = await res.json(); showToast(d.error || 'Failed to ban.'); }
                }
            }
        ]
    });
}

async function loadSettingsBans() {
    const container = document.getElementById('settingsBansList');
    container.innerHTML = '<p style="color:#949ba4;font-size:13px;">Loading…</p>';
    try {
        const res = await fetch(`/api/servers/${_settingsServerId}/bans`, { credentials: 'include' });
        const data = await res.json();
        const bans = data.bans || [];
        if (bans.length === 0) {
            container.innerHTML = '<p style="color:#6d6f78;font-size:13px;">No bans.</p>';
            return;
        }
        container.innerHTML = '<div class="bans-list">' + bans.map(b => `
            <div class="ban-row">
                <div>
                    <div class="ban-user">${escHtml(b.username)}</div>
                    ${b.reason ? `<div class="ban-reason">Reason: ${escHtml(b.reason)}</div>` : ''}
                </div>
                <button class="settings-btn secondary" onclick="unbanMember('${b.user_id}', '${escAttr(b.username)}', this)">Unban</button>
            </div>
        `).join('') + '</div>';
    } catch {
        container.innerHTML = '<p style="color:#f23f43;font-size:13px;">Failed to load bans.</p>';
    }
}

async function unbanMember(userId, username, btn) {
    btn.disabled = true;
    const res = await fetch(`/api/servers/${_settingsServerId}/bans/${userId}`, {
        method: 'DELETE', credentials: 'include'
    });
    if (res.ok) {
        btn.closest('.ban-row').remove();
        showToast(`${username} unbanned.`);
    } else {
        btn.disabled = false;
        showToast('Failed to unban.');
    }
}

// ── Invites Tab ───────────────────────────────────────────────────────────────

async function renderInvitesTab(container) {
    container.innerHTML = `
        <h2 class="settings-section-title">Invites</h2>
        <div id="settingsInviteList"><p style="color:#949ba4">Loading…</p></div>
        <div class="invite-create" style="margin-top:20px;">
            <h3 style="font-size:14px;color:#f2f3f5;margin-bottom:12px;">Create New Invite</h3>
            <div class="invite-options" style="display:flex;gap:16px;margin-bottom:12px;">
                <label style="font-size:13px;color:#b5bac1;">
                    Expires after
                    <select id="settingsInviteExpiry" class="settings-input" style="margin-top:4px;">
                        <option value="">Never</option>
                        <option value="1800">30 minutes</option>
                        <option value="3600">1 hour</option>
                        <option value="86400">24 hours</option>
                        <option value="604800">7 days</option>
                    </select>
                </label>
                <label style="font-size:13px;color:#b5bac1;">
                    Max uses
                    <select id="settingsInviteMaxUses" class="settings-input" style="margin-top:4px;">
                        <option value="0">Unlimited</option>
                        <option value="1">1 use</option>
                        <option value="5">5 uses</option>
                        <option value="10">10 uses</option>
                        <option value="25">25 uses</option>
                        <option value="100">100 uses</option>
                    </select>
                </label>
            </div>
            <button class="settings-btn" onclick="createSettingsInvite()">Generate Invite Link</button>
        </div>
    `;
    _loadSettingsInvites();
}

async function _loadSettingsInvites() {
    const listEl = document.getElementById('settingsInviteList');
    if (!listEl) return;
    try {
        const res = await fetch(`/api/servers/${_settingsServerId}/invites`, { credentials: 'include' });
        const data = await res.json();
        const invites = data.invites || [];
        if (invites.length === 0) {
            listEl.innerHTML = '<p style="color:#6d6f78;font-size:13px;">No active invites yet.</p>';
            return;
        }
        listEl.innerHTML = invites.map(inv => {
            const uses = inv.max_uses > 0 ? `${inv.uses}/${inv.max_uses} uses` : `${inv.uses} uses`;
            const expiry = inv.expires_at ? `Expires ${new Date(inv.expires_at).toLocaleDateString()}` : 'Never expires';
            return `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #2e3035;">
                <div>
                    <span style="font-size:13px;color:#dbdee1;font-family:monospace;">${inv.code}</span>
                    <span style="font-size:12px;color:#949ba4;margin-left:8px;">${uses} · ${expiry} · by ${escHtml(inv.inviter_username || 'Unknown')}</span>
                </div>
                <button class="settings-btn secondary" style="padding:4px 10px;font-size:12px;"
                        onclick="copyInviteCode('${inv.code}', this)">Copy</button>
            </div>`;
        }).join('');
    } catch {
        listEl.innerHTML = '<p style="color:#f23f43;font-size:13px;">Failed to load invites.</p>';
    }
}

async function createSettingsInvite() {
    const expiresIn = document.getElementById('settingsInviteExpiry').value || null;
    const maxUses = document.getElementById('settingsInviteMaxUses').value || 0;
    try {
        const res = await fetch(`/api/servers/${_settingsServerId}/invites`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                expiresIn: expiresIn ? parseInt(expiresIn) : null,
                maxUses: parseInt(maxUses),
            }),
        });
        if (res.ok) {
            const data = await res.json();
            await _loadSettingsInvites();
            try { await navigator.clipboard.writeText(data.invite.code); } catch {}
            showToast(`Invite ${data.invite.code} created!`);
        } else { showToast('Failed to create invite.'); }
    } catch { showToast('Failed to create invite.'); }
}

// ── Danger Zone Tab ───────────────────────────────────────────────────────────

function renderDangerZoneTab(container) {
    const isOwner = state.currentServer?.owner_id === state.currentUser?.id;
    container.innerHTML = `
        <h2 class="settings-section-title">Danger Zone</h2>
        ${!isOwner ? `
        <div class="danger-zone-card">
            <div>
                <h3>Leave Server</h3>
                <p>You will lose access to all channels and messages.</p>
            </div>
            <button class="settings-btn danger" onclick="closeServerSettings(); leaveOrDeleteServer();">Leave Server</button>
        </div>` : `
        <div class="danger-zone-card">
            <div>
                <h3>Delete Server</h3>
                <p>Permanently delete this server and all its data. This cannot be undone.</p>
            </div>
            <button class="settings-btn danger" onclick="closeServerSettings(); leaveOrDeleteServer();">Delete Server</button>
        </div>`}
    `;
}

// ── Emoji Tab ─────────────────────────────────────────────────────────────────

async function renderEmojisTab(container) {
    container.innerHTML = '<p style="color:#949ba4">Loading emoji…</p>';
    try {
        const res = await fetch(`/api/reactions/servers/${_settingsServerId}/emojis`, { credentials: 'include' });
        if (!res.ok) throw new Error();
        const data = await res.json();
        const emojis = data.server || [];

        const canManage = clientHasPermission(CLIENT_PERMS.MANAGE_GUILD_EXPRESSIONS);

        const uploadHtml = canManage ? `
            <div class="settings-field">
                <label class="settings-label">Upload Emoji</label>
                <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
                    <div>
                        <label class="settings-label" style="font-size:11px;margin-bottom:4px;display:block;">Name (a-z, 0-9, _)</label>
                        <input class="settings-input" id="emojiNameInput" type="text" placeholder="my_emoji" maxlength="32" style="width:150px;">
                    </div>
                    <div>
                        <label class="settings-label" style="font-size:11px;margin-bottom:4px;display:block;">Image (max 256 KB)</label>
                        <input type="file" id="emojiFileInput" accept="image/jpeg,image/jpg,image/png,image/gif,image/webp" style="color:#dcddde;font-size:13px;">
                    </div>
                    <button class="settings-btn" onclick="uploadServerEmoji()">Upload</button>
                </div>
                <div id="emojiUploadError" style="color:#f23f43;font-size:13px;margin-top:8px;display:none;"></div>
            </div>` : '';

        const listHtml = emojis.length === 0
            ? '<p style="color:#949ba4;margin-top:16px;">No custom emoji yet.</p>'
            : `<div class="emoji-mgmt-list">
                ${emojis.map(e => `
                    <div class="emoji-mgmt-item">
                        <img src="/img/emoji/${e.server_id}/${e.filename}" alt="${escHtml(e.name)}" class="emoji-mgmt-preview">
                        <span class="emoji-mgmt-name">:${escHtml(e.name)}:</span>
                        ${canManage ? `<button class="settings-btn danger" style="padding:4px 10px;font-size:12px;margin-left:auto;"
                            onclick="deleteServerEmoji('${e.id}','${escAttr(e.name)}')">Delete</button>` : ''}
                    </div>`).join('')}
               </div>`;

        container.innerHTML = `
            <h2 class="settings-section-title">Emoji</h2>
            <p style="font-size:13px;color:#949ba4;margin-bottom:20px;">Custom emoji for this server — ${emojis.length} uploaded.</p>
            ${uploadHtml}
            ${listHtml}
        `;
    } catch {
        container.innerHTML = '<p style="color:#f23f43">Failed to load emoji.</p>';
    }
}

async function uploadServerEmoji() {
    const nameInput = document.getElementById('emojiNameInput');
    const fileInput = document.getElementById('emojiFileInput');
    const errorEl  = document.getElementById('emojiUploadError');
    errorEl.style.display = 'none';

    const name = nameInput?.value.trim();
    const file = fileInput?.files[0];

    if (!name) { errorEl.textContent = 'Name is required.'; errorEl.style.display = 'block'; return; }
    if (!/^[a-zA-Z0-9_]{1,32}$/.test(name)) {
        errorEl.textContent = 'Name must be 1–32 characters: letters, numbers, or underscores.';
        errorEl.style.display = 'block';
        return;
    }
    if (!file) { errorEl.textContent = 'Image file is required.'; errorEl.style.display = 'block'; return; }

    const formData = new FormData();
    formData.append('name', name);
    formData.append('emoji', file);

    try {
        const res = await fetch(`/api/reactions/servers/${_settingsServerId}/emojis`, {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
        const data = await res.json();
        if (!res.ok) { errorEl.textContent = data.error || 'Upload failed.'; errorEl.style.display = 'block'; return; }
        showToast('Emoji uploaded!');
        renderEmojisTab(document.getElementById('settingsContent'));
    } catch {
        errorEl.textContent = 'Request failed.';
        errorEl.style.display = 'block';
    }
}

async function deleteServerEmoji(emojiId, name) {
    showModal({
        title: 'Delete Emoji',
        message: `Delete :${name}:? This cannot be undone.`,
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            {
                text: 'Delete', style: 'danger', action: async () => {
                    closeModal();
                    const res = await fetch(`/api/reactions/servers/${_settingsServerId}/emojis/${emojiId}`, {
                        method: 'DELETE',
                        credentials: 'include'
                    });
                    if (res.ok || res.status === 204) {
                        showToast('Emoji deleted.');
                        renderEmojisTab(document.getElementById('settingsContent'));
                    } else {
                        showToast('Failed to delete emoji.');
                    }
                }
            }
        ]
    });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escAttr(str) {
    return escHtml(str);
}

// ── Ascension Tab ─────────────────────────────────────────────────────────────

function renderAscensionTab(container) {
    const serverId = _settingsServerId;
    container.innerHTML = `<h2 class="settings-section-title">Server Ascension</h2><div class="asc-loading">Loading…</div>`;

    fetch(`/api/ascension/servers/${serverId}/balance`, { credentials: 'include' })
        .then(r => r.json())
        .then(data => {
            const balance = data.balance ?? 0;
            const spent   = data.spent   ?? 0;
            container.innerHTML = `
                <h2 class="settings-section-title">Server Ascension</h2>
                <div class="asc-balance-bar">
                    <strong>${balance}</strong> points donated &nbsp;·&nbsp;
                    <strong>${spent}</strong> committed
                </div>
                <div class="settings-field">
                    <label class="settings-label">Donate Points to Server</label>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <input class="settings-input" id="ascDonateAmount" type="number" min="1" placeholder="Amount" style="width:120px;">
                        <button class="settings-btn" onclick="_ascDonateTo('${escHtml(serverId)}')">Donate</button>
                    </div>
                </div>
                <div id="ascServerTreeContainer"></div>
            `;
            if (typeof renderServerSkillTree === 'function') {
                renderServerSkillTree(document.getElementById('ascServerTreeContainer'), serverId);
            }
        })
        .catch(() => {
            container.innerHTML = `<h2 class="settings-section-title">Server Ascension</h2><p style="color:#f23f43;">Failed to load.</p>`;
        });
}

async function _ascDonateTo(serverId) {
    const amount = parseInt(document.getElementById('ascDonateAmount')?.value, 10);
    if (!amount || amount <= 0) { showToast('Enter a valid amount', true); return; }
    const res = await fetch(`/api/ascension/servers/${serverId}/donate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount })
    });
    if (res.ok) {
        showToast(`Donated ${amount} points!`);
        renderAscensionTab(document.getElementById('settingsContent'));
    } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Donation failed', true);
    }
}

// ── Audit Log Tab ─────────────────────────────────────────────────────────────

const _AUDIT_LABELS = {
    member_kick:    e => `Kicked ${escHtml(e.target_username || e.target_id || 'a member')}`,
    member_ban:     e => `Banned ${escHtml(e.target_username || e.target_id || 'a member')}${e.changes?.reason ? ` — ${escHtml(e.changes.reason)}` : ''}`,
    member_unban:   e => `Unbanned ${escHtml(e.target_username || e.target_id || 'a member')}`,
    channel_create: e => `Created channel <strong>#${escHtml(e.changes?.name || '')}</strong>`,
    channel_delete: e => `Deleted channel <strong>#${escHtml(e.changes?.name || '')}</strong>`,
    role_create:    e => `Created role <strong>${escHtml(e.changes?.name || '')}</strong>`,
    role_delete:    e => `Deleted role <strong>${escHtml(e.changes?.name || '')}</strong>`,
    role_update:    e => `Updated role <strong>${escHtml(e.changes?.name || '')}</strong>`,
    role_assign:    e => `Assigned a role to ${escHtml(e.target_username || e.target_id || 'a member')}`,
    role_remove:    e => `Removed a role from ${escHtml(e.target_username || e.target_id || 'a member')}`,
    server_update:  e => `Updated server settings`,
    message_pin:    e => `Pinned a message`,
    message_unpin:  e => `Unpinned a message`,
    webhook_create: e => `Created webhook <strong>${escHtml(e.changes?.name || '')}</strong>`,
    webhook_update: e => `Updated webhook <strong>${escHtml(e.changes?.name || '')}</strong>`,
    webhook_delete: e => `Deleted webhook <strong>${escHtml(e.changes?.name || '')}</strong>`,
};

const _AUDIT_ICONS = {
    member_kick: '🥾', member_ban: '🔨', member_unban: '✅',
    channel_create: '#️⃣', channel_delete: '🗑️',
    role_create: '🎭', role_delete: '🗑️', role_update: '✏️', role_assign: '➕', role_remove: '➖',
    server_update: '⚙️',
    message_pin: '📌', message_unpin: '📌',
    webhook_create: '🔗', webhook_delete: '🗑️',
};

async function renderAuditTab(container) {
    container.innerHTML = '<div class="settings-loading">Loading audit log…</div>';
    try {
        const res = await fetch(`/api/audit/servers/${_settingsServerId}?limit=50`, { credentials: 'include' });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            container.innerHTML = `<h2 class="settings-section-title">Audit Log</h2><p class="settings-empty">${escHtml(d.error || 'Failed to load audit log.')}</p>`;
            return;
        }
        const { entries } = await res.json();

        let html = `<h2 class="settings-section-title">Audit Log</h2>`;

        if (entries.length === 0) {
            html += `<p class="settings-empty">No audit log entries yet.</p>`;
        } else {
            html += `<div class="audit-log-list">`;
            for (const e of entries) {
                const labelFn = _AUDIT_LABELS[e.action];
                const label   = labelFn ? labelFn(e) : escHtml(e.action);
                const icon    = _AUDIT_ICONS[e.action] || '📋';
                const actor   = escHtml(e.actor_username || 'System');
                const when    = new Date(e.created_at).toLocaleString();
                html += `
                    <div class="audit-entry">
                        <div class="audit-entry-icon">${icon}</div>
                        <div class="audit-entry-body">
                            <div class="audit-entry-action">
                                <span class="audit-actor">${actor}</span>
                                <span class="audit-label"> ${label}</span>
                            </div>
                            <div class="audit-entry-time">${when}</div>
                        </div>
                    </div>`;
            }
            html += `</div>`;
        }

        container.innerHTML = html;
    } catch {
        container.innerHTML = `<h2 class="settings-section-title">Audit Log</h2><p class="settings-empty">Failed to load audit log.</p>`;
    }
}

// ── Webhooks Tab ──────────────────────────────────────────────────────────────

function _webhookChannelOptions(selectedId) {
    return (state.channels || [])
        .filter(c => c.type === 'text' || c.type === 'announcement')
        .map(c => `<option value="${c.id}"${c.id === selectedId ? ' selected' : ''}>#${escHtml(c.name)}</option>`)
        .join('');
}

async function renderWebhooksTab(container) {
    container.innerHTML = '<div class="settings-loading">Loading webhooks…</div>';

    try {
        const res = await fetch(`/api/webhooks/servers/${_settingsServerId}`, { credentials: 'include' });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            container.innerHTML = `<h2 class="settings-section-title">Webhooks</h2><p class="settings-empty">${escHtml(d.error || 'Failed to load.')}</p>`;
            return;
        }
        const { webhooks } = await res.json();

        let html = `<h2 class="settings-section-title">Webhooks</h2>`;

        // Create form
        html += `
            <div class="settings-field">
                <label class="settings-label">New Webhook</label>
                <div class="webhook-create-form">
                    <input class="settings-input" id="webhookName" type="text" placeholder="Webhook name" maxlength="80">
                    <select class="settings-input" id="webhookChannel">${_webhookChannelOptions('')}</select>
                    <button class="settings-btn" onclick="_createWebhook()">Create</button>
                </div>
                <div id="webhookCreateError" class="settings-error" style="display:none;"></div>
            </div>
            <div class="settings-divider"></div>`;

        if (webhooks.length === 0) {
            html += `<p class="settings-empty">No webhooks yet.</p>`;
        } else {
            html += `<div class="webhook-list">`;
            for (const wh of webhooks) {
                const url = `${window.location.origin}/api/webhooks/${wh.id}/${wh.token}`;
                const avatarPreview = wh.avatar
                    ? `<img class="webhook-avatar-preview" src="${escHtml(wh.avatar)}" alt="">`
                    : `<div class="webhook-avatar-preview webhook-avatar-placeholder">🔗</div>`;
                html += `
                    <div class="webhook-item" id="wh-${wh.id}">
                        <div class="webhook-item-header">
                            ${avatarPreview}
                            <div class="webhook-item-info">
                                <div class="webhook-item-name">${escHtml(wh.name)}</div>
                                <div class="webhook-item-channel">#${escHtml(wh.channel_name)}</div>
                            </div>
                            <div class="webhook-item-actions">
                                <button class="settings-btn secondary small" onclick="_copyWebhookUrl('${escHtml(url)}')">Copy URL</button>
                                <button class="settings-btn secondary small" onclick="_toggleWebhookEdit('${wh.id}')">Edit</button>
                                <button class="settings-btn danger small" onclick="_deleteWebhook('${wh.id}')">Delete</button>
                            </div>
                        </div>
                        <div class="webhook-edit-form" id="wh-edit-${wh.id}" style="display:none;">
                            <div class="webhook-edit-row">
                                <label class="webhook-edit-label">Default Name</label>
                                <input class="settings-input" id="wh-name-${wh.id}" type="text"
                                       value="${escHtml(wh.name)}" maxlength="80" placeholder="Webhook display name">
                            </div>
                            <div class="webhook-edit-row">
                                <label class="webhook-edit-label">Channel</label>
                                <select class="settings-input" id="wh-channel-${wh.id}">
                                    ${_webhookChannelOptions(wh.channel_id)}
                                </select>
                            </div>
                            <div class="webhook-edit-row">
                                <label class="webhook-edit-label">Default Avatar URL</label>
                                <input class="settings-input" id="wh-avatar-${wh.id}" type="url"
                                       value="${escHtml(wh.avatar || '')}" placeholder="https://… (optional)">
                            </div>
                            <div class="webhook-edit-row">
                                <label class="webhook-edit-label">Webhook URL</label>
                                <div class="webhook-url-row">
                                    <input class="settings-input webhook-url-input" type="text"
                                           value="${escHtml(url)}" readonly onclick="this.select()">
                                    <button class="settings-btn secondary small" onclick="_copyWebhookUrl('${escHtml(url)}')">Copy</button>
                                </div>
                            </div>
                            <div class="webhook-edit-actions">
                                <button class="settings-btn" onclick="_saveWebhook('${wh.id}')">Save Changes</button>
                                <button class="settings-btn secondary" onclick="_toggleWebhookEdit('${wh.id}')">Cancel</button>
                                <div class="webhook-edit-error" id="wh-err-${wh.id}" style="display:none;"></div>
                            </div>
                        </div>
                    </div>`;
            }
            html += `</div>`;
        }

        container.innerHTML = html;
    } catch {
        container.innerHTML = `<h2 class="settings-section-title">Webhooks</h2><p class="settings-empty">Failed to load webhooks.</p>`;
    }
}

function _toggleWebhookEdit(webhookId) {
    const form = document.getElementById(`wh-edit-${webhookId}`);
    if (!form) return;
    const open = form.style.display === 'none';
    form.style.display = open ? 'block' : 'none';
    const item = document.getElementById(`wh-${webhookId}`);
    if (item) item.classList.toggle('editing', open);
}

async function _saveWebhook(webhookId) {
    const name      = document.getElementById(`wh-name-${webhookId}`)?.value.trim();
    const channelId = document.getElementById(`wh-channel-${webhookId}`)?.value;
    const avatar    = document.getElementById(`wh-avatar-${webhookId}`)?.value.trim();
    const errEl     = document.getElementById(`wh-err-${webhookId}`);
    if (errEl) errEl.style.display = 'none';

    if (!name) {
        if (errEl) { errEl.textContent = 'Name cannot be empty.'; errEl.style.display = 'block'; }
        return;
    }

    const res = await fetch(`/api/webhooks/${webhookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, channelId, avatar: avatar || null }),
    });

    if (res.ok) {
        showToast('Webhook updated!');
        renderWebhooksTab(document.getElementById('settingsContent'));
    } else {
        const d = await res.json().catch(() => ({}));
        if (errEl) { errEl.textContent = d.error || 'Failed to save.'; errEl.style.display = 'block'; }
    }
}

async function _createWebhook() {
    const name      = document.getElementById('webhookName')?.value.trim();
    const channelId = document.getElementById('webhookChannel')?.value;
    const errEl     = document.getElementById('webhookCreateError');
    if (errEl) errEl.style.display = 'none';

    if (!name) {
        if (errEl) { errEl.textContent = 'Name is required.'; errEl.style.display = 'block'; }
        return;
    }

    const res = await fetch(`/api/webhooks/servers/${_settingsServerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, channelId }),
    });

    if (res.ok) {
        showToast('Webhook created!');
        renderWebhooksTab(document.getElementById('settingsContent'));
    } else {
        const d = await res.json().catch(() => ({}));
        if (errEl) { errEl.textContent = d.error || 'Failed to create webhook.'; errEl.style.display = 'block'; }
    }
}

async function _deleteWebhook(webhookId) {
    const res = await fetch(`/api/webhooks/${webhookId}`, {
        method: 'DELETE',
        credentials: 'include',
    });
    if (res.ok) {
        showToast('Webhook deleted.');
        renderWebhooksTab(document.getElementById('settingsContent'));
    } else {
        const d = await res.json().catch(() => ({}));
        showToast(d.error || 'Failed to delete webhook.', true);
    }
}

function _copyWebhookUrl(url) {
    navigator.clipboard.writeText(url).then(() => showToast('Webhook URL copied!'));
}

// ── Reports Tab ───────────────────────────────────────────────────────────────

async function renderReportsTab(container) {
    const serverId = _settingsServerId;
    container.innerHTML = `<div class="settings-loading">Loading reports…</div>`;

    let reports = [];
    try {
        const res = await fetch(`/api/reports/servers/${serverId}`, { credentials: 'include' });
        if (!res.ok) { container.innerHTML = `<p class="settings-error">Failed to load reports.</p>`; return; }
        const data = await res.json();
        reports = data.reports || [];
    } catch {
        container.innerHTML = `<p class="settings-error">Failed to load reports.</p>`;
        return;
    }

    const statusColors = { open: '#ed4245', reviewed: '#5865f2', dismissed: '#4f545c', escalated: '#f0b232' };
    const statusBadge = (s) =>
        `<span class="report-status-badge" style="background:${statusColors[s]||'#4f545c'}">${escHtml(s)}</span>`;
    const typeBadge = (t) =>
        `<span class="report-type-badge">${t === 'message' ? '💬 Message' : '👤 User'}</span>`;

    const cards = reports.length ? reports.map(r => `
        <div class="report-card">
            <div class="report-card-header">
                <div class="report-card-tags">
                    ${statusBadge(r.status)}
                    ${typeBadge(r.type)}
                    <span class="report-reason">${escHtml(r.reason)}</span>
                </div>
                <span class="report-date">${new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </div>

            <div class="report-card-who">
                <div class="report-who-item">
                    <span class="report-who-label">Against</span>
                    <span class="report-who-value">${escHtml(r.reported_username || 'Unknown')}</span>
                </div>
                <div class="report-who-sep">·</div>
                <div class="report-who-item">
                    <span class="report-who-label">Filed by</span>
                    <span class="report-who-value">${
                        r.is_anonymous ? '<em>Anonymous</em>'
                        : r.reporter_username ? escHtml(r.reporter_username)
                        : '—'
                    }</span>
                </div>
                ${r.status === 'escalated' ? `<div class="report-who-sep">·</div><div class="report-who-item"><span class="report-who-label" style="color:#f0b232;">Escalated to staff</span></div>` : ''}
            </div>

            ${r.message_content ? `
            <div class="report-message-preview">
                <span class="report-message-label">Reported message</span>
                <p class="report-message-text">${escHtml(r.message_content.slice(0, 400))}${r.message_content.length > 400 ? '…' : ''}</p>
            </div>` : ''}

            ${r.details ? `
            <div class="report-details">
                <span class="report-who-label">Additional details</span>
                <p style="margin:3px 0 0;font-size:13px;color:#b5bac1;">${escHtml(r.details)}</p>
            </div>` : ''}

            ${r.status === 'open' ? `
            <div class="report-card-actions">
                <button class="btn-secondary report-action-btn" onclick="_markReportReviewed('${r.id}', '${serverId}')">Mark Reviewed</button>
                <button class="btn-secondary report-action-btn" onclick="_dismissReport('${r.id}', '${serverId}')">Dismiss</button>
                <button class="btn-secondary report-action-btn report-escalate-btn" onclick="_escalateReport('${r.id}', '${serverId}')">↑ Escalate to Staff</button>
            </div>` : ''}
        </div>
    `).join('') : `<div class="report-empty">No reports filed in this server yet.</div>`;

    container.innerHTML = `
        <h2>Reports</h2>
        <p style="color:#b5bac1;font-size:14px;margin-bottom:20px;">Reports submitted by members of this server.</p>
        <div class="report-card-list">${cards}</div>
    `;
}

async function _dismissReport(reportId, serverId) {
    const res = await fetch(`/api/reports/servers/${serverId}/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'dismissed' }),
    });
    if (res.ok) {
        showToast('Report dismissed.');
        renderReportsTab(document.getElementById('settingsContent'));
    } else {
        const d = await res.json().catch(() => ({}));
        showToast(d.error || 'Failed to dismiss report.', true);
    }
}

async function _markReportReviewed(reportId, serverId) {
    const res = await fetch(`/api/reports/servers/${serverId}/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'reviewed' }),
    });
    if (res.ok) {
        showToast('Report marked as reviewed.');
        renderReportsTab(document.getElementById('settingsContent'));
    } else {
        const d = await res.json().catch(() => ({}));
        showToast(d.error || 'Failed to update report.', true);
    }
}

async function _escalateReport(reportId, serverId) {
    const res = await fetch(`/api/reports/servers/${serverId}/${reportId}/escalate`, {
        method: 'POST',
        credentials: 'include',
    });
    if (res.ok) {
        showToast('Report escalated to NexusGuild staff.');
        renderReportsTab(document.getElementById('settingsContent'));
    } else {
        const d = await res.json().catch(() => ({}));
        showToast(d.error || 'Failed to escalate report.', true);
    }
}
