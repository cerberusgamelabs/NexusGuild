// Channel list rendering + drag-and-drop reordering

let _drag = null;       // { type: 'channel'|'category', id, el }
let _indicatorEl = null;

function _getIndicator() {
    if (!_indicatorEl) {
        _indicatorEl = document.createElement('div');
        _indicatorEl.className = 'drag-drop-indicator';
    }
    return _indicatorEl;
}

function _removeIndicator() { _indicatorEl?.remove(); }

function renderChannelList(channels, categories) {
    const channelsList = document.getElementById('channelsList');
    if (!channelsList) return;

    channelsList.innerHTML = '';

    const canDrag = typeof clientHasPermission === 'function' &&
                    clientHasPermission(CLIENT_PERMS.MANAGE_CHANNELS);

    // Group channels by category
    const channelsByCategory = {};
    const uncategorized = [];
    channels.forEach(channel => {
        if (channel.category_id) {
            (channelsByCategory[channel.category_id] ??= []).push(channel);
        } else {
            uncategorized.push(channel);
        }
    });

    // Render uncategorized channels first
    uncategorized.sort((a, b) => a.position - b.position).forEach(channel => {
        channelsList.appendChild(_makeChannelEl(channel, canDrag));
    });

    // Render categories and their channels
    categories.sort((a, b) => a.position - b.position).forEach(category => {
        const categoryChannels = channelsByCategory[category.id] || [];
        if (categoryChannels.length > 0) {
            const catEl = document.createElement('div');
            catEl.className = 'channel-category';
            catEl.dataset.categoryId = category.id;

            if (canDrag) {
                const handle = document.createElement('span');
                handle.className = 'drag-handle';
                handle.textContent = '⠿';
                catEl.appendChild(handle);
                catEl.draggable = true;
                catEl.addEventListener('dragstart', (e) => {
                    _drag = { type: 'category', id: category.id, el: catEl };
                    e.dataTransfer.effectAllowed = 'move';
                    setTimeout(() => catEl.classList.add('drag-ghost'), 0);
                });
                catEl.addEventListener('dragend', () => {
                    _drag = null;
                    catEl.classList.remove('drag-ghost');
                    _removeIndicator();
                });
            }

            catEl.appendChild(document.createTextNode(' ' + category.name));
            attachCategoryContextMenu(catEl, category);
            channelsList.appendChild(catEl);

            categoryChannels.sort((a, b) => a.position - b.position).forEach(channel => {
                channelsList.appendChild(_makeChannelEl(channel, canDrag));
            });
        }
    });

    if (canDrag) {
        channelsList.addEventListener('dragover', _onDragOver);
        channelsList.addEventListener('drop', _onDrop);
        channelsList.addEventListener('dragleave', _onDragLeave);
    }
}

function _makeChannelEl(channel, canDrag) {
    const icon = channel.type === 'voice'        ? '🔊'
               : channel.type === 'announcement' ? '📢'
               : channel.type === 'forum'        ? '💬'
               : channel.type === 'media'        ? '🖼️'
               : '#';
    const isActive = state.currentChannel?.id === channel.id;
    const unread = state.unread?.[channel.id];
    const badge = unread?.mentions > 0
        ? `<span class="channel-badge mention">${unread.mentions}</span>`
        : unread?.count > 0
        ? `<span class="channel-badge unread"></span>`
        : '';

    const btn = document.createElement('button');
    btn.className = `channel-button${isActive ? ' active' : ''}${unread ? ' has-unread' : ''}`;
    btn.dataset.channelId = channel.id;
    btn.innerHTML = `<span>${icon} ${channel.name}</span>${badge}`;
    btn.addEventListener('click', () => selectChannel(channel.id));
    attachChannelContextMenu(btn, channel);

    const wrapper = document.createElement('div');
    wrapper.className = 'channel-group';
    wrapper.dataset.channelId = channel.id;
    wrapper.dataset.categoryId = channel.category_id || '';
    wrapper.appendChild(btn);

    if (canDrag) {
        const handle = document.createElement('span');
        handle.className = 'drag-handle';
        handle.textContent = '⠿';
        btn.insertBefore(handle, btn.firstChild);
        wrapper.draggable = true;
        wrapper.addEventListener('dragstart', (e) => {
            _drag = { type: 'channel', id: channel.id, el: wrapper };
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => wrapper.classList.add('drag-ghost'), 0);
        });
        wrapper.addEventListener('dragend', () => {
            _drag = null;
            wrapper.classList.remove('drag-ghost');
            _removeIndicator();
        });
    }

    // Voice channel: show who's connected underneath
    if (channel.type === 'voice') {
        const voiceUsers = Object.values(state.voiceStates || {})
            .filter(vs => vs.channelId === channel.id);

        if (voiceUsers.length > 0) {
            const sub = document.createElement('div');
            sub.className = 'voice-channel-participants';
            voiceUsers.forEach(vs => {
                const m = state.members.find(m => m.id === vs.userId);
                const name = m?.nickname || m?.username || vs.username;
                const av = m?.avatar
                    ? `<img src="${m.avatar}" class="voice-mini-av" alt="">`
                    : `<span class="voice-mini-av voice-mini-initials">${getInitials(name)}</span>`;
                const row = document.createElement('div');
                row.className = 'voice-channel-participant';
                row.innerHTML = `${av}<span class="voice-mini-name">${name}</span>`;
                sub.appendChild(row);
            });
            wrapper.appendChild(sub);
        }
    }

    return wrapper;
}

function _onDragOver(e) {
    if (!_drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const target = e.target.closest('.channel-group, .channel-category');
    if (!target || target === _drag.el) return;

    // Categories can only be reordered among categories
    if (_drag.type === 'category' && !target.classList.contains('channel-category')) return;

    const rect = target.getBoundingClientRect();
    const indicator = _getIndicator();

    // Dropping a channel onto a category header → insert as first channel of that category
    if (_drag.type === 'channel' && target.classList.contains('channel-category')) {
        target.after(indicator);
    } else if (e.clientY > rect.top + rect.height / 2) {
        target.after(indicator);
    } else {
        target.before(indicator);
    }
}

function _onDragLeave(e) {
    const channelsList = document.getElementById('channelsList');
    if (!channelsList?.contains(e.relatedTarget)) _removeIndicator();
}

function _onDrop(e) {
    if (!_drag) return;
    e.preventDefault();

    const indicator = _getIndicator();
    if (!indicator.parentNode) { _removeIndicator(); return; }

    // Move the dragged element into the indicator's position
    indicator.replaceWith(_drag.el);
    _removeIndicator();

    _saveChannelOrder();
}

function _saveChannelOrder() {
    const channelsList = document.getElementById('channelsList');
    if (!channelsList || !state.currentServer) return;

    const channelUpdates = [];
    const categoryUpdates = [];
    let currentCategoryId = null;
    let chanPos = 0;
    let catPos = 0;

    Array.from(channelsList.children).forEach(el => {
        if (el.classList.contains('channel-category')) {
            const catId = el.dataset.categoryId;
            categoryUpdates.push({ id: catId, position: catPos++ });
            currentCategoryId = catId;
            chanPos = 0;
        } else if (el.classList.contains('channel-group')) {
            const chId = el.dataset.channelId;
            if (chId) {
                channelUpdates.push({ id: chId, position: chanPos++, categoryId: currentCategoryId });
                el.dataset.categoryId = currentCategoryId || '';
            }
        }
    });

    // Optimistically update state so re-renders before server confirms are correct
    channelUpdates.forEach(({ id, position, categoryId }) => {
        const ch = state.channels.find(c => c.id === id);
        if (ch) { ch.position = position; ch.category_id = categoryId; }
    });
    categoryUpdates.forEach(({ id, position }) => {
        const cat = state.categories.find(c => c.id === id);
        if (cat) cat.position = position;
    });

    fetch(`/api/channels/servers/${state.currentServer.id}/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: channelUpdates, categories: categoryUpdates }),
    }).catch(err => console.error('[reorder] failed:', err));
}