// NexusGuild Staff Portal — Frontend Logic

/* ─── State ────────────────────────────────────────────────────────────── */

const state = {
    user:      null,
    staffRole: null,
    tab:       'dashboard'
};

/* ─── API helper ────────────────────────────────────────────────────────── */

async function api(method, path, body) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch('/api/staff' + path, opts);
    if (res.status === 204) return null;
    return res.json().then(data => ({ ok: res.ok, status: res.status, data }));
}

/* ─── Toast ─────────────────────────────────────────────────────────────── */

function toast(msg, isError = false) {
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    document.getElementById('toastContainer').appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

/* ─── Modal helpers ─────────────────────────────────────────────────────── */

function openModal() { document.getElementById('modalOverlay').style.display = 'flex'; }
function closeModal() { document.getElementById('modalOverlay').style.display = 'none'; }

function closeModalOnBackdrop(e) {
    if (e.target === document.getElementById('modalOverlay')) closeModal();
}

function showConfirm(msg, onConfirm) {
    document.getElementById('modalTitle').textContent = 'Confirm Action';
    document.getElementById('modalBody').innerHTML =
        `<p class="modal-confirm-text">${escHtml(msg)}</p>`;
    document.getElementById('modalFooter').innerHTML =
        `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
         <button class="btn btn-danger" id="confirmOkBtn">Confirm</button>`;
    document.getElementById('confirmOkBtn').onclick = () => { closeModal(); onConfirm(); };
    openModal();
}

function showFormModal(title, fields, onSubmit) {
    document.getElementById('modalTitle').textContent = title;

    const rows = fields.map(f => {
        const id = 'mf_' + f.name;
        let input;
        if (f.type === 'select') {
            const opts = f.options.map(o =>
                `<option value="${escHtml(o.value)}"${o.value === f.default ? ' selected' : ''}>${escHtml(o.label)}</option>`
            ).join('');
            input = `<select id="${id}">${opts}</select>`;
        } else if (f.type === 'textarea') {
            input = `<textarea id="${id}" rows="3">${escHtml(f.default || '')}</textarea>`;
        } else {
            input = `<input id="${id}" type="${f.type || 'text'}" value="${escHtml(f.default || '')}" placeholder="${escHtml(f.placeholder || '')}">`;
        }
        return `<div class="form-field"><label>${escHtml(f.label)}</label>${input}</div>`;
    }).join('');

    document.getElementById('modalBody').innerHTML = rows;
    document.getElementById('modalFooter').innerHTML =
        `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
         <button class="btn btn-primary" id="formSubmitBtn">Save</button>`;

    document.getElementById('formSubmitBtn').onclick = () => {
        const values = {};
        for (const f of fields) {
            const el = document.getElementById('mf_' + f.name);
            values[f.name] = el ? el.value.trim() : '';
        }
        onSubmit(values);
    };
    openModal();
}

/* ─── Utility ───────────────────────────────────────────────────────────── */

function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function roleBadge(role) {
    return `<span class="role-badge ${escHtml(role)}">${escHtml(role)}</span>`;
}

function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString();
}

function fmtNum(n) {
    return Number(n).toLocaleString();
}

function paginationHtml(page, total, perPage, onPageChange) {
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    if (totalPages <= 1) return '';
    return `
        <div class="pagination">
            <button ${page <= 1 ? 'disabled' : ''} onclick="(${onPageChange})(${page - 1})">← Prev</button>
            <span class="page-info">Page ${page} of ${totalPages} (${fmtNum(total)} total)</span>
            <button ${page >= totalPages ? 'disabled' : ''} onclick="(${onPageChange})(${page + 1})">Next →</button>
        </div>`;
}

function setContent(html) {
    document.getElementById('contentArea').innerHTML = html;
}

/* ─── Init & Auth ───────────────────────────────────────────────────────── */

async function init() {
    const res = await api('GET', '/me');
    if (!res || !res.ok) {
        showLogin();
        return;
    }
    state.user      = res.data.user;
    state.staffRole = res.data.staffRole;
    showDashboard();
}

function showLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('mainApp').style.display     = 'none';
}

async function login() {
    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl    = document.getElementById('loginError');
    errEl.style.display = 'none';

    if (!email || !password) {
        errEl.textContent = 'Please enter your email and password.';
        errEl.style.display = 'block';
        return;
    }

    const res = await api('POST', '/login', { email, password });
    if (!res || !res.ok) {
        errEl.textContent = (res?.data?.error) || 'Login failed.';
        errEl.style.display = 'block';
        return;
    }

    state.user      = res.data.user;
    state.staffRole = res.data.staffRole;
    showDashboard();
}

function showDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display     = 'flex';

    document.getElementById('topbarRole').className     = `role-badge ${state.staffRole}`;
    document.getElementById('topbarRole').textContent   = state.staffRole;
    document.getElementById('topbarUsername').textContent = state.user.username;

    // Show staff roster link only to owner
    if (state.staffRole === 'owner') {
        document.querySelectorAll('.nav-owner-only').forEach(el => el.style.display = 'flex');
    }

    showTab('dashboard');
}

async function logout() {
    await api('POST', '/logout');
    state.user = null;
    state.staffRole = null;
    showLogin();
}

/* ─── Tab switching ─────────────────────────────────────────────────────── */

const TAB_RENDERERS = {
    dashboard: () => renderDashboard(),
    users:     () => renderUsers(1, ''),
    servers:   () => renderServers(1, ''),
    ascension: () => renderAscension(),
    audit:     () => renderAudit(1),
    staff:     () => renderStaff()
};

function showTab(name) {
    state.tab = name;
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === name);
    });
    setContent('<div class="loading">Loading…</div>');
    const fn = TAB_RENDERERS[name];
    if (fn) fn();
}

/* ─── Dashboard ─────────────────────────────────────────────────────────── */

async function renderDashboard() {
    const res = await api('GET', '/stats');
    if (!res?.ok) { setContent('<div class="loading">Failed to load stats.</div>'); return; }
    const s = res.data;

    setContent(`
        <h2 style="margin-bottom:20px;font-size:20px;font-weight:700;">Dashboard</h2>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Total Users</div>
                <div class="stat-value">${fmtNum(s.totalUsers)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Total Servers</div>
                <div class="stat-value">${fmtNum(s.totalServers)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Total Messages</div>
                <div class="stat-value">${fmtNum(s.totalMessages)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Active Users (24h)</div>
                <div class="stat-value">${fmtNum(s.activeUsers24h)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Ascension Volume</div>
                <div class="stat-value">${fmtNum(s.ascensionVolume)}</div>
            </div>
        </div>
    `);
}

/* ─── Users ─────────────────────────────────────────────────────────────── */

async function renderUsers(page = 1, q = '') {
    const qs  = `?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
    const res = await api('GET', `/users${qs}`);
    if (!res?.ok) { setContent('<div class="loading">Failed to load users.</div>'); return; }
    const { users, total } = res.data;

    const canDelete = roleAtLeast('superadmin');
    const canBan    = roleAtLeast('moderator');

    const rows = users.map(u => `
        <tr>
            <td class="cell-mono">${escHtml(u.id)}</td>
            <td><strong>${escHtml(u.username)}</strong></td>
            <td class="cell-muted">${escHtml(u.email)}</td>
            <td>${u.is_globally_banned ? '<span class="ban-badge">Banned</span>' : '<span class="cell-muted">—</span>'}</td>
            <td class="cell-muted">${fmtDate(u.created_at)}</td>
            <td>
                <div class="actions-cell">
                    <button class="btn btn-ghost btn-sm" onclick="renderUserDetail('${escHtml(u.id)}')">View</button>
                    ${canBan ? (u.is_globally_banned
                        ? `<button class="btn btn-success btn-sm" onclick="unbanUser('${escHtml(u.id)}')">Unban</button>`
                        : `<button class="btn btn-danger btn-sm" onclick="banUser('${escHtml(u.id)}', '${escHtml(u.username)}')">Ban</button>`)
                        : ''}
                    ${canDelete ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${escHtml(u.id)}', '${escHtml(u.username)}')">Delete</button>` : ''}
                </div>
            </td>
        </tr>
    `).join('');

    const pagFn = `function(p){ renderUsers(p, document.getElementById('userSearch')?.value||'') }`;

    setContent(`
        <div class="section-header">
            <h2>Users</h2>
            <div class="search-bar">
                <input id="userSearch" type="text" placeholder="Search username or email…" value="${escHtml(q)}"
                    onkeydown="if(event.key==='Enter') renderUsers(1, this.value)">
                <button class="btn btn-primary btn-sm" onclick="renderUsers(1, document.getElementById('userSearch').value)">Search</button>
            </div>
        </div>
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>ID</th><th>Username</th><th>Email</th><th>Ban</th><th>Created</th><th>Actions</th>
                    </tr>
                </thead>
                <tbody>${rows || '<tr><td colspan="6" class="empty-state">No users found.</td></tr>'}</tbody>
            </table>
        </div>
        ${paginationHtml(page, total, 25, pagFn)}
    `);
}

async function renderUserDetail(id) {
    const res = await api('GET', `/users/${id}`);
    if (!res?.ok) { toast('Failed to load user.', true); return; }
    const { user, serverCount, ascBalance, globalBan } = res.data;

    const canDelete = roleAtLeast('superadmin');
    const canBan    = roleAtLeast('moderator');

    setContent(`
        <span class="back-link" onclick="renderUsers(1,'')">← Back to Users</span>
        <div class="detail-card">
            <h3>User: ${escHtml(user.username)}</h3>
            <div class="detail-grid">
                <span class="detail-label">ID</span><span class="detail-value cell-mono">${escHtml(user.id)}</span>
                <span class="detail-label">Email</span><span class="detail-value">${escHtml(user.email)}</span>
                <span class="detail-label">Status</span><span class="detail-value">${escHtml(user.status || '—')}</span>
                <span class="detail-label">Custom Status</span><span class="detail-value">${escHtml(user.custom_status || '—')}</span>
                <span class="detail-label">Servers</span><span class="detail-value">${fmtNum(serverCount)}</span>
                <span class="detail-label">Asc. Balance</span><span class="detail-value">${fmtNum(ascBalance)} pts</span>
                <span class="detail-label">Global Ban</span><span class="detail-value">
                    ${globalBan ? `<span class="ban-badge">Banned</span> — ${escHtml(globalBan.reason || 'No reason')} (${fmtDate(globalBan.banned_at)})` : '—'}
                </span>
                <span class="detail-label">Created</span><span class="detail-value">${fmtDate(user.created_at)}</span>
            </div>
            <div class="detail-actions">
                ${canBan ? (globalBan
                    ? `<button class="btn btn-success" onclick="unbanUser('${escHtml(user.id)}')">Remove Global Ban</button>`
                    : `<button class="btn btn-danger" onclick="banUser('${escHtml(user.id)}', '${escHtml(user.username)}')">Global Ban</button>`)
                    : ''}
                ${canDelete ? `<button class="btn btn-danger" onclick="deleteUser('${escHtml(user.id)}', '${escHtml(user.username)}')">Delete Account</button>` : ''}
            </div>
        </div>
    `);
}

function banUser(id, username) {
    showFormModal('Ban User', [
        { name: 'reason', label: 'Reason (optional)', type: 'text', placeholder: 'Reason for ban…' }
    ], async (vals) => {
        const res = await api('POST', `/users/${id}/ban`, { reason: vals.reason });
        if (!res?.ok) { toast(res?.data?.error || 'Ban failed.', true); return; }
        toast(`${username} globally banned.`);
        closeModal();
        renderUsers(1, '');
    });
}

async function unbanUser(id) {
    const res = await api('DELETE', `/users/${id}/ban`);
    if (!res?.ok) { toast(res?.data?.error || 'Unban failed.', true); return; }
    toast('Global ban removed.');
    // Refresh current view
    if (document.querySelector('.back-link')) renderUserDetail(id);
    else renderUsers(1, '');
}

function deleteUser(id, username) {
    showConfirm(`Permanently delete user "${username}"? This cannot be undone.`, async () => {
        const res = await api('DELETE', `/users/${id}`);
        if (!res?.ok) { toast(res?.data?.error || 'Delete failed.', true); return; }
        toast(`User ${username} deleted.`);
        renderUsers(1, '');
    });
}

/* ─── Servers ───────────────────────────────────────────────────────────── */

async function renderServers(page = 1, q = '') {
    const qs  = `?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
    const res = await api('GET', `/servers${qs}`);
    if (!res?.ok) { setContent('<div class="loading">Failed to load servers.</div>'); return; }
    const { servers, total } = res.data;

    const canManage = roleAtLeast('superadmin');

    const rows = servers.map(s => `
        <tr>
            <td class="cell-mono">${escHtml(s.id)}</td>
            <td><strong>${escHtml(s.name)}</strong></td>
            <td>${escHtml(s.owner_username || '—')}</td>
            <td>${fmtNum(s.member_count)}</td>
            <td class="cell-muted">${fmtDate(s.created_at)}</td>
            <td>
                <div class="actions-cell">
                    <button class="btn btn-ghost btn-sm" onclick="renderServerDetail('${escHtml(s.id)}')">View</button>
                    ${canManage ? `
                        <button class="btn btn-ghost btn-sm" onclick="transferServer('${escHtml(s.id)}', '${escHtml(s.name)}')">Transfer</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteServer('${escHtml(s.id)}', '${escHtml(s.name)}')">Delete</button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');

    const pagFn = `function(p){ renderServers(p, document.getElementById('serverSearch')?.value||'') }`;

    setContent(`
        <div class="section-header">
            <h2>Servers</h2>
            <div class="search-bar">
                <input id="serverSearch" type="text" placeholder="Search server name…" value="${escHtml(q)}"
                    onkeydown="if(event.key==='Enter') renderServers(1, this.value)">
                <button class="btn btn-primary btn-sm" onclick="renderServers(1, document.getElementById('serverSearch').value)">Search</button>
            </div>
        </div>
        <div class="table-wrap">
            <table>
                <thead>
                    <tr><th>ID</th><th>Name</th><th>Owner</th><th>Members</th><th>Created</th><th>Actions</th></tr>
                </thead>
                <tbody>${rows || '<tr><td colspan="6" class="empty-state">No servers found.</td></tr>'}</tbody>
            </table>
        </div>
        ${paginationHtml(page, total, 25, pagFn)}
    `);
}

async function renderServerDetail(id) {
    const res = await api('GET', `/servers/${id}`);
    if (!res?.ok) { toast('Failed to load server.', true); return; }
    const { server, channelCount, members } = res.data;

    const canManage = roleAtLeast('superadmin');

    const memberRows = members.map(m => `
        <tr>
            <td class="cell-mono">${escHtml(m.id)}</td>
            <td>${escHtml(m.username)}</td>
            <td class="cell-muted">${fmtDate(m.joined_at)}</td>
        </tr>
    `).join('');

    setContent(`
        <span class="back-link" onclick="renderServers(1,'')">← Back to Servers</span>
        <div class="detail-card">
            <h3>Server: ${escHtml(server.name)}</h3>
            <div class="detail-grid">
                <span class="detail-label">ID</span><span class="detail-value cell-mono">${escHtml(server.id)}</span>
                <span class="detail-label">Owner</span><span class="detail-value">${escHtml(server.owner_username || '—')} <span class="cell-muted cell-mono">(${escHtml(server.owner_id || '')})</span></span>
                <span class="detail-label">Channels</span><span class="detail-value">${fmtNum(channelCount)}</span>
                <span class="detail-label">Members</span><span class="detail-value">${fmtNum(members.length)}${members.length >= 100 ? ' (showing first 100)' : ''}</span>
                <span class="detail-label">Created</span><span class="detail-value">${fmtDate(server.created_at)}</span>
            </div>
            ${canManage ? `
                <div class="detail-actions">
                    <button class="btn btn-ghost" onclick="transferServer('${escHtml(server.id)}', '${escHtml(server.name)}')">Transfer Ownership</button>
                    <button class="btn btn-danger" onclick="deleteServer('${escHtml(server.id)}', '${escHtml(server.name)}')">Delete Server</button>
                </div>
            ` : ''}
        </div>
        <div class="detail-card">
            <h3>Members</h3>
            <div class="table-wrap">
                <table>
                    <thead><tr><th>ID</th><th>Username</th><th>Joined</th></tr></thead>
                    <tbody>${memberRows || '<tr><td colspan="3" class="empty-state">No members.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `);
}

function deleteServer(id, name) {
    showConfirm(`Permanently delete server "${name}" and all its data? This cannot be undone.`, async () => {
        const res = await api('DELETE', `/servers/${id}`);
        if (!res?.ok) { toast(res?.data?.error || 'Delete failed.', true); return; }
        toast(`Server "${name}" deleted.`);
        renderServers(1, '');
    });
}

function transferServer(id, name) {
    showFormModal(`Transfer "${name}" Ownership`, [
        { name: 'newOwnerId', label: 'New Owner User ID', type: 'text', placeholder: 'User ID (must be a member)' }
    ], async (vals) => {
        if (!vals.newOwnerId) { toast('User ID required.', true); return; }
        const res = await api('PATCH', `/servers/${id}/owner`, { newOwnerId: vals.newOwnerId });
        if (!res?.ok) { toast(res?.data?.error || 'Transfer failed.', true); return; }
        toast('Ownership transferred.');
        closeModal();
        renderServerDetail(id);
    });
}

/* ─── Ascension ─────────────────────────────────────────────────────────── */

async function renderAscension() {
    const nodesRes = await api('GET', '/ascension/nodes');
    if (!nodesRes?.ok) { setContent('<div class="loading">Failed to load ascension data.</div>'); return; }
    const nodes = nodesRes.data.nodes;

    const canManage = roleAtLeast('superadmin');

    const nodeRows = nodes.map(n => `
        <tr class="${n.is_active ? '' : 'node-inactive'}">
            <td class="cell-mono">${escHtml(n.id)}</td>
            <td>${escHtml(n.icon || '')} ${escHtml(n.name)}</td>
            <td><span class="inline-badge" style="background:rgba(88,101,242,0.15);color:#5865f2">${escHtml(n.type)}</span></td>
            <td>T${escHtml(String(n.tier))}</td>
            <td>${fmtNum(n.cost)}</td>
            <td>${n.is_active ? '<span style="color:var(--success)">Active</span>' : '<span style="color:var(--text-muted)">Inactive</span>'}</td>
            ${canManage ? `
            <td>
                <div class="actions-cell">
                    <button class="btn btn-ghost btn-sm" onclick="editNode('${escHtml(n.id)}')">Edit</button>
                    ${n.is_active ? `<button class="btn btn-danger btn-sm" onclick="deleteNode('${escHtml(n.id)}', '${escHtml(n.name)}')">Deactivate</button>` : ''}
                </div>
            </td>` : '<td></td>'}
        </tr>
    `).join('');

    setContent(`
        <h2 style="margin-bottom:24px;font-size:20px;font-weight:700;">Ascension</h2>

        <div class="asc-section">
            <div class="section-header">
                <h3>Skill Tree Nodes</h3>
                ${canManage ? `<button class="btn btn-primary btn-sm" onclick="createNode()">+ New Node</button>` : ''}
            </div>
            <div class="table-wrap">
                <table>
                    <thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Tier</th><th>Cost</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>${nodeRows || '<tr><td colspan="7" class="empty-state">No nodes.</td></tr>'}</tbody>
                </table>
            </div>
        </div>

        <div class="asc-section">
            <h3>Grant Points to User</h3>
            <div class="detail-card" style="padding:16px 20px">
                <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
                    <div class="form-field" style="margin:0;flex:1;min-width:180px">
                        <label>Search User</label>
                        <input id="ascUserSearch" type="text" placeholder="Username…"
                            oninput="searchAscUsers(this.value)">
                    </div>
                </div>
                <div id="ascUserResults" style="margin-top:12px"></div>
            </div>
        </div>
    `);
}

async function searchAscUsers(q) {
    if (!q) { document.getElementById('ascUserResults').innerHTML = ''; return; }
    const res = await api('GET', `/ascension/users?q=${encodeURIComponent(q)}`);
    if (!res?.ok) return;
    const { users } = res.data;

    const rows = users.map(u => `
        <tr>
            <td>${escHtml(u.username)}</td>
            <td class="cell-mono">${escHtml(u.id)}</td>
            <td>${fmtNum(u.balance)} pts</td>
            <td>
                <button class="btn btn-success btn-sm" onclick="grantPoints('${escHtml(u.id)}', '${escHtml(u.username)}')">Grant Points</button>
            </td>
        </tr>
    `).join('');

    document.getElementById('ascUserResults').innerHTML = `
        <div class="table-wrap">
            <table>
                <thead><tr><th>Username</th><th>ID</th><th>Balance</th><th>Actions</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="4" class="empty-state">No users found.</td></tr>'}</tbody>
            </table>
        </div>`;
}

function grantPoints(userId, username) {
    showFormModal(`Grant Points to ${username}`, [
        { name: 'amount', label: 'Amount', type: 'number', placeholder: '100' },
        { name: 'reason', label: 'Reason (optional)', type: 'text', placeholder: 'Staff grant…' }
    ], async (vals) => {
        const amount = parseInt(vals.amount, 10);
        if (!amount || amount <= 0) { toast('Amount must be positive.', true); return; }
        const res = await api('POST', '/ascension/grant', { userId, amount, reason: vals.reason || undefined });
        if (!res?.ok) { toast(res?.data?.error || 'Grant failed.', true); return; }
        toast(`Granted ${fmtNum(amount)} pts to ${username}. New balance: ${fmtNum(res.data.balance)}`);
        closeModal();
    });
}

function createNode() {
    showFormModal('Create Skill Tree Node', [
        { name: 'name',        label: 'Name',        type: 'text' },
        { name: 'type',        label: 'Type',        type: 'select', options: [{value:'user',label:'User'},{value:'server',label:'Server'}], default: 'user' },
        { name: 'tier',        label: 'Tier',        type: 'number', default: '1' },
        { name: 'cost',        label: 'Cost (pts)',  type: 'number', default: '0' },
        { name: 'icon',        label: 'Icon (emoji)',type: 'text' },
        { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'parent_id',   label: 'Parent Node ID (optional)', type: 'text' },
        { name: 'sort_order',  label: 'Sort Order',  type: 'number', default: '0' }
    ], async (vals) => {
        if (!vals.name) { toast('Name required.', true); return; }
        const res = await api('POST', '/ascension/nodes', vals);
        if (!res?.ok) { toast(res?.data?.error || 'Create failed.', true); return; }
        toast('Node created.');
        closeModal();
        renderAscension();
    });
}

async function editNode(id) {
    // Fetch current data
    const nodesRes = await api('GET', '/ascension/nodes');
    const node = nodesRes?.data?.nodes?.find(n => n.id === id);
    if (!node) { toast('Node not found.', true); return; }

    showFormModal('Edit Node: ' + node.name, [
        { name: 'name',        label: 'Name',        type: 'text',   default: node.name },
        { name: 'type',        label: 'Type',        type: 'select', options: [{value:'user',label:'User'},{value:'server',label:'Server'}], default: node.type },
        { name: 'tier',        label: 'Tier',        type: 'number', default: String(node.tier) },
        { name: 'cost',        label: 'Cost (pts)',  type: 'number', default: String(node.cost) },
        { name: 'icon',        label: 'Icon',        type: 'text',   default: node.icon || '' },
        { name: 'description', label: 'Description', type: 'textarea', default: node.description || '' },
        { name: 'sort_order',  label: 'Sort Order',  type: 'number', default: String(node.sort_order) }
    ], async (vals) => {
        const res = await api('PATCH', `/ascension/nodes/${id}`, vals);
        if (!res?.ok) { toast(res?.data?.error || 'Update failed.', true); return; }
        toast('Node updated.');
        closeModal();
        renderAscension();
    });
}

function deleteNode(id, name) {
    showConfirm(`Deactivate node "${name}"?`, async () => {
        const res = await api('DELETE', `/ascension/nodes/${id}`);
        if (!res?.ok) { toast(res?.data?.error || 'Failed.', true); return; }
        toast(`Node "${name}" deactivated.`);
        renderAscension();
    });
}

/* ─── Audit Log ─────────────────────────────────────────────────────────── */

async function renderAudit(page = 1) {
    const res = await api('GET', `/audit?page=${page}`);
    if (!res?.ok) { setContent('<div class="loading">Failed to load audit log.</div>'); return; }
    const { entries, total } = res.data;

    const rows = entries.map(e => `
        <tr>
            <td class="cell-muted">${fmtDate(e.created_at)}</td>
            <td>${escHtml(e.username || '(deleted)')}</td>
            <td class="cell-mono">${escHtml(e.user_id || '')}</td>
            <td style="color:${e.delta > 0 ? 'var(--success)' : e.delta < 0 ? 'var(--danger)' : 'var(--text-muted)'}">
                ${e.delta > 0 ? '+' : ''}${fmtNum(e.delta)}
            </td>
            <td>${escHtml(e.reason || '—')}</td>
            <td class="cell-mono cell-muted">${escHtml(e.ref_id || '—')}</td>
        </tr>
    `).join('');

    const pagFn = `function(p){ renderAudit(p) }`;

    setContent(`
        <div class="section-header">
            <h2>Audit Log</h2>
            <span class="cell-muted" style="font-size:13px">${fmtNum(total)} total entries</span>
        </div>
        <div class="table-wrap">
            <table>
                <thead><tr><th>Time</th><th>User</th><th>User ID</th><th>Delta</th><th>Reason</th><th>Ref ID</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="6" class="empty-state">No entries.</td></tr>'}</tbody>
            </table>
        </div>
        ${paginationHtml(page, total, 100, pagFn)}
    `);
}

/* ─── Staff Roster ──────────────────────────────────────────────────────── */

async function renderStaff() {
    if (state.staffRole !== 'owner') {
        setContent('<div class="loading">Access denied.</div>');
        return;
    }

    const res = await api('GET', '/members');
    if (!res?.ok) { setContent('<div class="loading">Failed to load staff roster.</div>'); return; }
    const { members } = res.data;

    const rows = members.map(m => `
        <tr>
            <td>${escHtml(m.username)}</td>
            <td class="cell-muted">${escHtml(m.email)}</td>
            <td>${roleBadge(m.role)}</td>
            <td>${m.is_active ? '<span style="color:var(--success)">Active</span>' : '<span style="color:var(--text-muted)">Inactive</span>'}</td>
            <td class="cell-muted">${escHtml(m.granted_by_username || '—')}</td>
            <td class="cell-muted">${fmtDate(m.granted_at)}</td>
            <td>
                <div class="actions-cell">
                    ${m.is_active ? `<button class="btn btn-ghost btn-sm" onclick="editStaffRole('${escHtml(m.id)}', '${escHtml(m.username)}', '${escHtml(m.role)}')">Edit Role</button>` : ''}
                    ${m.is_active && m.user_id !== state.user.id
                        ? `<button class="btn btn-danger btn-sm" onclick="deactivateStaff('${escHtml(m.id)}', '${escHtml(m.username)}')">Deactivate</button>`
                        : ''}
                    ${!m.is_active
                        ? `<button class="btn btn-success btn-sm" onclick="reactivateStaff('${escHtml(m.id)}', '${escHtml(m.username)}')">Reactivate</button>`
                        : ''}
                </div>
            </td>
        </tr>
    `).join('');

    setContent(`
        <div class="section-header">
            <h2>Staff Roster</h2>
            <button class="btn btn-primary btn-sm" onclick="addStaffMember()">+ Add Staff</button>
        </div>
        <div class="table-wrap">
            <table>
                <thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Granted By</th><th>Granted At</th><th>Actions</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="7" class="empty-state">No staff members.</td></tr>'}</tbody>
            </table>
        </div>
    `);
}

function addStaffMember() {
    showFormModal('Add Staff Member', [
        { name: 'userId', label: 'User ID', type: 'text', placeholder: 'NexusGuild user ID' },
        { name: 'role', label: 'Role', type: 'select',
          options: [
              {value:'viewer',label:'Viewer'},
              {value:'moderator',label:'Moderator'},
              {value:'superadmin',label:'Superadmin'}
          ], default: 'viewer' }
    ], async (vals) => {
        if (!vals.userId) { toast('User ID required.', true); return; }
        const res = await api('POST', '/members', { userId: vals.userId, role: vals.role });
        if (!res?.ok) { toast(res?.data?.error || 'Failed to add staff.', true); return; }
        toast('Staff member added.');
        closeModal();
        renderStaff();
    });
}

function editStaffRole(id, username, currentRole) {
    showFormModal(`Edit Role: ${username}`, [
        { name: 'role', label: 'Role', type: 'select',
          options: [
              {value:'viewer',label:'Viewer'},
              {value:'moderator',label:'Moderator'},
              {value:'superadmin',label:'Superadmin'},
              {value:'owner',label:'Owner'}
          ], default: currentRole }
    ], async (vals) => {
        const res = await api('PATCH', `/members/${id}`, { role: vals.role });
        if (!res?.ok) { toast(res?.data?.error || 'Failed.', true); return; }
        toast('Role updated.');
        closeModal();
        renderStaff();
    });
}

function deactivateStaff(id, username) {
    showConfirm(`Deactivate staff access for "${username}"?`, async () => {
        const res = await api('DELETE', `/members/${id}`);
        if (!res?.ok) { toast(res?.data?.error || 'Failed.', true); return; }
        toast(`${username} deactivated.`);
        renderStaff();
    });
}

async function reactivateStaff(id, username) {
    const res = await api('POST', `/members/${id}/reactivate`);
    if (!res?.ok) { toast(res?.data?.error || 'Failed.', true); return; }
    toast(`${username} reactivated.`);
    renderStaff();
}

/* ─── Role check ────────────────────────────────────────────────────────── */

const ROLE_ORDER = ['viewer', 'moderator', 'superadmin', 'owner'];

function roleAtLeast(minRole) {
    return ROLE_ORDER.indexOf(state.staffRole) >= ROLE_ORDER.indexOf(minRole);
}

/* ─── Enter ─────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', init);

// Allow Enter key on login
document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.getElementById('loginScreen').style.display !== 'none') {
        const focused = document.activeElement;
        if (focused?.id === 'loginEmail' || focused?.id === 'loginPassword') login();
    }
});
