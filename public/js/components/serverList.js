function _serverIconHtml(server) {
    if (!server.icon) return getInitials(server.name);
    if (server.icon.startsWith('/') || server.icon.startsWith('http')) {
        return `<img src="${server.icon}" alt="${server.name}" class="server-icon-img">`;
    }
    return server.icon; // emoji / text fallback
}

// Server list rendering
function renderServerList() {
    const serverList = document.getElementById('serverList');
    if (!serverList) return;

    serverList.innerHTML = state.servers.map(server => {
        const serverUnread = Object.values(state.unread || {}).filter(u => u.serverId === server.id);
        const hasMention = serverUnread.some(u => u.mentions > 0);
        const hasUnread = serverUnread.length > 0;
        const badge = hasMention
            ? `<span class="server-badge mention"></span>`
            : hasUnread
            ? `<span class="server-badge unread"></span>`
            : '';
        return `
    <button
      data-server-id="${server.id}"
      onclick="selectServer('${server.id}')"
      class="${state.currentServer?.id === server.id ? 'active' : ''}"
      title="${server.name}"
    >
      ${_serverIconHtml(server)}${badge}
    </button>
  `;
    }).join('');

    // Attach context menus
    state.servers.forEach(server => {
        const el = serverList.querySelector(`[data-server-id="${server.id}"]`);
        if (el) attachServerContextMenu(el, server);
    });
}