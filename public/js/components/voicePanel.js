// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /public/js/components/voicePanel.js
//
// Manages the LiveKit voice connection and voice UI.
// Globals used from other scripts:
//   LivekitClient  — UMD CDN build on window
//   state          — app.js global state object
//   micMuted       — app.js global
//   deafened       — app.js global
//   renderChannelList — channelList.js
//   getInitials    — memberList.js

// ── Module state ──────────────────────────────────────────────────────────────

let _lkRoom          = null;
let _voiceChannelId  = null;
let _voiceServerId   = null;
let _activeSpeakerIds = new Set();

// ── Public: join/leave ────────────────────────────────────────────────────────

async function joinVoice(channelId, serverId) {
    try {
        await _joinVoiceInternal(channelId, serverId);
    } catch (e) {
        console.error('[voice] Unhandled error in joinVoice:', e);
        showToast('Voice connection failed. Check the console for details.', 'error');
        _lkRoom = null;
        _voiceChannelId = null;
        _voiceServerId = null;
        _hideVoicePanel();
    }
}

async function _joinVoiceInternal(channelId, serverId) {
    // Idempotent — already in this channel
    if (_lkRoom && _lkRoom.state !== 'disconnected' && _voiceChannelId === channelId) return;

    // One connection at a time — leave current first
    if (_lkRoom && _lkRoom.state !== 'disconnected') {
        await leaveVoice();
    }

    _voiceChannelId = channelId;
    _voiceServerId  = serverId;

    // Fetch token from backend
    let tokenData;
    try {
        const res = await fetch(
            `/api/voice/token?channelId=${channelId}&serverId=${serverId}`,
            { credentials: 'include' }
        );
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Failed to join voice channel', 'error');
            _voiceChannelId = null;
            _voiceServerId  = null;
            return;
        }
        tokenData = await res.json();
    } catch (e) {
        console.error('Voice token fetch failed:', e);
        showToast('Could not connect to voice. Please try again.', 'error');
        _voiceChannelId = null;
        _voiceServerId  = null;
        return;
    }

    const { Room, RoomEvent } = LivekitClient;

    _lkRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
    });

    // Bind room events
    _lkRoom
        .on(RoomEvent.ParticipantConnected,    _onParticipantConnected)
        .on(RoomEvent.ParticipantDisconnected, _onParticipantDisconnected)
        .on(RoomEvent.ActiveSpeakersChanged,   _onActiveSpeakersChanged)
        .on(RoomEvent.TrackSubscribed,         _onTrackSubscribed)
        .on(RoomEvent.TrackUnsubscribed,       _onTrackUnsubscribed)
        .on(RoomEvent.TrackMuted,              _onTrackMuted)
        .on(RoomEvent.TrackUnmuted,            _onTrackUnmuted)
        .on(RoomEvent.Disconnected,            _onRoomDisconnected);

    // Connect to LiveKit Cloud
    try {
        await _lkRoom.connect(tokenData.url, tokenData.token);
    } catch (e) {
        console.error('LiveKit connect failed:', e);
        showToast('Failed to connect to voice server.', 'error');
        _lkRoom = null;
        _voiceChannelId = null;
        _voiceServerId  = null;
        return;
    }

    // Enable mic (respects current mute/deafen state from app.js)
    if (!micMuted && !deafened) {
        await _lkRoom.localParticipant.setMicrophoneEnabled(true).catch(err => {
            console.error('Could not enable microphone:', err);
        });
    }

    // Apply current deafen state to any already-subscribed remote tracks
    if (deafened) {
        _lkRoom.remoteParticipants.forEach(p => {
            p.trackPublications.forEach(pub => {
                if (pub.track?.kind === 'audio') {
                    pub.track.mediaStreamTrack.enabled = false;
                }
            });
        });
    }

    // Notify Socket.io (drives channel list presence for all members)
    if (state.socket) {
        state.socket.emit('join_voice', { channelId, serverId });
    }

    _showVoicePanel(channelId);
    showVoiceView();
}

async function leaveVoice() {
    if (!_lkRoom) return;

    const channelId = _voiceChannelId;
    const serverId  = _voiceServerId;

    // Notify Socket.io before disconnect so serverId is still set
    if (state.socket && channelId && serverId) {
        state.socket.emit('leave_voice', { channelId, serverId });
    }

    try {
        await _lkRoom.localParticipant.setMicrophoneEnabled(false);
    } catch (_) {}

    await _lkRoom.disconnect();

    // Remove all injected audio elements
    document.querySelectorAll('[id^="voice-audio-"]').forEach(el => el.remove());

    const wasChannelId  = _voiceChannelId;
    const wasServerId   = _voiceServerId;

    _lkRoom          = null;
    _voiceChannelId  = null;
    _voiceServerId   = null;
    _activeSpeakerIds.clear();

    _hideVoicePanel();

    // If still viewing the voice channel, restore the join splash
    if (state.currentChannel?.id === wasChannelId) {
        const channel   = state.channels.find(c => c.id === wasChannelId);
        const container = document.getElementById('messagesContainer');
        if (container && channel) {
            container.innerHTML = `
                <div class="channel-splash">
                    <div class="channel-splash-icon">🔊</div>
                    <div class="channel-splash-name">${channel.name}</div>
                    <button class="btn-primary voice-join-splash-btn"
                            onclick="joinVoice('${channel.id}','${wasServerId}')">
                        Join Voice
                    </button>
                </div>`;
        }
    }
}

// ── Public: called by toggleMic() / toggleDeafen() in app.js ─────────────────

function setLiveKitMicMuted(muted) {
    if (!_lkRoom) return;
    _lkRoom.localParticipant.setMicrophoneEnabled(!muted)
        .catch(err => console.error('setMicrophoneEnabled error:', err));
}

function setLiveKitDeafened(isDeafened) {
    document.querySelectorAll('[id^="voice-audio-"]').forEach(el => {
        el.muted = isDeafened;
    });
}

// ── Room event handlers ───────────────────────────────────────────────────────

function _onTrackSubscribed(track, publication, participant) {
    if (track.kind !== 'audio') return;
    const el = track.attach();
    el.id = `voice-audio-${participant.identity}`;
    el.muted = deafened;
    document.body.appendChild(el);
}

function _onTrackUnsubscribed(track, publication, participant) {
    if (track.kind !== 'audio') return;
    track.detach().forEach(el => el.remove());
}

function _onParticipantConnected() {
    _renderVoiceParticipants();
}

function _onParticipantDisconnected(participant) {
    _activeSpeakerIds.delete(participant.identity);
    _renderVoiceParticipants();
}

function _onActiveSpeakersChanged(speakers) {
    _activeSpeakerIds.clear();
    speakers.forEach(p => _activeSpeakerIds.add(p.identity));
    _updateSpeakingIndicators();
}

function _onTrackMuted() {
    _renderVoiceParticipants();
}

function _onTrackUnmuted() {
    _renderVoiceParticipants();
}

function _onRoomDisconnected() {
    const channelId = _voiceChannelId;
    const serverId  = _voiceServerId;

    if (state.socket && channelId && serverId) {
        state.socket.emit('leave_voice', { channelId, serverId });
    }

    document.querySelectorAll('[id^="voice-audio-"]').forEach(el => el.remove());

    const wasChannelId = _voiceChannelId;
    const wasServerId  = _voiceServerId;

    _lkRoom          = null;
    _voiceChannelId  = null;
    _voiceServerId   = null;
    _activeSpeakerIds.clear();
    _hideVoicePanel();

    if (state.currentChannel?.id === wasChannelId) {
        const channel   = state.channels.find(c => c.id === wasChannelId);
        const container = document.getElementById('messagesContainer');
        if (container && channel) {
            container.innerHTML = `
                <div class="channel-splash">
                    <div class="channel-splash-icon">🔊</div>
                    <div class="channel-splash-name">${channel.name}</div>
                    <button class="btn-primary voice-join-splash-btn"
                            onclick="joinVoice('${channel.id}','${wasServerId}')">
                        Join Voice
                    </button>
                </div>`;
        }
    }
}

// ── Panel UI ──────────────────────────────────────────────────────────────────

function _showVoicePanel(channelId) {
    const panel  = document.getElementById('voicePanel');
    const nameEl = document.getElementById('voicePanelChannelName');
    if (!panel) return;

    const channel = state.channels.find(c => c.id === channelId);
    if (nameEl) nameEl.textContent = channel ? channel.name : 'Voice Channel';

    panel.style.display = 'flex';
}

function _hideVoicePanel() {
    const panel = document.getElementById('voicePanel');
    if (panel) panel.style.display = 'none';
}

function _renderVoiceParticipants() {
    _renderThinBar();
    _renderFullGrid();
}

function _renderThinBar() {
    const list = document.getElementById('voiceParticipantList');
    if (!list || !_lkRoom) return;

    list.innerHTML = '';

    const local = _lkRoom.localParticipant;
    if (local) {
        const isSpeaking = _activeSpeakerIds.has(local.identity);
        const isMuted    = !local.isMicrophoneEnabled;
        list.appendChild(_makeParticipantEl(local.identity, local.name || local.identity, isMuted, deafened, isSpeaking, true));
    }

    _lkRoom.remoteParticipants.forEach(p => {
        const isSpeaking = _activeSpeakerIds.has(p.identity);
        let remoteMuted  = true;
        p.trackPublications.forEach(pub => {
            if (pub.source === LivekitClient.Track.Source.Microphone) remoteMuted = pub.isMuted;
        });
        list.appendChild(_makeParticipantEl(p.identity, p.name || p.identity, remoteMuted, false, isSpeaking, false));
    });
}

function _renderFullGrid() {
    const grid = document.getElementById('voiceFullGrid');
    if (!grid || !_lkRoom) return;

    grid.innerHTML = '';

    const local = _lkRoom.localParticipant;
    if (local) {
        const isSpeaking = _activeSpeakerIds.has(local.identity);
        const isMuted    = !local.isMicrophoneEnabled;
        grid.appendChild(_makeVoiceTile(local.identity, local.name || local.identity, isMuted, deafened, isSpeaking, true));
    }

    _lkRoom.remoteParticipants.forEach(p => {
        const isSpeaking = _activeSpeakerIds.has(p.identity);
        let remoteMuted  = true;
        p.trackPublications.forEach(pub => {
            if (pub.source === LivekitClient.Track.Source.Microphone) remoteMuted = pub.isMuted;
        });
        grid.appendChild(_makeVoiceTile(p.identity, p.name || p.identity, remoteMuted, false, isSpeaking, false));
    });
}

function _makeParticipantEl(userId, displayName, muted, isDeafened, speaking, isLocal) {
    const member    = state.members?.find(m => m.id === userId);
    const avatar    = member?.avatar;
    const roleColor = member?.role_color;

    const avatarHtml = avatar
        ? `<img src="${avatar}" class="voice-participant-avatar" alt="">`
        : `<div class="voice-participant-avatar voice-participant-initials">${getInitials(displayName)}</div>`;

    const nameStyle    = roleColor ? ` style="color:${roleColor}"` : '';
    const speakingClass = speaking ? ' speaking' : '';
    const label        = isLocal ? `${displayName} (you)` : displayName;

    const el = document.createElement('div');
    el.className    = `voice-participant${speakingClass}`;
    el.dataset.userId = userId;
    el.innerHTML = `
        <div class="voice-participant-av-wrap${speakingClass}">${avatarHtml}</div>
        <span class="voice-participant-name"${nameStyle}>${label}</span>
        <div class="voice-participant-icons">
            ${muted      ? '<span class="voice-icon" title="Muted">&#128263;</span>'     : ''}
            ${isDeafened ? '<span class="voice-icon" title="Deafened">&#128264;</span>' : ''}
        </div>`;
    return el;
}

function _updateSpeakingIndicators() {
    // Thin bar
    const list = document.getElementById('voiceParticipantList');
    if (list) {
        list.querySelectorAll('.voice-participant').forEach(el => {
            const speaking = _activeSpeakerIds.has(el.dataset.userId);
            el.classList.toggle('speaking', speaking);
            el.querySelector('.voice-participant-av-wrap')?.classList.toggle('speaking', speaking);
        });
    }

    // Full grid
    const grid = document.getElementById('voiceFullGrid');
    if (grid) {
        grid.querySelectorAll('.voice-tile').forEach(el => {
            const speaking = _activeSpeakerIds.has(el.dataset.userId);
            el.classList.toggle('speaking', speaking);
            el.querySelector('.voice-tile-av-wrap')?.classList.toggle('speaking', speaking);
        });
    }
}

// ── Full voice view (rendered into messagesContainer) ─────────────────────────

function isInVoiceChannel(channelId) {
    return !!(_lkRoom && _lkRoom.state !== 'disconnected' && _voiceChannelId === channelId);
}

function showVoiceView() {
    const container = document.getElementById('messagesContainer');
    if (!container || !_lkRoom) return;

    const channel = state.channels.find(c => c.id === _voiceChannelId);
    const channelName = channel ? channel.name : 'Voice Channel';

    container.innerHTML = `
        <div class="voice-full-view">
            <div class="voice-full-header">🔊 ${channelName}</div>
            <div class="voice-full-grid" id="voiceFullGrid"></div>
            <div class="voice-full-controls">
                <button class="voice-full-leave-btn" onclick="leaveVoice()">Leave Call</button>
            </div>
        </div>`;

    _renderFullGrid();
}

function _makeVoiceTile(userId, displayName, muted, isDeafened, speaking, isLocal) {
    const member    = state.members?.find(m => m.id === userId);
    const avatar    = member?.avatar;
    const roleColor = member?.role_color;

    const avatarHtml = avatar
        ? `<img src="${avatar}" class="voice-tile-avatar" alt="">`
        : `<div class="voice-tile-avatar voice-tile-initials">${getInitials(displayName)}</div>`;

    const nameStyle     = roleColor ? ` style="color:${roleColor}"` : '';
    const speakingClass = speaking ? ' speaking' : '';
    const label         = isLocal ? `${displayName} (you)` : displayName;

    const el = document.createElement('div');
    el.className     = `voice-tile${speakingClass}`;
    el.dataset.userId = userId;
    el.innerHTML = `
        <div class="voice-tile-av-wrap${speakingClass}">${avatarHtml}</div>
        <div class="voice-tile-name"${nameStyle}>${label}</div>
        <div class="voice-tile-icons">
            ${muted      ? '<span class="voice-icon" title="Muted">&#128263;</span>'     : ''}
            ${isDeafened ? '<span class="voice-icon" title="Deafened">&#128264;</span>' : ''}
        </div>`;
    return el;
}

// ── Socket event handlers (called from socket.js) ─────────────────────────────

function onVoiceStateUpdate(data) {
    if (!state.voiceStates) state.voiceStates = {};
    if (data.joined) {
        state.voiceStates[data.userId] = {
            channelId: data.channelId,
            username:  data.username,
            userId:    data.userId,
        };
    } else {
        delete state.voiceStates[data.userId];
    }
    renderChannelList(state.channels, state.categories);
}

function onUserVoiceState() {
    _renderVoiceParticipants();
}
