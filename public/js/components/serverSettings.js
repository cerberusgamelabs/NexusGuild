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
            { key: 'VIEW_CHANNEL',    name: 'View Channels',     desc: 'Allows members to view channels' },
            { key: 'MANAGE_CHANNELS', name: 'Manage Channels',   desc: 'Allows members to create, edit, or delete channels' },
            { key: 'MANAGE_SERVER',   name: 'Manage Server',     desc: 'Allows members to change server settings' },
            { key: 'MANAGE_ROLES',    name: 'Manage Roles',      desc: 'Allows members to create and manage roles' },
            { key: 'CREATE_INVITE',   name: 'Create Invite',     desc: 'Allows members to invite new people' },
            { key: 'ADMINISTRATOR',   name: 'Administrator',     desc: 'Grants all permissions — use with care' },
        ]
    },
    {
        label: 'Text',
        perms: [
            { key: 'SEND_MESSAGES',    name: 'Send Messages',      desc: 'Allows members to send messages' },
            { key: 'MANAGE_MESSAGES',  name: 'Manage Messages',    desc: 'Allows members to delete others\' messages' },
            { key: 'EMBED_LINKS',      name: 'Embed Links',        desc: 'Links posted will show as embeds' },
            { key: 'ATTACH_FILES',     name: 'Attach Files',       desc: 'Allows members to upload files' },
            { key: 'ADD_REACTIONS',    name: 'Add Reactions',      desc: 'Allows members to add emoji reactions' },
            { key: 'MENTION_EVERYONE', name: 'Mention @everyone',  desc: 'Allows members to use @everyone and @here' },
        ]
    },
    {
        label: 'Voice',
        perms: [
            { key: 'CONNECT',        name: 'Connect',         desc: 'Allows members to join voice channels' },
            { key: 'SPEAK',          name: 'Speak',           desc: 'Allows members to speak in voice channels' },
            { key: 'MUTE_MEMBERS',   name: 'Mute Members',    desc: 'Allows members to mute others in voice' },
            { key: 'DEAFEN_MEMBERS', name: 'Deafen Members',  desc: 'Allows members to deafen others in voice' },
            { key: 'MOVE_MEMBERS',   name: 'Move Members',    desc: 'Allows members to move others between channels' },
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
            { key: 'KICK_MEMBERS', name: 'Kick Members', desc: 'Allows members to kick other members' },
            { key: 'BAN_MEMBERS',  name: 'Ban Members',  desc: 'Allows members to ban other members' },
        ]
    },
];

// State local to this module
let _settingsServerId = null;
let _settingsTab = 'overview';
let _selectedRoleId = null;
let _settingsRoles = [];
let _settingsMembersFilter = '';

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
        case 'danger':   renderDangerZoneTab(content); break;
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
             onclick="selectSettingsRole('${r.id}')">
            <span class="role-color-dot" style="background:${r.color}"></span>
            ${escHtml(r.name)}
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

    try {
        const res = await fetch(`/api/servers/${_settingsServerId}/roles/${_selectedRoleId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name, color, permissions: String(perms) }),
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
        // Full actions (kick/ban/nick/roles) on others — owner only, not on yourself or the owner
        const canActOnOther = isOwner && !isSelf && !isMemberOwner;
        // Self actions — anyone can try to set their own nickname; owner can also manage own roles
        const canActOnSelf = isSelf;

        let actionsHtml = '';
        if (canActOnOther) {
            actionsHtml = `
                <button class="member-action-btn" onclick="toggleMemberActionsMenu('${m.id}', event)">Actions ▾</button>
                <div class="member-actions-menu" id="memberMenu_${m.id}" style="display:none;">
                    <button onclick="openNicknameModal('${m.id}', '${escAttr(m.nickname || '')}')">Set Nickname</button>
                    <button onclick="openRoleAssignMenu('${m.id}', event)">Assign Roles ▸</button>
                    <button class="danger" onclick="confirmKick('${m.id}', '${escAttr(m.username)}')">Kick Member</button>
                    <button class="danger" onclick="confirmBan('${m.id}', '${escAttr(m.username)}')">Ban Member</button>
                </div>`;
        } else if (canActOnSelf) {
            actionsHtml = `
                <button class="member-action-btn" onclick="toggleMemberActionsMenu('${m.id}', event)">Edit ▾</button>
                <div class="member-actions-menu" id="memberMenu_${m.id}" style="display:none;">
                    <button onclick="openNicknameModal('${m.id}', '${escAttr(m.nickname || '')}')">Set Nickname</button>
                    ${isOwner ? `<button onclick="openRoleAssignMenu('${m.id}', event)">Assign Roles ▸</button>` : ''}
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
