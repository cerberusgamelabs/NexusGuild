// ?? Invite Modal ??????????????????????????????????????????????????????????????

function showInviteModal() {
    closeServerMenu();
    if (!state.currentServer) return;
    document.getElementById('inviteModal').style.display = 'flex';
    loadInvites();
}

function closeInviteModal(e) {
    if (e && e.target !== document.getElementById('inviteModal')) return;
    document.getElementById('inviteModal').style.display = 'none';
}

async function loadInvites() {
    const list = document.getElementById('inviteList');
    list.innerHTML = '<p class="loading">Loading invites...</p>';

    try {
        const res = await fetch(`/api/servers/${state.currentServer.id}/invites`, {
            credentials: 'include'
        });
        const data = await res.json();

        if (!data.invites || data.invites.length === 0) {
            list.innerHTML = '<p class="invite-empty">No active invites yet.</p>';
            return;
        }

        list.innerHTML = data.invites.map(inv => {
            const link = `${location.origin}/invite/${inv.code}`;
            const uses = inv.max_uses > 0 ? `${inv.uses}/${inv.max_uses} uses` : `${inv.uses} uses`;
            const expiry = inv.expires_at
                ? `Expires ${new Date(inv.expires_at).toLocaleDateString()}`
                : 'Never expires';
            return `
        <div class="invite-row">
          <div class="invite-info">
            <span class="invite-code">${inv.code}</span>
            <span class="invite-meta">${uses} &middot; ${expiry} &middot; by ${inv.inviter_username || 'Unknown'}</span>
          </div>
          <button class="btn-copy" onclick="copyInviteCode('${inv.code}', this)">Copy Code</button>
        </div>
      `;
        }).join('');
    } catch (err) {
        list.innerHTML = '<p class="modal-error">Failed to load invites.</p>';
    }
}

async function createInvite() {
    if (!state.currentServer) return;

    const expiresIn = document.getElementById('inviteExpiry').value || null;
    const maxUses = document.getElementById('inviteMaxUses').value || 0;

    try {
        const res = await fetch(`/api/servers/${state.currentServer.id}/invites`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                expiresIn: expiresIn ? parseInt(expiresIn) : null,
                maxUses: parseInt(maxUses)
            })
        });

        const data = await res.json();

        if (res.ok) {
            // Refresh the list first
            await loadInvites();
            // Then try clipboard — don't let failure bubble up as an error
            try {
                await navigator.clipboard.writeText(data.invite.code);
                showToast(`Invite code ${data.invite.code} copied to clipboard!`);
            } catch {
                showToast(`Invite ${data.invite.code} created! Copy it from the list above.`);
            }
        } else {
            alert(data.error || 'Failed to create invite');
        }
    } catch (err) {
        console.error('Create invite error:', err);
        alert('Failed to create invite');
    }
}

function copyInviteCode(code, btn) {
    navigator.clipboard.writeText(code).then(() => {
        if (btn) {
            const original = btn.textContent;
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 2000);
        } else {
            // Called without a button (after auto-generate) ? show brief toast
            showToast(`Invite code ${code} copied to clipboard!`);
        }
    }).catch(() => {
        // Fallback: show modal for manual copy
        showModal({
            title: 'Copy Code',
            message: 'Copy this code manually:',
            inputType: 'readonly',
            inputValue: code,
            inputStyle: {
                fontFamily: "'Courier New', monospace",
                letterSpacing: '2px',
                textAlign: 'center',
                fontSize: '18px'
            },
            buttons: [
                {
                    text: 'Close',
                    style: 'primary',
                    action: closeModal
                }
            ]
        });
    });
}

// ?? Join Server Modal ?????????????????????????????????????????????????????????

function showJoinServerModal() {
    document.getElementById('joinCodeInput').value = '';
    document.getElementById('joinError').style.display = 'none';
    document.getElementById('joinModal').style.display = 'flex';
    setTimeout(() => document.getElementById('joinCodeInput').focus(), 50);
}

function closeJoinModal(e) {
    if (e && e.target !== document.getElementById('joinModal')) return;
    document.getElementById('joinModal').style.display = 'none';
}

async function joinServer() {
    const code = document.getElementById('joinCodeInput').value.trim();
    const errorEl = document.getElementById('joinError');

    errorEl.style.display = 'none';

    if (!code) {
        errorEl.textContent = 'Please enter an invite code.';
        errorEl.style.display = 'block';
        return;
    }

    try {
        const res = await fetch('/api/servers/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ code })
        });

        const data = await res.json();

        if (res.ok) {
            document.getElementById('joinModal').style.display = 'none';
            // Reload servers and switch to the newly joined one
            await loadUserServers();
            const joined = state.servers.find(s => s.id === data.server.id);
            if (joined) selectServer(joined.id);
        } else {
            errorEl.textContent = data.error || 'Failed to join server.';
            errorEl.style.display = 'block';
        }
    } catch (err) {
        errorEl.textContent = 'Something went wrong. Try again.';
        errorEl.style.display = 'block';
    }
}

// ?? Server dropdown menu ??????????????????????????????????????????????????????

function toggleServerMenu() {
    const dd = document.getElementById('serverDropdown');
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

function closeServerMenu() {
    document.getElementById('serverDropdown').style.display = 'none';
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const btn = document.getElementById('serverMenuBtn');
    const dd = document.getElementById('serverDropdown');
    if (btn && dd && !btn.contains(e.target) && !dd.contains(e.target)) {
        dd.style.display = 'none';
    }
});

async function leaveOrDeleteServer() {
    closeServerMenu();
    if (!state.currentServer) return;

    const isOwner = state.currentServer.owner_id === state.currentUser.id;
    const action = isOwner ? 'delete' : 'leave';
    const title = isOwner ? 'Delete Server' : 'Leave Server';
    const message = isOwner
        ? `Are you sure you want to delete "${state.currentServer.name}"? This cannot be undone.`
        : `Are you sure you want to leave "${state.currentServer.name}"?`;

    showModal({
        title,
        message,
        buttons: [
            {
                text: 'Cancel',
                style: 'secondary',
                action: closeModal
            },
            {
                text: isOwner ? 'Delete' : 'Leave',
                style: 'danger',
                action: async () => {
                    try {
                        const res = await fetch(
                            isOwner
                                ? `/api/servers/${state.currentServer.id}`
                                : `/api/servers/${state.currentServer.id}/leave`,
                            { method: isOwner ? 'DELETE' : 'POST', credentials: 'include' }
                        );

                        if (res.ok) {
                            closeModal();
                            state.currentServer = null;
                            state.currentChannel = null;
                            state.channels = [];
                            state.messages = [];
                            state.members = [];
                            document.getElementById('channelsList').innerHTML = '';
                            document.getElementById('messagesContainer').innerHTML = '';
                            document.getElementById('membersPanel').innerHTML = '';
                            document.getElementById('currentServerName').textContent = 'Select a server';
                            await loadUserServers();
                        } else {
                            const data = await res.json();
                            alert(data.error || `Failed to ${action} server`);
                        }
                    } catch (err) {
                        console.error(`${action} server error:`, err);
                        alert(`Failed to ${action} server`);
                    }
                }
            }
        ]
    });
}

// ?? Toast notification ????????????????????????????????????????????????????????

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('toast-show'), 10);
    setTimeout(() => {
        toast.classList.remove('toast-show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ?? Handle /invite/:code URLs ?????????????????????????????????????????????????
// If someone opens a direct invite link, pre-fill and open the join modal
window.addEventListener('DOMContentLoaded', () => {
    const match = location.pathname.match(/^\/invite\/([A-Z0-9]+)$/i);
    if (match) {
        // Wait until the app decides auth state, then open the modal
        const waitForApp = setInterval(() => {
            if (state.isAuthenticated) {
                clearInterval(waitForApp);
                document.getElementById('joinCodeInput').value = match[1];
                showJoinServerModal();
            }
        }, 200);
    }
});