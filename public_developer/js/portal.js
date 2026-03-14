const API = 'https://app.nexusguild.gg';

let currentUser = null;
let currentBot  = null;
let userServers = [];

// Permission definitions for the picker
const PORTAL_PERMS = [
    { label: 'Administrator',        bit: 8n },
    { label: 'Manage Server',        bit: 32n },
    { label: 'Manage Channels',      bit: 16n },
    { label: 'Manage Roles',         bit: 268435456n },
    { label: 'Kick Members',         bit: 2n },
    { label: 'Ban Members',          bit: 4n },
    { label: 'Moderate Members',     bit: 1099511627776n },
    { label: 'Manage Webhooks',      bit: 536870912n },
    { label: 'View Channels',        bit: 1024n },
    { label: 'Send Messages',        bit: 2048n },
    { label: 'Manage Messages',      bit: 8192n },
    { label: 'Embed Links',          bit: 16384n },
    { label: 'Attach Files',         bit: 32768n },
    { label: 'Read Message History', bit: 65536n },
    { label: 'Mention @everyone',    bit: 131072n },
    { label: 'Add Reactions',        bit: 64n },
];

function renderPermPicker(currentPerms) {
    const bits = BigInt(currentPerms || 0);
    const el = document.getElementById('permPickerList');
    if (!el) return;
    el.innerHTML = PORTAL_PERMS.map(p => `
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#b5bac1;cursor:pointer;padding:3px 0;">
            <input type="checkbox" data-perm-bit="${p.bit}" ${(bits & p.bit) === p.bit ? 'checked' : ''}
                   style="accent-color:#5865f2;cursor:pointer;">
            ${escHtml(p.label)}
        </label>
    `).join('');
}

function getPickedPermissions() {
    let result = 0n;
    document.querySelectorAll('#permPickerList input[type=checkbox]:checked').forEach(cb => {
        result |= BigInt(cb.dataset.permBit);
    });
    return result;
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
    try {
        const res = await fetch(`${API}/api/auth/me`, { credentials: 'include' });
        if (!res.ok) { showAuthGate(); return; }
        currentUser = await res.json();

        document.getElementById('userName').textContent = currentUser.username;
        const av = document.getElementById('userAvatar');
        if (currentUser.avatar) {
            av.src = `${API}${currentUser.avatar}`;
        } else {
            av.style.display = 'none';
        }

        document.getElementById('authGate').style.display = 'none';
        document.getElementById('portal').style.display = 'flex';

        await Promise.all([loadBots(), loadUserServers()]);
    } catch {
        showAuthGate();
    }
}

function showAuthGate() {
    document.getElementById('authGate').style.display = 'flex';
    document.getElementById('portal').style.display = 'none';
}

// ── Bots ──────────────────────────────────────────────────────────────────────

async function loadBots() {
    const res = await fetch(`${API}/api/bots`, { credentials: 'include' });
    if (!res.ok) return;
    const { bots } = await res.json();
    renderBotList(bots);
    if (!bots.length) showEmpty();
}

function renderBotList(bots) {
    const list = document.getElementById('botList');
    if (!bots.length) { list.innerHTML = '<div class="empty-list">No bots yet.</div>'; return; }
    list.innerHTML = bots.map(b => `
        <div class="bot-item ${currentBot?.id === b.id ? 'active' : ''}"
             data-id="${b.id}" onclick="selectBot('${b.id}')">
            <div class="bot-item-av">🤖</div>
            <span>${escHtml(b.name)}</span>
        </div>
    `).join('');
}

async function selectBot(botId) {
    const res = await fetch(`${API}/api/bots/${botId}`, { credentials: 'include' });
    if (!res.ok) return;
    const { bot } = await res.json();
    currentBot = bot;

    document.querySelectorAll('.bot-item').forEach(el =>
        el.classList.toggle('active', el.dataset.id === botId)
    );

    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('createBotPanel').style.display = 'none';
    document.getElementById('botPanel').style.display = 'block';

    document.getElementById('botName').textContent = bot.name;
    document.getElementById('botIdDisplay').textContent = `ID: ${bot.id}`;
    const inviteUrl = `${API}/invite/bot/${bot.id}`;
    document.getElementById('inviteLinkField').value = inviteUrl;
    document.getElementById('inviteLinkOpen').href = inviteUrl;
    document.getElementById('editBotName').value = bot.name;
    document.getElementById('editBotDesc').value = bot.description || '';
    document.getElementById('editBotCallback').value = bot.callback_url || '';
    renderPermPicker(bot.default_permissions);

    switchTab('overview', document.querySelector('.tab[data-tab="overview"]'));
    loadBotToken(botId);
    loadBotServers(botId);
    populateServerSelects();
}

async function loadBotToken(botId) {
    const res = await fetch(`${API}/api/bots/${botId}/token`, { credentials: 'include' });
    if (!res.ok) return;
    const { token } = await res.json();
    document.getElementById('tokenField').value = token;
}

// ── Create bot ────────────────────────────────────────────────────────────────

function showCreateBot() {
    currentBot = null;
    document.querySelectorAll('.bot-item').forEach(el => el.classList.remove('active'));
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('botPanel').style.display = 'none';
    document.getElementById('createBotPanel').style.display = 'block';
    document.getElementById('newBotName').value = '';
    document.getElementById('newBotDesc').value = '';
    document.getElementById('newBotCallback').value = '';
    document.getElementById('createBotError').style.display = 'none';
}

async function createBot() {
    const name        = document.getElementById('newBotName').value.trim();
    const description = document.getElementById('newBotDesc').value.trim();
    const callbackUrl = document.getElementById('newBotCallback').value.trim();
    const errEl       = document.getElementById('createBotError');

    if (!name) { showError(errEl, 'Bot name is required.'); return; }

    const res = await fetch(`${API}/api/bots`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, callbackUrl }),
    });
    const data = await res.json();
    if (!res.ok) { showError(errEl, data.error || 'Failed to create bot.'); return; }

    await loadBots();
    selectBot(data.id);
}

// ── Save bot ──────────────────────────────────────────────────────────────────

async function saveBot() {
    if (!currentBot) return;
    const name               = document.getElementById('editBotName').value.trim();
    const description        = document.getElementById('editBotDesc').value.trim();
    const callbackUrl        = document.getElementById('editBotCallback').value.trim();
    const defaultPermissions = getPickedPermissions().toString();
    const msgEl              = document.getElementById('overviewMsg');

    const res = await fetch(`${API}/api/bots/${currentBot.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, callbackUrl, defaultPermissions }),
    });
    if (!res.ok) { const d = await res.json(); showError(msgEl, d.error || 'Save failed.'); return; }

    currentBot.name = name;
    currentBot.default_permissions = defaultPermissions;
    document.getElementById('botName').textContent = name;
    document.querySelectorAll(`.bot-item[data-id="${currentBot.id}"] span`).forEach(el => el.textContent = name);
    showSuccess(msgEl, 'Changes saved.');
}

// ── Delete bot ────────────────────────────────────────────────────────────────

function confirmDeleteBot() {
    showConfirm(
        'Delete Bot',
        `Are you sure you want to delete "${currentBot?.name}"? This cannot be undone.`,
        async () => {
            await fetch(`${API}/api/bots/${currentBot.id}`, { method: 'DELETE', credentials: 'include' });
            currentBot = null;
            closeConfirm();
            await loadBots();
            showEmpty();
        }
    );
}

// ── Token ─────────────────────────────────────────────────────────────────────

function toggleTokenVisibility() {
    const field = document.getElementById('tokenField');
    const btn   = field.nextElementSibling;
    if (field.type === 'password') { field.type = 'text'; btn.textContent = 'Hide'; }
    else { field.type = 'password'; btn.textContent = 'Show'; }
}

function copyToken() {
    const val = document.getElementById('tokenField').value;
    navigator.clipboard.writeText(val);
    const msgEl = document.getElementById('tokenMsg');
    showSuccess(msgEl, 'Token copied to clipboard.');
    msgEl.style.display = 'block';
}

function confirmRegenToken() {
    showConfirm(
        'Regenerate Token',
        'Your old token will stop working immediately. Are you sure?',
        async () => {
            const res = await fetch(`${API}/api/bots/${currentBot.id}/token/regenerate`, {
                method: 'POST', credentials: 'include'
            });
            if (res.ok) {
                const { token } = await res.json();
                document.getElementById('tokenField').value = token;
                document.getElementById('tokenField').type = 'text';
            }
            closeConfirm();
        }
    );
}

// ── Servers ───────────────────────────────────────────────────────────────────

async function loadUserServers() {
    const res = await fetch(`${API}/api/servers`, { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    userServers = data.servers || [];
}

function populateServerSelects() {
    const opts = userServers.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
    ['addServerSelect', 'cmdServerSelect', 'cmdListServerSelect'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = `<option value="">Select server...</option>${opts}`;
    });
}

async function loadBotServers(botId) {
    const res = await fetch(`${API}/api/bots/${botId}/servers`, { credentials: 'include' });
    if (!res.ok) return;
    const { servers } = await res.json();
    const el = document.getElementById('botServerList');
    if (!servers.length) { el.innerHTML = '<div class="empty-list">Not in any servers yet.</div>'; return; }
    el.innerHTML = servers.map(s => `
        <div class="server-list-item">
            <div class="server-info">
                <div class="server-icon">
                    ${s.icon ? `<img src="${API}${s.icon}" alt="">` : escHtml(s.name[0])}
                </div>
                <span class="server-name">${escHtml(s.name)}</span>
            </div>
            <button class="btn-danger-sm" onclick="removeBotFromServer('${s.id}', '${escHtml(s.name)}')">Remove</button>
        </div>
    `).join('');
}

async function addBotToServer() {
    const serverId = document.getElementById('addServerSelect').value;
    const msgEl    = document.getElementById('addServerMsg');
    if (!serverId || !currentBot) return;

    const res = await fetch(`${API}/api/bots/${currentBot.id}/servers/${serverId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: currentBot.default_permissions ?? '0' }),
    });
    const data = await res.json();
    if (!res.ok) { showError(msgEl, data.error || 'Failed to add bot.'); return; }

    showSuccess(msgEl, 'Bot added to server.');
    loadBotServers(currentBot.id);
}

function removeBotFromServer(serverId, serverName) {
    showConfirm(
        'Remove Bot',
        `Remove this bot from "${serverName}"?`,
        async () => {
            await fetch(`${API}/api/bots/${currentBot.id}/servers/${serverId}`, {
                method: 'DELETE', credentials: 'include'
            });
            closeConfirm();
            loadBotServers(currentBot.id);
        }
    );
}

// ── Slash commands ────────────────────────────────────────────────────────────

async function upsertCommand() {
    const serverId = document.getElementById('cmdServerSelect').value;
    const name     = document.getElementById('cmdName').value.trim().toLowerCase();
    const desc     = document.getElementById('cmdDesc').value.trim();
    const msgEl    = document.getElementById('cmdMsg');

    if (!serverId) { showError(msgEl, 'Select a server.'); return; }
    if (!name)     { showError(msgEl, 'Command name is required.'); return; }
    if (!desc)     { showError(msgEl, 'Description is required.'); return; }

    const res = await fetch(`${API}/api/bots/${currentBot.id}/servers/${serverId}/commands`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: desc }),
    });
    const data = await res.json();
    if (!res.ok) { showError(msgEl, data.error || 'Failed to save command.'); return; }

    showSuccess(msgEl, `/${name} saved.`);
    document.getElementById('cmdName').value = '';
    document.getElementById('cmdDesc').value = '';

    // Refresh list if that server is selected
    if (document.getElementById('cmdListServerSelect').value === serverId) {
        loadCommandsForServer();
    }
}

async function loadCommandsForServer() {
    const serverId = document.getElementById('cmdListServerSelect').value;
    const el = document.getElementById('commandList');
    if (!serverId || !currentBot) { el.innerHTML = '<div class="empty-list">Select a server to view commands.</div>'; return; }

    el.innerHTML = '<div class="loading">Loading...</div>';
    const res = await fetch(`${API}/api/bots/${currentBot.id}/servers/${serverId}/commands`, { credentials: 'include' });
    if (!res.ok) { el.innerHTML = '<div class="empty-list">Failed to load commands.</div>'; return; }
    const { commands } = await res.json();

    if (!commands.length) { el.innerHTML = '<div class="empty-list">No commands registered for this server.</div>'; return; }
    el.innerHTML = commands.map(c => `
        <div class="command-item">
            <div>
                <div class="command-name">${escHtml(c.name)}</div>
                <div class="command-desc">${escHtml(c.description)}</div>
            </div>
            <button class="btn-danger-sm" onclick="deleteCommand('${c.id}', '${escHtml(c.name)}', '${serverId}')">Delete</button>
        </div>
    `).join('');
}

function deleteCommand(commandId, name, serverId) {
    showConfirm(
        'Delete Command',
        `Delete /${name} from this server?`,
        async () => {
            await fetch(`${API}/api/bots/${currentBot.id}/servers/${serverId}/commands/${commandId}`, {
                method: 'DELETE', credentials: 'include'
            });
            closeConfirm();
            loadCommandsForServer();
        }
    );
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function copyInviteLink() {
    const url = document.getElementById('inviteLinkField').value;
    navigator.clipboard.writeText(url);
    const msgEl = document.getElementById('overviewMsg');
    showSuccess(msgEl, 'Invite link copied!');
}

function showEmpty() {
    document.getElementById('emptyState').style.display = 'flex';
    document.getElementById('createBotPanel').style.display = 'none';
    document.getElementById('botPanel').style.display = 'none';
}

function switchTab(name, btn) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
    if (btn) btn.classList.add('active');
    document.getElementById(`tab-${name}`).style.display = 'block';
}

function showSuccess(el, msg) {
    el.className = 'success-msg';
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 3000);
}

function showError(el, msg) {
    el.className = 'error-msg';
    el.textContent = msg;
    el.style.display = 'block';
}

let _confirmAction = null;
function showConfirm(title, msg, action) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;
    _confirmAction = action;
    document.getElementById('confirmOk').onclick = action;
    document.getElementById('confirmOverlay').style.display = 'flex';
}
function closeConfirm() {
    document.getElementById('confirmOverlay').style.display = 'none';
    _confirmAction = null;
}

function escHtml(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
