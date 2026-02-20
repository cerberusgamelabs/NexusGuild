// Message list rendering
function renderMessages() {
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    // Attach scroll listener once
    if (!container.dataset.scrollBound) {
        container.dataset.scrollBound = 'true';
        container.addEventListener('scroll', handleMessageScroll);
    }

    if (state.messages.length === 0) {
        container.innerHTML = '<div class="loading">No messages yet. Start the conversation!</div>';
        return;
    }

    // Build userId → role_color, nickname, and avatar lookups from loaded member list
    const roleColorMap = {};
    const nicknameMap = {};
    const avatarMap = {};
    (state.members || []).forEach(m => {
        if (m.role_color) roleColorMap[m.id] = m.role_color;
        if (m.nickname)   nicknameMap[m.id]  = m.nickname;
        if (m.avatar)     avatarMap[m.id]    = m.avatar;
    });

    const prevHeight = container.scrollHeight;
    const prevTop = container.scrollTop;

    container.innerHTML =
        (state.hasMoreMessages ? '<div class="load-more-spinner" id="loadMoreSpinner">Loading earlier messages...</div>' : '<div class="load-more-end" id="loadMoreEnd">Beginning of channel history</div>') +
        state.messages.map((message, index) => {
            const prevMessage = index > 0 ? state.messages[index - 1] : null;
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

            const messageContent = message.content ? highlightMentions(escapeHtml(message.content)) : '';
            const editedTag = message.edited_at ? ' <span class="edited-tag">(edited)</span>' : '';
            const isOwn = message.user_id === state.currentUser.id;

            // Render reactions if they exist
            const reactionsHTML = message.reactions ? renderReactions(message.reactions, message.id) : '';

            const authorColor = roleColorMap[message.user_id] ? ` style="color:${roleColorMap[message.user_id]}"` : '';
            const authorName = nicknameMap[message.user_id] || message.username;

            const authorAvatar = avatarMap[message.user_id]
                ? `<img src="${avatarMap[message.user_id]}" alt="${authorName}" class="message-av-img">`
                : `<div class="message-avatar">${getInitials(authorName)}</div>`;

            if (showHeader) {
                return `
            <div class="message" data-message-id="${message.id}">
              <div class="message-header">
                ${authorAvatar}
                <span class="message-author"${authorColor}>${authorName}</span>
                <span class="message-timestamp">${formatTimestamp(message.created_at)}</span>
              </div>
              <div class="message-content" data-content-id="${message.id}">${messageContent}${editedTag}</div>
              <div class="message-edit-area" data-edit-id="${message.id}" style="display:none;"></div>
              ${attachmentsHtml}
              ${reactionsHTML}
            </div>`;
            } else {
                return `
            <div class="message compact" data-message-id="${message.id}">
              <div class="message-content" data-content-id="${message.id}" style="margin-left:48px;">${messageContent}${editedTag}</div>
              <div class="message-edit-area" data-edit-id="${message.id}" style="display:none; margin-left:48px;"></div>
              ${attachmentsHtml ? `<div style="margin-left:48px;">${attachmentsHtml}</div>` : ''}
              ${reactionsHTML ? `<div style="margin-left:48px;">${reactionsHTML}</div>` : ''}
            </div>`;
            }
        }).join('');

    // Restore scroll position after prepending older messages
    if (prevTop < 200) {
        container.scrollTop = container.scrollHeight - prevHeight + prevTop;
    }

    state.messages.forEach(message => {
        const el = container.querySelector(`[data-message-id="${message.id}"]`);
        if (el) attachMessageContextMenu(el, message);
    });
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
            const idx = state.messages.findIndex(m => m.id === messageId);
            if (idx !== -1) {
                state.messages[idx] = { ...state.messages[idx], ...data.data };
            }
            cancelInlineEdit();
            renderMessages();
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

function highlightMentions(html) {
    if (!state.currentUser) return html;
    const me = escapeRegex(state.currentUser.username);
    const result = html
        .replace(/@everyone/gi, '<span class="mention mention-ping">@everyone</span>')
        .replace(/@here/gi,     '<span class="mention mention-ping">@here</span>')
        .replace(new RegExp(`@${me}`, 'gi'), `<span class="mention mention-me">@${state.currentUser.username}</span>`)
        .replace(/@(\w+)/g,     '<span class="mention">@$1</span>');
    return result;
}