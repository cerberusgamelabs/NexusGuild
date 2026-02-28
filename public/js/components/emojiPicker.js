// File Location: /public/js/components/emojiPicker.js

/**
 * Emoji Picker Component
 * Shared panel for both message reactions and message input insertion.
 */

let currentEmojiPickerMessageId = null;
let currentEmojiPickerDmId = null;
let serverEmojis = { global: [], server: [] };

// 'input' = insert :shortcode: into textarea (stays open)
// 'reaction' = add reaction to message (closes on pick)
let _iepMode = 'input';
let _iepCatIdx = 0;

// ── Shared HTML builder ───────────────────────────────────────────────────────

function _buildPickerHTML() {
    const hasServer = serverEmojis.server && serverEmojis.server.length > 0;
    const tabs = [];
    if (hasServer) {
        tabs.push(`<button class="iep-tab${_iepCatIdx === -1 ? ' active' : ''}" title="Server Emoji" onmousedown="event.preventDefault();_switchEmojiCategory(-1)">⭐</button>`);
    }
    if (typeof EMOJI_DATA !== 'undefined') {
        EMOJI_DATA.forEach((cat, i) => {
            const icon = cat.emoji[0] ? cat.emoji[0].char : '?';
            const active = (_iepCatIdx === i) ? ' active' : '';
            tabs.push(`<button class="iep-tab${active}" title="${cat.name}" onmousedown="event.preventDefault();_switchEmojiCategory(${i})">${icon}</button>`);
        });
    }
    return `
        <div class="iep-search"><input id="iepSearch" type="text" placeholder="Search emoji..." oninput="_filterEmojiPicker(this.value)"></div>
        <div class="iep-body">
            <div class="iep-tabs">${tabs.join('')}</div>
            <div class="iep-grid-wrap" id="iepGridWrap"></div>
        </div>
    `;
}

function _renderIepGrid() {
    const wrap = document.getElementById('iepGridWrap');
    if (!wrap) return;

    if (_iepCatIdx === -1) {
        const btns = (serverEmojis.server || []).map(e =>
            `<button class="iep-btn" title=":${e.name}:" onmousedown="insertEmojiFromPicker('${e.name}',event,'${e.server_id}')"><img src="/img/emoji/${e.server_id}/${e.filename}" alt="${e.name}"></button>`
        ).join('');
        wrap.innerHTML = `<div class="iep-section-label">Server Emoji</div><div class="iep-grid">${btns}</div>`;
    } else if (typeof EMOJI_DATA !== 'undefined' && EMOJI_DATA[_iepCatIdx]) {
        const cat = EMOJI_DATA[_iepCatIdx];
        const btns = cat.emoji.map(e =>
            `<button class="iep-btn" title=":${e.name}:" onmousedown="insertEmojiFromPicker('${e.name}',event)">${e.char}</button>`
        ).join('');
        wrap.innerHTML = `<div class="iep-section-label">${cat.name}</div><div class="iep-grid">${btns}</div>`;
    }
}

function _switchEmojiCategory(idx) {
    _iepCatIdx = idx;
    const wrap = document.getElementById('iepGridWrap');
    if (!wrap) return;
    const picker = wrap.closest('#inputEmojiPicker, #emojiPickerModal');
    if (picker) {
        picker.querySelectorAll('.iep-tab').forEach(btn => btn.classList.remove('active'));
        const tabs = picker.querySelectorAll('.iep-tab');
        const hasServer = serverEmojis.server && serverEmojis.server.length > 0;
        const tabIdx = hasServer ? (idx === -1 ? 0 : idx + 1) : idx;
        if (tabs[tabIdx]) tabs[tabIdx].classList.add('active');
    }
    const searchEl = document.getElementById('iepSearch');
    if (searchEl) searchEl.value = '';
    _renderIepGrid();
}

function _filterEmojiPicker(query) {
    const wrap = document.getElementById('iepGridWrap');
    if (!wrap) return;

    if (!query.trim()) { _renderIepGrid(); return; }

    const lower = query.toLowerCase();
    let btns = [];

    if (typeof EMOJI_SHORTCODES !== 'undefined') {
        let count = 0;
        for (const [name, char] of Object.entries(EMOJI_SHORTCODES)) {
            if (count >= 80) break;
            if (name.includes(lower)) {
                btns.push(`<button class="iep-btn" title=":${name}:" onmousedown="insertEmojiFromPicker('${name}',event)">${char}</button>`);
                count++;
            }
        }
    }

    if (serverEmojis.server) {
        for (const e of serverEmojis.server) {
            if (e.name.includes(lower)) {
                btns.push(`<button class="iep-btn" title=":${e.name}:" onmousedown="insertEmojiFromPicker('${e.name}',event,'${e.server_id}')"><img src="/img/emoji/${e.server_id}/${e.filename}" alt="${e.name}"></button>`);
            }
        }
    }

    const picker = wrap.closest('#inputEmojiPicker, #emojiPickerModal');
    if (picker) picker.querySelectorAll('.iep-tab').forEach(btn => btn.classList.remove('active'));

    wrap.innerHTML = btns.length
        ? `<div class="iep-grid">${btns.join('')}</div>`
        : `<div class="iep-section-label" style="padding:16px 8px;text-align:center;">No results</div>`;
}

function insertEmojiFromPicker(name, event, serverId) {
    if (event) event.preventDefault();

    if (_iepMode === 'reaction') {
        const emoji = serverId
            ? `custom:${serverId}:${name}`
            : (typeof EMOJI_SHORTCODES !== 'undefined' && EMOJI_SHORTCODES[name] ? EMOJI_SHORTCODES[name] : name);
        selectEmoji(emoji); // selectEmoji closes the picker
        return;
    }

    // input mode — insert :shortcode: at cursor, keep picker open
    const textarea = document.getElementById('messageInput');
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const val = textarea.value;
    const insert = `:${name}: `;
    textarea.value = val.slice(0, start) + insert + val.slice(end);
    const cursor = start + insert.length;
    textarea.selectionStart = textarea.selectionEnd = cursor;
    textarea.focus();
    textarea.dispatchEvent(new Event('input'));
}

// ── Reaction picker (emojiPickerModal) ───────────────────────────────────────

async function showEmojiPickerAt(messageId, x, y, dmId = null) {
    currentEmojiPickerMessageId = messageId;
    currentEmojiPickerDmId = dmId;
    _iepMode = 'reaction';
    _iepCatIdx = 0;

    if (state.currentServer && serverEmojis.server.length === 0) {
        await loadServerEmojis(state.currentServer.id);
    }

    const picker = document.getElementById('emojiPickerModal');
    picker.innerHTML = _buildPickerHTML();
    _renderIepGrid();

    // Position near cursor, stay within viewport
    const pickerW = 380, pickerH = 420;
    const left = Math.max(0, Math.min(x, window.innerWidth - pickerW - 10));
    const top = (y + pickerH > window.innerHeight) ? Math.max(0, y - pickerH) : y;
    picker.style.left = `${left}px`;
    picker.style.top = `${top}px`;
    picker.style.display = 'flex';
}

async function selectEmoji(emoji) {
    if (!currentEmojiPickerMessageId) return;
    const msgId = currentEmojiPickerMessageId;
    const dmId = currentEmojiPickerDmId;
    const url = dmId
        ? `/api/dm/${dmId}/messages/${msgId}/reactions`
        : `/api/reactions/messages/${msgId}/reactions`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ emoji })
        });
        const data = await response.json();
        if (!response.ok) {
            if (data.error === 'You already reacted with this emoji') {
                await fetch(url, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ emoji })
                });
            } else {
                console.error('Failed to add reaction:', data.error);
            }
        }
        closeEmojiPicker();
    } catch (error) {
        console.error('Error adding reaction:', error);
    }
}

async function removeReaction(messageId, emoji) {
    try {
        const response = await fetch(`/api/reactions/messages/${messageId}/reactions`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ emoji })
        });
        if (!response.ok) {
            const data = await response.json();
            console.error('Failed to remove reaction:', data.error);
        }
    } catch (error) {
        console.error('Error removing reaction:', error);
    }
}

async function loadServerEmojis(serverId) {
    try {
        const response = await fetch(`/api/reactions/servers/${serverId}/emojis`, {
            credentials: 'include'
        });
        if (response.ok) {
            serverEmojis = await response.json();
        }
    } catch (error) {
        console.error('Error loading server emojis:', error);
    }
}

function closeEmojiPicker() {
    const picker = document.getElementById('emojiPickerModal');
    picker.style.display = 'none';
    currentEmojiPickerMessageId = null;
    currentEmojiPickerDmId = null;
    _iepMode = 'input';
}

// ── Input emoji picker (inputEmojiPicker) ─────────────────────────────────────

function toggleInputEmojiPicker() {
    const iep = document.getElementById('inputEmojiPicker');
    if (iep.style.display !== 'none') {
        closeInputEmojiPicker();
    } else {
        _iepMode = 'input';
        iep.innerHTML = _buildPickerHTML();
        _renderIepGrid();
        iep.style.display = 'flex';
    }
}

function closeInputEmojiPicker() {
    const iep = document.getElementById('inputEmojiPicker');
    if (iep) iep.style.display = 'none';
    _iepCatIdx = 0;
}

// ── Click-outside handler ─────────────────────────────────────────────────────

document.addEventListener('click', (e) => {
    const picker = document.getElementById('emojiPickerModal');
    const emojiButton = e.target.closest('.message-emoji-btn');
    if (picker && picker.style.display === 'flex' && !picker.contains(e.target) && !emojiButton) {
        closeEmojiPicker();
    }

    const iep = document.getElementById('inputEmojiPicker');
    const iepBtn = document.getElementById('inputEmojiBtn');
    if (iep && iep.style.display !== 'none' && !iep.contains(e.target) && e.target !== iepBtn && !iepBtn.contains(e.target)) {
        closeInputEmojiPicker();
    }
});
