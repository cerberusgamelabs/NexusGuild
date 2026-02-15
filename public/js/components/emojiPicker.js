// File Location: /public/js/components/emojiPicker.js

/**
 * Emoji Picker Component
 * Displays global and server-specific emojis for reactions
 */

// Common global emojis (Unicode)
const GLOBAL_EMOJIS = [
    '??', '??', '??', '??', '??', '??', '??', '??', '??', '?',
    '?', '?', '??', '??', '??', '??', '??', '??', '??', '??',
    '??', '??', '??', '?', '??', '??', '??', '??', '??', '??',
    '??', '??', '??', '??', '??', '??', '??', '??', '??', '??'
];

let currentEmojiPickerMessageId = null;
let serverEmojis = { global: [], server: [] };

/**
 * Show emoji picker for a message
 */
async function showEmojiPicker(messageId, buttonElement) {
    currentEmojiPickerMessageId = messageId;

    // Load custom emojis if not already loaded
    if (state.currentServer && serverEmojis.server.length === 0) {
        await loadServerEmojis(state.currentServer.id);
    }

    const picker = document.getElementById('emojiPickerModal');
    const globalTab = document.getElementById('emojiPickerGlobal');
    const serverTab = document.getElementById('emojiPickerServer');

    // Render global emojis
    globalTab.innerHTML = GLOBAL_EMOJIS.map(emoji => 
        `<button class="emoji-option" onclick="selectEmoji('${emoji}')">${emoji}</button>`
    ).join('');

    // Render server custom emojis
    if (serverEmojis.server.length > 0) {
        serverTab.innerHTML = serverEmojis.server.map(emoji => 
            `<button class="emoji-option" onclick="selectEmoji('custom:${state.currentServer.id}:${emoji.name}')">
                <img src="/img/emoji/${emoji.server_id}/${emoji.filename}" alt="${emoji.name}" title=":${emoji.name}:" />
            </button>`
        ).join('');
        document.getElementById('emojiTabServer').style.display = 'block';
    } else {
        serverTab.innerHTML = '<p class="emoji-empty">No custom emojis yet</p>';
        document.getElementById('emojiTabServer').style.display = 'block';
    }

    // Position picker near button
    const rect = buttonElement.getBoundingClientRect();
    picker.style.display = 'block';
    picker.style.top = `${rect.bottom + 5}px`;
    picker.style.left = `${rect.left}px`;

    // Switch to global tab by default
    switchEmojiTab('global');
}

/**
 * Switch between emoji tabs
 */
function switchEmojiTab(tab) {
    const globalBtn = document.getElementById('emojiTabGlobal');
    const serverBtn = document.getElementById('emojiTabServer');
    const globalContent = document.getElementById('emojiPickerGlobal');
    const serverContent = document.getElementById('emojiPickerServer');

    if (tab === 'global') {
        globalBtn.classList.add('active');
        serverBtn.classList.remove('active');
        globalContent.style.display = 'grid';
        serverContent.style.display = 'none';
    } else {
        globalBtn.classList.remove('active');
        serverBtn.classList.add('active');
        globalContent.style.display = 'none';
        serverContent.style.display = 'grid';
    }
}

/**
 * Select an emoji and add reaction
 */
async function selectEmoji(emoji) {
    if (!currentEmojiPickerMessageId) return;

    try {
        const response = await fetch(`/api/reactions/messages/${currentEmojiPickerMessageId}/reactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ emoji })
        });

        const data = await response.json();

        if (!response.ok) {
            if (data.error === 'You already reacted with this emoji') {
                // If already reacted, remove it instead
                await removeReaction(currentEmojiPickerMessageId, emoji);
            } else {
                console.error('Failed to add reaction:', data.error);
            }
        }

        closeEmojiPicker();
    } catch (error) {
        console.error('Error adding reaction:', error);
    }
}

/**
 * Remove a reaction
 */
async function removeReaction(messageId, emoji) {
    try {
        const response = await fetch(`/api/reactions/messages/${messageId}/reactions`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ emoji })
        });

        if (!response.ok) {
            const data = await response.json();
            console.error('Failed to remove reaction:', data.error);
        }
    } catch (error) {
        console.error('Error removing reaction:', error);
    }
}

/**
 * Load server custom emojis
 */
async function loadServerEmojis(serverId) {
    try {
        const response = await fetch(`/api/reactions/servers/${serverId}/emojis`, {
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            serverEmojis = data;
        }
    } catch (error) {
        console.error('Error loading server emojis:', error);
    }
}

/**
 * Close emoji picker
 */
function closeEmojiPicker() {
    const picker = document.getElementById('emojiPickerModal');
    picker.style.display = 'none';
    currentEmojiPickerMessageId = null;
}

// Close picker when clicking outside
document.addEventListener('click', (e) => {
    const picker = document.getElementById('emojiPickerModal');
    const emojiButton = e.target.closest('.message-emoji-btn');
    
    if (picker && picker.style.display === 'block' && !picker.contains(e.target) && !emojiButton) {
        closeEmojiPicker();
    }
});