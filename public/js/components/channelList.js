// Channel list rendering
function renderChannelList(channels, categories) {
    const channelsList = document.getElementById('channelsList');
    if (!channelsList) return;

    channelsList.innerHTML = '';

    // Group channels by category
    const channelsByCategory = {};
    const uncategorized = [];

    channels.forEach(channel => {
        if (channel.category_id) {
            if (!channelsByCategory[channel.category_id]) {
                channelsByCategory[channel.category_id] = [];
            }
            channelsByCategory[channel.category_id].push(channel);
        } else {
            uncategorized.push(channel);
        }
    });

    // Render uncategorized channels first (prepended)
    const uncatFrag = document.createDocumentFragment();
    uncategorized.sort((a, b) => a.position - b.position).forEach(channel => {
        uncatFrag.appendChild(_makeChannelEl(channel));
    });

    // Render categories and their channels
    const catFrag = document.createDocumentFragment();
    categories.sort((a, b) => a.position - b.position).forEach(category => {
        const categoryChannels = channelsByCategory[category.id] || [];
        if (categoryChannels.length > 0) {
            const catEl = document.createElement('div');
            catEl.className = 'channel-category';
            catEl.textContent = category.name;
            attachCategoryContextMenu(catEl, category);
            catFrag.appendChild(catEl);

            categoryChannels.sort((a, b) => a.position - b.position).forEach(channel => {
                catFrag.appendChild(_makeChannelEl(channel));
            });
        }
    });

    channelsList.appendChild(uncatFrag);
    channelsList.appendChild(catFrag);
}

function _makeChannelEl(channel) {
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
    wrapper.appendChild(btn);

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