// Profile view — parser, renderer, modal, user settings overlay

// ── Parser ────────────────────────────────────────────────────────────────────

function findTopLevelBrackets(str) {
    const results = [];
    let depth = 0, start = -1;
    for (let i = 0; i < str.length; i++) {
        if (str[i] === '[') {
            if (depth === 0) start = i;
            depth++;
        } else if (str[i] === ']') {
            depth--;
            if (depth === 0 && start !== -1) {
                results.push({ start, end: i });
                start = -1;
            }
        }
    }
    return results;
}

function extractSize(str) {
    const m = str.match(/^\((\d+(?:\.\d+)?%)\)/);
    if (m) return { size: m[1], rest: str.slice(m[0].length) };
    return { size: null, rest: str };
}

function parseRow(innerText) {
    const { size: height, rest } = extractSize(innerText);
    const brackets = findTopLevelBrackets(rest);
    const columns = brackets.length === 0
        ? [parseColumn(rest)]
        : brackets.map(b => parseColumn(rest.slice(b.start + 1, b.end)));
    return { type: 'row', height, columns };
}

function parseColumn(innerText) {
    const { size: width, rest } = extractSize(innerText);
    return { type: 'col', width, children: parseColumnContent(rest) };
}

function parseColumnContent(str) {
    const children = [];
    const brackets = findTopLevelBrackets(str);
    let cursor = 0;
    for (const b of brackets) {
        if (b.start > cursor) {
            const part = str.slice(cursor, b.start);
            if (part) children.push({ type: 'text', content: part });
        }
        children.push(parseRow(str.slice(b.start + 1, b.end)));
        cursor = b.end + 1;
    }
    if (cursor < str.length) {
        const part = str.slice(cursor);
        if (part) children.push({ type: 'text', content: part });
    }
    return children;
}

function parseProfileLayout(text) {
    if (!text || !text.trim()) return [];
    return findTopLevelBrackets(text).map(b => parseRow(text.slice(b.start + 1, b.end)));
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderProfileMarkdown(raw, user) {
    if (!raw) return '';
    // 1. Escape HTML
    let out = escapeHtml(raw);

    // 2. Profile tokens
    const avSrc = user.avatar
        ? `<img src="${user.avatar}" alt="" class="profile-token-avatar">`
        : `<div class="profile-token-avatar profile-token-avatar-init">${escapeHtml(getInitials(user.username))}</div>`;
    out = out.replace(/\{avatar\}/g, avSrc);
    out = out.replace(/\{username\}/g, `<span class="profile-token-username">${escapeHtml(user.username)}</span>`);
    out = out.replace(/\{status\}/g, user.custom_status
        ? `<span class="profile-modal-status">${escapeHtml(user.custom_status)}</span>` : '');

    // 3. Images — https only; strip http
    out = out.replace(/!\[([^\]]*)\]\((https:\/\/[^)]+)\)/g,
        '<img src="$2" alt="$1" style="max-width:100%;border-radius:4px;">');
    out = out.replace(/!\[([^\]]*)\]\((http:\/\/[^)]+)\)/g, '');

    // 4. Links — https only; strip http
    out = out.replace(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    out = out.replace(/\[([^\]]+)\]\((http:\/\/[^)]+)\)/g, '$1');

    // 5. Headings (line-by-line)
    out = out.split('\n').map(line => {
        if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`;
        if (line.startsWith('## '))  return `<h2>${line.slice(3)}</h2>`;
        if (line.startsWith('# '))   return `<h1>${line.slice(2)}</h1>`;
        return line;
    }).join('\n');

    // 6-7. Bold + italic
    out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // 8. List items
    out = out.replace(/((?:^|\n)- .+)+/g, match => {
        const items = match.trim().split('\n').map(l => `<li>${l.replace(/^- /, '')}</li>`).join('');
        return `<ul>${items}</ul>`;
    });

    // 9. Remaining newlines → <br>
    out = out.replace(/\n/g, '<br>');
    return out;
}

// ── Layout renderer ───────────────────────────────────────────────────────────

function renderRow(row, user) {
    const heightStyle = row.height ? `height:${row.height}` : 'flex:1;min-height:0';
    return `<div class="profile-row" style="${heightStyle}">${row.columns.map(c => renderColumn(c, user)).join('')}</div>`;
}

function renderColumn(col, user) {
    const widthStyle = col.width ? `flex:0 0 ${col.width};max-width:${col.width}` : 'flex:1';
    const inner = col.children.map(child =>
        child.type === 'text' ? renderProfileMarkdown(child.content, user) : renderRow(child, user)
    ).join('');
    return `<div class="profile-col" style="${widthStyle}">${inner}</div>`;
}

function renderProfileLayout(rows, user) {
    return `<div class="profile-layout-area">${rows.map(r => renderRow(r, user)).join('')}</div>`;
}

// ── Profile modal ─────────────────────────────────────────────────────────────

async function openProfileModal(userId) {
    const res = await fetch(`/api/users/${userId}/profile`);
    if (!res.ok) return;
    const user = await res.json();
    const isOwn = user.id === state.currentUser?.id;

    const bannerStyle = user.profile_banner
        ? `background-image:url('${user.profile_banner}');background-size:cover;background-position:center;`
        : `background:#5865f2;`;

    const avatarHtml = user.avatar
        ? `<img class="profile-modal-av" src="${user.avatar}" alt="">`
        : `<div class="profile-modal-av profile-modal-av-init">${escapeHtml(getInitials(user.username))}</div>`;

    const layoutRows = user.profile_layout ? parseProfileLayout(user.profile_layout) : [];
    const layoutHtml = layoutRows.length
        ? renderProfileLayout(layoutRows, user)
        : `<div class="profile-layout-area" style="display:flex;align-items:center;justify-content:center;color:#555;font-size:13px;">No profile set yet.</div>`;

    showModal({
        title: ' ',
        customHTML: `
          <div class="profile-modal-wrap">
            <div class="profile-banner" style="${bannerStyle}">
              <div class="profile-av-wrap">${avatarHtml}</div>
            </div>
            <div class="profile-modal-header">
              <div>
                <span class="profile-modal-username">${escapeHtml(user.username)}</span>
                ${user.custom_status ? `<span class="profile-modal-status">${escapeHtml(user.custom_status)}</span>` : ''}
              </div>
              ${isOwn ? `<button class="profile-edit-btn" onclick="closeModal();openUserSettings('profile')">Edit Profile</button>` : ''}
            </div>
            ${layoutHtml}
          </div>`,
        buttons: [{ text: 'Close', style: 'secondary', action: closeModal }]
    });
    document.querySelector('#universalModal .modal')?.classList.add('modal-profile');
}

// ── User Settings Overlay ─────────────────────────────────────────────────────

function openUserSettings(initialTab) {
    initialTab = initialTab || 'account';
    const overlay = document.getElementById('userSettingsOverlay');
    if (!overlay) return;
    const nameEl = document.getElementById('userSettingsSidebarName');
    if (nameEl) nameEl.textContent = state.currentUser?.username || 'User Settings';
    switchUserSettingsTab(initialTab);
    overlay.style.display = 'flex';
}

function closeUserSettings() {
    const overlay = document.getElementById('userSettingsOverlay');
    if (overlay) overlay.style.display = 'none';
}

function switchUserSettingsTab(tab) {
    document.querySelectorAll('#userSettingsOverlay .settings-nav-item[data-tab]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    const content = document.getElementById('userSettingsContent');
    if (!content) return;
    if (tab === 'profile') renderUserProfileTab(content);
    else if (tab === 'account') renderUserAccountTab(content);
    else if (tab === 'status') renderUserStatusTab(content);
    else if (tab === 'asc-points') renderAscensionPointsTab(content);
    else if (tab === 'asc-tree') renderAscensionSkillTreeTab(content);
}

function renderUserProfileTab(content) {
    fetch(`/api/users/${state.currentUser.id}/profile`)
        .then(r => r.json())
        .then(user => {
            content.innerHTML = `
                <h2 class="settings-section-title">My Profile</h2>
                <div class="profile-editor-banner-row">
                    <button class="btn-secondary" onclick="document.getElementById('profileBannerInput').click()">Change Banner</button>
                    <input type="file" id="profileBannerInput" accept="image/*" style="display:none;" onchange="uploadProfileBanner(this)">
                </div>
                <div class="settings-field">
                    <label class="settings-label">Layout Code</label>
                    <div class="profile-editor-hint" style="margin-bottom:6px;">[ ] = row &nbsp;·&nbsp; inner [ ] = column &nbsp;·&nbsp; (N%) = size &nbsp;·&nbsp; supports **bold**, *italic*, # headings, - lists, {avatar}, {username}</div>
                    <textarea id="profileLayoutInput" class="modal-input profile-editor-textarea"
                              placeholder="[(50%)[(50%)**Hello!**][*World*]]"></textarea>
                </div>
                <div class="profile-editor-actions">
                    <div id="profileEditorError" class="modal-error" style="display:none;"></div>
                    <button class="btn-secondary" onclick="toggleProfilePreview()">Preview</button>
                    <button class="btn-primary" onclick="saveProfileLayout()">Save</button>
                </div>
                <div id="profileLayoutPreview" class="profile-editor-preview" style="display:none;"></div>
            `;
            // Set via .value to avoid HTML parsing; also normalise any stored <br> → newline
            const ta = content.querySelector('#profileLayoutInput');
            if (ta) ta.value = (user.profile_layout || '').replace(/<br\s*\/?>/gi, '\n');
        });
}

function renderUserAccountTab(content) {
    const user = state.currentUser;
    const avatarHtml = user?.avatar
        ? `<img src="${user.avatar}" alt="" style="width:72px;height:72px;border-radius:50%;object-fit:cover;">`
        : `<div style="width:72px;height:72px;border-radius:50%;background:#5865f2;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#fff;">${escapeHtml(getInitials(user?.username || ''))}</div>`;
    content.innerHTML = `
        <h2 class="settings-section-title">Account</h2>
        <div class="settings-field">
            <label class="settings-label">Avatar</label>
            <div style="display:flex;align-items:center;gap:16px;">
                ${avatarHtml}
                <button class="btn-secondary" onclick="document.getElementById('avatarFileInput').click()">Change Avatar</button>
            </div>
        </div>

        <div class="settings-divider"></div>
        <h3 class="settings-section-title" style="font-size:15px;">Change Password</h3>
        <div class="settings-field">
            <label class="settings-label">Current Password</label>
            <input type="password" id="acct-cur-pw" class="modal-input" placeholder="Enter current password">
        </div>
        <div class="settings-field">
            <label class="settings-label">New Password</label>
            <input type="password" id="acct-new-pw" class="modal-input" placeholder="At least 8 characters">
        </div>
        <div class="settings-field">
            <label class="settings-label">Confirm New Password</label>
            <input type="password" id="acct-confirm-pw" class="modal-input" placeholder="Repeat new password">
        </div>
        <div class="settings-actions">
            <div id="acct-pw-msg" class="modal-error" style="display:none;"></div>
            <button class="btn-primary" onclick="saveNewPassword()">Update Password</button>
        </div>
    `;
}

async function saveNewPassword() {
    const cur = document.getElementById('acct-cur-pw')?.value;
    const pw1 = document.getElementById('acct-new-pw')?.value;
    const pw2 = document.getElementById('acct-confirm-pw')?.value;
    const msgEl = document.getElementById('acct-pw-msg');

    const showErr = (msg) => { msgEl.textContent = msg; msgEl.style.color = '#da373c'; msgEl.style.display = 'block'; };
    const showOk  = (msg) => { msgEl.textContent = msg; msgEl.style.color = '#23a559'; msgEl.style.display = 'block'; };

    if (!cur || !pw1 || !pw2) return showErr('All fields are required.');
    if (pw1.length < 8) return showErr('New password must be at least 8 characters.');
    if (pw1 !== pw2) return showErr('Passwords do not match.');

    const res = await fetch('/api/auth/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword: cur, newPassword: pw1 }),
    });
    const data = await res.json();
    if (!res.ok) return showErr(data.error || 'Failed to update password.');

    showOk('Password updated successfully.');
    document.getElementById('acct-cur-pw').value = '';
    document.getElementById('acct-new-pw').value = '';
    document.getElementById('acct-confirm-pw').value = '';
}

// Shims so gear button + profile modal "Edit Profile" still work
function openSettingsPanel() { openUserSettings('profile'); }
function openProfileEditor() { closeModal(); openUserSettings('profile'); }

// ── Profile editor helpers ────────────────────────────────────────────────────

function toggleProfilePreview() {
    const preview = document.getElementById('profileLayoutPreview');
    if (!preview) return;
    if (preview.style.display === 'none') {
        updateProfilePreview();
        preview.style.display = 'block';
    } else {
        preview.style.display = 'none';
    }
}

function updateProfilePreview() {
    const text = document.getElementById('profileLayoutInput')?.value || '';
    const preview = document.getElementById('profileLayoutPreview');
    if (!preview) return;
    try {
        const rows = parseProfileLayout(text);
        if (rows.length) {
            preview.innerHTML = renderProfileLayout(rows, state.currentUser);
        } else {
            preview.innerHTML = '<div style="color:#555;font-size:13px;padding:12px;">Nothing to preview yet.</div>';
        }
    } catch (e) {
        preview.innerHTML = `<div style="color:#ed4245;font-size:13px;padding:12px;">Parse error: ${escapeHtml(e.message)}</div>`;
    }
}

async function saveProfileLayout() {
    const layout = (document.getElementById('profileLayoutInput')?.value || '').replace(/<br\s*\/?>/gi, '\n');
    const errEl = document.getElementById('profileEditorError');
    if (layout.length > 10000) {
        if (errEl) { errEl.textContent = 'Layout too long (max 10 000 chars)'; errEl.style.display = 'block'; }
        return;
    }
    const res = await fetch('/api/users/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ layout })
    });
    if (res.ok) {
        if (errEl) errEl.style.display = 'none';
        showToast('Profile saved!');
    } else {
        const data = await res.json().catch(() => ({}));
        if (errEl) { errEl.textContent = data.error || 'Failed to save'; errEl.style.display = 'block'; }
    }
}

async function uploadProfileBanner(input) {
    if (!input.files?.[0]) return;
    const fd = new FormData();
    fd.append('file', input.files[0]);
    const res = await fetch('/api/users/me/profile/banner', { method: 'PATCH', credentials: 'include', body: fd });
    if (res.ok) {
        showToast('Banner updated!');
    } else {
        showToast('Failed to upload banner');
    }
    input.value = '';
}

// ── Ascension / Status tabs ───────────────────────────────────────────────────

function renderUserStatusTab(content) {
    const current = state.currentUser?.custom_status || '';
    content.innerHTML = `
        <h2 class="settings-section-title">My Status</h2>
        <div class="settings-field">
            <label class="settings-label">Custom Status</label>
            <input class="settings-input" id="statusInput" type="text" maxlength="128"
                   placeholder="What's on your mind?" value="${escapeHtml(current)}">
        </div>
        <div id="statusSaveError" style="color:#f23f43;font-size:13px;margin-bottom:8px;display:none;"></div>
        <button class="btn-primary" onclick="saveCustomStatusFromSettings()">Save</button>
    `;
}

async function saveCustomStatusFromSettings() {
    const val = document.getElementById('statusInput')?.value || '';
    const errEl = document.getElementById('statusSaveError');
    const res = await fetch('/api/users/me/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: val })
    });
    if (res.ok) {
        if (state.currentUser) state.currentUser.custom_status = val;
        if (errEl) errEl.style.display = 'none';
        showToast('Status updated!');
        if (typeof renderUserStatus === 'function') renderUserStatus();
    } else {
        const data = await res.json().catch(() => ({}));
        if (errEl) { errEl.textContent = data.error || 'Failed to save'; errEl.style.display = 'block'; }
    }
}

function renderAscensionPointsTab(content) {
    content.innerHTML = `<h2 class="settings-section-title">Ascension Points</h2><div class="asc-loading">Loading…</div>`;

    Promise.all([
        fetch('/api/ascension/balance', { credentials: 'include' }).then(r => r.json()),
        fetch('/api/ascension/ledger',  { credentials: 'include' }).then(r => r.json())
    ]).then(([balData, ledgerData]) => {
        const balance = balData.balance ?? 0;
        const entries = ledgerData.entries || [];

        const ledgerRows = entries.map(e => {
            const d = new Date(e.created_at).toLocaleDateString();
            const cls = e.delta >= 0 ? 'delta-pos' : 'delta-neg';
            const sign = e.delta >= 0 ? '+' : '';
            return `<tr>
                <td>${escapeHtml(d)}</td>
                <td>${escapeHtml(e.reason || '')}</td>
                <td class="${cls}">${sign}${e.delta}</td>
            </tr>`;
        }).join('');

        content.innerHTML = `
            <h2 class="settings-section-title">Ascension Points</h2>
            <div class="asc-balance-bar"><strong>${balance}</strong> points available</div>
            <div style="margin-bottom:20px;">
                <button class="btn-secondary" onclick="ascGrantTestPoints()">Grant 500 Test Points</button>
            </div>
            <h3 class="settings-label" style="margin-bottom:8px;">Transaction History</h3>
            ${entries.length ? `
            <table class="asc-ledger">
                <thead><tr><th>Date</th><th>Reason</th><th>Amount</th></tr></thead>
                <tbody>${ledgerRows}</tbody>
            </table>` : '<p style="color:#72767d;font-size:13px;">No transactions yet.</p>'}
            <div style="margin-top:28px;padding-top:20px;border-top:1px solid #3d3f45;">
                <h3 class="settings-label" style="margin-bottom:8px;">
                    Buy Points <span class="asc-coming-soon">Coming Soon</span>
                </h3>
                <p style="color:#72767d;font-size:13px;">Point packages will be available when billing is enabled.</p>
            </div>
            <div style="margin-top:20px;">
                <h3 class="settings-label" style="margin-bottom:8px;">
                    Manage Subscription <span class="asc-coming-soon">Coming Soon</span>
                </h3>
                <p style="color:#72767d;font-size:13px;">Monthly point subscriptions are coming soon.</p>
            </div>
        `;
    }).catch(() => {
        content.innerHTML = `<h2 class="settings-section-title">Ascension Points</h2><p style="color:#f23f43;">Failed to load.</p>`;
    });
}

async function ascGrantTestPoints() {
    const res = await fetch('/api/ascension/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount: 500 })
    });
    if (res.ok) {
        showToast('500 test points granted!');
        renderAscensionPointsTab(document.getElementById('userSettingsContent'));
    } else {
        showToast('Failed to grant points', true);
    }
}

function renderAscensionSkillTreeTab(content) {
    content.innerHTML = `<h2 class="settings-section-title">Ascension Skill Tree</h2><div class="asc-loading">Loading…</div>`;
    fetch('/api/ascension/balance', { credentials: 'include' })
        .then(r => r.json())
        .then(balData => {
            const balance = balData.balance ?? 0;
            content.innerHTML = `
                <h2 class="settings-section-title">Ascension Skill Tree</h2>
                <div class="asc-balance-bar"><strong>${balance}</strong> points available</div>
                <div id="ascUserTreeContainer"></div>
            `;
            if (typeof renderUserSkillTree === 'function') {
                renderUserSkillTree(document.getElementById('ascUserTreeContainer'));
            }
        })
        .catch(() => {
            content.innerHTML = `<h2 class="settings-section-title">Ascension Skill Tree</h2><p style="color:#f23f43;">Failed to load.</p>`;
        });
}

// ── Init ──────────────────────────────────────────────────────────────────────

function initProfileView() {
    const av = document.getElementById('userAvatar');
    if (av) {
        av.style.cursor = 'pointer';
        av.onclick = () => openProfileModal(state.currentUser.id);
    }
}
