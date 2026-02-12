// Message list rendering
function renderMessages() {
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    if (state.messages.length === 0) {
        container.innerHTML = '<div class="loading">No messages yet. Start the conversation!</div>';
        return;
    }

    container.innerHTML = state.messages.map((message, index) => {
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
                                <div class="file-icon">??</div>
                                <div class="file-info">
                                    <div class="file-name">${att.originalName}</div>
                                    <div class="file-size">${fileSize}</div>
                                </div>
                            </a>
                        </div>`;
                }
            }).join('');
        }

        const messageContent = message.content ? escapeHtml(message.content) : '';
        const editedTag = message.edited_at ? ' <span class="edited-tag">(edited)</span>' : '';

        if (showHeader) {
            return `
        <div class="message" data-message-id="${message.id}">
          <div class="message-header">
            <div class="message-avatar">${getInitials(message.username)}</div>
            <span class="message-author">${message.username}</span>
            <span class="message-timestamp">${formatTimestamp(message.created_at)}</span>
          </div>
          <div class="message-content" data-content-id="${message.id}">${messageContent}${editedTag}</div>
          <div class="message-edit-area" data-edit-id="${message.id}" style="display:none;"></div>
          ${attachmentsHtml}
        </div>`;
        } else {
            return `
        <div class="message compact" data-message-id="${message.id}">
          <div class="message-content" data-content-id="${message.id}" style="margin-left:48px;">${messageContent}${editedTag}</div>
          <div class="message-edit-area" data-edit-id="${message.id}" style="display:none; margin-left:48px;"></div>
          ${attachmentsHtml ? `<div style="margin-left:48px;">${attachmentsHtml}</div>` : ''}
        </div>`;
        }
    }).join('');

    state.messages.forEach(message => {
        const el = container.querySelector(`[data-message-id="${message.id}"]`);
        if (el) attachMessageContextMenu(el, message);
    });
}

// ?? Inline Edit ???????????????????????????????????????????????????????????????

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

    // Build attachment removal UI
    const attachments = message.attachments
        ? (typeof message.attachments === 'string' ? JSON.parse(message.attachments) : message.attachments)
        : [];

    let attachmentsHtml = '';
    if (attachments.length > 0) {
        const items = attachments.map(att => {
            const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(att.filename);
            const preview = isImage
                ? `<img src="${att.url}" class="edit-att-thumb" alt="${att.originalName}" />`
                : `<div class="edit-att-icon">??</div>`;
            return `
                <div class="edit-att-item" data-filename="${att.filename}">
                    ${preview}
                    <span class="edit-att-name">${att.originalName}</span>
                    <button class="edit-att-remove" title="Remove attachment"
                        onclick="toggleAttachmentRemoval('${att.filename}', this)">?</button>
                </div>`;
        }).join('');

        attachmentsHtml = `
            <div class="edit-attachments-label">Attachments</div>
            <div class="edit-attachments-list">${items}</div>`;
    }

    editAreaEl.innerHTML = `
        <textarea class="inline-edit-textarea" id="inlineEditTextarea">${message.content}</textarea>
        ${attachmentsHtml}
        <div class="inline-edit-hint">escape to <span class="inline-edit-link" onclick="cancelInlineEdit()">cancel</span> · enter to <span class="inline-edit-link" onclick="submitInlineEdit('${message.id}')">save</span></div>
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
        btn.textContent = '?';
    } else {
        _pendingRemovals.splice(idx, 1);
        itemEl.classList.remove('edit-att-removed');
        btn.title = 'Remove attachment';
        btn.textContent = '?';
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

    // No-op check: same content and no removals
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