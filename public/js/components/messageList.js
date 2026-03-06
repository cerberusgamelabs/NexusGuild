// Message list rendering

// ── HTML escape (no newline conversion — used internally by markdown) ─────────
function _esc(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Markdown parser ───────────────────────────────────────────────────────────
function parseMarkdown(raw) {
    if (!raw) return '';

    const slots = [];
    const protect = html => `\x00${slots.push(html) - 1}\x00`;
    const restore = s => s.replace(/\x00(\d+)\x00/g, (_, i) => slots[+i]);

    let s = raw;

    // 1. Fenced code blocks — protect entirely from further processing
    s = s.replace(/```(\w*)\r?\n?([\s\S]*?)```/g, (_, lang, code) => {
        const trimmed   = code.replace(/^\n+/, '').replace(/\n+$/, '');
        const lines     = trimmed.split('\n');
        const multiline = lines.length > 1;
        const body  = _esc(trimmed);
        const label = lang ? _esc(lang) : '';
        return protect(
            `<div class="msg-code-block">` +
            (label && multiline ? `<div class="msg-code-lang">${label}</div>` : '') +
            `<pre><code>${body}</code></pre></div>`
        );
    });

    // 2. Inline formatting helper (used for regular lines + block element interiors)
    function applyInline(str) {
        // Inline code — protect before escaping
        str = str.replace(/`([^`\n]+)`/g, (_, c) => protect(`<code class="msg-inline-code">${_esc(c)}</code>`));

        // HTML-escape non-placeholder parts
        str = str.split(/(\x00\d+\x00)/).map(p => /^\x00\d+\x00$/.test(p) ? p : _esc(p)).join('');

        // Bold italic (*** must come before **)
        str = str.replace(/\*\*\*(.+?)\*\*\*/gs, '<strong><em>$1</em></strong>');
        str = str.replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>');
        str = str.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');

        // Underline (__text__)
        str = str.replace(/__(.+?)__/gs, '<u>$1</u>');

        // Italic underscore — only when not adjacent to word chars or underscores
        str = str.replace(/(?<![_\w])_([^_\n]+?)_(?![_\w])/g, '<em>$1</em>');

        // Strikethrough
        str = str.replace(/~~(.+?)~~/gs, '<s>$1</s>');

        // Spoiler — protect so inner HTML isn't re-processed
        str = str.replace(/\|\|(.+?)\|\|/gs, (_, c) =>
            protect(`<span class="msg-spoiler" onclick="this.classList.toggle('revealed')" title="Click to reveal spoiler">${c}</span>`)
        );

        // Masked links [text](url) — https only
        str = str.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g,
            (_, t, u) => protect(`<a href="${_esc(u)}" target="_blank" rel="noopener noreferrer">${t}</a>`)
        );

        // Emoji shortcodes, URL linkification, @mentions
        str = parseEmojiShortcodes(str);
        str = linkifyUrls(str);
        str = highlightMentions(str);

        return str;
    }

    // 3. Block-level elements — processed line by line
    const lines = s.split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
        const ln = lines[i];

        // Blockquote — collect consecutive > lines into one block
        if (ln.startsWith('> ') || ln === '>') {
            const qls = [];
            while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
                qls.push(lines[i].replace(/^> ?/, ''));
                i++;
            }
            const inner = applyInline(qls.join('\n')).replace(/\n/g, '<br>');
            out.push(protect(
                `<div class="msg-blockquote"><div class="msg-bq-bar"></div>` +
                `<div class="msg-bq-text">${inner}</div></div>`
            ));
            continue;
        }

        // Headers
        if (ln.startsWith('### ')) { out.push(protect(`<h3 class="msg-h3">${applyInline(ln.slice(4))}</h3>`)); i++; continue; }
        if (ln.startsWith('## '))  { out.push(protect(`<h2 class="msg-h2">${applyInline(ln.slice(3))}</h2>`)); i++; continue; }
        if (ln.startsWith('# '))   { out.push(protect(`<h1 class="msg-h1">${applyInline(ln.slice(2))}</h1>`)); i++; continue; }

        // Subtext (-# text)
        if (ln.startsWith('-# '))  { out.push(protect(`<span class="msg-subtext">${applyInline(ln.slice(3))}</span>`)); i++; continue; }

        // Unordered list (- item or * item)
        if (/^[*-] /.test(ln)) {
            const items = [];
            while (i < lines.length && /^[*-] /.test(lines[i])) {
                items.push(`<li>${applyInline(lines[i].slice(2))}</li>`);
                i++;
            }
            out.push(protect(`<ul class="msg-list">${items.join('')}</ul>`));
            continue;
        }

        // Ordered list (1. 2. etc.)
        if (/^\d+\. /.test(ln)) {
            const items = [];
            while (i < lines.length && /^\d+\. /.test(lines[i])) {
                items.push(`<li>${applyInline(lines[i].replace(/^\d+\. /, ''))}</li>`);
                i++;
            }
            out.push(protect(`<ol class="msg-list">${items.join('')}</ol>`));
            continue;
        }

        // Regular line — apply inline formatting only
        out.push(applyInline(ln));
        i++;
    }

    s = out.join('\n');

    // 4. Remaining newlines to <br>
    s = s.replace(/\n/g, '<br>');

    // 5. Restore all protected slots
    s = restore(s);

    return s;
}

// ── Emoji shortcode rendering ─────────────────────────────────────────────────

function parseEmojiShortcodes(html) {
    return html.replace(/:(\w+):/g, (match, name) => {
        // Current server emoji takes priority
        if (typeof serverEmojis !== 'undefined' && serverEmojis.server) {
            const custom = serverEmojis.server.find(e => e.name === name);
            if (custom) {
                return `<img src="/img/emoji/${custom.server_id}/${custom.filename}" class="inline-emoji" alt=":${name}:" title=":${name}:">`;
            }
        }
        // Cross-server emoji lookup across all joined servers.
        // TODO (Ascendent): gate cross-server lookup behind subscription check before launch.
        if (typeof _allServerEmojis !== 'undefined') {
            for (const [sId, sData] of _allServerEmojis) {
                const cross = (sData.emoji || []).find(e => e.name === name);
                if (cross) {
                    return `<img src="/img/emoji/${sId}/${cross.filename}" class="inline-emoji" alt=":${name}:" title=":${name}:">`;
                }
            }
        }
        // Unicode shortcode lookup
        if (typeof EMOJI_SHORTCODES !== 'undefined') {
            const char = EMOJI_SHORTCODES[name];
            if (char) return `<span class="emoji-char">${char}</span>`;
        }
        return match; // leave unknown shortcodes as-is
    });
}

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

    const messageContent = message.content ? parseMarkdown(message.content) : '';
    const editedTag = message.edited_at ? ' <span class="edited-tag">(edited)</span>' : '';
    const pinIcon = message.is_pinned ? ' <span class="pin-indicator" title="Pinned message">📌</span>' : '';
    const isMentioned = parseMentions(message.content);
    const reactionsHTML = message.reactions ? renderReactions(message.reactions, message.id) : '';

    const authorColor = roleColorMap[message.user_id] ? ` style="color:${roleColorMap[message.user_id]}"` : '';
    const authorName = nicknameMap[message.user_id] || message.username;
    const authorAvatar = avatarMap[message.user_id]
        ? `<img src="${avatarMap[message.user_id]}" alt="${authorName}" class="message-av-img" onclick="openProfileModal('${message.user_id}')" style="cursor:pointer">`
        : `<div class="message-avatar" onclick="openProfileModal('${message.user_id}')" style="cursor:pointer">${getInitials(authorName)}</div>`;

    if (showHeader) {
        return `
        <div class="message${isMentioned ? ' mention-highlight' : ''}${message.is_pinned ? ' pinned-message' : ''}" data-message-id="${message.id}">
          <div class="message-header">
            ${authorAvatar}
            <span class="message-author"${authorColor} onclick="openProfileModal('${message.user_id}')" style="cursor:pointer">${authorName}</span>
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

// ── Divider helpers ───────────────────────────────────────────────────────────

function _formatDividerDate(dateStr) {
    const d = new Date(dateStr);
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const day = d.getDate();
    const suffix = (day === 1 || day === 21 || day === 31) ? 'st'
                 : (day === 2 || day === 22)               ? 'nd'
                 : (day === 3 || day === 23)               ? 'rd' : 'th';
    return `${months[d.getMonth()]} ${day}${suffix}, ${d.getFullYear()}`;
}

function _sameDayStr(a, b) {
    return new Date(a).toDateString() === new Date(b).toDateString();
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

    let listHtml = '';
    let lastDateStr = null;
    const firstUnreadId = state.firstUnreadMessageId;

    for (let i = 0; i < state.messages.length; i++) {
        const message = state.messages[i];
        const prevMessage = i > 0 ? state.messages[i - 1] : null;

        const msgDateStr = new Date(message.created_at).toDateString();
        if (msgDateStr !== lastDateStr) {
            lastDateStr = msgDateStr;
            listHtml += `<div class="msg-divider-date"><span>${_formatDividerDate(message.created_at)}</span></div>`;
        }

        if (firstUnreadId && message.id === firstUnreadId) {
            listHtml += `<div class="msg-divider-new" id="newMsgDivider"><span>New Messages</span></div>`;
        }

        listHtml += buildMessageHTML(message, prevMessage, lookups);
    }

    container.innerHTML =
        (state.hasMoreMessages
            ? '<div class="load-more-spinner" id="loadMoreSpinner">Loading earlier messages...</div>'
            : '<div class="load-more-end" id="loadMoreEnd">Beginning of channel history</div>') +
        listHtml;

    // Restore scroll position after prepending older messages
    if (prevTop < 200) {
        container.scrollTop = container.scrollHeight - prevHeight + prevTop;
    }

    state.messages.forEach(message => {
        const el = container.querySelector(`[data-message-id="${message.id}"]`);
        if (el) attachMessageContextMenu(el, message);
    });

    if (clientHasPermission(CLIENT_PERMS.EMBED_LINKS)) {
        state.messages.forEach(message => {
            if (!message.content || message.embed_suppressed) return;
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

    // Date divider if the new message is on a different day
    if (prevMessage && !_sameDayStr(message.created_at, prevMessage.created_at)) {
        const dateDivEl = document.createElement('div');
        dateDivEl.className = 'msg-divider-date';
        dateDivEl.innerHTML = `<span>${_formatDividerDate(message.created_at)}</span>`;
        container.appendChild(dateDivEl);
    }

    const temp = document.createElement('div');
    temp.innerHTML = buildMessageHTML(message, prevMessage, lookups).trim();
    const el = temp.firstElementChild;
    container.appendChild(el);

    attachMessageContextMenu(el, message);

    if (clientHasPermission(CLIENT_PERMS.EMBED_LINKS) && message.content && !message.embed_suppressed) {
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

// ── Embed suppression ─────────────────────────────────────────────────────────

window.suppressEmbed = async function(messageId) {
    try {
        const res = await fetch(`/api/messages/${messageId}/embed`, {
            method: 'PATCH',
            credentials: 'include',
        });
        if (res.ok) {
            const msg = state.messages.find(m => m.id === messageId);
            if (msg) msg.embed_suppressed = true;
            const slot = document.querySelector(`[data-embed-id="${messageId}"]`);
            if (slot) { slot.innerHTML = ''; delete slot.dataset.embedLoaded; }
        }
    } catch (err) {
        console.error('suppressEmbed error:', err);
    }
};

function _maybeAddEmbedDismiss(slot, message) {
    if (!state.currentUser || message.user_id !== state.currentUser.id) return;
    const btn = document.createElement('button');
    btn.className = 'embed-dismiss-btn';
    btn.title = 'Remove embed';
    btn.textContent = '✕';
    btn.onclick = (e) => { e.stopPropagation(); suppressEmbed(message.id); };
    slot.appendChild(btn);
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

// Replaces a click-to-play preview card with the live iframe.
window.playEmbedVideo = function(el) {
    const src = el.dataset.embedSrc;
    if (!src) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'msg-embed-video-wrapper';
    wrapper.innerHTML = `<iframe src="${src}" allow="autoplay; accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="eager"></iframe>`;
    el.replaceWith(wrapper);
};

function videoPreviewCard(thumbUrl, embedSrc, title, metaText, linkUrl) {
    const infoHtml = (title || metaText) ? `
        <div class="msg-embed-video-info">
            ${title ? `<a class="msg-embed-video-title" href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${escapeHtml(title)}</a>` : ''}
            ${metaText ? `<div class="msg-embed-video-meta">${escapeHtml(metaText)}</div>` : ''}
        </div>` : '';
    return `
        <div class="msg-embed-video-preview" data-embed-src="${escapeHtml(embedSrc)}" onclick="playEmbedVideo(this)">
            <div class="msg-embed-video-thumb">
                <img src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" onerror="this.closest('.msg-embed-video-thumb').style.background='#111'">
                <div class="msg-embed-play-btn"></div>
            </div>
            ${infoHtml}
        </div>`;
}

async function injectEmbed(message, slot) {
    if (message.embed_suppressed) return;
    slot.dataset.embedLoaded = 'true';

    const urlMatch = message.content.match(/https:\/\/[^\s<>"]+/);
    if (!urlMatch) return;

    const url = urlMatch[0];

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
            _maybeAddEmbedDismiss(slot, message);
        } catch { /* silent */ }
        return;
    }

    // ── Direct image / video URLs ─────────────────────────────────────────────
    const isImageUrl = _IMAGE_URL_RE.test(url);
    const isVideoUrl = /\.(mp4|webm|mov|ogg)(\?.*)?$/i.test(url);

    // Images are rendered inline by linkifyUrls — skip embed slot
    if (isImageUrl) return;

    // Skip video if already rendered as an attachment
    if (isVideoUrl && message.attachments?.length) return;

    if (isVideoUrl) {
        if (!document.contains(slot)) return;
        slot.innerHTML = `<video class="msg-embed-direct-video" src="${escapeHtml(url)}" controls preload="metadata"></video>`;
        _maybeAddEmbedDismiss(slot, message);
        return;
    }

    // ── YouTube ────────────────────────────────────────────────────────────────
    const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
        const videoId = ytMatch[1];
        const isShort = url.includes('/shorts/');
        const thumbUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        const embedSrc = `https://www.youtube.com/embed/${videoId}?autoplay=1`;

        let title = '', meta = `YouTube${isShort ? ' Short' : ''}`;
        try {
            const res = await fetch(`/api/embed/oembed?url=${encodeURIComponent(url)}`, { credentials: 'include' });
            if (res.ok) {
                const d = await res.json();
                title = d.title || '';
                if (d.author_name) meta = `YouTube${isShort ? ' Short' : ''} · ${d.author_name}`;
            }
        } catch { /* use defaults */ }

        if (!document.contains(slot)) return;
        slot.innerHTML = videoPreviewCard(thumbUrl, embedSrc, title, meta, url);
        _maybeAddEmbedDismiss(slot, message);
        return;
    }

    // ── Twitch ─────────────────────────────────────────────────────────────────
    const parent = encodeURIComponent(window.location.hostname);

    const twitchVodMatch = url.match(/twitch\.tv\/videos\/(\d+)/);
    if (twitchVodMatch) {
        const embedSrc = `https://player.twitch.tv/?video=${twitchVodMatch[1]}&parent=${parent}&autoplay=true`;
        let title = '', meta = 'Twitch VOD', thumbUrl = '';
        const ogData = await fetchEmbed(url);
        if (ogData) {
            title = ogData.title || '';
            thumbUrl = ogData.image || '';
            if (ogData.description) meta = `Twitch VOD · ${ogData.description.slice(0, 80)}`;
        }
        if (!document.contains(slot)) return;
        slot.innerHTML = thumbUrl
            ? videoPreviewCard(thumbUrl, embedSrc, title, meta, url)
            : `<div class="msg-embed-video-wrapper"><iframe src="${embedSrc}" allowfullscreen loading="lazy"></iframe></div>`;
        _maybeAddEmbedDismiss(slot, message);
        return;
    }

    const twitchClipMatch = url.match(/(?:clips\.twitch\.tv\/|twitch\.tv\/\w+\/clip\/)([a-zA-Z0-9_-]+)/);
    if (twitchClipMatch) {
        const embedSrc = `https://clips.twitch.tv/embed?clip=${twitchClipMatch[1]}&parent=${parent}&autoplay=true`;
        let title = '', meta = 'Twitch Clip', thumbUrl = '';
        const ogData = await fetchEmbed(url);
        if (ogData) {
            title = ogData.title || '';
            thumbUrl = ogData.image || '';
            if (ogData.description) meta = `Twitch Clip · ${ogData.description.slice(0, 80)}`;
        }
        if (!document.contains(slot)) return;
        slot.innerHTML = thumbUrl
            ? videoPreviewCard(thumbUrl, embedSrc, title, meta, url)
            : `<div class="msg-embed-video-wrapper"><iframe src="${embedSrc}" allowfullscreen loading="lazy"></iframe></div>`;
        _maybeAddEmbedDismiss(slot, message);
        return;
    }

    const twitchStreamMatch = url.match(/twitch\.tv\/([a-zA-Z0-9_]+)\/?(?:\?.*)?$/);
    if (twitchStreamMatch) {
        const channel = twitchStreamMatch[1];
        const embedSrc = `https://player.twitch.tv/?channel=${channel}&parent=${parent}&autoplay=true`;
        let title = '', meta = 'Twitch', thumbUrl = '';
        const ogData = await fetchEmbed(url);
        if (ogData) {
            title = ogData.title || '';
            thumbUrl = ogData.image || '';
            // og:description on Twitch stream pages often contains viewer count and category
            meta = ogData.description ? ogData.description.slice(0, 80) : 'Twitch';
        }
        if (!document.contains(slot)) return;
        slot.innerHTML = thumbUrl
            ? videoPreviewCard(thumbUrl, embedSrc, title, meta, url)
            : `<div class="msg-embed-video-wrapper"><iframe src="${embedSrc}" allowfullscreen loading="lazy"></iframe></div>`;
        _maybeAddEmbedDismiss(slot, message);
        return;
    }

    // ── Spotify ────────────────────────────────────────────────────────────────
    const spotifyMatch = url.match(/open\.spotify\.com\/(track|album|playlist|artist|episode|show)\/([a-zA-Z0-9]+)/);
    if (spotifyMatch) {
        const [, type, id] = spotifyMatch;
        const isTall = ['album', 'playlist', 'artist', 'show'].includes(type);
        if (!document.contains(slot)) return;
        slot.innerHTML = `
            <div class="msg-embed-spotify${isTall ? ' tall' : ''}">
                <iframe src="https://open.spotify.com/embed/${type}/${id}"
                    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                    loading="lazy"></iframe>
            </div>`;
        _maybeAddEmbedDismiss(slot, message);
        return;
    }

    // ── SoundCloud ─────────────────────────────────────────────────────────────
    if (/soundcloud\.com\/[^?]+/.test(url)) {
        try {
            const res = await fetch(`/api/embed/oembed?url=${encodeURIComponent(url)}`, { credentials: 'include' });
            if (res.ok) {
                const d = await res.json();
                if (d.html && document.contains(slot)) {
                    slot.innerHTML = `<div class="msg-embed-soundcloud">${d.html}</div>`;
                    _maybeAddEmbedDismiss(slot, message);
                }
            }
        } catch { /* silent */ }
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
    _maybeAddEmbedDismiss(slot, message);
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
    if (!container) return;

    // Clear unread + remove new messages divider when user reaches the bottom
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    if (atBottom && state.currentChannel && typeof _clearChannelUnreadIfNeeded === 'function') {
        _clearChannelUnreadIfNeeded(state.currentChannel.id);
    }

    if (!state.hasMoreMessages || state.isLoadingMessages) return;
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

const _IMAGE_URL_RE = /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?[^\s<>"\x00]*)?$/i;

function linkifyUrls(html) {
    // Image URLs become inline <img> (replacing the link text entirely).
    // All other https:// URLs become clickable anchors.
    // Stops at whitespace, HTML delimiters, or \x00 (placeholder sentinel).
    return html.replace(
        /(https:\/\/[^\s<>"\x00]+)/g,
        (url) => {
            if (_IMAGE_URL_RE.test(url)) {
                return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="msg-image-link">` +
                    `<img class="msg-inline-image" src="${url}" alt="" loading="lazy" ` +
                    `onerror="this.closest('.msg-image-link').style.display='none'"></a>`;
            }
            return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        }
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
