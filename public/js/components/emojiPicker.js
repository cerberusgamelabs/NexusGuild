// File Location: /public/js/components/emojiPicker.js

/**
 * Emoji Picker Component
 * Shared panel for both message reactions and message input insertion.
 */

let currentEmojiPickerMessageId = null;
let currentEmojiPickerDmId = null;
let serverEmojis = { global: [], server: [] };

// TODO (Ascendent): Cross-server emoji tabs below show emoji from all joined servers.
// Before launch, gate _allServerEmojis loading and tab rendering behind a subscription
// flag (e.g. state.currentUser.is_ascendent). Non-subscribers should only see the
// current server's emoji tab.
const _allServerEmojis = new Map(); // Map<serverId, { serverName, emoji[] }>

// _iepServerTabs: populated in _buildPickerHTML(), maps negative catIdx → server data
const _iepServerTabs = [];

// 'input' = insert :shortcode: into textarea (stays open)
// 'reaction' = add reaction to message (closes on pick)
let _iepMode = 'input';
let _iepCatIdx = 0;

// ── Shared HTML builder ───────────────────────────────────────────────────────

function _buildPickerHTML() {
    // Reset server tabs list
    _iepServerTabs.length = 0;
    const tabs = [];

    // One tab per server that has emoji — placed ABOVE base emoji categories.
    // TODO (Ascendent): gate this block behind subscription check before launch.
    let serverTabOffset = 0;
    for (const [sId, sData] of _allServerEmojis) {
        if (!sData.emoji || sData.emoji.length === 0) continue;
        const catIdx = -(serverTabOffset + 1); // -1, -2, -3, ...
        _iepServerTabs.push({ catIdx, serverId: sId, serverName: sData.serverName });
        const firstEmoji = sData.emoji[0];
        const safeServerName = sData.serverName.replace(/"/g, '&quot;').replace(/</g, '&lt;');
        const iconHtml = `<img src="/img/emoji/${sId}/${firstEmoji.filename}" style="width:18px;height:18px;object-fit:contain;border-radius:2px;" alt="">`;
        tabs.push(`<button class="iep-tab${_iepCatIdx === catIdx ? ' active' : ''}" data-tab-idx="${catIdx}" title="${safeServerName}" onmousedown="event.preventDefault();_switchEmojiCategory(${catIdx})">${iconHtml}</button>`);
        serverTabOffset++;
    }

    if (typeof EMOJI_DATA !== 'undefined') {
        EMOJI_DATA.forEach((cat, i) => {
            const icon = cat.emoji[0] ? cat.emoji[0].char : '?';
            const active = (_iepCatIdx === i) ? ' active' : '';
            tabs.push(`<button class="iep-tab${active}" data-tab-idx="${i}" title="${cat.name}" onmousedown="event.preventDefault();_switchEmojiCategory(${i})">${icon}</button>`);
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

    if (_iepCatIdx < 0) {
        // Server emoji tab
        const tabData = _iepServerTabs.find(t => t.catIdx === _iepCatIdx);
        if (!tabData) { wrap.innerHTML = ''; return; }
        const sData = _allServerEmojis.get(tabData.serverId);
        if (!sData) { wrap.innerHTML = ''; return; }
        const btns = (sData.emoji || []).map(e =>
            `<button class="iep-btn" title=":${e.name}:" onmousedown="insertEmojiFromPicker('${e.name}',event,'${tabData.serverId}')"><img src="/img/emoji/${tabData.serverId}/${e.filename}" alt="${e.name}"></button>`
        ).join('');
        const label = (tabData.serverName || 'Server').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        wrap.innerHTML = `<div class="iep-section-label">${label}</div><div class="iep-grid">${btns || '<span style="color:#949ba4;padding:8px;">No emoji</span>'}</div>`;
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
        const target = picker.querySelector(`.iep-tab[data-tab-idx="${idx}"]`);
        if (target) target.classList.add('active');
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

    // TODO (Ascendent): gate cross-server search behind subscription check before launch.
    for (const [sId, sData] of _allServerEmojis) {
        for (const e of (sData.emoji || [])) {
            if (e.name.includes(lower)) {
                btns.push(`<button class="iep-btn" title=":${e.name}:" onmousedown="insertEmojiFromPicker('${e.name}',event,'${sId}')"><img src="/img/emoji/${sId}/${e.filename}" alt="${e.name}"></button>`);
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

    if (state.currentServer && !_allServerEmojis.has(state.currentServer.id)) {
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

    // Defer display to next macrotask so the click event that opened the picker
    // has fully propagated (including the click-outside close handler) before
    // we make it visible. Without this, the picker opens and is immediately
    // closed by the document-level click handler on the same event.
    setTimeout(() => { picker.style.display = 'flex'; }, 0);
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
            const data = await response.json();
            // Keep backward-compat alias for the current server
            if (serverId === state.currentServer?.id) {
                serverEmojis = data;
            }
            // Always update the all-server map for cross-server tabs and shortcodes
            const serverName = state.servers?.find(s => s.id === serverId)?.name || serverId;
            _allServerEmojis.set(serverId, { serverName, emoji: data.server || [] });
        }
    } catch (error) {
        console.error('Error loading server emojis:', error);
    }
}

// Load emoji for all joined servers (called after loadUserServers).
// TODO (Ascendent): Before launch, gate this behind a subscription flag so
// non-subscribers only load/see emoji for their current server.
async function loadAllServerEmojis() {
    if (!state.servers?.length) return;
    await Promise.all(state.servers.map(s => loadServerEmojis(s.id)));
}

function closeEmojiPicker() {
    const picker = document.getElementById('emojiPickerModal');
    if (picker) { picker.style.display = 'none'; picker.innerHTML = ''; }
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
    if (iep) { iep.style.display = 'none'; iep.innerHTML = ''; }
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
