// Server list rendering
function renderServerList() {
    const serverList = document.getElementById('serverList');
    if (!serverList) return;

    serverList.innerHTML = state.servers.map(server => `
    <button 
      data-server-id="${server.id}" 
      onclick="selectServer('${server.id}')"
      class="${state.currentServer?.id === server.id ? 'active' : ''}"
      title="${server.name}"
    >
      ${server.icon || getInitials(server.name)}
    </button>
  `).join('');

    // Attach context menus
    state.servers.forEach(server => {
        const el = serverList.querySelector(`[data-server-id="${server.id}"]`);
        if (el) attachServerContextMenu(el, server);
    });
}