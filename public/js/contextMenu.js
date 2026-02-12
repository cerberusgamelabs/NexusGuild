// File Location: /public/js/contextMenu.js

// ?????????????????????????????????????????????????????????????????????????
// UNIVERSAL MODAL SYSTEM
// ?????????????????????????????????????????????????????????????????????????

let modalCallback = null;
let modalData = null;

/**
 * Show universal modal with configuration
 * @param {Object} config - Modal configuration
 * @param {string} config.title - Modal title
 * @param {string} [config.message] - Optional message/hint text
 * @param {string} [config.inputType] - 'text', 'textarea', 'readonly', or null for no input
 * @param {string} [config.inputValue] - Initial input value
 * @param {string} [config.inputPlaceholder] - Input placeholder
 * @param {Object} [config.inputStyle] - Additional input styles
 * @param {Array} config.buttons - Array of button configs [{text, style, action}]
 * @param {Function} [config.onEnter] - Function to call when Enter is pressed
 */
function showModal(config) {
    const modal = document.getElementById('universalModal');
    const title = document.getElementById('modalTitle');
    const message = document.getElementById('modalMessage');
    const input = document.getElementById('modalInput');
    const textarea = document.getElementById('modalTextarea');
    const error = document.getElementById('modalError');
    const buttonsContainer = document.getElementById('modalButtons');

    // Set title
    title.textContent = config.title || 'Modal';

    // Set message
    if (config.message) {
        message.textContent = config.message;
        message.style.display = 'block';
    } else {
        message.style.display = 'none';
    }

    // Handle input
    input.style.display = 'none';
    textarea.style.display = 'none';

    if (config.inputType === 'text' || config.inputType === 'readonly') {
        input.style.display = 'block';
        input.value = config.inputValue || '';
        input.placeholder = config.inputPlaceholder || '';
        input.readOnly = config.inputType === 'readonly';

        // Apply custom styles
        if (config.inputStyle) {
            Object.assign(input.style, config.inputStyle);
        } else {
            // Reset to defaults
            input.style.fontFamily = 'inherit';
            input.style.letterSpacing = '';
            input.style.textAlign = '';
            input.style.fontSize = '';
        }

        // Enter key handler
        input.onkeypress = (e) => {
            if (e.key === 'Enter' && config.onEnter) {
                config.onEnter();
            }
        };
    } else if (config.inputType === 'textarea') {
        textarea.style.display = 'block';
        textarea.value = config.inputValue || '';
        textarea.placeholder = config.inputPlaceholder || '';
    }

    // Hide error
    error.style.display = 'none';

    // Build buttons
    buttonsContainer.innerHTML = config.buttons.map(btn =>
        `<button class="btn-${btn.style || 'primary'}" onclick="modalButtonClick(${config.buttons.indexOf(btn)})">${btn.text}</button>`
    ).join('');

    // Store callback data
    modalData = config;

    // Show modal
    modal.style.display = 'flex';

    // Auto-focus on input/textarea
    setTimeout(() => {
        if (config.inputType === 'text') input.focus();
        else if (config.inputType === 'textarea') textarea.focus();
        else if (config.inputType === 'readonly') {
            input.select();
            input.setSelectionRange(0, 99999);
        }
    }, 50);

    // Click outside to close
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
}

function modalButtonClick(index) {
    if (modalData && modalData.buttons[index]) {
        modalData.buttons[index].action();
    }
}

function closeModal() {
    const modal = document.getElementById('universalModal');
    modal.style.display = 'none';
    modalCallback = null;
    modalData = null;
}

function showModalError(message) {
    const error = document.getElementById('modalError');
    error.textContent = message;
    error.style.display = 'block';
}

function getModalInputValue() {
    const input = document.getElementById('modalInput');
    const textarea = document.getElementById('modalTextarea');
    if (input.style.display !== 'none') return input.value;
    if (textarea.style.display !== 'none') return textarea.value;
    return '';
}

// ?????????????????????????????????????????????????????????????????????????
// CONTEXT MENU SYSTEM
// ?????????????????????????????????????????????????????????????????????????

// Context Menu System

const ctxMenu = (() => {
    let menuEl = null;

    function init() {
        menuEl = document.createElement('div');
        menuEl.id = 'contextMenu';
        menuEl.className = 'ctx-menu';
        menuEl.style.display = 'none';
        document.body.appendChild(menuEl);

        // Close on any click outside
        document.addEventListener('click', () => hide());
        document.addEventListener('contextmenu', () => hide());
    }

    function show(x, y, items) {
        menuEl.innerHTML = items.map(item => {
            if (item === 'divider') return `<div class="ctx-divider"></div>`;
            return `
                <div class="ctx-item ${item.danger ? 'ctx-danger' : ''}" data-action="${item.action}">
                    ${item.label}
                </div>
            `;
        }).join('');

        // Position menu, flip if it would go off screen
        menuEl.style.display = 'block';
        const menuW = menuEl.offsetWidth;
        const menuH = menuEl.offsetHeight;
        const winW = window.innerWidth;
        const winH = window.innerHeight;

        menuEl.style.left = (x + menuW > winW ? x - menuW : x) + 'px';
        menuEl.style.top = (y + menuH > winH ? y - menuH : y) + 'px';

        menuEl.onclick = (e) => {
            const item = e.target.closest('.ctx-item');
            if (!item) return;
            const action = item.dataset.action;
            const handler = ctxMenu._handlers[action];
            if (handler) handler();
            hide();
        };
    }

    function hide() {
        if (menuEl) menuEl.style.display = 'none';
        ctxMenu._handlers = {};
    }

    return { init, show, hide, _handlers: {} };
})();

// ? Attach right-click to a message element ??????????????????????????????
function attachMessageContextMenu(el, message) {
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const isOwner = state.currentUser && message.user_id === state.currentUser.id;
        const items = [];

        if (isOwner) {
            items.push({ label: 'Edit Message', action: 'editMsg' });
            items.push({ label: 'Delete Message', action: 'deleteMsg', danger: true });
            items.push('divider');
        }
        items.push({ label: 'Copy Text', action: 'copyText' });

        ctxMenu._handlers.editMsg = () => startEditMessage(message);
        ctxMenu._handlers.deleteMsg = () => deleteMessage(message);
        ctxMenu._handlers.copyText = () => navigator.clipboard.writeText(message.content);

        ctxMenu.show(e.clientX, e.clientY, items);
    });
}

// ?? Attach right-click to a channel button ????????????????????????????????????
function attachChannelContextMenu(el, channel) {
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const isOwner = state.currentServer && state.currentUser &&
            state.currentServer.owner_id === state.currentUser.id;
        if (!isOwner) return;

        ctxMenu._handlers.renameChannel = () => promptRenameChannel(channel);
        ctxMenu._handlers.deleteChannel = () => promptDeleteChannel(channel);

        ctxMenu.show(e.clientX, e.clientY, [
            { label: 'Rename Channel', action: 'renameChannel' },
            { label: 'Delete Channel', action: 'deleteChannel', danger: true }
        ]);
    });
}

// ?? Attach right-click to a server button ?????????????????????????????????????
function attachServerContextMenu(el, server) {
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const isOwner = state.currentUser && server.owner_id === state.currentUser.id;

        if (isOwner) {
            ctxMenu._handlers.renameServer = () => promptRenameServer(server);
            ctxMenu._handlers.deleteServer = () => promptDeleteServer(server);
            ctxMenu.show(e.clientX, e.clientY, [
                { label: 'Rename Server', action: 'renameServer' },
                { label: 'Delete Server', action: 'deleteServer', danger: true }
            ]);
        } else {
            ctxMenu._handlers.leaveServer = () => promptLeaveServer(server);
            ctxMenu.show(e.clientX, e.clientY, [
                { label: 'Leave Server', action: 'leaveServer', danger: true }
            ]);
        }
    });
}

// ?? Attach right-click to a member ???????????????????????????????????????????
function attachMemberContextMenu(el, member) {
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        ctxMenu._handlers.copyUsername = () => navigator.clipboard.writeText(member.username);

        ctxMenu.show(e.clientX, e.clientY, [
            { label: 'Copy Username', action: 'copyUsername' }
        ]);
    });
}

// ? Message edit/delete actions ???????????????????????????????????????????
let currentEditingMessage = null;

function showEditMessageModal(message) {
    currentEditingMessage = message;
    showModal({
        title: 'Edit Message',
        inputType: 'textarea',
        inputValue: message.content,
        inputPlaceholder: 'Message content',
        buttons: [
            {
                text: 'Cancel',
                style: 'secondary',
                action: () => {
                    currentEditingMessage = null;
                    closeModal();
                }
            },
            {
                text: 'Save Changes',
                style: 'primary',
                action: submitEditMessage
            }
        ]
    });
}

function submitEditMessage() {
    if (!currentEditingMessage) return;

    const newContent = getModalInputValue().trim();

    if (!newContent) {
        showModalError('Message cannot be empty.');
        return;
    }

    fetch(`/api/messages/${currentEditingMessage.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: newContent })
    }).then(async (r) => {
        if (r.ok) {
            currentEditingMessage = null;
            closeModal();
        } else {
            const data = await r.json();
            showModalError(data.error || 'Failed to edit message');
        }
    }).catch(err => {
        console.error('Edit message error:', err);
        showModalError('Failed to edit message');
    });
}

function startEditMessage(message) {
    activateInlineEdit(message);
}

function deleteMessage(message) {
    showModal({
        title: 'Delete Message',
        message: 'Are you sure you want to delete this message? This cannot be undone.',
        buttons: [
            {
                text: 'Cancel',
                style: 'secondary',
                action: closeModal
            },
            {
                text: 'Delete',
                style: 'danger',
                action: () => {
                    fetch(`/api/messages/${message.id}`, {
                        method: 'DELETE',
                        credentials: 'include'
                    }).then(async (r) => {
                        if (r.ok) {
                            closeModal();
                        } else {
                            const data = await r.json();
                            alert(data.error || 'Failed to delete message');
                        }
                    }).catch(err => {
                        console.error('Delete message error:', err);
                        alert('Failed to delete message');
                    });
                }
            }
        ]
    });
}

// ? Channel actions ???????????????????????????????????????????????????????
let currentRenamingChannel = null;

function showRenameChannelModal(channel) {
    currentRenamingChannel = channel;
    showModal({
        title: 'Rename Channel',
        inputType: 'text',
        inputValue: channel.name,
        inputPlaceholder: 'Channel name',
        buttons: [
            {
                text: 'Cancel',
                style: 'secondary',
                action: () => {
                    currentRenamingChannel = null;
                    closeModal();
                }
            },
            {
                text: 'Rename',
                style: 'primary',
                action: submitRenameChannel
            }
        ],
        onEnter: submitRenameChannel
    });
}

function submitRenameChannel() {
    if (!currentRenamingChannel) return;

    const newName = getModalInputValue().trim();

    if (!newName) {
        showModalError('Channel name cannot be empty.');
        return;
    }

    fetch(`/api/channels/${currentRenamingChannel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newName })
    }).then(async (r) => {
        if (r.ok) {
            currentRenamingChannel = null;
            closeModal();
            loadServerChannels(state.currentServer.id);
        } else {
            const data = await r.json();
            showModalError(data.error || 'Failed to rename channel');
        }
    }).catch(err => {
        console.error('Rename channel error:', err);
        showModalError('Failed to rename channel');
    });
}

function promptRenameChannel(channel) {
    showRenameChannelModal(channel);
}

function promptDeleteChannel(channel) {
    showModal({
        title: 'Delete Channel',
        message: `Are you sure you want to delete #${channel.name}? This cannot be undone.`,
        buttons: [
            {
                text: 'Cancel',
                style: 'secondary',
                action: closeModal
            },
            {
                text: 'Delete',
                style: 'danger',
                action: () => {
                    fetch(`/api/channels/${channel.id}`, {
                        method: 'DELETE',
                        credentials: 'include'
                    }).then(async (r) => {
                        if (r.ok) {
                            closeModal();
                            loadServerChannels(state.currentServer.id);
                        } else {
                            const data = await r.json();
                            alert(data.error || 'Failed to delete channel');
                        }
                    }).catch(err => {
                        console.error('Delete channel error:', err);
                        alert('Failed to delete channel');
                    });
                }
            }
        ]
    });
}

// ? Server actions ????????????????????????????????????????????????????????
let currentRenamingServer = null;

function showRenameServerModal(server) {
    currentRenamingServer = server;
    showModal({
        title: 'Rename Server',
        inputType: 'text',
        inputValue: server.name,
        inputPlaceholder: 'Server name',
        buttons: [
            {
                text: 'Cancel',
                style: 'secondary',
                action: () => {
                    currentRenamingServer = null;
                    closeModal();
                }
            },
            {
                text: 'Rename',
                style: 'primary',
                action: submitRenameServer
            }
        ],
        onEnter: submitRenameServer
    });
}

function submitRenameServer() {
    if (!currentRenamingServer) return;

    const newName = getModalInputValue().trim();

    if (!newName) {
        showModalError('Server name cannot be empty.');
        return;
    }

    fetch(`/api/servers/${currentRenamingServer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newName })
    }).then(async (r) => {
        if (r.ok) {
            currentRenamingServer = null;
            closeModal();
            loadUserServers();
        } else {
            const data = await r.json();
            showModalError(data.error || 'Failed to rename server');
        }
    }).catch(err => {
        console.error('Rename server error:', err);
        showModalError('Failed to rename server');
    });
}

function promptRenameServer(server) {
    showRenameServerModal(server);
}

function promptDeleteServer(server) {
    showModal({
        title: 'Delete Server',
        message: `Are you sure you want to delete "${server.name}"? This cannot be undone.`,
        buttons: [
            {
                text: 'Cancel',
                style: 'secondary',
                action: closeModal
            },
            {
                text: 'Delete',
                style: 'danger',
                action: () => {
                    fetch(`/api/servers/${server.id}`, {
                        method: 'DELETE',
                        credentials: 'include'
                    }).then(async (r) => {
                        if (r.ok) {
                            closeModal();
                            state.currentServer = null;
                            state.currentChannel = null;
                            state.channels = [];
                            state.categories = [];
                            state.messages = [];
                            state.members = [];
                            document.getElementById('channelsList').innerHTML = '';
                            document.getElementById('messagesContainer').innerHTML = '';
                            document.getElementById('membersPanel').innerHTML = '';
                            document.getElementById('currentServerName').textContent = 'Select a server';
                            loadUserServers();
                        } else {
                            const data = await r.json();
                            alert(data.error || 'Failed to delete server');
                        }
                    }).catch(err => {
                        console.error('Delete server error:', err);
                        alert('Failed to delete server');
                    });
                }
            }
        ]
    });
}

function promptLeaveServer(server) {
    showModal({
        title: 'Leave Server',
        message: `Are you sure you want to leave "${server.name}"?`,
        buttons: [
            {
                text: 'Cancel',
                style: 'secondary',
                action: closeModal
            },
            {
                text: 'Leave',
                style: 'danger',
                action: () => {
                    fetch(`/api/servers/${server.id}/leave`, {
                        method: 'POST',
                        credentials: 'include'
                    }).then(async (r) => {
                        if (r.ok) {
                            closeModal();
                            loadUserServers();
                        } else {
                            const data = await r.json();
                            alert(data.error || 'Failed to leave server');
                        }
                    }).catch(err => {
                        console.error('Leave server error:', err);
                        alert('Failed to leave server');
                    });
                }
            }
        ]
    });
}

// Init on DOM ready
document.addEventListener('DOMContentLoaded', () => ctxMenu.init());