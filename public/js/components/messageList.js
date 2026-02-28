// Message list rendering

// ── Shared helpers ────────────────────────────────────────────────────────────

function buildMemberLookups() {
    const roleColorMap = {}, nicknameMap = {}, avatarMap = {};
    (state.members || []).forEach(m => {
        if (m.role_color) roleColorMap[m.id] = m.role_color;
        if (m.nickname)   nicknameMap[m.id]  = m.nickname;
        if (m.avatar)     avatarMap[m.id]    = m.avatar;
    });
    return { roleColorMap, nicknameMap, avatarMap };
}

function buildMessageHTML(message, prevMessage, { roleColorMap = {}, nicknameMap = {}, avatarMap = {} } = {}) {
    const showHeader = !prevMessage ||
        prevMessage.user_id !== message.user_id ||
        (new Date(message.created_at) - new Date(prevMessage.created_at)) > 300000;

    let attachmentsHtml = '';
    if (message.attachments) {
        const attachments = typeof message.attachments === 'string'
            ? JSON.parse(message.attachments)
            : message.attachments;

        attachmentsHtml = attachments.map(att => {
            const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(att.filename);
            if (isImage) {
                return `
                    <div class="message-attachment">
                        <a href="${att.url}" target="_blank">
                            <img src="${att.url}" alt="${att.originalName}" class="attachment-image" />
                        </a>
                    </div>`;
            } else {
                const fileSize = (att.size / 1024).toFixed(1) + ' KB';
                return `
                    <div class="message-attachment file-attachment">
                        <a href="${att.url}" target="_blank" download="${att.originalName}">
                            <div class="file-icon">&#128196;</div>
                            <div class="file-info">
                                <div class="file-name">${att.originalName}</div>
                                <div class="file-size">${fileSize}</div>
                            </div>
                        </a>
                    </div>`;
            }
        }).join('');
    }

    const messageContent = message.content ? linkifyUrls(highlightMentions(escapeHtml(message.content))) : '';
    const editedTag = message.edited_at ? ' <span class="edited-tag">(edited)</span>' : '';
    const pinIcon = message.is_pinned ? ' <span class="pin-indicator" title="Pinned message">📌</span>' : '';
    const isMentioned = parseMentions(message.content);
    const reactionsHTML = message.reactions ? renderReactions(message.reactions, message.id) : '';

    const authorColor = roleColorMap[message.user_id] ? ` style="color:${roleColorMap[message.user_id]}"` : '';
    const authorName = nicknameMap[message.user_id] || message.username;
    const authorAvatar = avatarMap[message.user_id]
        ? `<img src="${avatarMap[message.user_id]}" alt="${authorName}" class="message-av-img">`
        : `<div class="message-avatar">${getInitials(authorName)}</div>`;

    if (showHeader) {
        return `
        <div class="message${isMentioned ? ' mention-highlight' : ''}${message.is_pinned ? ' pinned-message' : ''}" data-message-id="${message.id}">
          <div class="message-header">
            ${authorAvatar}
            <span class="message-author"${authorColor}>${authorName}</span>
            <span class="message-timestamp">${formatTimestamp(message.created_at)}${pinIcon}</span>
          </div>
          <div class="message-content" data-content-id="${message.id}">${messageContent}${editedTag}</div>
          <div class="message-edit-area" data-edit-id="${message.id}" style="display:none;"></div>
          ${attachmentsHtml}
          <div class="msg-embeds" data-embed-id="${message.id}"></div>
          ${reactionsHTML}
        </div>`;
    } else {
        return `
        <div class="message compact${isMentioned ? ' mention-highlight' : ''}${message.is_pinned ? ' pinned-message' : ''}" data-message-id="${message.id}">
          <div class="message-content" data-content-id="${message.id}" style="margin-left:48px;">${messageContent}${editedTag}</div>
          <div class="message-edit-area" data-edit-id="${message.id}" style="display:none; margin-left:48px;"></div>
          ${attachmentsHtml ? `<div style="margin-left:48px;">${attachmentsHtml}</div>` : ''}
          <div class="msg-embeds" data-embed-id="${message.id}" style="margin-left:48px;"></div>
          ${reactionsHTML ? `<div style="margin-left:48px;">${reactionsHTML}</div>` : ''}
        </div>`;
    }
}

// ── Full list render (initial load + load-more) ───────────────────────────────

function renderMessages() {
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    if (!container.dataset.scrollBound) {
        container.dataset.scrollBound = 'true';
        container.addEventListener('scroll', handleMessageScroll);
    }

    if (state.messages.length === 0) {
        container.innerHTML = '<div class="loading">No messages yet. Start the conversation!</div>';
        return;
    }

    const lookups = buildMemberLookups();
    const prevHeight = container.scrollHeight;
    const prevTop = container.scrollTop;

    container.innerHTML =
        (state.hasMoreMessages
            ? '<div class="load-more-spinner" id="loadMoreSpinner">Loading earlier messages...</div>'
            : '<div class="load-more-end" id="loadMoreEnd">Beginning of channel history</div>') +
        state.messages.map((message, index) => {
            const prevMessage = index > 0 ? state.messages[index - 1] : null;
            return buildMessageHTML(message, prevMessage, lookups);
        }).join('');

    // Restore scroll position after prepending older messages
    if (prevTop < 200) {
        container.scrollTop = container.scrollHeight - prevHeight + prevTop;
    }

    state.messages.forEach(message => {
        const el = container.querySelector(`[data-message-id="${message.id}"]`);
        if (el) attachMessageContextMenu(el, message);
    });

    if (clientHasPermission('EMBED_LINKS')) {
        state.messages.forEach(message => {
            if (!message.content) return;
            const embedSlot = container.querySelector(`[data-embed-id="${message.id}"]`);
            if (!embedSlot || embedSlot.dataset.embedLoaded) return;
            injectEmbed(message, embedSlot);
        });
    }
}

// ── Targeted DOM operations (avoid full rebuild) ──────────────────────────────

// Append a single new message without rebuilding the whole list
function appendMessage(message) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    if (!container.dataset.scrollBound) {
        container.dataset.scrollBound = 'true';
        container.addEventListener('scroll', handleMessageScroll);
    }

    // First message ever: full render to clear empty-state placeholder
    if (state.messages.length <= 1) {
        renderMessages();
        scrollToBottom();
        return;
    }

    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;

    const lookups = buildMemberLookups();
    const prevMessage = state.messages[state.messages.length - 2];
    const temp = document.createElement('div');
    temp.innerHTML = buildMessageHTML(message, prevMessage, lookups).trim();
    const el = temp.firstElementChild;
    container.appendChild(el);

    attachMessageContextMenu(el, message);

    if (clientHasPermission('EMBED_LINKS') && message.content) {
        const embedSlot = el.querySelector(`[data-embed-id="${message.id}"]`);
        if (embedSlot) injectEmbed(message, embedSlot);
    }

    if (atBottom) scrollToBottom();
}

// Replace a single message element in place (edit, reaction update, etc.)
function patchMessageDOM(message) {
    const container = document.getElementById('messagesContainer');
    const el = container?.querySelector(`[data-message-id="${message.id}"]`);

    const idx = state.messages.findIndex(m => m.id === message.id);
    if (idx !== -1) state.messages[idx] = message;
    if (!el) return;

    const prevMessage = idx > 0 ? state.messages[idx - 1] : null;
    const lookups = buildMemberLookups();
    const temp = document.createElement('div');
    temp.innerHTML = buildMessageHTML(message, prevMessage, lookups).trim();
    const newEl = temp.firstElementChild;

    // Carry over any already-loaded embed so iframes don't reload
    const oldEmbed = el.querySelector('[data-embed-id]');
    const newEmbed = newEl.querySelector('[data-embed-id]');
    if (oldEmbed?.dataset.embedLoaded && newEmbed) {
        newEmbed.innerHTML = oldEmbed.innerHTML;
        newEmbed.dataset.embedLoaded = 'true';
    }

    el.replaceWith(newEl);
    attachMessageContextMenu(newEl, message);
}

// Toggle pin indicator without touching anything else
function patchMessagePin(messageId, isPinned) {
    const msg = state.messages.find(m => m.id === messageId);
    if (msg) msg.is_pinned = isPinned;

    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!el) return;

    el.classList.toggle('pinned-message', isPinned);
    const tsEl = el.querySelector('.message-timestamp');
    if (tsEl) {
        const existing = tsEl.querySelector('.pin-indicator');
        if (existing) existing.remove();
        if (isPinned) tsEl.insertAdjacentHTML('beforeend', ' <span class="pin-indicator" title="Pinned message">📌</span>');
    }
}

// Remove a single message element; promotes next compact message to header if needed
function removeMessageEl(messageId) {
    const container = document.getElementById('messagesContainer');
    const el = container?.querySelector(`[data-message-id="${messageId}"]`);

    state.messages = state.messages.filter(m => m.id !== messageId);

    if (!el) return;

    const wasHeader = !el.classList.contains('compact');
    const nextEl = el.nextElementSibling;
    el.remove();

    // If a header message was removed and the next sibling was compact, check whether
    // it still qualifies as compact against its new predecessor.
    if (wasHeader && nextEl?.dataset?.messageId) {
        const nextMsg = state.messages.find(m => m.id === nextEl.dataset.messageId);
        if (nextMsg && nextEl.classList.contains('compact')) {
            const newIdx = state.messages.findIndex(m => m.id === nextMsg.id);
            const prevMsg = newIdx > 0 ? state.messages[newIdx - 1] : null;
            const stillCompact = prevMsg &&
                prevMsg.user_id === nextMsg.user_id &&
                (new Date(nextMsg.created_at) - new Date(prevMsg.created_at)) < 300000;
            if (!stillCompact) {
                const lookups = buildMemberLookups();
                const temp = document.createElement('div');
                temp.innerHTML = buildMessageHTML(nextMsg, null, lookups).trim();
                const newNode = temp.firstElementChild;
                nextEl.replaceWith(newNode);
                attachMessageContextMenu(newNode, nextMsg);
            }
        }
    }

    if (state.messages.length === 0 && container) {
        container.innerHTML = '<div class="loading">No messages yet. Start the conversation!</div>';
    }
}

// ── Link embed cache & injection ─────────────────────────────────────────────
const _embedCache = new Map();

async function fetchEmbed(url) {
    if (_embedCache.has(url)) return _embedCache.get(url);
    try {
        const res = await fetch(`/api/embed?url=${encodeURIComponent(url)}`, { credentials: 'include' });
        if (res.status === 204 || !res.ok) { _embedCache.set(url, null); return null; }
        const data = await res.json();
        _embedCache.set(url, data);
        return data;
    } catch {
        _embedCache.set(url, null);
        return null;
    }
}

async function injectEmbed(message, slot) {
    slot.dataset.embedLoaded = 'true';

    const urlMatch = message.content.match(/https?:\/\/[^\s<>"]+/);
    if (!urlMatch) return;

    const url = urlMatch[0];
    const isMedia = /\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|webm)(\?.*)?$/i.test(url);
    if (isMedia && message.attachments) return;

    // ── NexusGuild invite links ────────────────────────────────────────────────
    const inviteMatch = url.match(/\/invite\/([A-Z0-9]{4,12})/i);
    if (inviteMatch) {
        const code = inviteMatch[1].toUpperCase();
        try {
            const res = await fetch(`/api/servers/preview/${code}`, { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            if (!document.contains(slot)) return;
            const iconHtml = data.serverIcon
                ? `<img src="${escapeHtml(data.serverIcon)}" alt="" class="msg-embed-invite-icon-img">`
                : `<div class="msg-embed-invite-icon-fallback">${escapeHtml(data.serverName.slice(0, 2).toUpperCase())}</div>`;
            const memberText = data.memberCount === 1 ? '1 Member' : `${data.memberCount.toLocaleString()} Members`;
            const inviterText = data.inviterUsername ? `Invited by ${escapeHtml(data.inviterUsername)}` : '';
            if (data.isExpired) {
                slot.innerHTML = `
                    <div class="msg-embed-invite">
                        <div class="msg-embed-invite-header">Server Invite</div>
                        <div class="msg-embed-invite-body">
                            ${iconHtml}
                            <div class="msg-embed-invite-info">
                                <div class="msg-embed-invite-name">${escapeHtml(data.serverName)}</div>
                                <div class="msg-embed-invite-expired">Invite expired</div>
                            </div>
                        </div>
                    </div>`;
            } else {
                slot.innerHTML = `
                    <div class="msg-embed-invite">
                        <div class="msg-embed-invite-header">You've been invited to join a server!</div>
                        <div class="msg-embed-invite-body">
                            ${iconHtml}
                            <div class="msg-embed-invite-info">
                                <div class="msg-embed-invite-name">${escapeHtml(data.serverName)}</div>
                                <div class="msg-embed-invite-meta">${memberText}${inviterText ? ' · ' + inviterText : ''}</div>
                            </div>
                            <button class="msg-embed-invite-btn" onclick="joinFromEmbed('${code}', this)">Join</button>
                        </div>
                    </div>`;
            }
        } catch { /* silent */ }
        return;
    }

    // ── YouTube ────────────────────────────────────────────────────────────────
    const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
        if (!document.contains(slot)) return;
        slot.innerHTML = `
            <div class="msg-embed-video-wrapper">
                <iframe src="https://www.youtube.com/embed/${ytMatch[1]}"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowfullscreen loading="lazy"></iframe>
            </div>`;
        return;
    }

    // ── Twitch ─────────────────────────────────────────────────────────────────
    const parent = encodeURIComponent(window.location.hostname);

    const twitchVodMatch = url.match(/twitch\.tv\/videos\/(\d+)/);
    if (twitchVodMatch) {
        if (!document.contains(slot)) return;
        slot.innerHTML = `
            <div class="msg-embed-video-wrapper">
                <iframe src="https://player.twitch.tv/?video=${twitchVodMatch[1]}&parent=${parent}"
                    allowfullscreen loading="lazy"></iframe>
            </div>`;
        return;
    }

    const twitchClipMatch = url.match(/(?:clips\.twitch\.tv\/|twitch\.tv\/\w+\/clip\/)([a-zA-Z0-9_-]+)/);
    if (twitchClipMatch) {
        if (!document.contains(slot)) return;
        slot.innerHTML = `
            <div class="msg-embed-video-wrapper">
                <iframe src="https://clips.twitch.tv/embed?clip=${twitchClipMatch[1]}&parent=${parent}"
                    allowfullscreen loading="lazy"></iframe>
            </div>`;
        return;
    }

    const twitchStreamMatch = url.match(/twitch\.tv\/([a-zA-Z0-9_]+)\/?(?:\?.*)?$/);
    if (twitchStreamMatch) {
        if (!document.contains(slot)) return;
        slot.innerHTML = `
            <div class="msg-embed-video-wrapper">
                <iframe src="https://player.twitch.tv/?channel=${twitchStreamMatch[1]}&parent=${parent}"
                    allowfullscreen loading="lazy"></iframe>
            </div>`;
        return;
    }

    // ── Generic OG embed ──────────────────────────────────────────────────────
    const data = await fetchEmbed(url);
    if (!data || !data.title) return;
    if (!document.contains(slot)) return;

    const imgHtml = data.image
        ? `<img class="msg-embed-image" src="${escapeHtml(data.image)}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : '';
    const siteHtml = data.siteName
        ? `<div class="msg-embed-site">${escapeHtml(data.siteName)}</div>`
        : '';
    const descHtml = data.description
        ? `<div class="msg-embed-description">${escapeHtml(data.description)}</div>`
        : '';

    slot.innerHTML = `
        <div class="msg-embed">
            ${siteHtml}
            <a class="msg-embed-title" href="${escapeHtml(data.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(data.title)}</a>
            ${descHtml}
            ${imgHtml}
        </div>
    `;
}

async function joinFromEmbed(code, btn) {
    btn.disabled = true;
    btn.textContent = 'Joining...';
    try {
        const res = await fetch('/api/servers/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ code }),
        });
        const data = await res.json();
        if (res.ok) {
            btn.textContent = 'Joined!';
            btn.classList.add('joined');
            if (typeof loadUserServers === 'function') loadUserServers();
        } else {
            btn.disabled = false;
            btn.textContent = data.error === 'Already a member' ? 'Already Joined' : 'Join';
        }
    } catch {
        btn.disabled = false;
        btn.textContent = 'Join';
    }
}

async function handleMessageScroll() {
    const container = document.getElementById('messagesContainer');
    if (!container || !state.hasMoreMessages || state.isLoadingMessages) return;
    if (!state.currentChannel) return;
    if (container.scrollTop > 100) return;

    state.isLoadingMessages = true;

    const spinner = document.getElementById('loadMoreSpinner');
    if (spinner) spinner.textContent = 'Loading...';

    const oldest = state.messages[0];
    if (!oldest) { state.isLoadingMessages = false; return; }

    try {
        const res = await fetch(
            `/api/messages/channels/${state.currentChannel.id}/messages?limit=50&before=${oldest.id}`,
            { credentials: 'include' }
        );
        const data = await res.json();
        const older = data.messages || [];

        if (older.length < 50) state.hasMoreMessages = false;

        if (older.length > 0) {
            state.messages = [...older, ...state.messages];
            renderMessages();
        } else {
            state.hasMoreMessages = false;
            renderMessages();
        }
    } catch (err) {
        console.error('Failed to load older messages:', err);
    }

    state.isLoadingMessages = false;
}

// ── Inline Edit ──────────────────────────────────────────────────────────────

let _pendingRemovals = [];

function activateInlineEdit(message) {
    cancelInlineEdit();
    _pendingRemovals = [];

    const contentEl = document.querySelector(`[data-content-id="${message.id}"]`);
    const editAreaEl = document.querySelector(`[data-edit-id="${message.id}"]`);
    if (!contentEl || !editAreaEl) return;

    contentEl.style.display = 'none';
    editAreaEl.style.display = 'block';
    editAreaEl.dataset.activeEdit = message.id;

    const attachments = message.attachments
        ? (typeof message.attachments === 'string' ? JSON.parse(message.attachments) : message.attachments)
        : [];

    let attachmentsHtml = '';
    if (attachments.length > 0) {
        const items = attachments.map(att => {
            const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(att.filename);
            const preview = isImage
                ? `<img src="${att.url}" class="edit-att-thumb" alt="${att.originalName}" />`
                : `<div class="edit-att-icon">&#128196;</div>`;
            return `
                <div class="edit-att-item" data-filename="${att.filename}">
                    ${preview}
                    <span class="edit-att-name">${att.originalName}</span>
                    <button class="edit-att-remove" title="Remove attachment"
                        onclick="toggleAttachmentRemoval('${att.filename}', this)">&#x2715;</button>
                </div>`;
        }).join('');

        attachmentsHtml = `
            <div class="edit-attachments-label">Attachments</div>
            <div class="edit-attachments-list">${items}</div>`;
    }

    editAreaEl.innerHTML = `
        <textarea class="inline-edit-textarea" id="inlineEditTextarea">${message.content}</textarea>
        ${attachmentsHtml}
        <div class="inline-edit-hint">escape to <span class="inline-edit-link" onclick="cancelInlineEdit()">cancel</span> &middot; enter to <span class="inline-edit-link" onclick="submitInlineEdit('${message.id}')">save</span></div>
        <div class="inline-edit-error" id="inlineEditError" style="display:none;"></div>
    `;

    const textarea = document.getElementById('inlineEditTextarea');
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cancelInlineEdit(); }
        else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitInlineEdit(message.id); }
    });
}

function toggleAttachmentRemoval(filename, btn) {
    const idx = _pendingRemovals.indexOf(filename);
    const itemEl = btn.closest('.edit-att-item');

    if (idx === -1) {
        _pendingRemovals.push(filename);
        itemEl.classList.add('edit-att-removed');
        btn.title = 'Undo remove';
        btn.innerHTML = '&#x21A9;';
    } else {
        _pendingRemovals.splice(idx, 1);
        itemEl.classList.remove('edit-att-removed');
        btn.title = 'Remove attachment';
        btn.innerHTML = '&#x2715;';
    }
}

function cancelInlineEdit() {
    const activeArea = document.querySelector('[data-active-edit]');
    if (!activeArea) return;
    const messageId = activeArea.dataset.activeEdit;
    const contentEl = document.querySelector(`[data-content-id="${messageId}"]`);
    if (contentEl) contentEl.style.display = '';
    activeArea.style.display = 'none';
    activeArea.innerHTML = '';
    delete activeArea.dataset.activeEdit;
    _pendingRemovals = [];
}

async function submitInlineEdit(messageId) {
    const textarea = document.getElementById('inlineEditTextarea');
    const errorEl = document.getElementById('inlineEditError');
    if (!textarea) return;

    const newContent = textarea.value.trim();

    const original = state.messages.find(m => m.id === messageId);
    const originalAttachments = original?.attachments
        ? (typeof original.attachments === 'string' ? JSON.parse(original.attachments) : original.attachments)
        : [];

    const remaining = originalAttachments.filter(a => !_pendingRemovals.includes(a.filename));

    if (!newContent && remaining.length === 0) {
        errorEl.textContent = 'Message must have content or at least one attachment.';
        errorEl.style.display = 'block';
        return;
    }

    if (original && original.content === newContent && _pendingRemovals.length === 0) {
        cancelInlineEdit();
        return;
    }

    textarea.disabled = true;

    try {
        const body = { content: newContent };
        if (_pendingRemovals.length > 0) body.removeAttachments = _pendingRemovals;

        const res = await fetch(`/api/messages/${messageId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body)
        });

        if (res.ok) {
            const data = await res.json();
            cancelInlineEdit();
            patchMessageDOM({ ...original, ...data.data });
        } else {
            const data = await res.json();
            textarea.disabled = false;
            errorEl.textContent = data.error || 'Failed to edit message.';
            errorEl.style.display = 'block';
        }
    } catch (err) {
        console.error('Inline edit error:', err);
        textarea.disabled = false;
        errorEl.textContent = 'Something went wrong.';
        errorEl.style.display = 'block';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
}

function linkifyUrls(html) {
    // Wrap bare http(s) URLs in anchor tags. Runs after escapeHtml so the
    // text is already safe; stops at whitespace or HTML delimiters.
    return html.replace(
        /(https?:\/\/[^\s<>"]+)/g,
        (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
    );
}

function highlightMentions(html) {
    if (!state.currentUser) return html;
    const me = escapeRegex(state.currentUser.username);
    let result = html
        .replace(/@everyone/gi, '<span class="mention mention-ping">@everyone</span>')
        .replace(/@here/gi,     '<span class="mention mention-ping">@here</span>')
        .replace(new RegExp(`@${me}`, 'gi'), `<span class="mention mention-me">@${state.currentUser.username}</span>`);
    // Highlight mentionable role pings with the role's color
    for (const role of (state.roles || [])) {
        if (!role.mentionable || role.name === '@everyone') continue;
        const safeName = escapeRegex(role.name);
        result = result.replace(
            new RegExp(`@${safeName}`, 'gi'),
            `<span class="mention mention-role" style="color:${role.color};background:${role.color}22;">@${role.name}</span>`
        );
    }
    result = result.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
    return result;
}
