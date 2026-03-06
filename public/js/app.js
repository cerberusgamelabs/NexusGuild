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
    roles: [],
    socket: null,
    isAuthenticated: false,
    hasMoreMessages: true,
    isLoadingMessages: false,
    unread: {},
    voiceStates: {},
    myPermissions: 0n,      // current user's effective server-level permissions (BigInt)
    myChannelPerms: {},     // { [channelId]: BigInt } — channel-level resolved perms
};

// Client-side permission bit values
const CLIENT_PERMS = {
    KICK_MEMBERS:         2n,
    BAN_MEMBERS:          4n,
    ADMINISTRATOR:        8n,
    MANAGE_CHANNELS:      16n,
    MANAGE_GUILD:         32n,
    ADD_REACTIONS:        64n,
    VIEW_CHANNEL:         1024n,
    SEND_MESSAGES:        2048n,
    MANAGE_MESSAGES:      8192n,
    EMBED_LINKS:          16384n,
    ATTACH_FILES:         32768n,
    READ_MESSAGE_HISTORY: 65536n,
    MENTION_EVERYONE:     131072n,
    MANAGE_ROLES:             268435456n,
    MANAGE_NICKNAMES:         134217728n,
    CONNECT:                  1048576n,
    SPEAK:                    2097152n,
    MANAGE_GUILD_EXPRESSIONS: 1073741824n,
};

// Returns true if the current user has the given permission.
// Pass channelId to check channel-level overrides; omit for server-level only.
// Server owners always return true.
function clientHasPermission(perm, channelId = null) {
    if (!state.currentServer || !state.currentUser) return false;
    if (state.currentServer.owner_id === state.currentUser.id) return true;
    const serverPerms = state.myPermissions || 0n;
    if ((serverPerms & CLIENT_PERMS.ADMINISTRATOR) === CLIENT_PERMS.ADMINISTRATOR) return true;
    // Channel-level perms take precedence when available
    if (channelId && state.myChannelPerms[channelId] !== undefined) {
        return !!(state.myChannelPerms[channelId] & perm);
    }
    return !!(serverPerms & perm);
}

// ── Unread / Mention helpers ──────────────────────────────────────────────────

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseMentions(content) {
    if (!content || !state.currentUser) return false;
    const lower = content.toLowerCase();
    const username = state.currentUser.username.toLowerCase();
    if (lower.includes(`@${username}`) || lower.includes('@everyone') || lower.includes('@here')) return true;
    // Check if content mentions a mentionable role that the current user has
    const myMember = (state.members || []).find(m => m.id === state.currentUser.id);
    const myRoleIds = new Set((myMember?.roles || []).map(r => r.id));
    for (const role of (state.roles || [])) {
        if (role.mentionable && myRoleIds.has(role.id) && lower.includes(`@${role.name.toLowerCase()}`)) return true;
    }
    return false;
}

function trackUnread(channelId, serverId, isMention) {
    if (!state.unread[channelId]) state.unread[channelId] = { count: 0, mentions: 0, serverId };
    state.unread[channelId].count++;
    if (isMention) state.unread[channelId].mentions++;
    saveUnread();
    renderChannelList(state.channels, state.categories);
    renderServerList();
}

function clearUnread(channelId) {
    if (!state.unread[channelId]) return;
    delete state.unread[channelId];
    saveUnread();
    renderChannelList(state.channels, state.categories);
    renderServerList();
}

function saveUnread() {
    if (!state.currentUser) return;
    try { localStorage.setItem(`ng_unread_${state.currentUser.id}`, JSON.stringify(state.unread)); } catch (e) {}
}

function loadUnread() {
    if (!state.currentUser) return;
    try {
        const saved = localStorage.getItem(`ng_unread_${state.currentUser.id}`);
        if (saved) state.unread = JSON.parse(saved);
    } catch (e) {}
}

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function showBrowserNotification(username, content, channelId) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible') return;
    const channel = state.channels.find(c => c.id === channelId);
    const n = new Notification(`${username} mentioned you${channel ? ` in #${channel.name}` : ''}`, {
        body: content,
        icon: '/img/logo.png',
        tag: channelId
    });
    n.onclick = () => { window.focus(); if (channel) selectChannel(channelId); n.close(); };
}

window.addEventListener('beforeunload', () => {
    if (typeof leaveVoice === 'function') leaveVoice();
});

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
            loadUnread();
            state.isAuthenticated = true;
            showApp();
            await loadUserServers();
            if (typeof loadAllServerEmojis === 'function') loadAllServerEmojis();
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

    // Auto-resize message textarea as user types
    const msgInput = document.getElementById('messageInput');
    if (msgInput) {
        msgInput.addEventListener('input', () => {
            msgInput.style.height = 'auto';
            msgInput.style.height = Math.min(msgInput.scrollHeight, 200) + 'px';
        });
    }
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
    document.getElementById('app-screen').style.display = 'flex';

    if (state.currentUser) {
        document.getElementById('currentUsername').textContent = state.currentUser.username;
        const uaEl = document.getElementById('userAvatar');
        if (state.currentUser.avatar) {
            uaEl.innerHTML = `<img src="${state.currentUser.avatar}" alt="" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;">`;
        } else {
            uaEl.textContent = state.currentUser.username.substring(0, 2).toUpperCase();
        }
        renderUserStatus();
    }
    if (typeof initProfileView === 'function') initProfileView();
}

function renderUserStatus() {
    const statusEl = document.getElementById('currentStatus');
    if (!statusEl || !state.currentUser) return;
    const cs = state.currentUser.custom_status;
    if (cs) {
        statusEl.textContent = cs;
        statusEl.title = cs;
        statusEl.classList.add('has-custom-status');
    } else {
        statusEl.textContent = 'Online';
        statusEl.title = 'Click to set a custom status';
        statusEl.classList.remove('has-custom-status');
    }
}

function openCustomStatusModal() {
    const current = state.currentUser?.custom_status || '';

    async function doSave() {
        const val = getModalInputValue().trim().slice(0, 128);
        try {
            const res = await fetch('/api/users/me/status', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ custom_status: val })
            });
            if (res.ok) {
                state.currentUser.custom_status = val || null;
                renderUserStatus();
                closeModal();
            } else {
                const d = await res.json();
                showModalError(d.error || 'Failed to update status');
            }
        } catch {
            showModalError('Failed to update status');
        }
    }

    showModal({
        title: 'Set Custom Status',
        message: 'Enter a status message (up to 128 characters, leave blank to clear).',
        inputType: 'text',
        inputValue: current,
        inputPlaceholder: 'What\'s on your mind?',
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            { text: 'Save', style: 'primary', action: doSave }
        ],
        onEnter: doSave
    });
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
    // Guard for DM view teardown (may not be implemented yet)
    if (typeof teardownDMView === 'function') {
        teardownDMView();
    }

    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;

    state.currentServer = server;
    state.myPermissions = 0n;      // reset until loadServerMembers resolves
    state.myChannelPerms = {};     // reset until loadServerChannels resolves
    state.roles = [];              // reset until loadServerMembers resolves

    if (state.socket) {
        state.socket.emit('join_server', serverId);
    }

    document.getElementById('currentServerName').textContent = server.name;
    loadServerChannels(serverId);
    loadServerMembers(serverId);  // updates myPermissions + management buttons when done
    // Pre-load server emoji so autocomplete has them ready
    if (typeof loadServerEmojis === 'function') loadServerEmojis(serverId);

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

            // Populate per-channel permission cache
            state.myChannelPerms = {};
            data.channels.forEach(ch => {
                if (ch.my_permissions !== undefined)
                    state.myChannelPerms[ch.id] = BigInt(ch.my_permissions);
            });

            // Merge server-side unread counts into state.
            // null  → no user_channel_reads row yet — leave localStorage cache intact.
            // 0     → row exists, nothing new — clear stale cache, UNLESS local has
            //         cached mentions (logout snapshot may have set cursor at the
            //         mention message itself, making the server see 0 new messages).
            // n > 0 → row exists with unread messages — update badge, preserving any
            //         locally-tracked mentions the server couldn't see (cursor swallowed
            //         a pre-logout mention).
            data.channels.forEach(ch => {
                const local = state.unread[ch.id];
                if (ch.unread_count > 0) {
                    state.unread[ch.id] = {
                        count: ch.unread_count,
                        mentions: Math.max(ch.mention_count || 0, local?.mentions || 0),
                        serverId: ch.server_id
                    };
                } else if (ch.unread_count === 0) {
                    if (local?.mentions > 0) {
                        // Preserve cached mention pip — snapshot cursor consumed it.
                    } else {
                        delete state.unread[ch.id];
                    }
                }
                // unread_count === null → no tracking row → leave cache alone
            });
            saveUnread();

            renderChannelList(data.channels, data.categories);

            // Auto-select first messageable channel
            const firstTextChannel = data.channels.find(c => ['text', 'announcement', 'forum', 'media'].includes(c.type));
            if (firstTextChannel) {
                selectChannel(firstTextChannel.id);
            }
        }
    } catch (error) {
        console.error('Error loading channels:', error);
    }
}

function _clearChannelUnreadIfNeeded(channelId) {
    if (!channelId) return;
    if (!state.unread[channelId] && !state.firstUnreadMessageId) return;
    clearUnread(channelId);
    fetch(`/api/channels/${channelId}/read`, { method: 'PATCH', credentials: 'include' });
    state.firstUnreadMessageId = null;
    const divider = document.getElementById('newMsgDivider');
    if (divider) divider.remove();
    renderChannelList(state.channels, state.categories);
    renderServerList();
}

function selectChannel(channelId) {
    const channel = state.channels.find(c => c.id === channelId);
    if (!channel) return;

    // Save unread count to position the "New Messages" divider; defer clearing until scroll-to-bottom
    state.firstUnreadCount = state.unread[channelId]?.count || 0;
    state.firstUnreadMessageId = null;

    const prevChannelId = state.currentChannel?.id;
    state.currentChannel = channel;

    if (state.socket) {
        if (prevChannelId && prevChannelId !== channelId) {
            state.socket.emit('leave_channel', prevChannelId);
        }
        state.socket.emit('join_channel', channelId);
    }

    const chIcon = channel.type === 'voice'        ? '🔊'
                 : channel.type === 'announcement' ? '📢'
                 : channel.type === 'forum'        ? '💬'
                 : channel.type === 'media'        ? '🖼️'
                 : '#';
    document.getElementById('currentChannelName').textContent = `${chIcon} ${channel.name}`;

    // Close side panels and clear reply when switching channels
    if (typeof closePinsPanel === 'function') closePinsPanel();
    if (typeof closeThreadPanel === 'function') closeThreadPanel();
    clearReply();

    // Show pins button only for text/announcement channels (not voice/forum/media)
    const pinsBtn = document.getElementById('pinsBtn');
    if (pinsBtn) {
        const showPins = channel.type === 'text' || channel.type === 'announcement';
        pinsBtn.style.display = showPins ? '' : 'none';
    }

    _updateInputForChannel(channel);

    if (channel.type === 'voice') {
        state.messages = [];
        renderMessages();
        const container = document.getElementById('messagesContainer');

        // Already connected to this channel — show the full voice panel
        if (typeof isInVoiceChannel === 'function' && isInVoiceChannel(channel.id)) {
            if (typeof showVoiceView === 'function') showVoiceView();
        } else if (container) {
            container.innerHTML = `
                <div class="channel-splash">
                    <div class="channel-splash-icon">🔊</div>
                    <div class="channel-splash-name">${channel.name}</div>
                    <button class="btn-primary voice-join-splash-btn"
                            onclick="joinVoice('${channel.id}','${state.currentServer.id}')">
                        Join Voice
                    </button>
                </div>`;
        }
    } else if (channel.type === 'forum' || channel.type === 'media') {
        state.messages = [];
        openForumView(channel);
    } else {
        if (typeof closeForumView === 'function') closeForumView();
        loadChannelMessages(channelId);
    }
    mobileShowMessages();

    // Update UI
    document.querySelectorAll('.channel-button').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-channel-id="${channelId}"]`)?.classList.add('active');
}

function _updateInputForChannel(channel) {
    const inputArea = document.querySelector('.input-area');
    const msgInput  = document.getElementById('messageInput');
    if (!inputArea || !msgInput) return;

    if (channel.type === 'voice' || channel.type === 'forum' || channel.type === 'media') {
        inputArea.style.display = 'none';
        return;
    }

    inputArea.style.display = '';

    const canSend = clientHasPermission(CLIENT_PERMS.SEND_MESSAGES, channel.id);

    if (!canSend) {
        msgInput.disabled = true;
        msgInput.placeholder = channel.type === 'announcement'
            ? 'You cannot send messages in announcement channels.'
            : 'You do not have permission to send messages here.';
    } else {
        msgInput.disabled = false;
        msgInput.placeholder = `Message #${channel.name}`;
    }
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
            // Discard if the user navigated away while the fetch was in-flight
            if (state.currentChannel?.id !== channelId) return;
            state.messages = data.messages;

            // Determine first unread message for the "New Messages" divider
            state.firstUnreadMessageId = null;
            const unreadCount = state.firstUnreadCount || 0;
            if (unreadCount > 0 && state.messages.length > 0) {
                const idx = state.messages.length - unreadCount;
                if (idx > 0) state.firstUnreadMessageId = state.messages[idx].id;
            }

            renderMessages();

            // Scroll to new messages divider if unread, else to bottom and clear
            if (state.firstUnreadMessageId) {
                scrollToNewMessageDivider();
            } else {
                scrollToBottom();
                _clearChannelUnreadIfNeeded(channelId);
            }

            await loadMessageReactions(state.messages);
            if (state.currentChannel?.id !== channelId) return;

            // Check if user reached the bottom while reactions were loading
            const container = document.getElementById('messagesContainer');
            const reachedBottom = container &&
                container.scrollHeight - container.scrollTop - container.clientHeight < 80;
            if (reachedBottom && state.firstUnreadMessageId) {
                state.firstUnreadMessageId = null;
                _clearChannelUnreadIfNeeded(channelId);
            }

            renderMessages();

            // Reapply scroll after second render resets scrollTop
            if (state.firstUnreadMessageId) {
                scrollToNewMessageDivider();
            } else {
                scrollToBottom();
            }

            // Re-emit join_channel here — by the time both fetches complete the
            // socket is connected, so this is guaranteed to reach the server even
            // if the earlier emit (in selectChannel) was lost during handshake.
            if (state.socket && state.currentChannel?.id === channelId) {
                state.socket.emit('join_channel', channelId);
            }
        }
    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

async function loadServerMembers(serverId) {
    try {
        const [membersResponse, rolesResponse] = await Promise.all([
            fetch(`/api/servers/${serverId}/members`, { credentials: 'include' }),
            fetch(`/api/servers/${serverId}/roles`, { credentials: 'include' }),
        ]);

        if (rolesResponse.ok) {
            const rolesData = await rolesResponse.json();
            state.roles = rolesData.roles || [];
        }

        if (membersResponse.ok) {
            const data = await membersResponse.json();
            state.members = data.members;
            state.myPermissions = BigInt(data.myPermissions || '0');

            // Update management buttons now that we know the user's permissions
            const canManage = clientHasPermission(CLIENT_PERMS.MANAGE_CHANNELS);
            const createChannelBtn = document.getElementById('createChannelBtn');
            if (createChannelBtn) createChannelBtn.style.display = canManage ? 'block' : 'none';
            const createCategoryBtn = document.getElementById('createCategoryBtn');
            if (createCategoryBtn) createCategoryBtn.style.display = canManage ? 'block' : 'none';

            renderMemberList();
            // Re-render messages now that avatar/role-color maps are available
            if (state.messages?.length > 0) renderMessages();
            // Refresh input state now that channel-level perms are known
            if (state.currentChannel) _updateInputForChannel(state.currentChannel);
        }
    } catch (error) {
        console.error('Error loading members:', error);
    }
}

// ── @Mention Autocomplete ─────────────────────────────────────────────────────

let _mentionIndex = -1;

function getMentionQuery(textarea) {
    const before = textarea.value.slice(0, textarea.selectionStart);
    const match = before.match(/@(\w*)$/);
    return match ? match[1] : null;
}

function updateMentionDropdown(textarea) {
    const query = getMentionQuery(textarea);
    if (query === null) { hideMentionDropdown(); return; }
    const lower = query.toLowerCase();
    const matches = [];
    if ('everyone'.startsWith(lower)) matches.push({ id: '__everyone', displayName: 'everyone', sub: 'Notify all members' });
    if ('here'.startsWith(lower))     matches.push({ id: '__here',     displayName: 'here',     sub: 'Notify online members' });
    for (const role of (state.roles || [])) {
        if (!role.mentionable || role.name === '@everyone') continue;
        if (role.name.toLowerCase().startsWith(lower))
            matches.push({ id: `__role_${role.id}`, displayName: role.name, sub: 'Role', role_color: role.color });
    }
    for (const m of (state.members || [])) {
        const nick  = (m.nickname || '').toLowerCase();
        const uname = m.username.toLowerCase();
        if (nick.startsWith(lower) || uname.startsWith(lower))
            matches.push({ id: m.id, displayName: m.nickname || m.username, sub: m.username, avatar: m.avatar, role_color: m.role_color });
    }
    if (matches.length === 0) { hideMentionDropdown(); return; }
    _mentionIndex = 0;
    _renderMentionDropdown(matches.slice(0, 10));
}

function _renderMentionDropdown(matches) {
    const dd = document.getElementById('mentionDropdown');
    if (!dd) return;
    dd.style.display = 'block';
    dd.innerHTML = matches.map((m, i) => {
        const av = m.avatar
            ? `<img src="${m.avatar}" class="mention-av-img" alt="">`
            : `<span class="mention-av-init">${getInitials(m.displayName)}</span>`;
        const colorStyle = m.role_color ? ` style="color:${m.role_color}"` : '';
        const safeName = m.displayName.replace(/'/g, "\\'");
        return `<div class="mention-item${i === _mentionIndex ? ' active' : ''}" data-idx="${i}"
                     onmousedown="selectMention('${safeName}',event)">
            <span class="mention-av">${av}</span>
            <span class="mention-name"${colorStyle}>${m.displayName}</span>
            <span class="mention-sub">${m.sub || ''}</span>
        </div>`;
    }).join('');
}

function hideMentionDropdown() {
    const dd = document.getElementById('mentionDropdown');
    if (dd) dd.style.display = 'none';
    _mentionIndex = -1;
}

function selectMention(name, event) {
    if (event) event.preventDefault();
    const ta = document.getElementById('messageInput');
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos).replace(/@(\w*)$/, `@${name} `);
    ta.value = before + ta.value.slice(pos);
    ta.selectionStart = ta.selectionEnd = before.length;
    hideMentionDropdown();
    ta.focus();
}

// ── Emoji Shortcode Autocomplete ──────────────────────────────────────────────

let _emojiIndex = -1;

function getEmojiQuery(textarea) {
    const before = textarea.value.slice(0, textarea.selectionStart);
    const match = before.match(/:(\w+)$/);
    return match ? match[1] : null;
}

// Routes oninput between emoji autocomplete and mention autocomplete
function updateAutocomplete(textarea) {
    const emojiQuery = getEmojiQuery(textarea);
    if (emojiQuery !== null) {
        hideMentionDropdown();
        _showEmojiMatches(emojiQuery, textarea);
        return;
    }
    hideEmojiDropdown();
    updateMentionDropdown(textarea);
}

function hideAllAutocomplete() {
    hideMentionDropdown();
    hideEmojiDropdown();
}

function hideEmojiDropdown() {
    const dd = document.getElementById('emojiDropdown');
    if (dd) dd.style.display = 'none';
    _emojiIndex = 0;
}

function _showEmojiMatches(q, textarea) {
    const lower = q.toLowerCase();
    const matches = [];

    // Custom server emoji first (from emojiPicker.js global `serverEmojis`)
    if (typeof serverEmojis !== 'undefined' && serverEmojis.server) {
        for (const e of serverEmojis.server) {
            if (e.name.includes(lower)) {
                matches.push({ name: e.name, char: null, isCustom: true, serverId: e.server_id, filename: e.filename });
                if (matches.length >= 5) break;
            }
        }
    }

    // Unicode emoji — startsWith first for better UX, then includes
    if (typeof EMOJI_SHORTCODES !== 'undefined') {
        const starts = [], contains = [];
        for (const name of Object.keys(EMOJI_SHORTCODES)) {
            if (name.startsWith(lower)) starts.push(name);
            else if (name.includes(lower)) contains.push(name);
        }
        for (const name of [...starts, ...contains]) {
            if (matches.length >= 10) break;
            if (!matches.some(m => m.name === name)) {
                matches.push({ name, char: EMOJI_SHORTCODES[name], isCustom: false });
            }
        }
    }

    if (matches.length === 0) { hideEmojiDropdown(); return; }
    _emojiIndex = 0;
    _renderEmojiDropdown(matches);
}

function _renderEmojiDropdown(matches) {
    const dd = document.getElementById('emojiDropdown');
    if (!dd) return;

    // Group into sections if both custom and unicode present
    const customMatches = matches.filter(m => m.isCustom);
    const unicodeMatches = matches.filter(m => !m.isCustom);
    const hasBoth = customMatches.length > 0 && unicodeMatches.length > 0;

    let html = '';
    let globalIdx = 0;

    if (hasBoth) {
        html += `<div class="emoji-section-header">Server Emoji</div>`;
    }
    for (const m of customMatches) {
        const isActive = globalIdx === _emojiIndex ? ' active' : '';
        const safeName = m.name.replace(/'/g, "\\'");
        html += `<div class="emoji-item${isActive}" data-idx="${globalIdx}" onmousedown="selectEmojiShortcode('${safeName}',event)">
            <span class="emoji-item-char"><img src="/img/emoji/${m.serverId}/${m.filename}" style="width:20px;height:20px;object-fit:contain;" alt=":${m.name}:"></span>
            <span class="emoji-item-name">:${m.name}:</span>
        </div>`;
        globalIdx++;
    }
    if (hasBoth) {
        html += `<div class="emoji-section-header">Unicode Emoji</div>`;
    }
    for (const m of unicodeMatches) {
        const isActive = globalIdx === _emojiIndex ? ' active' : '';
        const safeName = m.name.replace(/'/g, "\\'");
        html += `<div class="emoji-item${isActive}" data-idx="${globalIdx}" onmousedown="selectEmojiShortcode('${safeName}',event)">
            <span class="emoji-item-char">${m.char}</span>
            <span class="emoji-item-name">:${m.name}:</span>
        </div>`;
        globalIdx++;
    }

    dd.innerHTML = html;
    dd.style.display = 'block';
}

function selectEmojiShortcode(name, event) {
    if (event) event.preventDefault();
    const ta = document.getElementById('messageInput');
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos).replace(/:(\w+)$/, `:${name}: `);
    ta.value = before + ta.value.slice(pos);
    ta.selectionStart = ta.selectionEnd = before.length;
    hideEmojiDropdown();
    ta.focus();
}

// Message handling
function handleMessageInput(event) {
    if (event.key === 'Escape') { hideAllAutocomplete(); if (typeof closeInputEmojiPicker === 'function') closeInputEmojiPicker(); return; }

    // Emoji dropdown keyboard nav
    const edd = document.getElementById('emojiDropdown');
    const emojiOpen = edd && edd.style.display !== 'none';
    if (emojiOpen) {
        const items = edd.querySelectorAll('.emoji-item');
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            _emojiIndex = Math.max(0, _emojiIndex - 1);
            items.forEach((el, i) => el.classList.toggle('active', i === _emojiIndex));
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            _emojiIndex = Math.min(items.length - 1, _emojiIndex + 1);
            items.forEach((el, i) => el.classList.toggle('active', i === _emojiIndex));
            return;
        }
        if ((event.key === 'Enter' || event.key === 'Tab') && items[_emojiIndex]) {
            event.preventDefault();
            items[_emojiIndex].dispatchEvent(new MouseEvent('mousedown'));
            return;
        }
    }

    // Mention dropdown keyboard nav
    const dd = document.getElementById('mentionDropdown');
    const open = dd && dd.style.display !== 'none';
    if (open) {
        const items = dd.querySelectorAll('.mention-item');
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            _mentionIndex = Math.max(0, _mentionIndex - 1);
            items.forEach((el, i) => el.classList.toggle('active', i === _mentionIndex));
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            _mentionIndex = Math.min(items.length - 1, _mentionIndex + 1);
            items.forEach((el, i) => el.classList.toggle('active', i === _mentionIndex));
            return;
        }
        if ((event.key === 'Enter' || event.key === 'Tab') && items[_mentionIndex]) {
            event.preventDefault();
            items[_mentionIndex].dispatchEvent(new MouseEvent('mousedown'));
            return;
        }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

// ── Avatar upload ─────────────────────────────────────────────────────────────

async function uploadUserAvatar(event) {
    const input = event.target;
    const file = input.files[0];
    if (!file) return;
    // Reset immediately (sync, in user-gesture context) so re-selection always triggers onchange
    input.value = '';
    const formData = new FormData();
    formData.append('file', file);
    try {
        const res = await fetch('/api/users/me/avatar', {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Upload failed'); return; }
        state.currentUser.avatar = data.avatar;
        const uaEl = document.getElementById('userAvatar');
        if (uaEl) uaEl.innerHTML = `<img src="${data.avatar}" alt="" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;">`;
        if (state.currentServer) {
            await loadServerMembers(state.currentServer.id);
        }
        renderMessages();
    } catch (err) {
        console.error('Avatar upload error:', err);
        alert('Failed to upload avatar');
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
                    <button class="remove-file-btn" onclick="removeFile(${index})">&#x2715;</button>
                    <div class="file-preview-name">${file.name}</div>
                </div>
            `;
        } else {
            return `
                <div class="file-preview-item">
                    <div class="file-preview-icon">??</div>
                    <button class="remove-file-btn" onclick="removeFile(${index})">&#x2715;</button>
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

// ── Reply state ──────────────────────────────────────────────────────────────
let replyTo = null;

function setReply(messageId, username, content) {
    replyTo = { id: messageId, username, content };
    document.getElementById('replyBarName').textContent = username;
    document.getElementById('replyBarPreview').textContent = content?.slice(0, 80) || '';
    document.getElementById('replyBar').style.display = 'flex';
    document.getElementById('messageInput').focus();
}

function clearReply() {
    replyTo = null;
    const bar = document.getElementById('replyBar');
    if (bar) bar.style.display = 'none';
}

function scrollToMessage(messageId) {
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('highlight-flash');
    setTimeout(() => el.classList.remove('highlight-flash'), 2000);
}

async function sendMessage() {
    requestNotificationPermission();
    const input = document.getElementById('messageInput');
    const content = input.value.trim();

    if (!content && selectedFiles.length === 0) return;
    if (!state.currentChannel) return;

    try {
        const formData = new FormData();
        if (content) formData.append('content', content);
        if (replyTo) formData.append('replyToId', replyTo.id);

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
            input.style.height = 'auto';
            hideMentionDropdown();
            hideEmojiDropdown();
            selectedFiles = [];
            renderFilePreview();
            document.getElementById('fileInput').value = '';
            clearReply();
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

function _syncMuteBtn(muted) {
    for (const id of ['micToggle', 'vmpMuteBtn']) {
        const btn = document.getElementById(id);
        if (!btn) continue;
        btn.classList.toggle('active', muted);
        btn.querySelector('img').src = `img/mute-${muted ? 'on' : 'off'}.png`;
    }
}

function _syncDeafenBtn(deaf) {
    for (const id of ['deafenToggle', 'vmpDeafBtn']) {
        const btn = document.getElementById(id);
        if (!btn) continue;
        btn.classList.toggle('active', deaf);
        btn.querySelector('img').src = `img/deafen-${deaf ? 'on' : 'off'}.png`;
    }
}

function toggleMic() {
    if (!deafened) {
        micMuted = !micMuted;
        _syncMuteBtn(micMuted);

        if (state.socket) {
            state.socket.emit('voice_state_change', { muted: micMuted, deafened });
        }

        if (typeof setLiveKitMicMuted === 'function') setLiveKitMicMuted(micMuted);
    }
}

function toggleDeafen() {
    deafened = !deafened;
    _syncDeafenBtn(deafened);

    micMuted = deafened;
    _syncMuteBtn(micMuted);

    if (state.socket) {
        state.socket.emit('voice_state_change', { muted: micMuted, deafened });
    }

    if (typeof setLiveKitMicMuted  === 'function') setLiveKitMicMuted(micMuted);
    if (typeof setLiveKitDeafened  === 'function') setLiveKitDeafened(deafened);
}

// ── Mobile panel navigation ────────────────────────────────────────────────
function mobileShowMessages() {
    document.querySelector('.main-container')?.classList.add('mobile-show-messages');
}

function mobileShowChannels() {
    closeMobileMembers();
    document.querySelector('.main-container')?.classList.remove('mobile-show-messages');
}

function mobileToggleMembers() {
    const panel = document.getElementById('membersPanel');
    const backdrop = document.getElementById('mobileBackdrop');
    if (!panel) return;
    const isOpen = panel.classList.contains('mobile-open');
    if (isOpen) {
        closeMobileMembers();
    } else {
        panel.classList.add('mobile-open');
        backdrop?.classList.add('visible');
    }
}

function closeMobileMembers() {
    document.getElementById('membersPanel')?.classList.remove('mobile-open');
    document.getElementById('mobileBackdrop')?.classList.remove('visible');
}

// UI helpers
function scrollToBottom() {
    requestAnimationFrame(() => {
        const container = document.getElementById('messagesContainer');
        if (container) container.scrollTop = container.scrollHeight;
    });
}

function scrollToNewMessageDivider() {
    requestAnimationFrame(() => {
        const divider = document.getElementById('newMsgDivider');
        if (divider) divider.scrollIntoView({ block: 'start', behavior: 'instant' });
        else scrollToBottom();
    });
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const month = (date.getMonth() + 1).toString();
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

// ── Create Server Modal ──────────────────────────────────────────────────────

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

// ── Create Channel Modal ─────────────────────────────────────────────────────

function showCreateChannelModal() {
    closeServerMenu();
    if (!state.currentServer) return;
    document.getElementById('createChannelName').value = '';
    document.getElementById('createChannelError').style.display = 'none';
    document.getElementById('createChannelType').value = 'text';

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

function showCreateCategoryModal() {
    closeServerMenu();
    if (!state.currentServer) return;
    showModal({
        title: 'Create Category',
        inputType: 'text',
        inputPlaceholder: 'Category name',
        buttons: [
            { text: 'Cancel', style: 'secondary', action: closeModal },
            { text: 'Create', style: 'primary', action: submitCreateCategory }
        ],
        onEnter: submitCreateCategory
    });
}

async function submitCreateCategory() {
    const name = getModalInputValue().trim();
    if (!name) { showModalError('Please enter a category name.'); return; }
    try {
        const res = await fetch(`/api/channels/servers/${state.currentServer.id}/categories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name })
        });
        if (res.ok) {
            closeModal();
        } else {
            const data = await res.json();
            showModalError(data.error || 'Failed to create category.');
        }
    } catch (err) {
        showModalError('Failed to create category.');
    }
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
    const type = document.getElementById('createChannelType').value;
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
            const msg = data.error || (data.errors?.[0]?.msg) || `Failed to create channel (${response.status}).`;
            errorEl.textContent = msg;
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
}