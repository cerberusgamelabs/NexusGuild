// File Location: /public/js/components/forumView.js
// Handles forum (list view) and media (grid view) channel rendering.
// Replaces messagesContainer content; hides the native input bar.

let _fvChannel      = null;
let _fvPosts        = [];
let _fvViewingPostId = null;
let _fvPostMessages = [];
let _fvNewPostFiles = [];

// ── Public API ────────────────────────────────────────────────────────────────

function openForumView(channel) {
    _fvChannel       = channel;
    _fvPosts         = [];
    _fvViewingPostId = null;
    _fvPostMessages  = [];
    _fvNewPostFiles  = [];
    // Clear immediately so stale messages from previous channel don't show
    const container = document.getElementById('messagesContainer');
    if (container) container.innerHTML = '';
    _fvLoadPosts();
}

function closeForumView() {
    _fvChannel       = null;
    _fvPosts         = [];
    _fvViewingPostId = null;
    _fvPostMessages  = [];
    _fvNewPostFiles  = [];
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function _fvLoadPosts() {
    try {
        const res  = await fetch(`/api/forum/channels/${_fvChannel.id}/posts`, { credentials: 'include' });
        const data = await res.json();
        _fvPosts = data.posts || [];
        _fvRender();
    } catch (err) {
        console.error('Forum load error:', err);
    }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function _fvRender() {
    const container = document.getElementById('messagesContainer');
    if (!container || !_fvChannel) return;

    if (_fvViewingPostId !== null) {
        _fvRenderThread(container);
    } else if (_fvChannel.type === 'media') {
        _fvRenderMediaGrid(container);
    } else {
        _fvRenderList(container);
    }
}

// Forum list view
function _fvRenderList(container) {
    const canPost = clientHasPermission(CLIENT_PERMS.SEND_MESSAGES, _fvChannel.id);
    container.innerHTML = `
        <div class="fv-header">
            <h2 class="fv-title">💬 ${escapeHtml(_fvChannel.name)}</h2>
            ${canPost ? `<button class="fv-new-btn" onclick="_fvShowNewPostForm()">+ New Post</button>` : ''}
        </div>
        <div class="fv-post-list">
            ${_fvPosts.length === 0
                ? '<div class="fv-empty">No posts yet. Be the first to start a discussion!</div>'
                : _fvPosts.map(_fvMakePostRow).join('')}
        </div>`;
}

function _fvMakePostRow(post) {
    const date = new Date(post.last_reply_at || post.created_at).toLocaleDateString();
    const av   = post.avatar
        ? `<img src="${post.avatar}" class="fv-av-img" alt="">`
        : `<span class="fv-av-init">${post.username.substring(0, 2).toUpperCase()}</span>`;
    return `
        <div class="fv-post-row" onclick="_fvOpenPost('${post.id}')">
            <div class="fv-post-av">${av}</div>
            <div class="fv-post-info">
                <div class="fv-post-title">${escapeHtml(post.title)}</div>
                <div class="fv-post-meta">${escapeHtml(post.username)} · ${date}</div>
            </div>
            <div class="fv-post-stats">
                <span class="fv-reply-count">${post.reply_count ?? 0}</span>
                <span class="fv-reply-label">replies</span>
            </div>
        </div>`;
}

// Media grid view
function _fvRenderMediaGrid(container) {
    const canPost = clientHasPermission(CLIENT_PERMS.SEND_MESSAGES, _fvChannel.id);
    container.innerHTML = `
        <div class="fv-header">
            <h2 class="fv-title">🖼️ ${escapeHtml(_fvChannel.name)}</h2>
            ${canPost ? `<button class="fv-new-btn" onclick="_fvShowNewPostForm()">+ Upload</button>` : ''}
        </div>
        <div class="fv-media-grid">
            ${_fvPosts.length === 0
                ? '<div class="fv-empty fv-empty-grid">No media yet. Be the first to share something!</div>'
                : _fvPosts.map(_fvMakeMediaCard).join('')}
        </div>`;
}

function _fvMakeMediaCard(post) {
    let thumbHtml = '<div class="fv-media-thumb-placeholder">📎</div>';
    let isVideo = false;

    if (post.opener_attachments) {
        try {
            const atts = typeof post.opener_attachments === 'string'
                ? JSON.parse(post.opener_attachments)
                : post.opener_attachments;
            if (atts?.[0]) {
                const a = atts[0];
                if (a.mimetype?.startsWith('image/')) {
                    thumbHtml = `<img src="${a.url}" class="fv-media-thumb" alt="${escapeHtml(a.originalName || '')}" loading="lazy">`;
                } else if (a.mimetype?.startsWith('video/')) {
                    isVideo = true;
                    thumbHtml = `<video src="${a.url}" class="fv-media-thumb" preload="none" muted playsinline></video>`;
                }
            }
        } catch (_) {}
    }

    const date = new Date(post.created_at).toLocaleDateString();
    const replies = post.reply_count ?? 0;
    const replyStr = replies > 0 ? ' \u00b7 ' + replies + (replies === 1 ? ' reply' : ' replies') : '';

    return `
        <div class="fv-media-card" onclick="_fvOpenPost('${post.id}')">
            <div class="fv-media-thumb-wrap">
                ${thumbHtml}
                ${isVideo ? '<div class="fv-media-play-icon">&#9654;</div>' : ''}
                <div class="fv-media-card-overlay">
                    <span class="fv-media-overlay-name">${escapeHtml(post.username)}</span>
                    <span class="fv-media-overlay-meta">${date}${replyStr}</span>
                </div>
            </div>
        </div>`;
}

// Thread view
async function _fvOpenPost(postId) {
    try {
        const res  = await fetch(`/api/forum/posts/${postId}/messages`, { credentials: 'include' });
        const data = await res.json();
        _fvViewingPostId = postId;
        _fvPostMessages  = data.messages || [];
        _fvRenderThread(document.getElementById('messagesContainer'), data.post);
    } catch (err) {
        console.error('Forum post load error:', err);
    }
}

function _fvRenderThread(container, post) {
    if (!post) post = _fvPosts.find(p => p.id === _fvViewingPostId);
    if (!container || !post) return;

    const canReply  = clientHasPermission(CLIENT_PERMS.SEND_MESSAGES, _fvChannel.id);
    const isAuthor  = post.user_id === state.currentUser?.id;
    const canDelete = isAuthor || clientHasPermission(CLIENT_PERMS.MANAGE_MESSAGES, _fvChannel.id);

    container.innerHTML = `
        <div class="fv-thread-header">
            <button class="fv-back-btn" onclick="_fvBackToList()">← Back</button>
            <div class="fv-thread-title">${escapeHtml(post.title)}</div>
            ${canDelete ? `<button class="fv-delete-post-btn" onclick="_fvDeletePost('${post.id}')" title="Delete post">🗑️</button>` : ''}
        </div>
        <div class="fv-thread-messages" id="fvThreadMessages">
            ${_fvPostMessages.map((m, i) => _fvMakeMessage(m, i === 0)).join('')}
        </div>
        ${canReply ? `
        <div class="fv-reply-bar">
            <textarea class="fv-reply-input" id="fvReplyInput" placeholder="Write a reply…" rows="1"
                onkeydown="_fvHandleReplyKey(event)" oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px'"></textarea>
            <button class="fv-reply-send" onclick="_fvSendReply()">Send</button>
        </div>` : ''}`;

    const threadEl = document.getElementById('fvThreadMessages');
    if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
}

function _fvMakeMessage(msg, isOpener) {
    const date = formatTimestamp(msg.created_at);
    const av   = msg.avatar
        ? `<img src="${msg.avatar}" class="fv-msg-av-img" alt="">`
        : `<span class="fv-msg-av-init">${msg.username.substring(0, 2).toUpperCase()}</span>`;

    let attachHtml = '';
    if (msg.attachments) {
        try {
            const atts = typeof msg.attachments === 'string' ? JSON.parse(msg.attachments) : msg.attachments;
            if (atts?.length > 0) {
                attachHtml = '<div class="fv-msg-attachments">' + atts.map(a => {
                    if (a.mimetype?.startsWith('image/')) {
                        return `<a href="${a.url}" target="_blank"><img src="${a.url}" class="fv-msg-img" alt="${escapeHtml(a.originalName || '')}"></a>`;
                    }
                    return `<a href="${a.url}" target="_blank" class="fv-msg-file">📎 ${escapeHtml(a.originalName || a.filename)}</a>`;
                }).join('') + '</div>';
            }
        } catch (_) {}
    }

    return `
        <div class="fv-thread-msg${isOpener ? ' fv-opener' : ''}">
            <div class="fv-msg-av">${av}</div>
            <div class="fv-msg-body">
                <div class="fv-msg-header">
                    <span class="fv-msg-username">${escapeHtml(msg.username)}</span>
                    <span class="fv-msg-time">${date}</span>
                    ${isOpener ? '<span class="fv-opener-badge">Original Post</span>' : ''}
                </div>
                <div class="fv-msg-content">${msg.content ? parseMarkdown(msg.content) : ''}</div>
                ${attachHtml}
            </div>
        </div>`;
}

// ── Reply ─────────────────────────────────────────────────────────────────────

function _fvHandleReplyKey(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        _fvSendReply();
    }
}

async function _fvSendReply() {
    const input = document.getElementById('fvReplyInput');
    if (!input || !_fvViewingPostId) return;
    const content = input.value.trim();
    if (!content) return;

    try {
        const fd = new FormData();
        fd.append('content', content);
        const res = await fetch(`/api/forum/posts/${_fvViewingPostId}/messages`, {
            method: 'POST', credentials: 'include', body: fd
        });
        if (res.ok) {
            input.value = '';
            input.style.height = 'auto';
        } else {
            const d = await res.json();
            alert(d.error || 'Failed to send reply');
        }
    } catch (err) {
        console.error('Reply error:', err);
    }
}

function _fvBackToList() {
    _fvViewingPostId = null;
    _fvPostMessages  = [];
    _fvRender();
}

// ── Delete post ───────────────────────────────────────────────────────────────

async function _fvDeletePost(postId) {
    if (!confirm('Delete this post and all its replies? This cannot be undone.')) return;
    try {
        const res = await fetch(`/api/forum/posts/${postId}`, { method: 'DELETE', credentials: 'include' });
        if (res.ok) {
            _fvBackToList();
        } else {
            const d = await res.json();
            alert(d.error || 'Failed to delete post');
        }
    } catch (err) {
        console.error('Delete post error:', err);
    }
}

// ── New post form ─────────────────────────────────────────────────────────────

function _fvShowNewPostForm() {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    const isMedia = _fvChannel.type === 'media';
    _fvNewPostFiles = [];

    container.innerHTML = `
        <div class="fv-thread-header">
            <button class="fv-back-btn" onclick="_fvCancelNewPost()">← Back</button>
            <div class="fv-thread-title">New Post</div>
        </div>
        <div class="fv-new-post-form">
            <input type="text" class="fv-form-input" id="fvPostTitle" placeholder="Post title" maxlength="200">
            ${isMedia ? '' : `<textarea class="fv-form-textarea" id="fvPostContent" rows="5" placeholder="What's on your mind?"></textarea>`}
            <div class="fv-form-files" id="fvFormFiles"></div>
            <div class="fv-form-actions">
                <label class="fv-attach-btn">
                    📎 ${isMedia ? 'Attach Media (required)' : 'Attach Files'}
                    <input type="file" id="fvPostFileInput" multiple accept="image/*,video/*,.pdf,.txt,.doc,.docx,.zip"
                           style="display:none" onchange="_fvHandleFileSelect(event)">
                </label>
                <div style="flex:1"></div>
                <button class="fv-cancel-btn" onclick="_fvCancelNewPost()">Cancel</button>
                <button class="fv-submit-btn btn-primary" onclick="_fvSubmitNewPost()">Post</button>
            </div>
            <div id="fvPostError" class="fv-post-error" style="display:none;"></div>
        </div>`;

    document.getElementById('fvPostTitle')?.focus();
}

function _fvHandleFileSelect(event) {
    _fvNewPostFiles = [..._fvNewPostFiles, ...Array.from(event.target.files)].slice(0, 5);
    _fvRenderFormFiles();
}

function _fvRenderFormFiles() {
    const el = document.getElementById('fvFormFiles');
    if (!el) return;
    el.innerHTML = _fvNewPostFiles.map((f, i) => `
        <div class="fv-form-file-item">
            ${f.type.startsWith('image/') ? `<img src="${URL.createObjectURL(f)}" class="fv-form-file-thumb" alt="">` : '📎'}
            <span class="fv-form-file-name">${escapeHtml(f.name)}</span>
            <button onclick="_fvRemoveFormFile(${i})">✕</button>
        </div>`).join('');
}

function _fvRemoveFormFile(index) {
    _fvNewPostFiles.splice(index, 1);
    _fvRenderFormFiles();
}

async function _fvSubmitNewPost() {
    const titleEl   = document.getElementById('fvPostTitle');
    const contentEl = document.getElementById('fvPostContent');
    const errorEl   = document.getElementById('fvPostError');
    const title     = titleEl?.value.trim();
    const content   = contentEl?.value.trim() || '';

    const showErr = (msg) => { if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; } };

    if (!title) return showErr('Please enter a title.');
    if (_fvChannel.type === 'media' && _fvNewPostFiles.length === 0) return showErr('Media posts require an attachment.');
    if (!content && _fvNewPostFiles.length === 0) return showErr('Post must have content or an attachment.');

    try {
        const fd = new FormData();
        fd.append('title', title);
        if (content) fd.append('content', content);
        _fvNewPostFiles.forEach(f => fd.append('files', f));

        const res = await fetch(`/api/forum/channels/${_fvChannel.id}/posts`, {
            method: 'POST', credentials: 'include', body: fd
        });

        if (res.ok) {
            const data = await res.json();
            _fvNewPostFiles = [];
            // Navigate into the new post thread
            _fvPosts.unshift(data.post);
            _fvOpenPost(data.post.id);
        } else {
            const d = await res.json();
            showErr(d.error || 'Failed to create post');
        }
    } catch (err) {
        console.error('Create post error:', err);
        showErr('Something went wrong.');
    }
}

function _fvCancelNewPost() {
    _fvNewPostFiles = [];
    _fvRender();
}

// ── Socket event callbacks (called from socket.js) ────────────────────────────

function onForumPostCreated(data) {
    if (!_fvChannel || data.channelId !== _fvChannel.id) return;
    if (!_fvPosts.find(p => p.id === data.post.id)) {
        _fvPosts.unshift(data.post);
    }
    if (_fvViewingPostId === null) _fvRender();
}

function onForumReplyAdded(data) {
    // Update reply_count in local post list
    const post = _fvPosts.find(p => p.id === data.postId);
    if (post) {
        post.reply_count = (post.reply_count || 0) + 1;
        post.last_reply_at = data.message.created_at;
    }
    // If currently viewing this thread, append the message
    if (_fvViewingPostId === data.postId) {
        // Don't re-render if this is the user's own reply (already submitted)
        const exists = _fvPostMessages.find(m => m.id === data.message.id);
        if (!exists) {
            _fvPostMessages.push(data.message);
            const container = document.getElementById('messagesContainer');
            _fvRenderThread(container, null);
        }
    }
}

function onForumPostDeleted(data) {
    if (!_fvChannel || data.channelId !== _fvChannel.id) return;
    _fvPosts = _fvPosts.filter(p => p.id !== data.postId);
    if (_fvViewingPostId === data.postId) {
        _fvBackToList();
    } else if (_fvViewingPostId === null) {
        _fvRender();
    }
}
