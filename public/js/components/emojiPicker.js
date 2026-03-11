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
let _iepMode    = 'input';
let _iepTopMode = 'emoji'; // 'emoji' | 'gif' — top-level tab (input picker only)
let _iepCatIdx  = 0;       // emoji category index (negative = server emoji)
let _iepGifCat  = 'trending'; // active gif category key

const GIF_CATEGORIES = [
    { key: 'trending',  label: 'Trending'  },
    { key: 'reactions', label: 'Reactions' },
    { key: 'memes',     label: 'Memes'     },
    { key: 'gaming',    label: 'Gaming'    },
    { key: 'anime',     label: 'Anime'     },
    { key: 'sports',    label: 'Sports'    },
];

// ── GIF helpers ───────────────────────────────────────────────────────────────

let _gifSearchTimer   = null;
let _gifStyleInjected = false;

function _injectGifStyles() {
    if (_gifStyleInjected) return;
    _gifStyleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
        .iep-top-tabs {
            display: flex;
            border-bottom: 1px solid var(--border-color, #3f4147);
            margin-bottom: 4px;
        }
        .iep-top-tab {
            flex: 1;
            padding: 6px 0;
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            color: var(--text-muted, #949ba4);
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: color 0.15s, border-color 0.15s;
        }
        .iep-top-tab:hover { color: var(--text-color, #dbdee1); }
        .iep-top-tab.active {
            color: var(--text-color, #dbdee1);
            border-bottom-color: var(--accent, #5865f2);
        }
        .iep-gif-cats {
            display: flex;
            gap: 4px;
            flex-wrap: wrap;
            padding: 2px 0 6px;
        }
        .iep-gif-cat {
            padding: 3px 10px;
            border-radius: 12px;
            border: 1px solid var(--border-color, #3f4147);
            background: none;
            color: var(--text-muted, #949ba4);
            font-size: 12px;
            cursor: pointer;
            transition: background 0.1s, color 0.1s;
        }
        .iep-gif-cat:hover { background: var(--hover-bg, #2e3035); color: var(--text-color, #dbdee1); }
        .iep-gif-cat.active {
            background: var(--accent, #5865f2);
            border-color: var(--accent, #5865f2);
            color: #fff;
        }
        .iep-gif-search {
            width: 100%;
            box-sizing: border-box;
            padding: 6px 8px;
            margin-bottom: 6px;
            background: var(--input-bg, #1e1f22);
            border: 1px solid var(--border-color, #3f4147);
            border-radius: 4px;
            color: var(--text-color, #dbdee1);
            font-size: 13px;
            outline: none;
        }
        .iep-gif-search:focus { border-color: var(--accent, #5865f2); }
        .iep-gif-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 4px;
            overflow-y: auto;
            max-height: 260px;
        }
        .iep-gif-item {
            border-radius: 4px;
            overflow: hidden;
            cursor: pointer;
            line-height: 0;
        }
        .iep-gif-item:hover { opacity: 0.8; }
        .iep-gif-item img {
            width: 100%;
            height: auto;
            display: block;
            border-radius: 4px;
            cursor: pointer;
        }
        .iep-gif-status {
            grid-column: span 2;
            text-align: center;
            padding: 16px 8px;
            color: var(--text-muted, #949ba4);
            font-size: 13px;
        }
    `;
    document.head.appendChild(style);
}

async function _loadGifs(query) {
    const grid = document.getElementById('iepGifGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="iep-gif-status">Loading…</div>';
    try {
        let endpoint;
        if (query.trim()) {
            endpoint = `/api/giphy?q=${encodeURIComponent(query.trim())}`;
        } else if (_iepGifCat === 'trending') {
            endpoint = '/api/giphy/trending';
        } else {
            endpoint = `/api/giphy?q=${encodeURIComponent(_iepGifCat)}`;
        }
        const res = await fetch(endpoint, { credentials: 'include' });
        if (!res.ok) { grid.innerHTML = '<div class="iep-gif-status">Failed to load GIFs.</div>'; return; }
        const gifs = await res.json();
        if (!Array.isArray(gifs) || !gifs.length) { grid.innerHTML = '<div class="iep-gif-status">No results.</div>'; return; }
        grid.innerHTML = gifs.map(g => {
            const safeUrl   = g.url.replace(/'/g, '%27');
            const safeTitle = (g.title || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
            return `<div class="iep-gif-item" onmousedown="event.preventDefault();_insertGif('${safeUrl}')">` +
                       `<img src="${safeUrl}" alt="${safeTitle}" loading="lazy">` +
                   `</div>`;
        }).join('');
    } catch {
        const g2 = document.getElementById('iepGifGrid');
        if (g2) g2.innerHTML = '<div class="iep-gif-status">Error loading GIFs.</div>';
    }
}

function _onGifSearchInput(value) {
    clearTimeout(_gifSearchTimer);
    _gifSearchTimer = setTimeout(() => _loadGifs(value), 400);
}

function _switchGifCategory(key) {
    _iepGifCat = key;
    document.querySelectorAll('.iep-gif-cat').forEach(b => b.classList.toggle('active', b.dataset.gifCat === key));
    const searchEl = document.getElementById('iepGifSearch');
    if (searchEl) searchEl.value = '';
    _loadGifs('');
}

function _insertGif(url) {
    if (_iepMode === 'reaction') { closeEmojiPicker(); return; }
    const textarea = document.getElementById('messageInput');
    if (textarea) {
        const start  = textarea.selectionStart;
        const end    = textarea.selectionEnd;
        const insert = url + ' ';
        textarea.value = textarea.value.slice(0, start) + insert + textarea.value.slice(end);
        textarea.selectionStart = textarea.selectionEnd = start + insert.length;
        textarea.focus();
        textarea.dispatchEvent(new Event('input'));
    }
    closeInputEmojiPicker();
}

// ── Top-mode switcher (Emoji ↔ GIF) ──────────────────────────────────────────

function _switchTopMode(mode) {
    _iepTopMode = mode;
    document.querySelectorAll('.iep-top-tab').forEach(b => b.classList.toggle('active', b.dataset.topMode === mode));
    _renderIepGrid();
}

// ── Shared HTML builder ───────────────────────────────────────────────────────

function _buildPickerHTML(showTopTabs = false) {
    _iepServerTabs.length = 0;
    const tabs = [];
    let serverTabOffset = 0;

    for (const [sId, sData] of _allServerEmojis) {
        if (!sData.emoji || sData.emoji.length === 0) continue;
        const catIdx = -(serverTabOffset + 1);
        _iepServerTabs.push({ catIdx, serverId: sId, serverName: sData.serverName });
        const firstEmoji    = sData.emoji[0];
        const safeServerName = sData.serverName.replace(/"/g, '&quot;').replace(/</g, '&lt;');
        const iconHtml      = `<img src="/img/emoji/${sId}/${firstEmoji.filename}" style="width:18px;height:18px;object-fit:contain;border-radius:2px;" alt="">`;
        tabs.push(`<button class="iep-tab${_iepCatIdx === catIdx ? ' active' : ''}" data-tab-idx="${catIdx}" title="${safeServerName}" onmousedown="event.preventDefault();_switchEmojiCategory(${catIdx})">${iconHtml}</button>`);
        serverTabOffset++;
    }

    if (typeof EMOJI_DATA !== 'undefined') {
        EMOJI_DATA.forEach((cat, i) => {
            const icon   = cat.emoji[0] ? cat.emoji[0].char : '?';
            const active = (_iepCatIdx === i) ? ' active' : '';
            tabs.push(`<button class="iep-tab${active}" data-tab-idx="${i}" title="${cat.name}" onmousedown="event.preventDefault();_switchEmojiCategory(${i})">${icon}</button>`);
        });
    }

    const topBar = showTopTabs ? `
        <div class="iep-top-tabs">
            <button class="iep-top-tab${_iepTopMode === 'emoji' ? ' active' : ''}" data-top-mode="emoji" onmousedown="event.preventDefault();_switchTopMode('emoji')">Emoji</button>
            <button class="iep-top-tab${_iepTopMode === 'gif'   ? ' active' : ''}" data-top-mode="gif"   onmousedown="event.preventDefault();_switchTopMode('gif')">GIF</button>
        </div>` : '';

    return `
        ${topBar}
        <div class="iep-search"><input id="iepSearch" type="text" placeholder="Search emoji..." oninput="_filterEmojiPicker(this.value)"></div>
        <div class="iep-body">
            <div class="iep-tabs">${tabs.join('')}</div>
            <div class="iep-grid-wrap" id="iepGridWrap"></div>
        </div>
    `;
}

function _renderIepGrid() {
    if (_iepTopMode === 'gif') {
        _injectGifStyles();
        const picker = document.getElementById('inputEmojiPicker');
        if (!picker) return;

        // Hide emoji search + body, show gif panel
        const searchEl = picker.querySelector('.iep-search');
        const bodyEl   = picker.querySelector('.iep-body');
        if (searchEl) searchEl.style.display = 'none';
        if (bodyEl)   bodyEl.style.display   = 'none';

        let gifPanel = picker.querySelector('.iep-gif-panel');
        if (!gifPanel) {
            gifPanel = document.createElement('div');
            gifPanel.className = 'iep-gif-panel';
            picker.appendChild(gifPanel);
        }
        gifPanel.style.display = '';

        const catBtns = GIF_CATEGORIES.map(c =>
            `<button class="iep-gif-cat${_iepGifCat === c.key ? ' active' : ''}" data-gif-cat="${c.key}" onmousedown="event.preventDefault();_switchGifCategory('${c.key}')">${c.label}</button>`
        ).join('');

        gifPanel.innerHTML =
            `<div class="iep-gif-cats">${catBtns}</div>` +
            `<input class="iep-gif-search" id="iepGifSearch" type="text" placeholder="Search GIFs…" oninput="_onGifSearchInput(this.value)">` +
            `<div class="iep-gif-grid" id="iepGifGrid"><div class="iep-gif-status">Loading…</div></div>`;
        _loadGifs('');
        return;
    }

    // Emoji mode — restore hidden elements if returning from GIF tab
    const activePicker = document.getElementById('inputEmojiPicker') || document.getElementById('emojiPickerModal');
    if (activePicker) {
        const searchEl = activePicker.querySelector('.iep-search');
        const bodyEl   = activePicker.querySelector('.iep-body');
        const gifPanel = activePicker.querySelector('.iep-gif-panel');
        if (searchEl) searchEl.style.display = '';
        if (bodyEl)   bodyEl.style.display   = '';
        if (gifPanel) gifPanel.style.display  = 'none';
    }

    const wrap = document.getElementById('iepGridWrap');
    if (!wrap) return;

    if (_iepCatIdx < 0) {
        const tabData = _iepServerTabs.find(t => t.catIdx === _iepCatIdx);
        if (!tabData) { wrap.innerHTML = ''; return; }
        const sData = _allServerEmojis.get(tabData.serverId);
        if (!sData)  { wrap.innerHTML = ''; return; }
        const btns  = (sData.emoji || []).map(e =>
            `<button class="iep-btn" title=":${e.name}:" onmousedown="insertEmojiFromPicker('${e.name}',event,'${tabData.serverId}')"><img src="/img/emoji/${tabData.serverId}/${e.filename}" alt="${e.name}"></button>`
        ).join('');
        const label = (tabData.serverName || 'Server').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        wrap.innerHTML = `<div class="iep-section-label">${label}</div><div class="iep-grid">${btns || '<span style="color:#949ba4;padding:8px;">No emoji</span>'}</div>`;
    } else if (typeof EMOJI_DATA !== 'undefined' && EMOJI_DATA[_iepCatIdx]) {
        const cat  = EMOJI_DATA[_iepCatIdx];
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
    if (_iepTopMode === 'gif') return;

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
        selectEmoji(emoji);
        return;
    }

    const textarea = document.getElementById('messageInput');
    if (!textarea) return;
    const start  = textarea.selectionStart;
    const end    = textarea.selectionEnd;
    const insert = `:${name}: `;
    textarea.value = textarea.value.slice(0, start) + insert + textarea.value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + insert.length;
    textarea.focus();
    textarea.dispatchEvent(new Event('input'));
}

// ── Reaction picker (emojiPickerModal) ───────────────────────────────────────

async function showEmojiPickerAt(messageId, x, y, dmId = null) {
    currentEmojiPickerMessageId = messageId;
    currentEmojiPickerDmId = dmId;
    _iepMode    = 'reaction';
    _iepTopMode = 'emoji';
    _iepCatIdx  = 0;

    if (state.currentServer && !_allServerEmojis.has(state.currentServer.id)) {
        await loadServerEmojis(state.currentServer.id);
    }

    const picker = document.getElementById('emojiPickerModal');
    picker.innerHTML = _buildPickerHTML(false); // no top tabs in reaction picker
    _renderIepGrid();

    const pickerW = 380, pickerH = 420;
    const left = Math.max(0, Math.min(x, window.innerWidth - pickerW - 10));
    const top  = (y + pickerH > window.innerHeight) ? Math.max(0, y - pickerH) : y;
    picker.style.left = `${left}px`;
    picker.style.top  = `${top}px`;

    setTimeout(() => { picker.style.display = 'flex'; }, 0);
}

async function selectEmoji(emoji) {
    if (!currentEmojiPickerMessageId) return;
    const msgId = currentEmojiPickerMessageId;
    const dmId  = currentEmojiPickerDmId;
    const url   = dmId
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
            if (serverId === state.currentServer?.id) {
                serverEmojis = data;
            }
            const serverName = state.servers?.find(s => s.id === serverId)?.name || serverId;
            _allServerEmojis.set(serverId, { serverName, emoji: data.server || [] });
        }
    } catch (error) {
        console.error('Error loading server emojis:', error);
    }
}

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
        _iepMode    = 'input';
        _iepTopMode = 'emoji';
        _iepGifCat  = 'trending';
        iep.innerHTML = _buildPickerHTML(true);
        _renderIepGrid();
        iep.style.display = 'flex';
    }
}

function closeInputEmojiPicker() {
    const iep = document.getElementById('inputEmojiPicker');
    if (iep) { iep.style.display = 'none'; iep.innerHTML = ''; }
    _iepCatIdx  = 0;
    _iepTopMode = 'emoji';
}

// ── Click-outside handler ─────────────────────────────────────────────────────

document.addEventListener('click', (e) => {
    const picker = document.getElementById('emojiPickerModal');
    const emojiButton = e.target.closest('.message-emoji-btn');
    if (picker && picker.style.display === 'flex' && !picker.contains(e.target) && !emojiButton) {
        closeEmojiPicker();
    }

    const iep    = document.getElementById('inputEmojiPicker');
    const iepBtn = document.getElementById('inputEmojiBtn');
    if (iep && iep.style.display !== 'none' && !iep.contains(e.target) && e.target !== iepBtn && !iepBtn.contains(e.target)) {
        closeInputEmojiPicker();
    }
});
