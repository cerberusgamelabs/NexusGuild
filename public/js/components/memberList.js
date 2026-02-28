// Member list rendering
function renderMemberList() {
    const panel = document.getElementById('membersPanel');
    if (!panel) return;

    const online = state.members.filter(m => m.status === 'online');
    const offline = state.members.filter(m => m.status !== 'online');

    // Group online members by their highest hoisted role
    const hoistGroups = new Map(); // position -> { name, position, members[] }
    const nonHoisted = [];

    online.forEach(m => {
        if (m.hoist_role_name != null) {
            const key = m.hoist_role_position;
            if (!hoistGroups.has(key)) {
                hoistGroups.set(key, { name: m.hoist_role_name, position: key, members: [] });
            }
            hoistGroups.get(key).members.push(m);
        } else {
            nonHoisted.push(m);
        }
    });

    // Sort hoisted groups highest position first
    const sortedGroups = [...hoistGroups.values()].sort((a, b) => b.position - a.position);

    let html = '';
    sortedGroups.forEach(group => {
        html += `<div class="member-role">${group.name} \u2014 ${group.members.length}</div>`;
        group.members.forEach(m => { html += renderMember(m); });
    });

    if (nonHoisted.length > 0) {
        html += `<div class="member-role">Online \u2014 ${nonHoisted.length}</div>`;
        nonHoisted.forEach(m => { html += renderMember(m); });
    }

    if (offline.length > 0) {
        html += `<div class="member-role">Offline \u2014 ${offline.length}</div>`;
        offline.forEach(m => { html += renderMember(m); });
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
    const nameStyle = member.role_color ? ` style="color:${member.role_color}"` : '';
    const avatarHtml = member.avatar
        ? `<img src="${member.avatar}" alt="${displayName}" class="member-av-img">`
        : `<div class="member-avatar">${getInitials(displayName)}</div>`;

    const statusText = member.custom_status
        ? `<div class="member-custom-status" title="${escapeHtml(member.custom_status)}">${escapeHtml(member.custom_status)}</div>`
        : '';

    return `
    <div class="member" data-user-id="${member.id}">
      <div class="member-av-wrap">
        ${avatarHtml}
        <div class="member-status ${statusClass}"></div>
      </div>
      <div class="member-info">
        <span class="member-name"${nameStyle}>${displayName}${isOwner ? ' &#x1F451;' : ''}</span>
        ${statusText}
      </div>
    </div>
  `;
}