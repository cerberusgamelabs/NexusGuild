// Socket.io client initialization
function initializeSocket() {
    state.socket = io({ transports: ['websocket', 'polling'] });

    state.socket.on('connect', () => {
        // Join every server the user belongs to so channel_notification events
        // arrive regardless of which server is currently selected.
        state.servers.forEach(s => state.socket.emit('join_server', s.id));
        if (state.currentChannel) state.socket.emit('join_channel', state.currentChannel.id);
    });

    // -- Messages --------------------------------------------------
    state.socket.on('message_created', (message) => {
        // DB rows use channel_id (snake_case); guard both just in case
        const msgChannelId = message.channel_id ?? message.channelId;
        if (state.currentChannel && msgChannelId === state.currentChannel.id) {
            state.messages.push(message);
            appendMessage(message);
        }
    });

    state.socket.on('message_updated', (message) => {
        patchMessageDOM(message);
    });

    state.socket.on('message_deleted', (data) => {
        removeMessageEl(data.messageId);
    });

    // -- Channel notifications (unread tracking) ---------------------------
    state.socket.on('channel_notification', (data) => {
        const { channelId, serverId, username, content } = data;
        if (state.currentChannel?.id === channelId) return;
        if (state.currentUser && username === state.currentUser.username) return;
        const isMention = parseMentions(content);
        trackUnread(channelId, serverId, isMention);
        if (isMention) showBrowserNotification(username, content, channelId);
    });

    // ── DM Events ─────────────────────────────────────────────────────────
    state.socket.on('dm_message_created', (message) => {
        onDMMessageCreated(message);
    });

    state.socket.on('dm_typing', (data) => {
        onDMTyping(data);
    });

    state.socket.on('dm_stop_typing', (data) => {
        onDMStopTyping(data);
    });

    // -- Presence --------------------------------------------------
    state.socket.on('presence_update', (data) => {
        const member = state.members.find(m => m.id === data.userId);
        if (member) { member.status = data.status; renderMemberList(); }
    });

    state.socket.on('role_updated', async (data) => {
        if (typeof refreshSettingsIfOpen === 'function') refreshSettingsIfOpen(data.serverId);
        if (state.currentServer?.id === data.serverId) {
            await loadServerMembers(data.serverId);
            renderMessages();
        }
    });

    state.socket.on('user_joined', (data) => {
        if (state.currentServer && data.serverId === state.currentServer.id) {
            loadServerMembers(state.currentServer.id);
        }
    });

    state.socket.on('server_joined', async ({ serverId }) => {
        await loadUserServers();
        const server = state.servers.find(s => s.id === serverId);
        if (server) selectServer(serverId);
    });

    state.socket.on('user_left', (data) => {
        state.members = state.members.filter(m => m.id !== data.userId);
        renderMemberList();
    });

    // ── Channels ───────────────────────────────────────────────────
    state.socket.on('channel_created', (data) => {
        if (state.currentServer && data.serverId === state.currentServer.id) {
            loadServerChannels(state.currentServer.id);
        }
    });

    state.socket.on('channel_updated', (data) => {
        if (state.currentServer && data.serverId === state.currentServer.id) {
            loadServerChannels(state.currentServer.id);
        }
    });

    state.socket.on('channel_deleted', (data) => {
        if (state.currentServer && data.serverId === state.currentServer.id) {
            // If the deleted channel is the current one, switch to first available
            if (state.currentChannel && state.currentChannel.id === data.channelId) {
                state.currentChannel = null;
                state.messages = [];
                renderMessages();
            }
            loadServerChannels(state.currentServer.id);
        }
    });

    state.socket.on('category_created', (data) => {
        if (state.currentServer && data.serverId === state.currentServer.id) {
            loadServerChannels(state.currentServer.id);
        }
    });

    state.socket.on('category_updated', (data) => {
        if (state.currentServer?.id === data.serverId) loadServerChannels(data.serverId);
    });

    state.socket.on('category_deleted', (data) => {
        if (state.currentServer?.id === data.serverId) loadServerChannels(data.serverId);
    });

    state.socket.on('permissions_updated', async ({ serverId }) => {
        if (state.currentServer && state.currentServer.id === serverId) {
            await loadServerChannels(serverId);
            renderChannelList(state.channels, state.categories);
        }
    });

    // ── Forum Events ───────────────────────────────────────────────
    state.socket.on('forum_post_created', (data) => {
        if (typeof onForumPostCreated === 'function') onForumPostCreated(data);
    });

    state.socket.on('forum_reply_added', (data) => {
        if (typeof onForumReplyAdded === 'function') onForumReplyAdded(data);
    });

    state.socket.on('forum_post_deleted', (data) => {
        if (typeof onForumPostDeleted === 'function') onForumPostDeleted(data);
    });

    state.socket.on('message_pinned', (data) => {
        patchMessagePin(data.messageId, true);
    });

    state.socket.on('message_unpinned', (data) => {
        patchMessagePin(data.messageId, false);
    });

    state.socket.on('custom_status_update', (data) => {
        const member = state.members.find(m => m.id === data.userId);
        if (member) {
            member.custom_status = data.custom_status;
            renderMemberList();
        }
        // Update own status display if it's the current user
        if (state.currentUser && data.userId === state.currentUser.id) {
            state.currentUser.custom_status = data.custom_status;
            renderUserStatus();
        }
    });

    state.socket.on('reaction_added', (data) => {
        const { messageId, reactions } = data;
        updateMessageReactions(messageId, reactions);
    });

    state.socket.on('reaction_removed', (data) => {
        const { messageId, reactions } = data;
        updateMessageReactions(messageId, reactions);
    });

    // ── Typing indicators ──────────────────────────────────────────
    const typingUsers = new Set();
    let typingTimeout;

    state.socket.on('user_typing', (data) => {
        if (data.channelId === state.currentChannel?.id && data.userId !== state.currentUser.id) {
            typingUsers.add(data.username);
            updateTypingIndicator();
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                typingUsers.delete(data.username);
                updateTypingIndicator();
            }, 3000);
        }
    });

    state.socket.on('user_stop_typing', (data) => {
        typingUsers.delete(data.username);
        updateTypingIndicator();
    });

    // ── Voice presence ──────────────────────────────────────────────────────
    state.socket.on('voice_state_update', (data) => {
        if (typeof onVoiceStateUpdate === 'function') onVoiceStateUpdate(data);
    });

    state.socket.on('user_voice_state', (data) => {
        if (typeof onUserVoiceState === 'function') onUserVoiceState(data);
    });

    function updateTypingIndicator() {
        const indicator = document.getElementById('typingIndicator');
        if (!indicator) return;
        const users = Array.from(typingUsers);
        if (users.length === 0) { indicator.style.display = 'none'; return; }
        indicator.style.display = 'block';
        if (users.length === 1) indicator.textContent = `${users[0]} is typing...`;
        else if (users.length === 2) indicator.textContent = `${users[0]} and ${users[1]} are typing...`;
        else indicator.textContent = `${users[0]} and ${users.length - 1} others are typing...`;
    }

}

// ── Typing emit ────────────────────────────────────────────────────
let isTyping = false;
let typingTimer;

function handleTyping() {
    if (!state.currentChannel || !state.socket) return;
    if (!isTyping) {
        isTyping = true;
        state.socket.emit('start_typing', state.currentChannel.id);
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        isTyping = false;
        state.socket.emit('stop_typing', state.currentChannel.id);
    }, 3000);
}

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('messageInput');
    if (input) input.addEventListener('input', handleTyping);
});