// Member list rendering
function renderMemberList() {
    const panel = document.getElementById('membersPanel');
    if (!panel) return;

    // Group members by online status
    const online = state.members.filter(m => m.status === 'online');
    const offline = state.members.filter(m => m.status === 'offline');

    let html = '';

    if (online.length > 0) {
        html += `<div class="member-role">Online - ${online.length}</div>`;
        online.forEach(member => {
            html += renderMember(member);
        });
    }

    if (offline.length > 0) {
        html += `<div class="member-role">Offline - ${offline.length}</div>`;
        offline.forEach(member => {
            html += renderMember(member);
        });
    }

    panel.innerHTML = html;

    // Attach context menus
    state.members.forEach(member => {
        const el = panel.querySelector(`[data-user-id="${member.id}"]`);
        if (el) attachMemberContextMenu(el, member);
    });
}

function renderMember(member) {
    const displayName = member.nickname || member.username;
    const statusClass = member.status || 'offline';
    const isOwner = state.currentServer && member.id === state.currentServer.owner_id;

    return `
    <div class="member" data-user-id="${member.id}">
      <div style="position: relative;">
        <div class="member-avatar">${getInitials(displayName)}</div>
        <div class="member-status ${statusClass}"></div>
      </div>
      <span class="member-name">${displayName}${isOwner ? ' &#x1F451;' : ''}</span>
    </div>
  `;
}