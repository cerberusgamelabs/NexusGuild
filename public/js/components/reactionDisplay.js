// File Location: /public/js/components/reactionDisplay.js

/**
 * Reaction Display Component
 * Shows reactions under messages and handles toggling
 */

/**
 * Render reactions for a message
 * @param {Array} reactions - Array of {emoji, count, users}
 * @param {string} messageId - Message ID
 * @returns {string} HTML string
 */
function renderReactions(reactions, messageId) {
    if (!reactions || reactions.length === 0) {
        return '';
    }

    return `
        <div class="message-reactions" data-message-id="${messageId}">
            ${reactions.map(reaction => renderReactionBubble(reaction, messageId)).join('')}
        </div>
    `;
}

/**
 * Render a single reaction bubble
 */
function renderReactionBubble(reaction, messageId) {
    const { emoji, count, users } = reaction;
    const userIds = users.map(u => u.userId);
    const hasReacted = userIds.includes(state.currentUser.id);
    const activeClass = hasReacted ? 'reacted' : '';
    
    // Format emoji (handle both unicode and custom)
    let emojiDisplay = emoji;
    if (emoji.startsWith('custom:')) {
        const [, serverId, name] = emoji.split(':');
        emojiDisplay = `<img src="/img/emoji/${serverId}/${name}.png" alt=":${name}:" class="custom-emoji-small" />`;
    }

    // Create tooltip showing who reacted
    const usernames = users.map(u => u.username).join(', ');
    const tooltip = count === 1 
        ? usernames 
        : `${usernames.split(',').slice(0, 3).join(',')}${count > 3 ? ` and ${count - 3} more` : ''}`;

    return `
        <button 
            class="reaction-bubble ${activeClass}" 
            onclick="toggleReaction('${messageId}', '${emoji.replace(/'/g, "\\'")}')"
            title="${tooltip}"
            data-emoji="${emoji}"
        >
            <span class="reaction-emoji">${emojiDisplay}</span>
            <span class="reaction-count">${count}</span>
        </button>
    `;
}

/**
 * Toggle reaction (add if not reacted, remove if already reacted)
 */
async function toggleReaction(messageId, emoji) {
    try {
        // Get current reaction state
        const reactionBubble = document.querySelector(
            `.reaction-bubble[data-emoji="${emoji}"]`
        );
        const hasReacted = reactionBubble?.classList.contains('reacted');

        if (hasReacted) {
            await removeReaction(messageId, emoji);
        } else {
            const response = await fetch(`/api/reactions/messages/${messageId}/reactions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ emoji })
            });

            if (!response.ok) {
                const data = await response.json();
                console.error('Failed to add reaction:', data.error);
            }
        }
    } catch (error) {
        console.error('Error toggling reaction:', error);
    }
}

/**
 * Update reactions display for a message
 * Called when socket events are received
 */
function updateMessageReactions(messageId, reactions) {
    // Find the message element
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageElement) return;

    // Find or create reactions container
    let reactionsContainer = messageElement.querySelector('.message-reactions');
    
    if (reactions.length === 0) {
        // Remove reactions container if no reactions
        if (reactionsContainer) {
            reactionsContainer.remove();
        }
        return;
    }

    const reactionsHTML = renderReactions(reactions, messageId);
    
    if (reactionsContainer) {
        // Update existing container
        reactionsContainer.outerHTML = reactionsHTML;
    } else {
        // Add new container after message content
        const messageContent = messageElement.querySelector('.message-content');
        if (messageContent) {
            messageContent.insertAdjacentHTML('afterend', reactionsHTML);
        }
    }
}

/**
 * Load reactions for all visible messages
 */
async function loadMessageReactions(messages) {
    for (const message of messages) {
        try {
            const response = await fetch(`/api/reactions/messages/${message.id}/reactions`, {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                if (data.reactions.length > 0) {
                    message.reactions = data.reactions;
                }
            }
        } catch (error) {
            console.error('Error loading reactions for message:', message.id, error);
        }
    }
}