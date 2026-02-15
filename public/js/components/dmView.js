// File Location: /public/js/components/dmView.js

// ─── State ───────────────────────────────────────────────────────────────────
const dmState = {
    conversations: [],
    currentDM: null,
    messages: [],
    hasMore: true,
    isLoading: false,
    typingUsers: new Set(),
    _savedPanelHTML: null
};

// ─── Entry point ─────────────────────────────────────────────────────────────
async function showDMHome() {
    if (isInDMMode()) {
        dmState.currentDM = null;
        renderDMConversationList();
        renderDMHomeScreen();
        return;
    }

    state.currentServer = null;
    state.currentChannel = null;
    document.querySelectorAll('#serverList button').forEach(b => b.classList.remove('active'));

    const channelsPanel = document.getElementById('channelsPanel');
    dmState._savedPanelHTML = channelsPanel.innerHTML;
    channelsPanel.innerHTML = renderDMSidebar();
    channelsPanel.className = 'channels-panel dm-panel';

    const membersPanel = document.getElementById('membersPanel');
    if (membersPanel) membersPanel.style.display = 'none';

    renderDMHomeScreen();
    await loadDMConversations();

    // Register edit/delete socket listeners once
    if (state.socket && !state.socket._dmEditListenersSetup) {
        state.socket._dmEditListenersSetup = true;
        state.socket.on('dm_message_updated', onDMMessageUpdated);
        state.socket.on('dm_message_deleted', onDMMessageDeleted);
    }

    const searchInput = document.getElementById('dmSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(handleDMSearch, 250));
        searchInput.addEventListener('keydown', e => { if (e.key === 'Escape') clearDMSearch(); });
    }
}

// ─── Restore server panel ─────────────────────────────────────────────────────
function teardownDMView() {
    if (!isInDMMode()) return;

    if (dmState.currentDM && state.socket) state.socket.emit('leave_dm', dmState.currentDM.id);

    dmState.currentDM = null;
    dmState.messages = [];
    dmState.typingUsers.clear();

    const channelsPanel = document.getElementById('channelsPanel');
    if (dmState._savedPanelHTML !== null) {
        channelsPanel.innerHTML = dmState._savedPanelHTML;
        channelsPanel.className = 'channels-panel';
        dmState._savedPanelHTML = null;
    }

    const membersPanel = document.getElementById('membersPanel');
    if (membersPanel) membersPanel.style.display = '';

    const channelHeader = document.getElementById('channelHeader');
    if (channelHeader) channelHeader.innerHTML = `<span id="currentChannelName"># general</span>`;

    const msgInput = document.getElementById('messageInput');
    if (msgInput) msgInput.placeholder = 'Message...';

    const inputArea = document.querySelector('.input-area');
    if (inputArea) inputArea.style.display = '';
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function renderDMSidebar() {
    return `
        <div class="dm-sidebar-header">
            <span class="dm-sidebar-title">Direct Messages</span>
            <button class="dm-new-btn" onclick="showNewDMSearch()" title="New Message">+</button>
        </div>
        <div class="dm-search-wrapper" id="dmSearchWrapper" style="display:none;">
            <input type="text" id="dmSearchInput" class="dm-search-input"
                placeholder="Find a user..." autocomplete="off" />
            <div id="dmSearchResults" class="dm-search-results"></div>
        </div>
        <div id="dmConversationList" class="dm-conversation-list">
            <div class="dm-loading">Loading...</div>
        </div>
    `;
}

// ─── Conversations ────────────────────────────────────────────────────────────
async function loadDMConversations() {
    try {
        const res = await fetch('/api/dm', { credentials: 'include' });
        const data = await res.json();
        dmState.conversations = data.conversations || [];
        renderDMConversationList();
    } catch (err) {
        console.error('Failed to load DM conversations:', err);
    }
}

function renderDMConversationList() {
    const list = document.getElementById('dmConversationList');
    if (!list) return;

    if (dmState.conversations.length === 0) {
        list.innerHTML = `<div class="dm-empty">No conversations yet.<br>Hit <strong>+</strong> to start one.</div>`;
        return;
    }

    list.innerHTML = dmState.conversations.map(conv => {
        const isActive = dmState.currentDM?.id === conv.id;
        const preview = conv.last_message
            ? (conv.last_message.length > 35 ? conv.last_message.slice(0, 35) + '…' : conv.last_message)
            : 'No messages yet';
        return `
            <div class="dm-conversation-item ${isActive ? 'active' : ''}"
                 data-dm-id="${conv.id}"
                 onclick="selectDMConversation('${conv.id}')">
                <div class="dm-conv-avatar-wrap">
                    <div class="dm-conv-avatar">${getInitials(conv.partner_username)}</div>
                    <div class="dm-conv-status ${conv.partner_status || 'offline'}"></div>
                </div>
                <div class="dm-conv-info">
                    <span class="dm-conv-name">${escapeHtmlDM(conv.partner_username)}</span>
                    <span class="dm-conv-preview">${escapeHtmlDM(preview)}</span>
                </div>
            </div>`;
    }).join('');
}

// ─── Home screen ──────────────────────────────────────────────────────────────
function renderDMHomeScreen() {
    const container = document.getElementById('messagesContainer');
    const header = document.getElementById('channelHeader');
    const inputArea = document.querySelector('.input-area');

    if (header) header.innerHTML = `<span style="font-weight:700;font-size:16px;">Home</span>`;
    if (inputArea) inputArea.style.display = 'none';
    if (container) {
        container.innerHTML = `
            <div class="dm-welcome">
                <div class="dm-welcome-icon">💬</div>
                <h2>Your Direct Messages</h2>
                <p>Select a conversation on the left, or start a new one with the <strong>+</strong> button.</p>
            </div>`;
    }
}

// ─── Select conversation ──────────────────────────────────────────────────────
async function selectDMConversation(dmId) {
    const conv = dmState.conversations.find(c => c.id === dmId);
    if (!conv) return;

    if (dmState.currentDM && state.socket) state.socket.emit('leave_dm', dmState.currentDM.id);

    dmState.currentDM = conv;
    dmState.messages = [];
    dmState.hasMore = true;
    dmState.typingUsers.clear();

    renderDMConversationList();
    if (state.socket) state.socket.emit('join_dm', dmId);

    const header = document.getElementById('channelHeader');
    if (header) {
        header.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:32px;height:32px;background:#5865f2;border-radius:50%;display:flex;
                            align-items:center;justify-content:center;font-weight:bold;font-size:13px;color:#fff;">
                    ${getInitials(conv.partner_username)}
                </div>
                <span style="font-weight:700;font-size:16px;">${escapeHtmlDM(conv.partner_username)}</span>
            </div>`;
    }

    const inputArea = document.querySelector('.input-area');
    if (inputArea) inputArea.style.display = '';
    const msgInput = document.getElementById('messageInput');
    if (msgInput) { msgInput.placeholder = `Message @${conv.partner_username}`; msgInput.focus(); }

    await loadDMMessages(dmId);
}

// ─── Load messages ────────────────────────────────────────────────────────────
async function loadDMMessages(dmId, before = null) {
    if (dmState.isLoading) return;
    dmState.isLoading = true;

    try {
        const url = `/api/dm/${dmId}/messages?limit=50${before ? `&before=${before}` : ''}`;
        const res = await fetch(url, { credentials: 'include' });
        const data = await res.json();
        const msgs = data.messages || [];

        if (msgs.length < 50) dmState.hasMore = false;
        dmState.messages = before ? [...msgs, ...dmState.messages] : msgs;

        renderDMMessages(!!before);
        if (!before) scrollToBottom();
    } catch (err) {
        console.error('Failed to load DM messages:', err);
    }

    dmState.isLoading = false;
}

// ─── Render messages — identical structure to messageList.js ─────────────────
function renderDMMessages(prepending = false) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    const prevHeight = container.scrollHeight;
    const prevTop = container.scrollTop;

    const topBanner = dmState.hasMore
        ? `<div class="load-more-spinner" id="dmLoadMoreSpinner">Loading earlier messages...</div>`
        : `<div class="load-more-end">Beginning of conversation</div>`;

    if (dmState.messages.length === 0) {
        container.innerHTML = topBanner + `
            <div class="dm-welcome">
                <div class="dm-welcome-icon" style="font-size:48px;">👋</div>
                <p>This is the beginning of your conversation with
                <strong>${escapeHtmlDM(dmState.currentDM?.partner_username || '')}</strong>.</p>
            </div>`;
        return;
    }

    const msgsHtml = dmState.messages.map((msg, i) => {
        const prev = dmState.messages[i - 1];
        // Same grouping threshold as messageList.js (5 minutes)
        const showHeader = !prev ||
            prev.sender_id !== msg.sender_id ||
            (new Date(msg.created_at) - new Date(prev.created_at)) > 300000;

        const content = escapeHtmlDM(msg.content);
        const editedTag = msg.edited_at ? ' <span class="edited-tag">(edited)</span>' : '';
        // Use app.js formatTimestamp if available, otherwise fall back
        const ts = (typeof formatTimestamp === 'function')
            ? formatTimestamp(msg.created_at)
            : new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (showHeader) {
            return `
            <div class="message" data-message-id="${msg.id}">
              <div class="message-header">
                <div class="message-avatar">${getInitials(msg.username)}</div>
                <span class="message-author">${escapeHtmlDM(msg.username)}</span>
                <span class="message-timestamp">${ts}</span>
              </div>
              <div class="message-content" data-content-id="${msg.id}">${content}${editedTag}</div>
              <div class="message-edit-area" data-edit-id="${msg.id}" style="display:none;"></div>
            </div>`;
        } else {
            return `
            <div class="message compact" data-message-id="${msg.id}">
              <div class="message-content" data-content-id="${msg.id}" style="margin-left:48px;">${content}${editedTag}</div>
              <div class="message-edit-area" data-edit-id="${msg.id}" style="display:none; margin-left:48px;"></div>
            </div>`;
        }
    }).join('');

    container.innerHTML = topBanner + msgsHtml;

    if (prepending) container.scrollTop = container.scrollHeight - prevHeight + prevTop;

    // Attach context menus to DM messages
    dmState.messages.forEach(msg => {
        const el = container.querySelector(`[data-message-id="${msg.id}"]`);
        if (el) attachDMMessageContextMenu(el, msg);
    });

    container.onscroll = () => {
        if (container.scrollTop < 100 && dmState.hasMore && !dmState.isLoading) {
            const oldest = dmState.messages[0];
            if (oldest) loadDMMessages(dmState.currentDM.id, oldest.id);
        }
    };
}

// ─── DM Message context menu ──────────────────────────────────────────────────
function attachDMMessageContextMenu(el, msg) {
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const isOwn = state.currentUser && msg.sender_id === state.currentUser.id;
        const items = [];

        if (isOwn) {
            items.push({ label: 'Edit Message',   action: 'editDM' });
            items.push({ label: 'Delete Message', action: 'deleteDM', danger: true });
            items.push('divider');
        }
        items.push({ label: 'Copy Text', action: 'copyDM' });

        ctxMenu._handlers.editDM   = () => activateDMInlineEdit(msg);
        ctxMenu._handlers.deleteDM = () => deleteDMMessage(msg);
        ctxMenu._handlers.copyDM   = () => navigator.clipboard.writeText(msg.content);

        ctxMenu.show(e.clientX, e.clientY, items);
    });
}

// ─── DM Inline edit (text-only — DMs have no attachments) ────────────────────
function activateDMInlineEdit(msg) {
    cancelDMInlineEdit();

    const contentEl  = document.querySelector(`[data-content-id="${msg.id}"]`);
    const editAreaEl = document.querySelector(`[data-edit-id="${msg.id}"]`);
    if (!contentEl || !editAreaEl) return;

    contentEl.style.display  = 'none';
    editAreaEl.style.display = 'block';
    editAreaEl.dataset.activeDmEdit = msg.id;

    editAreaEl.innerHTML = `
        <textarea class="inline-edit-textarea" id="dmInlineEditTextarea">${msg.content}</textarea>
        <div class="inline-edit-hint">escape to <span class="inline-edit-link" onclick="cancelDMInlineEdit()">cancel</span> &middot; enter to <span class="inline-edit-link" onclick="submitDMInlineEdit('${msg.id}')">save</span></div>
        <div class="inline-edit-error" id="dmInlineEditError" style="display:none;"></div>
    `;

    const textarea = document.getElementById('dmInlineEditTextarea');
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cancelDMInlineEdit(); }
        else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitDMInlineEdit(msg.id); }
    });
}

function cancelDMInlineEdit() {
    const activeArea = document.querySelector('[data-active-dm-edit]');
    if (!activeArea) return;
    const msgId     = activeArea.dataset.activeDmEdit;
    const contentEl = document.querySelector(`[data-content-id="${msgId}"]`);
    if (contentEl) contentEl.style.display = '';
    activeArea.style.display = 'none';
    activeArea.innerHTML     = '';
    delete activeArea.dataset.activeDmEdit;
}

async function submitDMInlineEdit(msgId) {
    const textarea = document.getElementById('dmInlineEditTextarea');
    const errorEl  = document.getElementById('dmInlineEditError');
    if (!textarea) return;

    const newContent = textarea.value.trim();
    if (!newContent) {
        errorEl.textContent  = 'Message cannot be empty.';
        errorEl.style.display = 'block';
        return;
    }

    const original = dmState.messages.find(m => m.id === msgId);
    if (original && original.content === newContent) { cancelDMInlineEdit(); return; }

    textarea.disabled = true;
    const dmId = dmState.currentDM.id;

    try {
        const res = await fetch(`/api/dm/${dmId}/messages/${msgId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ content: newContent })
        });

        if (res.ok) {
            const data = await res.json();
            const idx = dmState.messages.findIndex(m => m.id === msgId);
            if (idx !== -1) dmState.messages[idx] = { ...dmState.messages[idx], ...data.message };
            cancelDMInlineEdit();
            renderDMMessages();
        } else {
            const data = await res.json();
            textarea.disabled    = false;
            errorEl.textContent  = data.error || 'Failed to edit message.';
            errorEl.style.display = 'block';
        }
    } catch (err) {
        console.error('DM inline edit error:', err);
        textarea.disabled    = false;
        errorEl.textContent  = 'Something went wrong.';
        errorEl.style.display = 'block';
    }
}

// ─── DM Delete ────────────────────────────────────────────────────────────────
function deleteDMMessage(msg) {
    showModal({
        title: 'Delete Message',
        message: 'Are you sure you want to delete this message? This cannot be undone.',
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            {
                text: 'Delete', style: 'danger',
                action: async () => {
                    const dmId = dmState.currentDM.id;
                    try {
                        const res = await fetch(`/api/dm/${dmId}/messages/${msg.id}`, {
                            method: 'DELETE',
                            credentials: 'include'
                        });
                        if (res.ok) {
                            closeModal();
                            dmState.messages = dmState.messages.filter(m => m.id !== msg.id);
                            renderDMMessages();
                        } else {
                            const data = await res.json();
                            alert(data.error || 'Failed to delete message');
                        }
                    } catch (err) {
                        console.error('DM delete error:', err);
                        alert('Failed to delete message');
                    }
                }
            }
        ]
    });
}

// ─── Socket events for DM edits/deletes (other participant) ──────────────────
function onDMMessageUpdated(message) {
    const idx = dmState.messages.findIndex(m => m.id === message.id);
    if (idx !== -1) {
        dmState.messages[idx] = { ...dmState.messages[idx], ...message };
        renderDMMessages();
    }
}

function onDMMessageDeleted({ message_id, dm_id }) {
    if (dmState.currentDM?.id !== dm_id) return;
    dmState.messages = dmState.messages.filter(m => m.id !== message_id);
    renderDMMessages();
}

// ─── Send message ─────────────────────────────────────────────────────────────
async function sendDMMessage(content) {
    if (!dmState.currentDM || !content.trim()) return;
    try {
        const res = await fetch(`/api/dm/${dmState.currentDM.id}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ content: content.trim() })
        });
        if (!res.ok) console.error('DM send error:', await res.json());
    } catch (err) {
        console.error('Failed to send DM:', err);
    }
}

// ─── New DM search ────────────────────────────────────────────────────────────
function showNewDMSearch() {
    const wrapper = document.getElementById('dmSearchWrapper');
    if (!wrapper) return;
    wrapper.style.display = 'block';
    document.getElementById('dmSearchInput')?.focus();
}

function clearDMSearch() {
    const wrapper = document.getElementById('dmSearchWrapper');
    if (wrapper) wrapper.style.display = 'none';
    const input = document.getElementById('dmSearchInput');
    if (input) input.value = '';
    const results = document.getElementById('dmSearchResults');
    if (results) results.innerHTML = '';
}

async function handleDMSearch(e) {
    const q = e.target.value.trim();
    const resultsEl = document.getElementById('dmSearchResults');
    if (!resultsEl) return;
    if (q.length < 2) { resultsEl.innerHTML = ''; return; }
    try {
        const res = await fetch(`/api/dm/users/search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
        const data = await res.json();
        const users = data.users || [];
        resultsEl.innerHTML = users.length === 0
            ? `<div class="dm-search-empty">No users found</div>`
            : users.map(u => `
                <div class="dm-search-result" onclick="startDMWithUser('${u.id}', '${escapeHtmlDM(u.username)}')">
                    <div class="dm-search-avatar">${getInitials(u.username)}</div>
                    <span>${escapeHtmlDM(u.username)}</span>
                </div>`).join('');
    } catch (err) { console.error('User search error:', err); }
}

// ─── Start DM (search or member context menu) ────────────────────────────────
async function startDMWithUser(userId, username) {
    if (!isInDMMode()) await showDMHome();
    clearDMSearch();
    try {
        const res = await fetch('/api/dm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ userId })
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Failed to open DM'); return; }
        if (!dmState.conversations.find(c => c.id === data.conversation.id)) {
            dmState.conversations.unshift(data.conversation);
        }
        await selectDMConversation(data.conversation.id);
    } catch (err) { console.error('Start DM error:', err); }
}

// ─── Socket event handlers ────────────────────────────────────────────────────
function onDMMessageCreated(message) {
    const conv = dmState.conversations.find(c => c.id === message.dm_id);
    if (conv) {
        conv.last_message = message.content;
        conv.last_message_at = message.created_at;
        dmState.conversations = [conv, ...dmState.conversations.filter(c => c.id !== conv.id)];
        renderDMConversationList();
    }
    if (dmState.currentDM?.id === message.dm_id) {
        dmState.messages.push(message);
        renderDMMessages();
        scrollToBottom();
    }
}

function onDMTyping(data) {
    if (dmState.currentDM?.id !== data.dmId || data.userId === state.currentUser?.id) return;
    dmState.typingUsers.add(data.username);
    updateDMTypingIndicator();
    setTimeout(() => { dmState.typingUsers.delete(data.username); updateDMTypingIndicator(); }, 3000);
}

function onDMStopTyping(data) {
    dmState.typingUsers.delete(data.username);
    updateDMTypingIndicator();
}

function updateDMTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (!indicator) return;
    const users = Array.from(dmState.typingUsers);
    if (users.length === 0) { indicator.style.display = 'none'; return; }
    indicator.style.display = 'block';
    indicator.textContent = `${users[0]} is typing...`;
}

// ─── Intercept send button + Enter key + typing ───────────────────────────────
function initDMMessageInterceptor() {
    // 1. Patch sendMessage (the Send button)
    const _origSendMessage = window.sendMessage;
    window.sendMessage = async function () {
        if (!isInDMMode() || !dmState.currentDM) {
            return _origSendMessage?.apply(this, arguments);
        }
        const input = document.getElementById('messageInput');
        const content = input?.value.trim();
        if (!content) return;
        input.value = '';
        if (state.socket) state.socket.emit('dm_stop_typing', dmState.currentDM.id);
        await sendDMMessage(content);
    };

    // 2. Patch handleMessageInput (the onkeypress Enter handler on the input)
    //    app.js gates on state.currentChannel which is null in DM mode,
    //    so we intercept here before it bails out.
    const _origHandleMessageInput = window.handleMessageInput;
    window.handleMessageInput = function (e) {
        if (e.key === 'Enter' && isInDMMode() && dmState.currentDM) {
            e.preventDefault();
            const input = document.getElementById('messageInput');
            const content = input?.value.trim();
            if (!content) return;
            input.value = '';
            if (state.socket) state.socket.emit('dm_stop_typing', dmState.currentDM.id);
            sendDMMessage(content);
            return; // don't fall through to original
        }
        _origHandleMessageInput?.apply(this, arguments);
    };

    // 3. Wire typing emit on the input
    const input = document.getElementById('messageInput');
    if (input && !input.dataset.dmTypingBound) {
        input.dataset.dmTypingBound = 'true';
        let typingDebounce = null;
        input.addEventListener('input', () => {
            if (!isInDMMode() || !dmState.currentDM) return;
            if (state.socket) state.socket.emit('dm_typing', dmState.currentDM.id);
            clearTimeout(typingDebounce);
            typingDebounce = setTimeout(() => {
                if (state.socket && dmState.currentDM) {
                    state.socket.emit('dm_stop_typing', dmState.currentDM.id);
                }
            }, 2000);
        });
    }

    // 4. Wrap loadUserServers so DM home shows after every login / server leave / delete
    //    auth.js calls loadUserServers() right after making the app screen visible,
    //    so this is the most reliable hook point.
    const _origLoadUserServers = window.loadUserServers;
    window.loadUserServers = async function () {
        // Capture BEFORE original runs — original no longer auto-selects,
        // but guard here too in case that changes.
        const hadServer = !!state.currentServer;
        const result = await _origLoadUserServers?.apply(this, arguments);
        if (!isInDMMode() && !hadServer) {
            await showDMHome();
        }
        return result;
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isInDMMode() {
    return document.getElementById('channelsPanel')?.classList.contains('dm-panel') ?? false;
}

function escapeHtmlDM(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function debounce(fn, delay) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

document.addEventListener('DOMContentLoaded', initDMMessageInterceptor);
