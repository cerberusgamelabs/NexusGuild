// Channel list rendering
function renderChannelList(channels, categories) {
    const channelsList = document.getElementById('channelsList');
    if (!channelsList) return;

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

    let html = '';

    // Render categories and their channels
    categories.sort((a, b) => a.position - b.position).forEach(category => {
        const categoryChannels = channelsByCategory[category.id] || [];

        if (categoryChannels.length > 0) {
            html += `<div class="channel-category">${category.name}</div>`;

            categoryChannels.sort((a, b) => a.position - b.position).forEach(channel => {
                const icon = channel.type === 'voice' ? 'VC' : '#';
                const isActive = state.currentChannel?.id === channel.id;

                html += `
          <button 
            class="channel-button ${isActive ? 'active' : ''}"
            data-channel-id="${channel.id}"
            onclick="selectChannel('${channel.id}')"
          >
            ${icon} ${channel.name}
          </button>
        `;
            });
        }
    });

    // Render uncategorized channels
    if (uncategorized.length > 0) {
        uncategorized.sort((a, b) => a.position - b.position).forEach(channel => {
            const icon = channel.type === 'voice' ? 'VC' : '#';
            const isActive = state.currentChannel?.id === channel.id;

            html = `
        <button 
          class="channel-button ${isActive ? 'active' : ''}"
          data-channel-id="${channel.id}"
          onclick="selectChannel('${channel.id}')"
        >
          ${icon} ${channel.name}
        </button>
      ` + html;
        });
    }

    channelsList.innerHTML = html;

    // Attach context menus
    state.channels.forEach(channel => {
        const el = channelsList.querySelector(`[data-channel-id="${channel.id}"]`);
        if (el) attachChannelContextMenu(el, channel);
    });
}