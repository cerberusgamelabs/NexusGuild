// Socket.io client initialization
function initializeSocket() {
    state.socket = io({ transports: ['websocket', 'polling'] });

    state.socket.on('connect', () => {
        console.log('Connected to server');
        if (state.currentServer) state.socket.emit('join_server', state.currentServer.id);
        if (state.currentChannel) state.socket.emit('join_channel', state.currentChannel.id);
    });

    state.socket.on('disconnect', () => console.log('Disconnected from server'));
    state.socket.on('connect_error', (e) => console.error('Connection error:', e));

    // ?? Messages ??????????????????????????????????????????????????????????????
    state.socket.on('message_created', (message) => {
        // DB rows use channel_id (snake_case); guard both just in case
        const msgChannelId = message.channel_id ?? message.channelId;
        if (state.currentChannel && msgChannelId === state.currentChannel.id) {
            state.messages.push(message);
            renderMessages();
            scrollToBottom();
        }
    });

    state.socket.on('message_updated', (message) => {
        const index = state.messages.findIndex(m => m.id === message.id);
        if (index !== -1) {
            state.messages[index] = message;
            renderMessages();
        }
    });

    state.socket.on('message_deleted', (data) => {
        state.messages = state.messages.filter(m => m.id !== data.messageId);
        renderMessages();
    });

    // ?? Presence ??????????????????????????????????????????????????????????????
    state.socket.on('presence_update', (data) => {
        const member = state.members.find(m => m.id === data.userId);
        if (member) { member.status = data.status; renderMemberList(); }
    });

    state.socket.on('user_joined', (data) => {
        if (state.currentServer && data.serverId === state.currentServer.id) {
            loadServerMembers(state.currentServer.id);
        }
    });

    state.socket.on('user_left', (data) => {
        state.members = state.members.filter(m => m.id !== data.userId);
        renderMemberList();
    });

    // ?? Typing indicators ?????????????????????????????????????????????????????
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

    // ?? Voice (stubs for later) ???????????????????????????????????????????????
    state.socket.on('voice_state_update', (d) => console.log('Voice state:', d));
    state.socket.on('user_voice_state', (d) => console.log('User voice:', d));
    state.socket.on('webrtc_offer', (d) => console.log('WebRTC offer:', d));
    state.socket.on('webrtc_answer', (d) => console.log('WebRTC answer:', d));
    state.socket.on('webrtc_ice_candidate', (d) => console.log('ICE candidate:', d));
}

// ?? Typing emit ???????????????????????????????????????????????????????????????
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