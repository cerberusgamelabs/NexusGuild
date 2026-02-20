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
    const icon = channel.type === 'voice' ? '🔊' : '#';
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
    return btn;
}