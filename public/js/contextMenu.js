// File Location: /public/js/contextMenu.js

// -------------------------------------------------------------------------
// UNIVERSAL MODAL SYSTEM
// -------------------------------------------------------------------------

let modalCallback = null;
let modalData = null;

/**
 * Show universal modal with configuration
 * @param {Object} config - Modal configuration
 * @param {string} config.title - Modal title
 * @param {string} [config.message] - Optional message/hint text
 * @param {string} [config.customHTML] - Optional custom HTML content (alternative to message)
 * @param {string} [config.inputType] - 'text', 'textarea', 'readonly', or null for no input
 * @param {string} [config.inputValue] - Initial input value
 * @param {string} [config.inputPlaceholder] - Input placeholder
 * @param {Object} [config.inputStyle] - Additional input styles
 * @param {Array} config.buttons - Array of button configs [{text, style, action}]
 * @param {Function} [config.onEnter] - Function to call when Enter is pressed
 */
function showModal(config) {
    const modal = document.getElementById('universalModal');
    // Clear any profile-specific class left from a previous modal open
    modal.querySelector('.modal')?.classList.remove('modal-profile');
    const title = document.getElementById('modalTitle');
    const message = document.getElementById('modalMessage');
    const input = document.getElementById('modalInput');
    const textarea = document.getElementById('modalTextarea');
    const error = document.getElementById('modalError');
    const buttonsContainer = document.getElementById('modalButtons');

    // Set title
    title.textContent = config.title || 'Modal';

    // Set message
    if (config.message) {
        message.textContent = config.message;
        message.style.display = 'block';
    } else if (config.customHTML) {
        message.innerHTML = config.customHTML;
        message.style.display = 'block';
    } else {
        message.style.display = 'none';
    }

    // Handle input
    input.style.display = 'none';
    textarea.style.display = 'none';

    if (config.inputType === 'text' || config.inputType === 'readonly') {
        input.style.display = 'block';
        input.value = config.inputValue || '';
        input.placeholder = config.inputPlaceholder || '';
        input.readOnly = config.inputType === 'readonly';

        // Apply custom styles
        if (config.inputStyle) {
            Object.assign(input.style, config.inputStyle);
        } else {
            // Reset to defaults
            input.style.fontFamily = 'inherit';
            input.style.letterSpacing = '';
            input.style.textAlign = '';
            input.style.fontSize = '';
        }

        // Enter key handler
        input.onkeypress = (e) => {
            if (e.key === 'Enter' && config.onEnter) {
                config.onEnter();
            }
        };
    } else if (config.inputType === 'textarea') {
        textarea.style.display = 'block';
        textarea.value = config.inputValue || '';
        textarea.placeholder = config.inputPlaceholder || '';
    }

    // Hide error
    error.style.display = 'none';

    // Build buttons
    buttonsContainer.innerHTML = config.buttons.map(btn =>
        `<button class="btn-${btn.style || 'primary'}" onclick="modalButtonClick(${config.buttons.indexOf(btn)})">${btn.text}</button>`
    ).join('');

    // Store callback data
    modalData = config;

    // Show modal
    modal.style.display = 'flex';

    // Auto-focus on input/textarea
    setTimeout(() => {
        if (config.inputType === 'text') input.focus();
        else if (config.inputType === 'textarea') textarea.focus();
        else if (config.inputType === 'readonly') {
            input.select();
            input.setSelectionRange(0, 99999);
        }
    }, 50);

    // Click outside to close
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
}

function modalButtonClick(index) {
    if (modalData && modalData.buttons[index]) {
        modalData.buttons[index].action();
    }
}

function closeModal() {
    const modal = document.getElementById('universalModal');
    modal.style.display = 'none';
    modalCallback = null;
    modalData = null;
}

function showModalError(message) {
    const error = document.getElementById('modalError');
    error.textContent = message;
    error.style.display = 'block';
}

function getModalInputValue() {
    const input = document.getElementById('modalInput');
    const textarea = document.getElementById('modalTextarea');
    if (input.style.display !== 'none') return input.value;
    if (textarea.style.display !== 'none') return textarea.value;
    return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT MENU SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

// Context Menu System

const ctxMenu = (() => {
    let menuEl = null;

    function init() {
        menuEl = document.createElement('div');
        menuEl.id = 'contextMenu';
        menuEl.className = 'ctx-menu';
        menuEl.style.display = 'none';
        document.body.appendChild(menuEl);

        // Close on any left-click outside
        document.addEventListener('click', () => hide());

        // Global right-click: suppress browser menu everywhere except inputs/textareas,
        // and show user context menu when right-clicking any [data-user-id] element.
        document.addEventListener('contextmenu', (e) => {
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) {
                hide();
                return; // allow browser default for text editing
            }
            e.preventDefault();

            const userEl = e.target.closest('[data-user-id]');
            if (userEl?.dataset.userId) {
                showUserContextMenu(userEl.dataset.userId, e.clientX, e.clientY);
                return;
            }

            hide();
        });
    }

    function show(x, y, items) {
        menuEl.innerHTML = items.map(item => {
            if (item === 'divider') return `<div class="ctx-divider"></div>`;
            return `
                <div class="ctx-item ${item.danger ? 'ctx-danger' : ''}" data-action="${item.action}">
                    ${item.label}
                </div>
            `;
        }).join('');

        // Position menu, flip if it would go off screen
        menuEl.style.display = 'block';
        const menuW = menuEl.offsetWidth;
        const menuH = menuEl.offsetHeight;
        const winW = window.innerWidth;
        const winH = window.innerHeight;

        menuEl.style.left = (x + menuW > winW ? x - menuW : x) + 'px';
        menuEl.style.top = (y + menuH > winH ? y - menuH : y) + 'px';

        menuEl.onclick = (e) => {
            const item = e.target.closest('.ctx-item');
            if (!item) return;
            const action = item.dataset.action;
            const handler = ctxMenu._handlers[action];
            if (handler) handler();
            hide();
        };
    }

    function hide() {
        if (menuEl) menuEl.style.display = 'none';
        ctxMenu._handlers = {};
    }

    return { init, show, hide, _handlers: {} };
})();

// ── Attach right-click to a message element ──────────────────────────────────
function attachMessageContextMenu(el, message) {
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const isOwner = state.currentUser && message.user_id === state.currentUser.id;
        const canManageMessages = clientHasPermission(CLIENT_PERMS.MANAGE_MESSAGES);
        const items = [];

        items.push({ label: '↩ Reply', action: 'reply' });
        items.push({ label: 'View Profile', action: 'viewProfile' });
        items.push('divider');
        items.push({ label: 'Add Reaction', action: 'addReaction' });
        if (canManageMessages) {
            items.push('divider');
            if (!message.is_pinned) {
                items.push({ label: '📌 Pin Message', action: 'pinMsg' });
            } else {
                items.push({ label: '📌 Unpin Message', action: 'unpinMsg' });
            }
        }
        if (isOwner || canManageMessages) {
            if (!canManageMessages) items.push('divider');
            if (isOwner) items.push({ label: 'Edit Message', action: 'editMsg' });
            items.push({ label: 'Delete Message', action: 'deleteMsg', danger: true });
        }

        // Thread creation — text/announcement channels only, not inside existing threads
        const chType = state.currentChannel?.type;
        if (['text', 'announcement'].includes(chType) && clientHasPermission(CLIENT_PERMS.SEND_MESSAGES) && !el.closest('#threadSidePanel')) {
            items.push('divider');
            items.push({ label: '🧵 Create Thread', action: 'createThread' });
        }

        // "Remove Embed" for message author if an embed is currently loaded
        if (isOwner && !message.embed_suppressed) {
            const embedSlot = el.querySelector('[data-embed-id]');
            if (embedSlot && embedSlot.dataset.embedLoaded && embedSlot.children.length > 0) {
                items.push({ label: 'Remove Embed', action: 'suppressEmbed' });
            }
        }

        items.push('divider');
        items.push({ label: 'Copy Text', action: 'copyText' });

        if (!isOwner) {
            items.push('divider');
            items.push({ label: '🚩 Report Message', action: 'reportMsg' });
        }

        const inThreadPanel = !!el.closest('#threadSidePanel');
        ctxMenu._handlers.reply = () => {
            if (inThreadPanel) {
                setThreadReply(message.id, message.username, message.content);
            } else {
                setReply(message.id, message.username, message.content);
            }
        };
        ctxMenu._handlers.viewProfile = () => openProfileModal(message.user_id);
        ctxMenu._handlers.addReaction = () => showReactionModal(message.id, null, e.clientX, e.clientY);
        ctxMenu._handlers.pinMsg = () => pinMessage(message);
        ctxMenu._handlers.unpinMsg = () => unpinMessage(message);
        ctxMenu._handlers.editMsg = () => startEditMessage(message);
        ctxMenu._handlers.deleteMsg = () => deleteMessage(message);
        ctxMenu._handlers.copyText = () => navigator.clipboard.writeText(message.content);
        ctxMenu._handlers.suppressEmbed = () => suppressEmbed(message.id);
        ctxMenu._handlers.createThread = () => promptCreateThread(message.id);
        ctxMenu._handlers.reportMsg = () => openReportModal('message', message.user_id, message.id, message.content);

        ctxMenu.show(e.clientX, e.clientY, items);
    });
}

// ── Attach right-click to a category header ──────────────────────────────────
function attachCategoryContextMenu(el, category) {
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!clientHasPermission(CLIENT_PERMS.MANAGE_CHANNELS)) return;

        ctxMenu._handlers.renameCategory = () => promptRenameCategory(category);
        ctxMenu._handlers.deleteCategory = () => promptDeleteCategory(category);
        ctxMenu.show(e.clientX, e.clientY, [
            { label: 'Rename Category', action: 'renameCategory' },
            { label: 'Delete Category', action: 'deleteCategory', danger: true }
        ]);
    });
}

function promptCreateThread(messageId) {
    async function doCreate() {
        const name = getModalInputValue().trim();
        if (!name) { showModalError('Thread name is required.'); return; }
        const isPrivate = document.getElementById('threadPrivateCheck')?.checked || false;
        const res = await fetch(`/api/messages/${messageId}/thread`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name, isPrivate }),
        });
        if (res.ok) {
            const data = await res.json();
            closeModal();
            openThreadPanel(data.thread, messageId);
        } else {
            const d = await res.json();
            showModalError(d.error || 'Failed to create thread.');
        }
    }
    showModal({
        title: '🧵 Create Thread',
        inputType: 'text',
        inputPlaceholder: 'Thread name...',
        customHTML: `
            <label style="display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer;color:#b5bac1;font-size:14px;">
                <input type="checkbox" id="threadPrivateCheck"> Make private
            </label>`,
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            { text: 'Create Thread', style: 'primary', action: doCreate },
        ],
        onEnter: doCreate,
    });
}

function promptRenameCategory(category) {
    async function doSave() {
        const val = getModalInputValue().trim();
        if (!val) { showModalError('Name cannot be empty.'); return; }
        const res = await fetch(
            `/api/channels/servers/${state.currentServer.id}/categories/${category.id}`,
            { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              credentials: 'include', body: JSON.stringify({ name: val }) }
        );
        if (res.ok) { closeModal(); }
        else { const d = await res.json(); showModalError(d.error || 'Failed to rename.'); }
    }
    showModal({
        title: 'Rename Category',
        inputType: 'text',
        inputValue: category.name,
        inputPlaceholder: 'Category name',
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            { text: 'Save', style: 'primary', action: doSave }
        ],
        onEnter: doSave
    });
}

function promptDeleteCategory(category) {
    showModal({
        title: 'Delete Category',
        message: `Delete "${category.name}"? Channels inside will move to uncategorized.`,
        buttons: [
            {
                text: 'Cancel',
                style: 'secondary',
                action: closeModal
            },
            {
                text: 'Delete',
                style: 'danger',
                action: async () => {
                    const res = await fetch(
                        `/api/channels/servers/${state.currentServer.id}/categories/${category.id}`,
                        { method: 'DELETE', credentials: 'include' }
                    );
                    if (res.ok) { closeModal(); }
                    else { const d = await res.json(); showModalError(d.error || 'Failed to delete.'); }
                }
            }
        ]
    });
}

// ── Attach right-click to a channel button ───────────────────────────────────
function attachChannelContextMenu(el, channel) {
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!clientHasPermission(CLIENT_PERMS.MANAGE_CHANNELS)) return;

        ctxMenu._handlers.renameChannel = () => promptRenameChannel(channel);
        ctxMenu._handlers.deleteChannel = () => promptDeleteChannel(channel);
        ctxMenu._handlers.editPerms     = () => openChannelPerms(channel);

        ctxMenu.show(e.clientX, e.clientY, [
            { label: 'Edit Permissions', action: 'editPerms' },
            { label: 'Rename Channel',   action: 'renameChannel' },
            { label: 'Delete Channel',   action: 'deleteChannel', danger: true }
        ]);
    });
}

// ── Attach right-click to a server button ────────────────────────────────────
function attachServerContextMenu(el, server) {
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const isOwner = state.currentUser && server.owner_id === state.currentUser.id;

        if (isOwner) {
            ctxMenu._handlers.renameServer = () => promptRenameServer(server);
            ctxMenu._handlers.deleteServer = () => promptDeleteServer(server);
            ctxMenu.show(e.clientX, e.clientY, [
                { label: 'Rename Server', action: 'renameServer' },
                { label: 'Delete Server', action: 'deleteServer', danger: true }
            ]);
        } else {
            ctxMenu._handlers.leaveServer = () => promptLeaveServer(server);
            ctxMenu.show(e.clientX, e.clientY, [
                { label: 'Leave Server', action: 'leaveServer', danger: true }
            ]);
        }
    });
}

// ── Shared user context menu (called from delegation and explicit attachments) ─
function showUserContextMenu(userId, x, y) {
    // Prefer live member data; fall back to what the DOM element recorded
    const member = (state.members || []).find(m => m.id === userId);
    const domEl  = document.querySelector(`[data-user-id="${CSS.escape(userId)}"]`);
    const username = member?.username || domEl?.dataset.username || userId;
    const displayName = member?.nickname || username;

    const isSelf        = state.currentUser && userId === state.currentUser.id;
    const isTargetOwner = state.currentServer && userId === state.currentServer.owner_id;
    const memberObj     = member || { id: userId, username };

    const items = [];

    items.push({ label: 'View Profile', action: 'viewProfile' });
    if (isSelf) items.push({ label: 'Edit Profile', action: 'editProfile' });
    items.push('divider');

    if (!isSelf) {
        items.push({ label: 'Message', action: 'dmUser' });
        if (state.currentServer) items.push({ label: '@Mention', action: 'mentionUser' });
        items.push('divider');
    }

    if (isSelf) {
        items.push({ label: 'Change Nickname', action: 'changeNickname' });
        items.push({ label: 'Change Avatar', action: 'changeAvatar' });
        items.push('divider');
    }

    if (state.currentServer && !isSelf && clientHasPermission(CLIENT_PERMS.MANAGE_NICKNAMES)) {
        items.push({ label: 'Set Nickname', action: 'setNickname' });
    }
    if (state.currentServer && clientHasPermission(CLIENT_PERMS.MANAGE_ROLES)) {
        items.push({ label: 'Manage Roles', action: 'manageRoles' });
    }

    items.push({ label: 'Copy Username', action: 'copyUsername' });
    items.push({ label: 'Copy User ID', action: 'copyUserId' });

    if (!isSelf && !isTargetOwner && state.currentServer) {
        const canKick = clientHasPermission(CLIENT_PERMS.KICK_MEMBERS);
        const canBan  = clientHasPermission(CLIENT_PERMS.BAN_MEMBERS);
        if (canKick || canBan) {
            items.push('divider');
            if (canKick) items.push({ label: 'Kick Member', action: 'kickMember', danger: true });
            if (canBan)  items.push({ label: 'Ban Member',  action: 'banMember',  danger: true });
        }
    }

    if (!isSelf) {
        items.push('divider');
        items.push({ label: '🚩 Report User', action: 'reportUser' });
    }

    ctxMenu._handlers.viewProfile    = () => openProfileModal(userId);
    ctxMenu._handlers.editProfile    = () => openUserSettings('profile');
    ctxMenu._handlers.dmUser         = () => startDMWithUser(userId, username);
    ctxMenu._handlers.mentionUser    = () => ctxMentionUser(displayName);
    ctxMenu._handlers.changeNickname = () => openChangeNicknameModal();
    ctxMenu._handlers.changeAvatar   = () => document.getElementById('avatarFileInput')?.click();
    ctxMenu._handlers.setNickname    = () => ctxSetNicknameForMember(memberObj);
    ctxMenu._handlers.manageRoles    = () => ctxOpenRoleAssignMenu(memberObj);
    ctxMenu._handlers.copyUsername   = () => navigator.clipboard.writeText(username);
    ctxMenu._handlers.copyUserId     = () => navigator.clipboard.writeText(userId);
    ctxMenu._handlers.kickMember     = () => ctxKickMember(memberObj);
    ctxMenu._handlers.banMember      = () => ctxBanMember(memberObj);
    ctxMenu._handlers.reportUser     = () => openReportModal('user', userId, null, null);

    ctxMenu.show(x, y, items);
}

// ── Attach right-click to a member element (thin wrapper for explicit attachment) ─
function attachMemberContextMenu(el, member) {
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showUserContextMenu(member.id, e.clientX, e.clientY);
    });
}

function ctxMentionUser(username) {
    const input = document.getElementById('messageInput');
    if (!input) return;
    const val = input.value;
    const mention = `@${username} `;
    const start = input.selectionStart ?? val.length;
    const end   = input.selectionEnd   ?? val.length;
    input.value = val.slice(0, start) + mention + val.slice(end);
    const newPos = start + mention.length;
    input.setSelectionRange(newPos, newPos);
    input.focus();
}

function ctxSetNicknameForMember(member) {
    async function doSave() {
        const nick = getModalInputValue().trim();
        const res = await fetch(`/api/servers/${state.currentServer.id}/members/${member.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ nickname: nick }),
        });
        if (res.ok) {
            closeModal();
            const m = state.members.find(m => m.id === member.id);
            if (m) { m.nickname = nick || null; renderMemberList(); }
            showToast('Nickname updated.');
        } else {
            const d = await res.json();
            showModalError(d.error || 'Failed to set nickname.');
        }
    }
    showModal({
        title: `Set Nickname — ${member.username}`,
        inputType: 'text',
        inputValue: member.nickname || '',
        inputPlaceholder: 'Nickname (blank to clear)',
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            { text: 'Save', style: 'primary', action: doSave },
        ],
        onEnter: doSave,
    });
}

async function ctxOpenRoleAssignMenu(member) {
    if (!state.currentServer) return;
    let roles = [];
    try {
        const res = await fetch(`/api/servers/${state.currentServer.id}/roles`, { credentials: 'include' });
        const data = await res.json();
        roles = (data.roles || []).filter(r => r.name !== '@everyone');
    } catch { showToast('Failed to load roles.'); return; }

    let memberRoleIds = new Set();
    try {
        const res = await fetch(`/api/servers/${state.currentServer.id}/members/${member.id}/roles`, { credentials: 'include' });
        const data = await res.json();
        (data.roles || []).forEach(r => memberRoleIds.add(r.id));
    } catch {}

    const itemsHtml = roles.map(r => `
        <label class="role-assign-item">
            <input type="checkbox" ${memberRoleIds.has(r.id) ? 'checked' : ''}
                   onchange="ctxToggleMemberRole('${member.id}', '${r.id}', this.checked)">
            <span class="role-color-dot" style="background:${r.color}"></span>
            ${r.name}
        </label>
    `).join('');

    showModal({
        title: `Roles \u2014 ${member.username}`,
        message: roles.length ? null : 'No roles to assign (create roles first).',
        buttons: [{ text: 'Done', style: 'primary', action: closeModal }]
    });

    if (roles.length) {
        const msgEl = document.getElementById('modalMessage');
        const inputEl = document.getElementById('modalInput');
        inputEl.style.display = 'none';
        msgEl.style.display = 'block';
        msgEl.innerHTML = `<div class="role-assign-list">${itemsHtml}</div>`;
    }
}

async function ctxToggleMemberRole(memberId, roleId, assign) {
    if (!state.currentServer) return;
    const url = `/api/servers/${state.currentServer.id}/members/${memberId}/roles${assign ? '' : '/' + roleId}`;
    const method = assign ? 'POST' : 'DELETE';
    const body = assign ? JSON.stringify({ roleId }) : undefined;
    const headers = assign ? { 'Content-Type': 'application/json' } : {};
    const res = await fetch(url, { method, headers, credentials: 'include', body });
    if (!res.ok) showToast('Failed to update role.');
}

function ctxKickMember(member) {
    showModal({
        title: 'Kick Member',
        message: `Kick ${member.nickname || member.username} from the server?`,
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            { text: 'Kick', style: 'danger', action: async () => {
                const res = await fetch(`/api/servers/${state.currentServer.id}/members/${member.id}`, {
                    method: 'DELETE', credentials: 'include'
                });
                if (res.ok) {
                    closeModal();
                    state.members = state.members.filter(m => m.id !== member.id);
                    renderMemberList();
                    showToast(`${member.username} kicked.`);
                } else {
                    const d = await res.json();
                    showModalError(d.error || 'Failed to kick.');
                }
            }}
        ]
    });
}

function ctxBanMember(member) {
    showModal({
        title: 'Ban Member',
        message: `Ban ${member.nickname || member.username}? They won't be able to rejoin.`,
        inputType: 'text',
        inputPlaceholder: 'Reason (optional)',
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            { text: 'Ban', style: 'danger', action: async () => {
                const reason = getModalInputValue().trim();
                const res = await fetch(`/api/servers/${state.currentServer.id}/bans/${member.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ reason }),
                });
                if (res.ok) {
                    closeModal();
                    state.members = state.members.filter(m => m.id !== member.id);
                    renderMemberList();
                    showToast(`${member.username} banned.`);
                } else {
                    const d = await res.json();
                    showModalError(d.error || 'Failed to ban.');
                }
            }}
        ]
    });
}

// ── Pin / Unpin actions ───────────────────────────────────────────────────────
async function pinMessage(message) {
    try {
        const res = await fetch(`/api/messages/${message.id}/pin`, {
            method: 'PUT', credentials: 'include'
        });
        if (!res.ok) {
            const d = await res.json();
            showToast(d.error || 'Failed to pin message');
        }
    } catch { showToast('Failed to pin message'); }
}

async function unpinMessage(message) {
    try {
        const res = await fetch(`/api/messages/${message.id}/pin`, {
            method: 'DELETE', credentials: 'include'
        });
        if (!res.ok) {
            const d = await res.json();
            showToast(d.error || 'Failed to unpin message');
        }
    } catch { showToast('Failed to unpin message'); }
}

async function showPinsPanel(channelId) {
    const panel = document.getElementById('pinsSidePanel');
    const body  = document.getElementById('pinsPanelBody');

    // If already open for same channel, close instead
    if (panel.classList.contains('open') && panel.dataset.channelId === String(channelId)) {
        closePinsPanel();
        return;
    }

    panel.dataset.channelId = channelId;
    body.innerHTML = '<div class="pins-loading">Loading...</div>';

    // Open panel first so user sees loading state immediately
    panel.style.display = 'flex';
    requestAnimationFrame(() => panel.classList.add('open'));

    let pins = [];
    try {
        const res = await fetch(`/api/messages/channels/${channelId}/pins`, { credentials: 'include' });
        if (res.ok) {
            const d = await res.json();
            pins = d.pins || [];
        } else {
            body.innerHTML = '<div class="pins-empty">Failed to load pinned messages.</div>';
            return;
        }
    } catch {
        body.innerHTML = '<div class="pins-empty">Failed to load pinned messages.</div>';
        return;
    }

    const canManage = clientHasPermission(CLIENT_PERMS.MANAGE_MESSAGES);

    if (pins.length === 0) {
        body.innerHTML = '<div class="pins-empty">No pinned messages in this channel.</div>';
        return;
    }

    body.innerHTML = pins.map(pin => {
        const content = pin.content
            ? (pin.content.length > 200 ? pin.content.slice(0, 200) + '\u2026' : pin.content)
            : '(attachment)';
        const date = new Date(pin.pinned_at).toLocaleDateString();
        return `
            <div class="pin-item" data-message-id="${pin.id}">
                <div class="pin-body">
                    <div class="pin-author">${escapeHtml(pin.username)}</div>
                    <div class="pin-content">${escapeHtml(content)}</div>
                    <div class="pin-meta">Pinned ${date}${pin.pinned_by_username ? ` by ${escapeHtml(pin.pinned_by_username)}` : ''}</div>
                </div>
                ${canManage ? `<button class="pin-remove-btn" title="Unpin" onclick="unpinFromPanel('${pin.id}', '${channelId}')">✕</button>` : ''}
            </div>`;
    }).join('');
}

function closePinsPanel() {
    const panel = document.getElementById('pinsSidePanel');
    panel.classList.remove('open');
    panel.addEventListener('transitionend', () => {
        if (!panel.classList.contains('open')) panel.style.display = 'none';
    }, { once: true });
}

async function unpinFromPanel(messageId, channelId) {
    try {
        const res = await fetch(`/api/messages/${messageId}/pin`, {
            method: 'DELETE', credentials: 'include'
        });
        if (res.ok) {
            // Close then reopen so showPinsPanel re-fetches
            const panel = document.getElementById('pinsSidePanel');
            panel.classList.remove('open');
            setTimeout(() => showPinsPanel(channelId), 50);
        } else {
            const d = await res.json();
            showToast(d.error || 'Failed to unpin');
        }
    } catch { showToast('Failed to unpin message'); }
}

// ── Message edit/delete actions ───────────────────────────────────────────────
let currentEditingMessage = null;
let currentReactionMessageId = null;
let currentReactionDmId = null;  // set when reacting to a DM message; null for channel messages

async function showReactionModal(messageId, dmId = null, x = 0, y = 0) {
    showEmojiPickerAt(messageId, x, y, dmId);
}


function showEditMessageModal(message) {
    currentEditingMessage = message;
    showModal({
        title: 'Edit Message',
        inputType: 'textarea',
        inputValue: message.content,
        inputPlaceholder: 'Message content',
        buttons: [
            {
                text: 'Cancel',
                style: 'secondary',
                action: () => {
                    currentEditingMessage = null;
                    closeModal();
                }
            },
            {
                text: 'Save Changes',
                style: 'primary',
                action: submitEditMessage
            }
        ]
    });
}

function submitEditMessage() {
    if (!currentEditingMessage) return;

    const newContent = getModalInputValue().trim();

    if (!newContent) {
        showModalError('Message cannot be empty.');
        return;
    }

    fetch(`/api/messages/${currentEditingMessage.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: newContent })
    }).then(async (r) => {
        if (r.ok) {
            currentEditingMessage = null;
            closeModal();
        } else {
            const data = await r.json();
            showModalError(data.error || 'Failed to edit message');
        }
    }).catch(err => {
        console.error('Edit message error:', err);
        showModalError('Failed to edit message');
    });
}

function startEditMessage(message) {
    activateInlineEdit(message);
}

function deleteMessage(message) {
    showModal({
        title: 'Delete Message',
        message: 'Are you sure you want to delete this message? This cannot be undone.',
        buttons: [
            {
                text: 'Cancel',
                style: 'secondary',
                action: closeModal
            },
            {
                text: 'Delete',
                style: 'danger',
                action: () => {
                    fetch(`/api/messages/${message.id}`, {
                        method: 'DELETE',
                        credentials: 'include'
                    }).then(async (r) => {
                        if (r.ok) {
                            closeModal();
                        } else {
                            const data = await r.json();
                            alert(data.error || 'Failed to delete message');
                        }
                    }).catch(err => {
                        console.error('Delete message error:', err);
                        alert('Failed to delete message');
                    });
                }
            }
        ]
    });
}

// ── Channel actions ───────────────────────────────────────────────────────────
let currentRenamingChannel = null;

function showRenameChannelModal(channel) {
    currentRenamingChannel = channel;
    showModal({
        title: 'Rename Channel',
        inputType: 'text',
        inputValue: channel.name,
        inputPlaceholder: 'Channel name',
        buttons: [
            {
                text: 'Cancel',
                style: 'secondary',
                action: () => {
                    currentRenamingChannel = null;
                    closeModal();
                }
            },
            {
                text: 'Rename',
                style: 'primary',
                action: submitRenameChannel
            }
        ],
        onEnter: submitRenameChannel
    });
}

function submitRenameChannel() {
    if (!currentRenamingChannel) return;

    const newName = getModalInputValue().trim();

    if (!newName) {
        showModalError('Channel name cannot be empty.');
        return;
    }

    fetch(`/api/channels/${currentRenamingChannel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newName })
    }).then(async (r) => {
        if (r.ok) {
            currentRenamingChannel = null;
            closeModal();
            loadServerChannels(state.currentServer.id);
        } else {
            const data = await r.json();
            showModalError(data.error || 'Failed to rename channel');
        }
    }).catch(err => {
        console.error('Rename channel error:', err);
        showModalError('Failed to rename channel');
    });
}

function promptRenameChannel(channel) {
    showRenameChannelModal(channel);
}

function promptDeleteChannel(channel) {
    showModal({
        title: 'Delete Channel',
        message: `Are you sure you want to delete #${channel.name}? This cannot be undone.`,
        buttons: [
            {
                text: 'Cancel',
                style: 'secondary',
                action: closeModal
            },
            {
                text: 'Delete',
                style: 'danger',
                action: () => {
                    fetch(`/api/channels/${channel.id}`, {
                        method: 'DELETE',
                        credentials: 'include'
                    }).then(async (r) => {
                        if (r.ok) {
                            closeModal();
                            loadServerChannels(state.currentServer.id);
                        } else {
                            const data = await r.json();
                            alert(data.error || 'Failed to delete channel');
                        }
                    }).catch(err => {
                        console.error('Delete channel error:', err);
                        alert('Failed to delete channel');
                    });
                }
            }
        ]
    });
}

// ── Server actions ────────────────────────────────────────────────────────────
let currentRenamingServer = null;

function showRenameServerModal(server) {
    currentRenamingServer = server;
    showModal({
        title: 'Rename Server',
        inputType: 'text',
        inputValue: server.name,
        inputPlaceholder: 'Server name',
        buttons: [
            {
                text: 'Cancel',
                style: 'secondary',
                action: () => {
                    currentRenamingServer = null;
                    closeModal();
                }
            },
            {
                text: 'Rename',
                style: 'primary',
                action: submitRenameServer
            }
        ],
        onEnter: submitRenameServer
    });
}

function submitRenameServer() {
    if (!currentRenamingServer) return;

    const newName = getModalInputValue().trim();

    if (!newName) {
        showModalError('Server name cannot be empty.');
        return;
    }

    fetch(`/api/servers/${currentRenamingServer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newName })
    }).then(async (r) => {
        if (r.ok) {
            currentRenamingServer = null;
            closeModal();
            loadUserServers();
        } else {
            const data = await r.json();
            showModalError(data.error || 'Failed to rename server');
        }
    }).catch(err => {
        console.error('Rename server error:', err);
        showModalError('Failed to rename server');
    });
}

function promptRenameServer(server) {
    showRenameServerModal(server);
}

function promptDeleteServer(server) {
    showModal({
        title: 'Delete Server',
        message: `Are you sure you want to delete "${server.name}"? This cannot be undone.`,
        buttons: [
            {
                text: 'Cancel',
                style: 'secondary',
                action: closeModal
            },
            {
                text: 'Delete',
                style: 'danger',
                action: () => {
                    fetch(`/api/servers/${server.id}`, {
                        method: 'DELETE',
                        credentials: 'include'
                    }).then(async (r) => {
                        if (r.ok) {
                            closeModal();
                            state.currentServer = null;
                            state.currentChannel = null;
                            state.channels = [];
                            state.categories = [];
                            state.messages = [];
                            state.members = [];
                            document.getElementById('channelsList').innerHTML = '';
                            document.getElementById('messagesContainer').innerHTML = '';
                            document.getElementById('membersPanel').innerHTML = '';
                            document.getElementById('currentServerName').textContent = 'Select a server';
                            loadUserServers();
                        } else {
                            const data = await r.json();
                            alert(data.error || 'Failed to delete server');
                        }
                    }).catch(err => {
                        console.error('Delete server error:', err);
                        alert('Failed to delete server');
                    });
                }
            }
        ]
    });
}

function promptLeaveServer(server) {
    showModal({
        title: 'Leave Server',
        message: `Are you sure you want to leave "${server.name}"?`,
        buttons: [
            {
                text: 'Cancel',
                style: 'secondary',
                action: closeModal
            },
            {
                text: 'Leave',
                style: 'danger',
                action: () => {
                    fetch(`/api/servers/${server.id}/leave`, {
                        method: 'POST',
                        credentials: 'include'
                    }).then(async (r) => {
                        if (r.ok) {
                            closeModal();
                            loadUserServers();
                        } else {
                            const data = await r.json();
                            alert(data.error || 'Failed to leave server');
                        }
                    }).catch(err => {
                        console.error('Leave server error:', err);
                        alert('Failed to leave server');
                    });
                }
            }
        ]
    });
}

// ── Report modal ─────────────────────────────────────────────────────────────

const REPORT_REASONS = [
    'Spam',
    'Harassment',
    'Hate speech',
    'NSFW content',
    'Misinformation',
    'Threats / violence',
    'Impersonation',
    'Other',
];

function openReportModal(type, reportedUserId, messageId, messageContent) {
    const inServer = !!state.currentServer;

    function buildFormHTML(scope) {
        const showAnon = scope === 'server' && inServer;
        return `
            <div style="display:flex;flex-direction:column;gap:10px;margin-top:4px;">
                ${inServer ? `
                <div style="display:flex;gap:8px;margin-bottom:2px;">
                    <button type="button" class="btn-${scope==='server'?'primary':'secondary'}" style="flex:1;padding:6px;" id="rScope_server">Server</button>
                    <button type="button" class="btn-${scope==='global'?'primary':'secondary'}" style="flex:1;padding:6px;" id="rScope_global">Global</button>
                </div>
                <p style="margin:0;font-size:12px;color:#b5bac1;">${scope==='server'?'Reported to server moderators.':'Reported to NexusGuild staff.'}</p>
                ` : `<p style="margin:0;font-size:12px;color:#b5bac1;">This report will be sent to NexusGuild staff.</p>`}
                <select id="rReason" style="width:100%;padding:8px;background:#1e1f22;border:1px solid #3f4147;border-radius:4px;color:#dbdee1;">
                    <option value="">— Select a reason —</option>
                    ${REPORT_REASONS.map(r => `<option value="${r}">${r}</option>`).join('')}
                </select>
                <textarea id="rDetails" placeholder="Additional details (optional)" style="width:100%;padding:8px;background:#1e1f22;border:1px solid #3f4147;border-radius:4px;color:#dbdee1;resize:vertical;min-height:72px;box-sizing:border-box;font-family:inherit;font-size:14px;"></textarea>
                ${showAnon ? `
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#b5bac1;font-size:13px;">
                    <input type="checkbox" id="rAnon"> Submit anonymously
                </label>` : ''}
            </div>
        `;
    }

    // Default scope: server if in a server, else global
    const defaultScope = inServer ? 'server' : 'global';

    async function doSubmit() {
        const scopeEl = document.getElementById('rScope_server');
        // determine scope from button active state, or default
        let scope = defaultScope;
        if (inServer && scopeEl) {
            const serverBtn = document.getElementById('rScope_server');
            const globalBtn = document.getElementById('rScope_global');
            scope = serverBtn?.classList.contains('btn-primary') ? 'server' : 'global';
        }

        const reason = document.getElementById('rReason')?.value;
        const details = document.getElementById('rDetails')?.value.trim();
        const isAnonymous = document.getElementById('rAnon')?.checked || false;

        if (!reason) { showModalError('Please select a reason.'); return; }

        const body = {
            type,
            scope,
            reportedUserId,
            messageId: messageId || undefined,
            messageContent: messageContent || undefined,
            serverId: state.currentServer?.id || undefined,
            reason,
            details: details || undefined,
            isAnonymous,
        };

        const res = await fetch('/api/reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
        });

        if (res.ok) {
            closeModal();
            showToast('Report submitted.');
        } else {
            const d = await res.json().catch(() => ({}));
            showModalError(d.error || 'Failed to submit report.');
        }
    }

    showModal({
        title: type === 'message' ? 'Report Message' : 'Report User',
        customHTML: buildFormHTML(defaultScope),
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            { text: 'Submit Report', style: 'danger', action: doSubmit },
        ],
    });

    // Wire up scope toggle buttons after modal renders
    if (inServer) {
        setTimeout(() => {
            const serverBtn = document.getElementById('rScope_server');
            const globalBtn = document.getElementById('rScope_global');
            const descEl = serverBtn?.closest('[style]')?.querySelector('p');
            if (!serverBtn || !globalBtn) return;

            function setScope(s) {
                serverBtn.className = s === 'server' ? 'btn-primary' : 'btn-secondary';
                globalBtn.className = s === 'global' ? 'btn-primary' : 'btn-secondary';
                // Update description text
                const p = serverBtn.parentElement.nextElementSibling;
                if (p) p.textContent = s === 'server' ? 'Reported to server moderators.' : 'Reported to NexusGuild staff.';
                // Toggle anon checkbox
                const anonLabel = document.querySelector('#rAnon')?.parentElement;
                if (anonLabel) anonLabel.style.display = s === 'server' ? '' : 'none';
            }

            serverBtn.addEventListener('click', () => setScope('server'));
            globalBtn.addEventListener('click', () => setScope('global'));
        }, 50);
    }
}

// Init on DOM ready
document.addEventListener('DOMContentLoaded', () => ctxMenu.init());