// Thread panel — slide-in panel for reading and replying in threads

const threadState = {
    isOpen: false,
    threadId: null,
    parentMessageId: null,
    messages: [],
    replyCount: 0,
};

let threadReplyTo = null;

function setThreadReply(messageId, username, content) {
    threadReplyTo = messageId;
    document.getElementById('threadReplyBarName').textContent = username;
    document.getElementById('threadReplyBarPreview').textContent = content?.slice(0, 80) || '';
    document.getElementById('threadReplyBar').style.display = 'flex';
    document.getElementById('threadMessageInput')?.focus();
}

function clearThreadReply() {
    threadReplyTo = null;
    const bar = document.getElementById('threadReplyBar');
    if (bar) bar.style.display = 'none';
}

function openThreadPanel(thread, parentMessageId) {
    // Close pins panel if open
    const pinsPanel = document.getElementById('pinsSidePanel');
    if (pinsPanel?.classList.contains('open') && typeof closePinsPanel === 'function') closePinsPanel();

    threadState.threadId = thread.id;
    threadState.parentMessageId = String(parentMessageId);
    threadState.isOpen = true;
    threadState.messages = [];
    threadState.replyCount = thread.reply_count || 0;

    const panel = document.getElementById('threadSidePanel');
    const body  = document.getElementById('threadPanelBody');
    document.getElementById('threadPanelName').textContent = thread.name || '';
    body.innerHTML = '<div class="pins-loading">Loading thread...</div>';

    panel.style.display = 'flex';
    requestAnimationFrame(() => panel.classList.add('open'));

    // Show delete button only if user has MANAGE_CHANNELS or is server owner
    const deleteBtn = document.getElementById('threadDeleteBtn');
    if (deleteBtn) {
        const canDelete = typeof clientHasPermission === 'function' &&
            typeof CLIENT_PERMS !== 'undefined' &&
            clientHasPermission(CLIENT_PERMS.MANAGE_CHANNELS);
        deleteBtn.style.display = canDelete ? '' : 'none';
    }

    // Join socket room for real-time messages
    if (state.socket?.connected) state.socket.emit('join_channel', thread.id);

    _loadThreadMessages(thread.id);
}

function closeThreadPanel() {
    const panel = document.getElementById('threadSidePanel');
    if (!panel) return;
    panel.classList.remove('open');

    if (threadState.threadId && state.socket?.connected) {
        state.socket.emit('leave_channel', threadState.threadId);
    }

    threadState.isOpen = false;
    threadState.threadId = null;
    threadState.parentMessageId = null;
    threadState.messages = [];
    clearThreadReply();

    panel.addEventListener('transitionend', () => {
        if (!panel.classList.contains('open')) panel.style.display = 'none';
    }, { once: true });
}

function handleThreadIndicatorClick(el) {
    const threadId      = el.dataset.threadId;
    const parentMsgId   = el.dataset.messageId;
    // If same thread already open, close it
    if (threadState.isOpen && threadState.threadId === threadId) {
        closeThreadPanel();
        return;
    }
    // Fetch thread info then open
    fetch(`/api/messages/${parentMsgId}/thread`, { credentials: 'include' })
        .then(r => r.json())
        .then(data => { if (data.thread) openThreadPanel(data.thread, parentMsgId); })
        .catch(console.error);
}

async function _loadThreadMessages(threadId) {
    const body = document.getElementById('threadPanelBody');
    try {
        const res = await fetch(`/api/messages/channels/${threadId}/messages?limit=50`, {
            credentials: 'include'
        });
        if (!res.ok) { body.innerHTML = '<div class="settings-error">Failed to load thread.</div>'; return; }
        const data = await res.json();
        threadState.messages = data.messages || [];
        _renderThreadMessages(body, threadState.messages);
    } catch {
        body.innerHTML = '<div class="settings-error">Failed to load thread.</div>';
    }
}

function _renderThreadMessages(body, messages) {
    if (!messages.length) {
        body.innerHTML = '<div class="settings-empty" style="padding:16px;">No messages yet. Start the conversation!</div>';
        return;
    }
    const lookups = typeof buildMemberLookups === 'function' ? buildMemberLookups() : {};
    body.innerHTML = messages.map((msg, i) =>
        buildMessageHTML(msg, messages[i - 1] || null, lookups)
    ).join('');
    messages.forEach(msg => {
        const slot = body.querySelector(`[data-embed-id="${msg.id}"]`);
        if (slot && typeof injectEmbed === 'function') injectEmbed(msg, slot);
        const el = body.querySelector(`[data-message-id="${msg.id}"]`);
        if (el && typeof attachMessageContextMenu === 'function') attachMessageContextMenu(el, msg);
    });
    body.scrollTop = body.scrollHeight;
}

function appendThreadMessage(message) {
    const body = document.getElementById('threadPanelBody');
    if (!body) return;

    // Remove empty-state placeholder if present
    const empty = body.querySelector('.settings-empty');
    if (empty) empty.remove();

    const lookups = typeof buildMemberLookups === 'function' ? buildMemberLookups() : {};
    const prev    = threadState.messages[threadState.messages.length - 1] || null;
    const html    = buildMessageHTML(message, prev, lookups);
    const tmp     = document.createElement('div');
    tmp.innerHTML = html;
    const el = tmp.firstElementChild;
    body.appendChild(el);

    const slot = el.querySelector('[data-embed-id]');
    if (slot && typeof injectEmbed === 'function') injectEmbed(message, slot);

    if (typeof attachMessageContextMenu === 'function') attachMessageContextMenu(el, message);

    threadState.messages.push(message);
    threadState.replyCount++;
    body.scrollTop = body.scrollHeight;

    // Update the thread indicator in the main message list
    _updateThreadIndicator(threadState.parentMessageId, threadState.replyCount);
}

function _updateThreadIndicator(parentMessageId, count) {
    const indicator = document.querySelector(`.thread-indicator[data-message-id="${parentMessageId}"]`);
    if (indicator) {
        indicator.querySelector('span').textContent =
            `${count} repl${count === 1 ? 'y' : 'ies'}`;
    }
}

// Called from socket.js message_deleted handler
function onThreadMessageDeleted(messageId) {
    if (!threadState.isOpen) return;
    const body = document.getElementById('threadPanelBody');
    const el = body?.querySelector(`[data-message-id="${messageId}"]`);
    if (!el) return;
    threadState.messages = threadState.messages.filter(m => m.id !== messageId);
    el.remove();
    threadState.replyCount = Math.max(0, threadState.replyCount - 1);
    _updateThreadIndicator(threadState.parentMessageId, threadState.replyCount);
}

// Called from socket.js message_created handler
function onThreadMessageCreated(message) {
    const msgChannelId = message.channel_id ?? message.channelId;
    if (threadState.isOpen && msgChannelId === threadState.threadId) {
        appendThreadMessage(message);
    }
}

async function sendThreadMessage() {
    const input = document.getElementById('threadMessageInput');
    const content = input?.value.trim();
    if (!content || !threadState.threadId) return;

    try {
        const formData = new FormData();
        formData.append('content', content);
        if (threadReplyTo) formData.append('replyToId', threadReplyTo);
        const res = await fetch(`/api/messages/channels/${threadState.threadId}/messages`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        if (res.ok) {
            input.value = '';
            input.style.height = 'auto';
            clearThreadReply();
        } else {
            const data = await res.json();
            alert(data.error || 'Failed to send message');
        }
    } catch {
        alert('Failed to send message');
    }
}

function handleThreadInput(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendThreadMessage();
    }
}

async function deleteThread() {
    const threadId = threadState.threadId;
    if (!threadId) return;
    showModal({
        title: 'Delete Thread',
        message: 'Are you sure you want to delete this thread? All messages inside will be lost.',
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            { text: 'Delete Thread', style: 'danger', action: async () => {
                const res = await fetch(`/api/channels/${threadId}`, {
                    method: 'DELETE',
                    credentials: 'include',
                });
                if (res.ok) {
                    closeModal();
                    closeThreadPanel();
                } else {
                    const data = await res.json().catch(() => ({}));
                    showModalError(data.error || 'Failed to delete thread.');
                }
            }},
        ],
    });
}

// Called from socket.js channel_deleted handler
function onThreadChannelDeleted(channelId) {
    if (threadState.isOpen && threadState.threadId === channelId) {
        closeThreadPanel();
        // Remove thread indicator from parent message
        const indicator = document.querySelector(`.thread-indicator[data-thread-id="${channelId}"]`);
        if (indicator) indicator.remove();
    }
}
