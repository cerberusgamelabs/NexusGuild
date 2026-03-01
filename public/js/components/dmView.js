// File Location: /public/js/components/dmView.js

// ─── State ───────────────────────────────────────────────────────────────────
const dmState = {
    conversations: [],       // 1:1 DMs  (type: 'dm')
    groupConversations: [],  // group DMs (type: 'group')
    convTypeMap: {},         // { [id]: 'dm' | 'group' }
    currentDM: null,
    messages: [],
    hasMore: true,
    isLoading: false,
    typingUsers: new Set(),
    _savedPanelHTML: null,
    unread: {},  // keyed by conversation id → unread count
};

function dmAvatarHtml(avatar, name, size = 32) {
    if (avatar) {
        return `<img src="${avatar}" alt="" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;">`;
    }
    return getInitials(name);
}

// ─── Entry point ─────────────────────────────────────────────────────────────
async function showDMHome() {
    mobileShowChannels();
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

    // Register DM socket listeners once
    if (state.socket && !state.socket._dmEditListenersSetup) {
        state.socket._dmEditListenersSetup = true;
        state.socket.on('dm_message_updated', onDMMessageUpdated);
        state.socket.on('dm_message_deleted', onDMMessageDeleted);
        state.socket.on('dm_reaction_added',  ({ messageId, dmId, reactions }) => updateDMMessageReactions(messageId, reactions, dmId));
        state.socket.on('dm_reaction_removed', ({ messageId, dmId, reactions }) => updateDMMessageReactions(messageId, reactions, dmId));
        state.socket.on('group_dm_updated',   onGroupDmUpdated);
        state.socket.on('group_dm_member_removed', onGroupDmMemberRemoved);
        state.socket.on('dm_voice_state_update', (data) => {
            if (data.userId === state.currentUser?.id) return;
            if (dmState.currentDM?.id !== data.dmId) return;
            const container = document.getElementById('messagesContainer');
            if (!container) return;
            const existing = document.getElementById('dmCallBanner');
            if (data.joined) {
                if (!existing) {
                    const banner = document.createElement('div');
                    banner.id = 'dmCallBanner';
                    banner.className = 'dm-call-banner';
                    banner.innerHTML = `📞 ${escapeHtmlDM(data.username)} is in a call — <button onclick="typeof joinDMVoice==='function'&&joinDMVoice('${data.dmId}')">Join</button>`;
                    container.insertBefore(banner, container.firstChild);
                }
            } else {
                existing?.remove();
            }
        });
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

    if (typeof hideDMVoiceBar === 'function') hideDMVoiceBar();

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
    if (channelHeader) channelHeader.innerHTML = `
        <span id="currentChannelName"># general</span>
        <button id="pinsBtn" class="header-icon-btn" title="Pinned Messages"
                onclick="state.currentChannel && showPinsPanel(state.currentChannel.id)"
                style="display:none;">📌</button>`;

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
            <button class="dm-new-btn" onclick="openNewConversationModal()" title="New Conversation">+</button>
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
        const [dmRes, gdmRes] = await Promise.all([
            fetch('/api/dm', { credentials: 'include' }),
            fetch('/api/group-dm', { credentials: 'include' }),
        ]);
        const dmData  = await dmRes.json();
        const gdmData = await gdmRes.json();

        const dms    = (dmData.conversations || []).map(c => ({ ...c, type: 'dm' }));
        const groups = (gdmData.groups || []).map(g => ({ ...g, type: 'group' }));

        // Rebuild type map
        dmState.convTypeMap = {};
        for (const c of dms)    dmState.convTypeMap[c.id] = 'dm';
        for (const g of groups) dmState.convTypeMap[g.id] = 'group';

        // Merge & sort
        const all = [...dms, ...groups].sort(
            (a, b) => new Date(b.last_message_at) - new Date(a.last_message_at)
        );
        dmState.conversations    = dms;
        dmState.groupConversations = groups;

        // Store merged list for rendering
        dmState._allConversations = all;

        renderDMConversationList();
    } catch (err) {
        console.error('Failed to load DM conversations:', err);
    }
}

function _getGroupDisplayName(group) {
    if (group.name) return group.name;
    const names = (group.members || [])
        .filter(m => m.id !== state.currentUser?.id)
        .map(m => m.username);
    if (names.length === 0) return 'Group';
    const joined = names.join(', ');
    return joined.length > 30 ? joined.slice(0, 28) + '…' : joined;
}

function renderDMConversationList() {
    const list = document.getElementById('dmConversationList');
    if (!list) return;

    const all = dmState._allConversations || [];
    if (all.length === 0) {
        list.innerHTML = `<div class="dm-empty">No conversations yet.<br>Hit <strong>+</strong> to start one.</div>`;
        return;
    }

    list.innerHTML = all.map(conv => {
        const isActive = dmState.currentDM?.id === conv.id;
        const preview = conv.last_message
            ? (conv.last_message.length > 35 ? conv.last_message.slice(0, 35) + '…' : conv.last_message)
            : 'No messages yet';
        const unreadCount = dmState.unread[conv.id] || 0;
        const badge = unreadCount > 0
            ? `<span class="dm-unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>`
            : '';

        if (conv.type === 'group') {
            const displayName = _getGroupDisplayName(conv);
            const memberCount = (conv.members || []).length;
            return `
                <div class="dm-conversation-item ${isActive ? 'active' : ''}"
                     data-dm-id="${conv.id}"
                     onclick="selectDMConversation('${conv.id}')">
                    <div class="dm-conv-avatar-wrap">
                        <div class="dm-conv-avatar gdm-avatar">👥</div>
                    </div>
                    <div class="dm-conv-info">
                        <span class="dm-conv-name">${escapeHtmlDM(displayName)}<span class="gdm-member-count">${memberCount}</span></span>
                        <span class="dm-conv-preview">${escapeHtmlDM(preview)}</span>
                    </div>
                    ${badge}
                </div>`;
        }

        return `
            <div class="dm-conversation-item ${isActive ? 'active' : ''}"
                 data-dm-id="${conv.id}"
                 onclick="selectDMConversation('${conv.id}')">
                <div class="dm-conv-avatar-wrap">
                    <div class="dm-conv-avatar">${dmAvatarHtml(conv.partner_avatar, conv.partner_username)}</div>
                    <div class="dm-conv-status ${conv.partner_status || 'offline'}"></div>
                </div>
                <div class="dm-conv-info">
                    <span class="dm-conv-name">${escapeHtmlDM(conv.partner_username)}</span>
                    <span class="dm-conv-preview">${escapeHtmlDM(preview)}</span>
                </div>
                ${badge}
            </div>`;
    }).join('');
}

// ─── Home screen ──────────────────────────────────────────────────────────────
function renderDMHomeScreen() {
    const container = document.getElementById('messagesContainer');
    const header = document.getElementById('channelHeader');
    const inputArea = document.querySelector('.input-area');
    if (typeof hideDMVoiceBar === 'function') hideDMVoiceBar();

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
    const all = dmState._allConversations || [];
    const conv = all.find(c => c.id === dmId);
    if (!conv) return;

    if (dmState.currentDM && state.socket) state.socket.emit('leave_dm', dmState.currentDM.id);

    dmState.currentDM = conv;
    dmState.messages = [];
    dmState.hasMore = true;
    dmState.typingUsers.clear();

    delete dmState.unread[dmId];
    updateDMHomeBadge();

    renderDMConversationList();
    if (state.socket) state.socket.emit('join_dm', dmId);

    const header = document.getElementById('channelHeader');
    if (header) {
        if (conv.type === 'group') {
            const displayName = _getGroupDisplayName(conv);
            const memberCount = (conv.members || []).length;
            header.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:space-between;width:100%;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div style="width:32px;height:32px;background:#5865f2;border-radius:50%;display:flex;
                                    align-items:center;justify-content:center;font-size:16px;">👥</div>
                        <span style="font-weight:700;font-size:16px;">${escapeHtmlDM(displayName)}</span>
                        <span style="font-size:13px;color:#96989d;">${memberCount} members</span>
                    </div>
                    <div style="display:flex;gap:6px;align-items:center;">
                        <button title="Members"
                                onclick="openGroupMembersPanel('${conv.id}')"
                                style="background:none;border:none;color:#949ba4;font-size:18px;cursor:pointer;
                                       padding:4px 8px;border-radius:4px;line-height:1;"
                                onmouseover="this.style.color='#dcddde';this.style.background='#3d3f45'"
                                onmouseout="this.style.color='#949ba4';this.style.background='none'">👥</button>
                        <button id="dmVoiceBtn" title="Voice Call"
                                onclick="typeof joinDMVoice==='function'&&joinDMVoice('${conv.id}')"
                                style="background:none;border:none;color:#949ba4;font-size:20px;cursor:pointer;
                                       padding:4px 8px;border-radius:4px;line-height:1;"
                                onmouseover="this.style.color='#dcddde';this.style.background='#3d3f45'"
                                onmouseout="this.style.color='#949ba4';this.style.background='none'">📞</button>
                    </div>
                </div>`;
        } else {
            header.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:space-between;width:100%;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div style="width:32px;height:32px;background:#5865f2;border-radius:50%;display:flex;
                                    align-items:center;justify-content:center;font-weight:bold;font-size:13px;color:#fff;overflow:hidden;">
                            ${dmAvatarHtml(conv.partner_avatar, conv.partner_username)}
                        </div>
                        <span style="font-weight:700;font-size:16px;">${escapeHtmlDM(conv.partner_username)}</span>
                    </div>
                    <button id="dmVoiceBtn" title="Voice Call"
                            onclick="typeof joinDMVoice==='function'&&joinDMVoice('${conv.id}')"
                            style="background:none;border:none;color:#949ba4;font-size:20px;cursor:pointer;
                                   padding:4px 8px;border-radius:4px;line-height:1;"
                            onmouseover="this.style.color='#dcddde';this.style.background='#3d3f45'"
                            onmouseout="this.style.color='#949ba4';this.style.background='none'">📞</button>
                </div>`;
        }
    }

    const inputArea = document.querySelector('.input-area');
    if (inputArea) inputArea.style.display = '';
    const msgInput = document.getElementById('messageInput');
    if (msgInput) {
        const placeholder = conv.type === 'group'
            ? `Message ${_getGroupDisplayName(conv)}`
            : `Message @${conv.partner_username}`;
        msgInput.placeholder = placeholder;
        msgInput.focus();
    }

    mobileShowMessages();
    await loadDMMessages(dmId);

    if (typeof isInDMVoice === 'function' && typeof getVoiceDmId === 'function') {
        if (isInDMVoice() && getVoiceDmId() === dmId) {
            if (typeof showDMVoiceBar === 'function') showDMVoiceBar();
        } else {
            if (typeof hideDMVoiceBar === 'function') hideDMVoiceBar();
        }
    }
}

// ─── Load messages ────────────────────────────────────────────────────────────
async function loadDMMessages(dmId, before = null) {
    if (dmState.isLoading) return;
    dmState.isLoading = true;

    try {
        const type = dmState.convTypeMap[dmId] || 'dm';
        const base = type === 'group' ? `/api/group-dm/${dmId}/messages` : `/api/dm/${dmId}/messages`;
        const url = `${base}?limit=50${before ? `&before=${before}` : ''}`;
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

    const convName = dmState.currentDM?.type === 'group'
        ? _getGroupDisplayName(dmState.currentDM)
        : dmState.currentDM?.partner_username || '';

    if (dmState.messages.length === 0) {
        container.innerHTML = topBanner + `
            <div class="dm-welcome">
                <div class="dm-welcome-icon" style="font-size:48px;">👋</div>
                <p>This is the beginning of your conversation with
                <strong>${escapeHtmlDM(convName)}</strong>.</p>
            </div>`;
        return;
    }

    const msgsHtml = dmState.messages.map((msg, i) => {
        const prev = dmState.messages[i - 1];
        const showHeader = !prev ||
            prev.sender_id !== msg.sender_id ||
            (new Date(msg.created_at) - new Date(prev.created_at)) > 300000;

        let content = escapeHtmlDM(msg.content);
        if (typeof parseEmojiShortcodes === 'function') content = parseEmojiShortcodes(content);
        if (typeof linkifyUrls === 'function') content = linkifyUrls(content);
        const editedTag = msg.edited_at ? ' <span class="edited-tag">(edited)</span>' : '';
        const ts = (typeof formatTimestamp === 'function')
            ? formatTimestamp(msg.created_at)
            : new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        let attachmentsHtml = '';
        if (msg.attachments) {
            const atts = typeof msg.attachments === 'string' ? JSON.parse(msg.attachments) : msg.attachments;
            attachmentsHtml = atts.map(att => {
                const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(att.filename);
                if (isImage) {
                    return `<div class="message-attachment"><a href="${att.url}" target="_blank"><img src="${att.url}" alt="${escapeHtmlDM(att.originalName)}" class="attachment-image" /></a></div>`;
                }
                const fileSize = (att.size / 1024).toFixed(1) + ' KB';
                return `<div class="message-attachment file-attachment"><a href="${att.url}" target="_blank" download="${escapeHtmlDM(att.originalName)}"><div class="file-icon">&#128196;</div><div class="file-info"><div class="file-name">${escapeHtmlDM(att.originalName)}</div><div class="file-size">${fileSize}</div></div></a></div>`;
            }).join('');
        }

        const reactionsHTML = msg.reactions ? renderDMReactions(msg.reactions, msg.id) : '';

        if (showHeader) {
            return `
            <div class="message" data-message-id="${msg.id}">
              <div class="message-header">
                <div class="message-avatar">${dmAvatarHtml(msg.avatar, msg.username)}</div>
                <span class="message-author">${escapeHtmlDM(msg.username)}</span>
                <span class="message-timestamp">${ts}</span>
              </div>
              <div class="message-content" data-content-id="${msg.id}">${content}${editedTag}</div>
              <div class="message-edit-area" data-edit-id="${msg.id}" style="display:none;"></div>
              ${attachmentsHtml}
              <div class="msg-embeds" data-embed-id="${msg.id}"></div>
              ${reactionsHTML}
            </div>`;
        } else {
            return `
            <div class="message compact" data-message-id="${msg.id}">
              <div class="message-content" data-content-id="${msg.id}" style="margin-left:48px;">${content}${editedTag}</div>
              <div class="message-edit-area" data-edit-id="${msg.id}" style="display:none; margin-left:48px;"></div>
              ${attachmentsHtml ? `<div style="margin-left:48px;">${attachmentsHtml}</div>` : ''}
              <div class="msg-embeds" data-embed-id="${msg.id}" style="margin-left:48px;"></div>
              ${reactionsHTML ? `<div style="margin-left:48px;">${reactionsHTML}</div>` : ''}
            </div>`;
        }
    }).join('');

    container.innerHTML = topBanner + msgsHtml;

    if (prepending) container.scrollTop = container.scrollHeight - prevHeight + prevTop;

    dmState.messages.forEach(msg => {
        const el = container.querySelector(`[data-message-id="${msg.id}"]`);
        if (el) attachDMMessageContextMenu(el, msg);
    });

    if (typeof injectEmbed === 'function') {
        dmState.messages.forEach(msg => {
            if (!msg.content) return;
            const slot = container.querySelector(`[data-embed-id="${msg.id}"]`);
            if (slot && !slot.dataset.embedLoaded) injectEmbed(msg, slot);
        });
    }

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
        const dmId = dmState.currentDM?.id;
        const items = [];

        items.push({ label: 'Add Reaction', action: 'addDMReaction' });
        if (isOwn) {
            items.push('divider');
            items.push({ label: 'Edit Message',   action: 'editDM' });
            items.push({ label: 'Delete Message', action: 'deleteDM', danger: true });
        }
        items.push('divider');
        items.push({ label: 'Copy Text', action: 'copyDM' });

        ctxMenu._handlers.addDMReaction = () => showReactionModal(msg.id, dmId, e.clientX, e.clientY);
        ctxMenu._handlers.editDM   = () => activateDMInlineEdit(msg);
        ctxMenu._handlers.deleteDM = () => deleteDMMessage(msg);
        ctxMenu._handlers.copyDM   = () => navigator.clipboard.writeText(msg.content);

        ctxMenu.show(e.clientX, e.clientY, items);
    });
}

// ─── DM Inline edit ───────────────────────────────────────────────────────────
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
    const type = dmState.convTypeMap[dmId] || 'dm';
    const url = type === 'group'
        ? `/api/group-dm/${dmId}/messages/${msgId}`
        : `/api/dm/${dmId}/messages/${msgId}`;

    try {
        const res = await fetch(url, {
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
                    const type = dmState.convTypeMap[dmId] || 'dm';
                    const url = type === 'group'
                        ? `/api/group-dm/${dmId}/messages/${msg.id}`
                        : `/api/dm/${dmId}/messages/${msg.id}`;
                    try {
                        const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
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

// ─── Socket events for DM edits/deletes ──────────────────────────────────────
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

function onGroupDmUpdated({ id, name, members }) {
    const g = dmState.groupConversations.find(g => g.id === id);
    if (!g) return;
    if (name !== undefined) g.name = name;
    if (members !== undefined) g.members = members;
    // Rebuild merged list
    const all = [...dmState.conversations, ...dmState.groupConversations].sort(
        (a, b) => new Date(b.last_message_at) - new Date(a.last_message_at)
    );
    dmState._allConversations = all;
    // Update current header if viewing
    if (dmState.currentDM?.id === id) {
        dmState.currentDM = g;
        selectDMConversation(id);
    }
    renderDMConversationList();
}

function onGroupDmMemberRemoved({ id, removedUserId }) {
    if (removedUserId === state.currentUser?.id) {
        // I was removed — leave and reload
        dmState.groupConversations = dmState.groupConversations.filter(g => g.id !== id);
        delete dmState.convTypeMap[id];
        const all = [...dmState.conversations, ...dmState.groupConversations].sort(
            (a, b) => new Date(b.last_message_at) - new Date(a.last_message_at)
        );
        dmState._allConversations = all;
        if (dmState.currentDM?.id === id) {
            dmState.currentDM = null;
            renderDMHomeScreen();
        }
        renderDMConversationList();
        return;
    }
    // Update members list in the group
    const g = dmState.groupConversations.find(g => g.id === id);
    if (g && g.members) {
        g.members = g.members.filter(m => m.id !== removedUserId);
        if (dmState.currentDM?.id === id) {
            dmState.currentDM = g;
            // Refresh header member count
            const countEl = document.querySelector('#channelHeader [style*="color:#96989d"]');
            if (countEl) countEl.textContent = `${g.members.length} members`;
        }
        renderDMConversationList();
    }
}

// ─── DM Reactions ─────────────────────────────────────────────────────────────
function renderDMReactions(reactions, messageId, dmId) {
    if (!reactions || reactions.length === 0) return '';
    const effectiveDmId = dmId || dmState.currentDM?.id;
    return `<div class="message-reactions" data-message-id="${messageId}">
        ${reactions.map(r => {
            const userIds = r.users.map(u => u.userId || u.userid);
            const hasReacted = userIds.includes(state.currentUser?.id);
            const activeClass = hasReacted ? 'reacted' : '';
            const usernames = r.users.map(u => u.username).join(', ');
            const safeEmoji = r.emoji.replace(/'/g, "\\'");
            return `<button class="reaction-bubble ${activeClass}"
                onclick="toggleDMReaction('${messageId}', '${safeEmoji}', '${effectiveDmId}')"
                title="${usernames}" data-emoji="${escapeHtmlDM(r.emoji)}">
                <span class="reaction-emoji">${r.emoji}</span>
                <span class="reaction-count">${r.count}</span>
            </button>`;
        }).join('')}
    </div>`;
}

function updateDMMessageReactions(messageId, reactions, dmId) {
    const msg = dmState.messages.find(m => m.id === messageId);
    if (msg) msg.reactions = reactions.length > 0 ? reactions : [];

    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!msgEl) return;

    const reactionsContainer = msgEl.querySelector('.message-reactions');
    if (reactions.length === 0) {
        reactionsContainer?.remove();
        return;
    }

    const html = renderDMReactions(reactions, messageId, dmId);
    if (reactionsContainer) {
        reactionsContainer.outerHTML = html;
    } else {
        const anchor = msgEl.querySelector('.msg-embeds') ||
                       msgEl.querySelector('.message-attachment') ||
                       msgEl.querySelector('.message-content');
        anchor?.insertAdjacentHTML('afterend', html);
    }
}

async function toggleDMReaction(messageId, emoji, dmId) {
    try {
        const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
        const bubble = msgEl?.querySelector(`.reaction-bubble[data-emoji="${emoji}"]`);
        const hasReacted = bubble?.classList.contains('reacted');
        const type = dmState.convTypeMap[dmId] || 'dm';
        const url = type === 'group'
            ? `/api/group-dm/${dmId}/messages/${messageId}/reactions`
            : `/api/dm/${dmId}/messages/${messageId}/reactions`;
        await fetch(url, {
            method: hasReacted ? 'DELETE' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ emoji })
        });
    } catch (err) {
        console.error('DM reaction toggle error:', err);
    }
}

// ─── Send message ─────────────────────────────────────────────────────────────
async function sendDMMessage(content) {
    if (!dmState.currentDM) return;
    const hasFiles = typeof selectedFiles !== 'undefined' && selectedFiles.length > 0;
    if (!content.trim() && !hasFiles) return;

    const dmId = dmState.currentDM.id;
    const type = dmState.convTypeMap[dmId] || 'dm';
    const url = type === 'group'
        ? `/api/group-dm/${dmId}/messages`
        : `/api/dm/${dmId}/messages`;

    try {
        const formData = new FormData();
        if (content.trim()) formData.append('content', content.trim());
        if (hasFiles) selectedFiles.forEach(f => formData.append('files', f));

        const res = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
        if (!res.ok) console.error('DM send error:', await res.json());

        if (hasFiles) {
            selectedFiles = [];
            if (typeof renderFilePreview === 'function') renderFilePreview();
            const fileInput = document.getElementById('fileInput');
            if (fileInput) fileInput.value = '';
        }
    } catch (err) {
        console.error('Failed to send DM:', err);
    }
}

// ─── New conversation modal ───────────────────────────────────────────────────
const _newConvState = {
    selectedUsers: [],  // [{ id, username, avatar }]
};

function openNewConversationModal() {
    _newConvState.selectedUsers = [];
    const modal = document.getElementById('newConvModal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('newConvSearch').value = '';
    document.getElementById('newConvResults').innerHTML = '';
    document.getElementById('newConvGroupName').style.display = 'none';
    document.getElementById('newConvGroupName').value = '';
    document.getElementById('newConvError').style.display = 'none';
    document.getElementById('newConvPills').innerHTML = '';
    document.getElementById('newConvSearch').focus();
}

function closeNewConvModal(e) {
    if (e && e.target !== document.getElementById('newConvModal')) return;
    document.getElementById('newConvModal').style.display = 'none';
}

async function searchNewConvUsers(q) {
    const resultsEl = document.getElementById('newConvResults');
    if (!resultsEl) return;
    if (!q || q.trim().length < 2) { resultsEl.innerHTML = ''; return; }
    try {
        const res = await fetch(`/api/dm/users/search?q=${encodeURIComponent(q.trim())}`, { credentials: 'include' });
        const data = await res.json();
        const users = (data.users || []).filter(u => !_newConvState.selectedUsers.find(s => s.id === u.id));
        resultsEl.innerHTML = users.length === 0
            ? `<div class="conv-user-result" style="color:#888;cursor:default;">No users found</div>`
            : users.map(u => `
                <div class="conv-user-result" onclick="addNewConvUser('${u.id}','${escapeHtmlDM(u.username)}','${u.avatar || ''}')">
                    <div class="dm-search-avatar">${getInitials(u.username)}</div>
                    <span>${escapeHtmlDM(u.username)}</span>
                </div>`).join('');
    } catch (err) {}
}

function addNewConvUser(id, username, avatar) {
    if (_newConvState.selectedUsers.find(u => u.id === id)) return;
    _newConvState.selectedUsers.push({ id, username, avatar });
    _renderNewConvPills();
    document.getElementById('newConvResults').innerHTML = '';
    document.getElementById('newConvSearch').value = '';
    // Show group name field if ≥2 others selected
    const groupNameField = document.getElementById('newConvGroupName');
    groupNameField.style.display = _newConvState.selectedUsers.length >= 2 ? '' : 'none';
}

function removeNewConvUser(id) {
    _newConvState.selectedUsers = _newConvState.selectedUsers.filter(u => u.id !== id);
    _renderNewConvPills();
    const groupNameField = document.getElementById('newConvGroupName');
    groupNameField.style.display = _newConvState.selectedUsers.length >= 2 ? '' : 'none';
}

function _renderNewConvPills() {
    const pillsEl = document.getElementById('newConvPills');
    if (!pillsEl) return;
    pillsEl.innerHTML = _newConvState.selectedUsers.map(u => `
        <span class="conv-pill">
            ${escapeHtmlDM(u.username)}
            <button class="conv-pill-remove" onclick="removeNewConvUser('${u.id}')" title="Remove">✕</button>
        </span>`).join('');
}

async function submitNewConversation() {
    const errorEl = document.getElementById('newConvError');
    errorEl.style.display = 'none';

    if (_newConvState.selectedUsers.length === 0) {
        errorEl.textContent = 'Select at least one user.';
        errorEl.style.display = 'block';
        return;
    }

    const userIds = _newConvState.selectedUsers.map(u => u.id);

    if (userIds.length === 1) {
        // 1:1 DM
        document.getElementById('newConvModal').style.display = 'none';
        await startDMWithUser(userIds[0], _newConvState.selectedUsers[0].username);
        return;
    }

    // Group DM
    const name = document.getElementById('newConvGroupName').value.trim() || null;
    await createGroupDm(userIds, name);
}

async function createGroupDm(userIds, name) {
    const errorEl = document.getElementById('newConvError');
    try {
        const res = await fetch('/api/group-dm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ userIds, name })
        });
        const data = await res.json();
        if (!res.ok) {
            errorEl.textContent = data.error || 'Failed to create group DM';
            errorEl.style.display = 'block';
            return;
        }
        document.getElementById('newConvModal').style.display = 'none';
        await loadDMConversations();
        await selectDMConversation(data.groupDm.id);
    } catch (err) {
        console.error('createGroupDm error:', err);
        errorEl.textContent = 'Something went wrong.';
        errorEl.style.display = 'block';
    }
}

// ─── Group members panel ──────────────────────────────────────────────────────
function openGroupMembersPanel(gdmId) {
    const all = dmState._allConversations || [];
    const group = all.find(g => g.id === gdmId);
    if (!group) return;

    const isOwner = group.owner_id === state.currentUser?.id;
    const members = group.members || [];

    const memberRows = members.map(m => {
        const isMe = m.id === state.currentUser?.id;
        const removeBtn = (isOwner && !isMe)
            ? `<button style="background:#ed4245;border:none;color:#fff;border-radius:4px;padding:2px 8px;
                              font-size:12px;cursor:pointer;margin-left:auto;"
                       onclick="removeGroupMember('${gdmId}','${m.id}')">Remove</button>`
            : '';
        return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #333;">
            <div style="width:32px;height:32px;background:#5865f2;border-radius:50%;display:flex;align-items:center;
                        justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0;overflow:hidden;">
                ${dmAvatarHtml(m.avatar, m.username)}
            </div>
            <span style="font-size:14px;color:#dcddde;">${escapeHtmlDM(m.username)}${isMe ? ' <span style="color:#888;font-size:12px;">(you)</span>' : ''}</span>
            ${removeBtn}
        </div>`;
    }).join('');

    const addMemberSection = isOwner ? `
        <div style="margin-top:12px;">
            <input type="text" id="addMemberSearch" class="modal-input" placeholder="Add member by username..."
                   oninput="searchAddGroupMember(this.value,'${gdmId}')" style="margin-bottom:6px;">
            <div id="addMemberResults" class="conv-user-results"></div>
        </div>` : '';

    const leaveBtn = `
        <div style="margin-top:12px;text-align:center;">
            <button style="background:#ed4245;border:none;color:#fff;border-radius:6px;padding:8px 20px;
                           font-size:14px;cursor:pointer;font-weight:600;"
                    onclick="removeGroupMember('${gdmId}','${state.currentUser.id}')">Leave Group</button>
        </div>`;

    showModal({
        title: `Group Members (${members.length})`,
        customHTML: `<div style="max-height:300px;overflow-y:auto;">${memberRows}</div>${addMemberSection}${leaveBtn}`,
        buttons: [{ text: 'Close', style: 'secondary', action: closeModal }]
    });
}

async function searchAddGroupMember(q, gdmId) {
    const resultsEl = document.getElementById('addMemberResults');
    if (!resultsEl) return;
    if (!q || q.trim().length < 2) { resultsEl.innerHTML = ''; return; }
    try {
        const res = await fetch(`/api/dm/users/search?q=${encodeURIComponent(q.trim())}`, { credentials: 'include' });
        const data = await res.json();
        const group = (dmState._allConversations || []).find(g => g.id === gdmId);
        const existingIds = (group?.members || []).map(m => m.id);
        const users = (data.users || []).filter(u => !existingIds.includes(u.id));
        resultsEl.innerHTML = users.length === 0
            ? `<div class="conv-user-result" style="color:#888;cursor:default;">No users found</div>`
            : users.map(u => `
                <div class="conv-user-result" onclick="addGroupMember('${gdmId}','${u.id}')">
                    <div class="dm-search-avatar">${getInitials(u.username)}</div>
                    <span>${escapeHtmlDM(u.username)}</span>
                </div>`).join('');
    } catch (err) {}
}

async function addGroupMember(gdmId, userId) {
    try {
        const res = await fetch(`/api/group-dm/${gdmId}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ userId })
        });
        if (res.ok) {
            closeModal();
            await loadDMConversations();
            if (dmState.currentDM?.id === gdmId) await selectDMConversation(gdmId);
        } else {
            const data = await res.json();
            alert(data.error || 'Failed to add member');
        }
    } catch (err) {
        console.error('addGroupMember error:', err);
    }
}

async function removeGroupMember(gdmId, userId) {
    try {
        const res = await fetch(`/api/group-dm/${gdmId}/members/${userId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (res.ok) {
            closeModal();
            await loadDMConversations();
            if (userId === state.currentUser?.id) {
                // Left group — go home
                dmState.currentDM = null;
                renderDMHomeScreen();
                renderDMConversationList();
            }
        } else {
            const data = await res.json();
            alert(data.error || 'Failed to remove member');
        }
    } catch (err) {
        console.error('removeGroupMember error:', err);
    }
}

// ─── Old DM search (kept for compatibility, now secondary path) ───────────────
function showNewDMSearch() {
    openNewConversationModal();
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
    } catch (err) {}
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
        // Reload conversations to ensure type map is current
        await loadDMConversations();
        await selectDMConversation(data.conversation.id);
    } catch (err) {}
}

// ─── Socket event handlers ────────────────────────────────────────────────────
function onDMMessageCreated(message) {
    const dmId = message.dm_id;
    const all = dmState._allConversations || [];
    const conv = all.find(c => c.id === dmId);
    if (conv) {
        conv.last_message = message.content ||
            (message.attachments?.length ? '📎 Attachment' : '');
        conv.last_message_at = message.created_at;
        // Re-sort
        dmState._allConversations = [conv, ...all.filter(c => c.id !== dmId)];
    }
    if (dmState.currentDM?.id === dmId) {
        dmState.messages.push(message);
        renderDMMessages();
        scrollToBottom();
    } else if (state.currentUser && message.sender_id !== state.currentUser.id) {
        dmState.unread[dmId] = (dmState.unread[dmId] || 0) + 1;
        updateDMHomeBadge();
    }
    renderDMConversationList();

    // Browser notification when tab is not focused
    if (document.visibilityState !== 'visible' &&
        dmState.currentDM?.id !== dmId &&
        state.currentUser && message.sender_id !== state.currentUser.id) {
        if ('Notification' in window && Notification.permission === 'granted') {
            const notifTitle = message.type === 'group'
                ? `${message.username} in ${conv ? _getGroupDisplayName(conv) : 'group'}`
                : `${message.username} sent you a message`;
            const n = new Notification(notifTitle, {
                body: message.content,
                icon: '/img/logo.png',
                tag: `dm-${dmId}`
            });
            n.onclick = () => {
                window.focus();
                if (!isInDMMode()) {
                    showDMHome().then(() => selectDMConversation(dmId));
                } else {
                    selectDMConversation(dmId);
                }
                n.close();
            };
        }
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
    const _origSendMessage = window.sendMessage;
    window.sendMessage = async function () {
        if (!isInDMMode() || !dmState.currentDM) {
            return _origSendMessage?.apply(this, arguments);
        }
        const input = document.getElementById('messageInput');
        const content = input?.value.trim() || '';
        const hasFiles = typeof selectedFiles !== 'undefined' && selectedFiles.length > 0;
        if (!content && !hasFiles) return;
        input.value = '';
        input.style.height = 'auto';
        if (state.socket) state.socket.emit('dm_stop_typing', dmState.currentDM.id);
        await sendDMMessage(content);
    };

    const _origHandleMessageInput = window.handleMessageInput;
    window.handleMessageInput = function (e) {
        if (e.key === 'Enter' && !e.shiftKey && isInDMMode() && dmState.currentDM) {
            e.preventDefault();
            const input = document.getElementById('messageInput');
            const content = input?.value.trim() || '';
            const hasFiles = typeof selectedFiles !== 'undefined' && selectedFiles.length > 0;
            if (!content && !hasFiles) return;
            input.value = '';
            input.style.height = 'auto';
            if (state.socket) state.socket.emit('dm_stop_typing', dmState.currentDM.id);
            sendDMMessage(content);
            return;
        }
        _origHandleMessageInput?.apply(this, arguments);
    };

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

    const _origLoadUserServers = window.loadUserServers;
    window.loadUserServers = async function () {
        const result = await _origLoadUserServers?.apply(this, arguments);
        if (!isInDMMode() && !state.currentServer) {
            await showDMHome();
        }
        return result;
    };
}

// ─── DM home button badge ──────────────────────────────────────────────────────
function updateDMHomeBadge() {
    const btn = document.querySelector('.logo-btn');
    if (!btn) return;
    const total = Object.values(dmState.unread).reduce((sum, n) => sum + n, 0);
    let badge = btn.querySelector('.dm-home-badge');
    if (total > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'dm-home-badge';
            btn.appendChild(badge);
        }
        badge.textContent = total > 99 ? '99+' : total;
    } else {
        badge?.remove();
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isInDMMode() {
    return document.getElementById('channelsPanel')?.classList.contains('dm-panel') ?? false;
}

function escapeHtmlDM(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/\n/g, '<br>');
}

function debounce(fn, delay) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

document.addEventListener('DOMContentLoaded', initDMMessageInterceptor);
