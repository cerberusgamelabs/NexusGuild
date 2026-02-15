// Global state
const state = {
    currentUser: null,
    currentServer: null,
    currentChannel: null,
    servers: [],
    channels: [],
    categories: [],
    messages: [],
    members: [],
    socket: null,
    isAuthenticated: false,
    hasMoreMessages: true,
    isLoadingMessages: false,
};

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Check if user is already authenticated
        const response = await fetch('/api/auth/me', {
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            state.currentUser = data.user;
            state.isAuthenticated = true;
            showApp();
            await loadUserServers();
            initializeSocket();
        } else {
            showAuth();
        }
    } catch (error) {
        console.error('Initialization error:', error);
        showAuth();
    }

    // Set up drag-and-drop for file uploads
    setupDragAndDrop();
});

function setupDragAndDrop() {
    const messagesContainer = document.getElementById('messagesContainer');
    const inputBar = document.querySelector('.input-bar');

    if (!messagesContainer || !inputBar) return;

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        messagesContainer.addEventListener(eventName, preventDefaults, false);
        inputBar.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // Highlight drop area
    ['dragenter', 'dragover'].forEach(eventName => {
        messagesContainer.addEventListener(eventName, () => {
            messagesContainer.classList.add('drag-over');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        messagesContainer.addEventListener(eventName, () => {
            messagesContainer.classList.remove('drag-over');
        });
    });

    // Handle dropped files
    messagesContainer.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = Array.from(dt.files);

        if (files.length > 0) {
            selectedFiles = [...selectedFiles, ...files].slice(0, 5);
            renderFilePreview();
            document.getElementById('messageInput').focus();
        }
    });
}

function showAuth() {
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display = 'none';
}

function showApp() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'block';

    if (state.currentUser) {
        document.getElementById('currentUsername').textContent = state.currentUser.username;
        document.getElementById('userAvatar').textContent = state.currentUser.username.substring(0, 2).toUpperCase();
    }
}

// Server management
async function loadUserServers() {
    try {
        const response = await fetch('/api/servers', {
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            state.servers = data.servers;
            renderServerList();

            // Auto-select first server if available
            if (state.servers.length > 0 && !state.currentServer) {
                selectServer(state.servers[0].id);
            }
        }
    } catch (error) {
        console.error('Error loading servers:', error);
    }
}

function selectServer(serverId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;

    state.currentServer = server;
    state.socket.emit('join_server', serverId);

    document.getElementById('currentServerName').textContent = server.name;
    loadServerChannels(serverId);
    loadServerMembers(serverId);

    // Show Create Channel only to the server owner
    const isOwner = state.currentUser && server.owner_id === state.currentUser.id;
    const createChannelBtn = document.getElementById('createChannelBtn');
    if (createChannelBtn) createChannelBtn.style.display = isOwner ? 'block' : 'none';

    // Update UI
    document.querySelectorAll('.space-rail button').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-server-id="${serverId}"]`)?.classList.add('active');
}

async function loadServerChannels(serverId) {
    try {
        const response = await fetch(`/api/channels/servers/${serverId}/channels`, {
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            state.channels = data.channels;
            state.categories = data.categories;
            renderChannelList(data.channels, data.categories);

            // Auto-select first text channel
            const firstTextChannel = data.channels.find(c => c.type === 'text');
            if (firstTextChannel) {
                selectChannel(firstTextChannel.id);
            }
        }
    } catch (error) {
        console.error('Error loading channels:', error);
    }
}

function selectChannel(channelId) {
    const channel = state.channels.find(c => c.id === channelId);
    if (!channel) return;

    state.currentChannel = channel;
    state.socket.emit('leave_channel', state.currentChannel?.id);
    state.socket.emit('join_channel', channelId);

    document.getElementById('currentChannelName').textContent =
        channel.type === 'voice' ? `&#128266; ${channel.name}` : `# ${channel.name}`;

    loadChannelMessages(channelId);

    // Update UI
    document.querySelectorAll('.channel-button').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-channel-id="${channelId}"]`)?.classList.add('active');
}

async function loadChannelMessages(channelId) {
    state.hasMoreMessages = true;
    state.isLoadingMessages = false;
    try {
        const response = await fetch(`/api/messages/channels/${channelId}/messages?limit=50`, {
            credentials: 'include'
        });
        if (response.ok) {
            const data = await response.json();
            state.messages = data.messages;
            renderMessages();
            scrollToBottom();
        }
    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

async function loadServerMembers(serverId) {
    try {
        const response = await fetch(`/api/servers/${serverId}/members`, {
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            state.members = data.members;
            renderMemberList();
        }
    } catch (error) {
        console.error('Error loading members:', error);
    }
}

// Message handling
function handleMessageInput(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

// File upload state
let selectedFiles = [];

function handleFileSelect(event) {
    const files = Array.from(event.target.files);
    selectedFiles = [...selectedFiles, ...files].slice(0, 5); // Max 5 files
    renderFilePreview();
}

function renderFilePreview() {
    const preview = document.getElementById('filePreview');
    if (!preview) return;

    if (selectedFiles.length === 0) {
        preview.innerHTML = '';
        preview.style.display = 'none';
        return;
    }

    preview.style.display = 'flex';
    preview.innerHTML = selectedFiles.map((file, index) => {
        const isImage = file.type.startsWith('image/');
        const fileSize = (file.size / 1024).toFixed(1) + ' KB';

        if (isImage) {
            const url = URL.createObjectURL(file);
            return `
                <div class="file-preview-item">
                    <img src="${url}" alt="${file.name}" class="preview-image" />
                    <button class="remove-file-btn" onclick="removeFile(${index})">×</button>
                    <div class="file-preview-name">${file.name}</div>
                </div>
            `;
        } else {
            return `
                <div class="file-preview-item">
                    <div class="file-preview-icon">??</div>
                    <button class="remove-file-btn" onclick="removeFile(${index})">×</button>
                    <div class="file-preview-name">${file.name}</div>
                    <div class="file-preview-size">${fileSize}</div>
                </div>
            `;
        }
    }).join('');
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderFilePreview();
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();

    if (!content && selectedFiles.length === 0) return;
    if (!state.currentChannel) return;

    try {
        const formData = new FormData();
        if (content) formData.append('content', content);

        selectedFiles.forEach(file => {
            formData.append('files', file);
        });

        const response = await fetch(`/api/messages/channels/${state.currentChannel.id}/messages`, {
            method: 'POST',
            credentials: 'include',
            body: formData
        });

        if (response.ok) {
            input.value = '';
            selectedFiles = [];
            renderFilePreview();
            document.getElementById('fileInput').value = '';
        } else {
            const data = await response.json();
            alert(data.error || 'Failed to send message');
        }
    } catch (error) {
        console.error('Error sending message:', error);
        alert('Failed to send message');
    }
}

// Voice controls
let micMuted = false;
let deafened = false;

function toggleMic() {
    if (!deafened) {
        micMuted = !micMuted;
        const btn = document.getElementById('micToggle');
        btn.classList.toggle('active', micMuted);
        btn.querySelector('img').src = `img/mute-${micMuted ? 'on' : 'off'}.png`;

        if (state.socket) {
            state.socket.emit('voice_state_change', { muted: micMuted, deafened });
        }
    }
}

function toggleDeafen() {
    deafened = !deafened;
    const btn = document.getElementById('deafenToggle');
    btn.classList.toggle('active', deafened);
    btn.querySelector('img').src = `img/deafen-${deafened ? 'on' : 'off'}.png`;

    if (deafened) {
        micMuted = true;
        document.getElementById('micToggle').classList.add('active');
        document.getElementById('micToggle').querySelector('img').src = `img/mute-${micMuted ? 'on' : 'off'}.png`;
    } else {
        micMuted = false;
        document.getElementById('micToggle').classList.remove('active');
        document.getElementById('micToggle').querySelector('img').src = `img/mute-${micMuted ? 'on' : 'off'}.png`;
    }

    if (state.socket) {
        state.socket.emit('voice_state_change', { muted: micMuted, deafened });
    }
}

// UI helpers
function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const month = date.getMonth().toString();
    const day = date.getDate().toString();
    const year = date.getFullYear().toString();
    let hours = date.getHours();
    let ampm = 'AM';
    if (hours > 12) {
        hours = hours - 12;
        ampm = 'PM';
    }
    hours = hours.toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${month}/${day}/${year} ${hours}:${minutes} ${ampm}`;
}

function getInitials(name) {
    return name.substring(0, 2).toUpperCase();
}

// ?? Create Server Modal ???????????????????????????????????????????????????

function showCreateServerModal() {
    document.getElementById('createServerName').value = '';
    document.getElementById('createServerError').style.display = 'none';
    document.getElementById('createServerModal').style.display = 'flex';
    setTimeout(() => document.getElementById('createServerName').focus(), 50);
}

function closeCreateServerModal(e) {
    if (e && e.target !== document.getElementById('createServerModal')) return;
    document.getElementById('createServerModal').style.display = 'none';
}

async function submitCreateServer() {
    const name = document.getElementById('createServerName').value.trim();
    const errorEl = document.getElementById('createServerError');
    errorEl.style.display = 'none';

    if (!name) {
        errorEl.textContent = 'Please enter a server name.';
        errorEl.style.display = 'block';
        return;
    }

    try {
        const response = await fetch('/api/servers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name })
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('createServerModal').style.display = 'none';
            await loadUserServers();
            const created = state.servers.find(s => s.id === data.server.id);
            if (created) selectServer(created.id);
        } else {
            errorEl.textContent = data.error || 'Failed to create server.';
            errorEl.style.display = 'block';
        }
    } catch (error) {
        console.error('Error creating server:', error);
        errorEl.textContent = 'Something went wrong. Try again.';
        errorEl.style.display = 'block';
    }
}

// ?? Create Channel Modal ??????????????????????????????????????????????????

function showCreateChannelModal() {
    closeServerMenu();
    if (!state.currentServer) return;
    document.getElementById('createChannelName').value = '';
    document.getElementById('createChannelError').style.display = 'none';
    document.querySelector('input[name="channelType"][value="text"]').checked = true;

    // Populate category dropdown from current server's categories
    const select = document.getElementById('createChannelCategory');
    select.innerHTML = '<option value="">No Category</option>';
    const categories = state.channels
        .map(c => ({ id: c.category_id, name: c.category_name }))
        .filter(c => c.id);

    // Use the categories from the last loadServerChannels response
    if (state.categories) {
        state.categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.textContent = cat.name;
            select.appendChild(opt);
        });
    }

    document.getElementById('createChannelModal').style.display = 'flex';
    setTimeout(() => document.getElementById('createChannelName').focus(), 50);
}

function onChannelTypeChange(radio) {
    if (!state.categories) return;
    const select = document.getElementById('createChannelCategory');
    const match = state.categories.find(c =>
        radio.value === 'voice'
            ? c.name.toLowerCase().includes('voice')
            : c.name.toLowerCase().includes('text')
    );
    if (match) select.value = match.id;
}

function closeCreateChannelModal(e) {
    if (e && e.target !== document.getElementById('createChannelModal')) return;
    document.getElementById('createChannelModal').style.display = 'none';
}

async function submitCreateChannel() {
    const name = document.getElementById('createChannelName').value.trim();
    const type = document.querySelector('input[name="channelType"]:checked').value;
    const categoryId = document.getElementById('createChannelCategory').value || null;
    const errorEl = document.getElementById('createChannelError');
    errorEl.style.display = 'none';

    if (!name) {
        errorEl.textContent = 'Please enter a channel name.';
        errorEl.style.display = 'block';
        return;
    }

    try {
        const response = await fetch(`/api/channels/servers/${state.currentServer.id}/channels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name, type, categoryId })
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('createChannelModal').style.display = 'none';
            await loadServerChannels(state.currentServer.id);
        } else {
            errorEl.textContent = data.error || 'Failed to create channel.';
            errorEl.style.display = 'block';
        }
    } catch (error) {
        console.error('Error creating channel:', error);
        errorEl.textContent = 'Something went wrong. Try again.';
        errorEl.style.display = 'block';
    }
}

function showProfile() {
    alert(`Profile:\nUsername: ${state.currentUser.username}\nEmail: ${state.currentUser.email}`);
}

function showServerList() {
    // TODO: Implement server list modal
    console.log('Server list:', state.servers);
}