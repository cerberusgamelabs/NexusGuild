// File Location: /public/js/components/dmView.js

// ??? State ???????????????????????????????????????????????????????????????????
const dmState = {
    conversations: [],
    currentDM: null,
    messages: [],
    hasMore: true,
    isLoading: false,
    typingUsers: new Set(),
    typingTimeout: null,
    _savedPanelHTML: null   // stores original channels panel HTML for teardown
};

// ??? Entry point (called by logo button) ?????????????????????????????????????
async function showDMHome() {
    // Already in DM mode — just reset to home screen
    if (isInDMMode()) {
        dmState.currentDM = null;
        renderDMConversationList();
        renderDMHomeScreen();
        return;
    }

    // Deselect any active server
    state.currentServer = null;
    state.currentChannel = null;
    document.querySelectorAll('#serverList button').forEach(b => b.classList.remove('active'));

    // Save the original channels panel so we can restore it when a server is selected
    const channelsPanel = document.getElementById('channelsPanel');
    dmState._savedPanelHTML = channelsPanel.innerHTML;

    // Swap to DM sidebar
    channelsPanel.innerHTML = renderDMSidebar();
    channelsPanel.className = 'channels-panel dm-panel';

    // Hide members panel
    const membersPanel = document.getElementById('membersPanel');
    if (membersPanel) membersPanel.style.display = 'none';

    renderDMHomeScreen();
    await loadDMConversations();

    // Wire search input
    const searchInput = document.getElementById('dmSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(handleDMSearch, 250));
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') clearDMSearch();
        });
    }

    wireDMTypingEmit();
}

// ??? Restore channels panel to server mode ????????????????????????????????????
// Add one line to the TOP of selectServer() in app.js:
//   teardownDMView();
function teardownDMView() {
    if (!isInDMMode()) return;

    if (dmState.currentDM && state.socket) {
        state.socket.emit('leave_dm', dmState.currentDM.id);
    }

    dmState.currentDM = null;
    dmState.messages = [];
    dmState.typingUsers.clear();

    // Restore original channels panel HTML
    const channelsPanel = document.getElementById('channelsPanel');
    if (dmState._savedPanelHTML !== null) {
        channelsPanel.innerHTML = dmState._savedPanelHTML;
        channelsPanel.className = 'channels-panel';
        dmState._savedPanelHTML = null;
    }

    // Restore members panel
    const membersPanel = document.getElementById('membersPanel');
    if (membersPanel) membersPanel.style.display = '';

    // Restore channel header
    const channelHeader = document.getElementById('channelHeader');
    if (channelHeader) channelHeader.innerHTML = `<span id="currentChannelName"># general</span>`;

    // Restore input area
    const msgInput = document.getElementById('messageInput');
    if (msgInput) msgInput.placeholder = 'Message...';
    const inputArea = document.querySelector('.input-area');
    if (inputArea) inputArea.style.display = '';
}

// ??? Sidebar HTML ?????????????????????????????????????????????????????????????
function renderDMSidebar() {
    return `
        <div class="dm-sidebar-header">
            <span class="dm-sidebar-title">Direct Messages</span>
            <button class="dm-new-btn" onclick="showNewDMSearch()" title="New Message">+</button>
        </div>
        <div class="dm-search-wrapper" id="dmSearchWrapper" style="display:none;">
            <input
                type="text"
                id="dmSearchInput"
                class="dm-search-input"
                placeholder="Find a user..."
                autocomplete="off"
            />
            <div id="dmSearchResults" class="dm-search-results"></div>
        </div>
        <div id="dmConversationList" class="dm-conversation-list">
            <div class="dm-loading">Loading...</div>
        </div>
    `;
}

// ??? Load & render conversations ??????????????????????????????????????????????
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
            <div
                class="dm-conversation-item ${isActive ? 'active' : ''}"
                data-dm-id="${conv.id}"
                onclick="selectDMConversation('${conv.id}')"
            >
                <div class="dm-conv-avatar-wrap">
                    <div class="dm-conv-avatar">${getInitials(conv.partner_username)}</div>
                    <div class="dm-conv-status ${conv.partner_status || 'offline'}"></div>
                </div>
                <div class="dm-conv-info">
                    <span class="dm-conv-name">${escapeHtmlDM(conv.partner_username)}</span>
                    <span class="dm-conv-preview">${escapeHtmlDM(preview)}</span>
                </div>
            </div>
        `;
    }).join('');
}

// ??? Home screen ??????????????????????????????????????????????????????????????
function renderDMHomeScreen() {
    const container = document.getElementById('messagesContainer');
    const header = document.getElementById('channelHeader');
    const inputArea = document.querySelector('.input-area');

    if (header) header.innerHTML = `<span style="font-weight:700;font-size:16px;">Home</span>`;
    if (inputArea) inputArea.style.display = 'none';

    if (container) {
        container.innerHTML = `
            <div class="dm-welcome">
                <div class="dm-welcome-icon">??</div>
                <h2>Your Direct Messages</h2>
                <p>Select a conversation on the left, or start a new one with the <strong>+</strong> button.</p>
            </div>
        `;
    }
}

// ??? Select & open a DM conversation ?????????????????????????????????????????
async function selectDMConversation(dmId) {
    const conv = dmState.conversations.find(c => c.id === dmId);
    if (!conv) return;

    if (dmState.currentDM && state.socket) {
        state.socket.emit('leave_dm', dmState.currentDM.id);
    }

    dmState.currentDM = conv;
    dmState.messages = [];
    dmState.hasMore = true;
    dmState.typingUsers.clear();

    renderDMConversationList();

    if (state.socket) state.socket.emit('join_dm', dmId);

    // Update header
    const header = document.getElementById('channelHeader');
    if (header) {
        header.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:32px;height:32px;background:#5865f2;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:13px;color:#fff;">
                    ${getInitials(conv.partner_username)}
                </div>
                <span style="font-weight:700;font-size:16px;">${escapeHtmlDM(conv.partner_username)}</span>
            </div>
        `;
    }

    // Show input & focus
    const inputArea = document.querySelector('.input-area');
    if (inputArea) inputArea.style.display = '';
    const msgInput = document.getElementById('messageInput');
    if (msgInput) {
        msgInput.placeholder = `Message @${conv.partner_username}`;
        msgInput.focus();
    }

    await loadDMMessages(dmId);
}

// ??? Load messages ????????????????????????????????????????????????????????????
async function loadDMMessages(dmId, before = null) {
    if (dmState.isLoading) return;
    dmState.isLoading = true;

    try {
        const url = `/api/dm/${dmId}/messages?limit=50${before ? `&before=${before}` : ''}`;
        const res = await fetch(url, { credentials: 'include' });
        const data = await res.json();
        const msgs = data.messages || [];

        if (msgs.length < 50) dmState.hasMore = false;

        if (before) {
            dmState.messages = [...msgs, ...dmState.messages];
        } else {
            dmState.messages = msgs;
        }

        renderDMMessages(!!before);
        if (!before) scrollToBottom();
    } catch (err) {
        console.error('Failed to load DM messages:', err);
    }

    dmState.isLoading = false;
}

// ??? Render messages ??????????????????????????????????????????????????????????
function renderDMMessages(prepending = false) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    const prevHeight = container.scrollHeight;
    const prevTop = container.scrollTop;

    const spinner = `<div id="dmLoadMoreSpinner" class="load-more-spinner">${
        dmState.hasMore ? 'Scroll up for more' : 'Beginning of conversation'
    }</div>`;

    if (dmState.messages.length === 0) {
        container.innerHTML = `
            ${spinner}
            <div class="dm-welcome">
                <div class="dm-welcome-icon" style="font-size:48px;">??</div>
                <p>This is the beginning of your conversation with <strong>${escapeHtmlDM(dmState.currentDM?.partner_username || '')}</strong>.</p>
            </div>
        `;
        return;
    }

    const msgsHtml = dmState.messages.map((msg, i) => {
        const prev = dmState.messages[i - 1];
        const sameAuthor = prev && prev.sender_id === msg.sender_id &&
            (new Date(msg.created_at) - new Date(prev.created_at)) < 5 * 60 * 1000;

        const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (sameAuthor) {
            return `
                <div class="message compact" data-dm-message-id="${msg.id}">
                    <div class="message-hover-time">${time}</div>
                    <div class="message-content">${escapeHtmlDM(msg.content)}</div>
                </div>`;
        }

        return `
            <div class="message" data-dm-message-id="${msg.id}">
                <div class="message-avatar">${getInitials(msg.username)}</div>
                <div class="message-body">
                    <div class="message-header">
                        <span class="message-author">${escapeHtmlDM(msg.username)}</span>
                        <span class="message-time">${time}</span>
                    </div>
                    <div class="message-content">${escapeHtmlDM(msg.content)}</div>
                </div>
            </div>`;
    }).join('');

    container.innerHTML = spinner + msgsHtml;

    if (prepending) {
        container.scrollTop = container.scrollHeight - prevHeight + prevTop;
    }

    container.onscroll = () => {
        if (container.scrollTop < 100 && dmState.hasMore && !dmState.isLoading) {
            const oldest = dmState.messages[0];
            if (oldest) loadDMMessages(dmState.currentDM.id, oldest.id);
        }
    };
}

// ??? Send message ?????????????????????????????????????????????????????????????
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

// ??? New DM search UI ?????????????????????????????????????????????????????????
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

        if (users.length === 0) {
            resultsEl.innerHTML = `<div class="dm-search-empty">No users found</div>`;
            return;
        }

        resultsEl.innerHTML = users.map(u => `
            <div class="dm-search-result" onclick="startDMWithUser('${u.id}', '${escapeHtmlDM(u.username)}')">
                <div class="dm-search-avatar">${getInitials(u.username)}</div>
                <span>${escapeHtmlDM(u.username)}</span>
            </div>
        `).join('');
    } catch (err) {
        console.error('User search error:', err);
    }
}

// ??? Start a DM (from search or member context menu) ?????????????????????????
async function startDMWithUser(userId, username) {
    // Enter DM mode first if we're currently in server view
    if (!isInDMMode()) {
        await showDMHome();
    }

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

        const exists = dmState.conversations.find(c => c.id === data.conversation.id);
        if (!exists) dmState.conversations.unshift(data.conversation);

        await selectDMConversation(data.conversation.id);
    } catch (err) {
        console.error('Start DM error:', err);
    }
}

// ??? Socket event handlers (called from socket.js) ????????????????????????????
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
    if (dmState.currentDM?.id !== data.dmId) return;
    if (data.userId === state.currentUser?.id) return;
    dmState.typingUsers.add(data.username);
    updateDMTypingIndicator();
    setTimeout(() => {
        dmState.typingUsers.delete(data.username);
        updateDMTypingIndicator();
    }, 3000);
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

// ??? Wire typing emit from the message input ??????????????????????????????????
function wireDMTypingEmit() {
    const input = document.getElementById('messageInput');
    if (!input || input.dataset.dmTypingBound) return;
    input.dataset.dmTypingBound = 'true';

    let dmTypingDebounce = null;

    input.addEventListener('input', () => {
        if (!isInDMMode() || !dmState.currentDM) return;
        if (state.socket) state.socket.emit('dm_typing', dmState.currentDM.id);

        clearTimeout(dmTypingDebounce);
        dmTypingDebounce = setTimeout(() => {
            if (state.socket && dmState.currentDM) {
                state.socket.emit('dm_stop_typing', dmState.currentDM.id);
            }
        }, 2000);
    });
}

// ??? Intercept global sendMessage for DM mode ?????????????????????????????????
function initDMMessageInterceptor() {
    const originalSendMessage = window.sendMessage;
    window.sendMessage = async function () {
        if (!isInDMMode() || !dmState.currentDM) {
            if (originalSendMessage) return originalSendMessage.apply(this, arguments);
            return;
        }

        const input = document.getElementById('messageInput');
        if (!input) return;
        const content = input.value.trim();
        if (!content) return;

        input.value = '';
        if (state.socket) state.socket.emit('dm_stop_typing', dmState.currentDM.id);
        await sendDMMessage(content);
    };
}

// ??? Is currently in DM mode ?????????????????????????????????????????????????
function isInDMMode() {
    return document.getElementById('channelsPanel')?.classList.contains('dm-panel') ?? false;
}

// ??? Helpers ??????????????????????????????????????????????????????????????????
function escapeHtmlDM(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function debounce(fn, delay) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

document.addEventListener('DOMContentLoaded', initDMMessageInterceptor);