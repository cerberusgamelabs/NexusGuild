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

let _lkRoom           = null;
let _voiceChannelId   = null;
let _voiceServerId    = null;
let _voiceDmId        = null;   // non-null when in a DM voice call
let _activeSpeakerIds = new Set();
let _lastSpeakerId    = null;
let _lastSpeakerName  = null;

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

// ── Public: DM voice call ─────────────────────────────────────────────────────

async function joinDMVoice(dmId) {
    try {
        // Leave any current call first
        if (_lkRoom && _lkRoom.state !== 'disconnected') {
            await leaveVoice();
        }

        _voiceDmId = dmId;

        const res = await fetch(`/api/voice/dm/${dmId}`, { credentials: 'include' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Failed to start voice call', 'error');
            _voiceDmId = null;
            return;
        }
        const tokenData = await res.json();

        const { Room, RoomEvent } = LivekitClient;
        _lkRoom = new Room({ adaptiveStream: true, dynacast: true });
        _lkRoom
            .on(RoomEvent.ParticipantConnected,    _onParticipantConnected)
            .on(RoomEvent.ParticipantDisconnected, _onParticipantDisconnected)
            .on(RoomEvent.ActiveSpeakersChanged,   _onActiveSpeakersChanged)
            .on(RoomEvent.TrackSubscribed,         _onTrackSubscribed)
            .on(RoomEvent.TrackUnsubscribed,       _onTrackUnsubscribed)
            .on(RoomEvent.TrackMuted,              _onTrackMuted)
            .on(RoomEvent.TrackUnmuted,            _onTrackUnmuted)
            .on(RoomEvent.Disconnected,            _onRoomDisconnected);

        try {
            await _lkRoom.connect(tokenData.url, tokenData.token);
        } catch (e) {
            showToast('Failed to connect to voice server.', 'error');
            _lkRoom = null;
            _voiceDmId = null;
            return;
        }

        if (!micMuted && !deafened) {
            await _lkRoom.localParticipant.setMicrophoneEnabled(true).catch(console.error);
        }

        if (state.socket) {
            state.socket.emit('join_dm_voice', { dmId });
            if (micMuted || deafened) {
                state.socket.emit('voice_state_change', { muted: micMuted, deafened });
            }
        }

        _showVoicePanel('dm');
        showDMVoiceBar();
    } catch (e) {
        console.error('[voice] Unhandled error in joinDMVoice:', e);
        showToast('Voice call failed.', 'error');
        _lkRoom = null;
        _voiceDmId = null;
        _hideVoicePanel();
    }
}

function showDMVoiceView() {
    // Show the split bar and render messages below it
    showDMVoiceBar();
    if (typeof isInDMMode === 'function' && isInDMMode() &&
        typeof renderDMMessages === 'function') {
        renderDMMessages();
    }
}

function isInDMVoice() {
    return !!(_lkRoom && _lkRoom.state !== 'disconnected' && _voiceDmId);
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
        // Sync current mute/deafen state immediately — server resets to false on join_voice
        // so we must re-broadcast if the user was already muted/deafened.
        if (micMuted || deafened) {
            state.socket.emit('voice_state_change', { muted: micMuted, deafened });
        }
    }

    _showVoicePanel(channelId);
    showVoiceView();
}

async function leaveVoice() {
    if (!_lkRoom) return;

    const channelId = _voiceChannelId;
    const serverId  = _voiceServerId;
    const dmId      = _voiceDmId;

    // Notify Socket.io before disconnect
    if (state.socket) {
        if (dmId) {
            state.socket.emit('leave_dm_voice', { dmId });
        } else if (channelId && serverId) {
            state.socket.emit('leave_voice', { channelId, serverId });
        }
    }

    try {
        await _lkRoom.localParticipant.setMicrophoneEnabled(false);
    } catch (_) {}

    await _lkRoom.disconnect();

    // Remove all injected audio elements
    document.querySelectorAll('[id^="voice-audio-"]').forEach(el => el.remove());

    const wasChannelId = _voiceChannelId;
    const wasServerId  = _voiceServerId;
    const wasDmId      = _voiceDmId;

    _lkRoom          = null;
    _voiceChannelId  = null;
    _voiceServerId   = null;
    _voiceDmId       = null;
    _activeSpeakerIds.clear();
    _lastSpeakerId   = null;
    _lastSpeakerName = null;

    _hideVoicePanel();

    if (wasDmId) {
        // Restore DM message view
        if (typeof isInDMMode === 'function' && isInDMMode() &&
            typeof renderDMMessages === 'function') {
            renderDMMessages();
        }
    } else if (state.currentChannel?.id === wasChannelId) {
        // Restore voice channel join splash
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
    if (speakers.length > 0) {
        _lastSpeakerId  = speakers[0].identity;
        _lastSpeakerName = speakers[0].name || speakers[0].identity;
        _updateMiniPanelLastSpeaker();
    }
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
    const dmId      = _voiceDmId;

    if (state.socket) {
        if (dmId) {
            state.socket.emit('leave_dm_voice', { dmId });
        } else if (channelId && serverId) {
            state.socket.emit('leave_voice', { channelId, serverId });
        }
    }

    document.querySelectorAll('[id^="voice-audio-"]').forEach(el => el.remove());

    const wasChannelId = _voiceChannelId;
    const wasServerId  = _voiceServerId;
    const wasDmId      = _voiceDmId;

    _lkRoom          = null;
    _voiceChannelId  = null;
    _voiceServerId   = null;
    _voiceDmId       = null;
    _activeSpeakerIds.clear();
    _lastSpeakerId   = null;
    _lastSpeakerName = null;
    _hideVoicePanel();

    if (wasDmId) {
        if (typeof isInDMMode === 'function' && isInDMMode() &&
            typeof renderDMMessages === 'function') {
            renderDMMessages();
        }
    } else if (state.currentChannel?.id === wasChannelId) {
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
    let label;
    if (channelId === 'dm') {
        label = 'DM Call';
    } else {
        const channel = state.channels.find(c => c.id === channelId);
        label = channel ? channel.name : 'Voice Channel';
    }
    showVoiceMiniPanel(label);
}

function _hideVoicePanel() {
    hideVoiceMiniPanel();
    hideDMVoiceBar();
}

function _renderVoiceParticipants() {
    _renderFullGrid();
    _renderDMBar();
    _updateMiniPanelParticipants();
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
        let remoteMuted  = false;
        p.trackPublications.forEach(pub => {
            if (pub.source === LivekitClient.Track.Source.Microphone) remoteMuted = pub.isMuted;
        });
        grid.appendChild(_makeVoiceTile(p.identity, p.name || p.identity, remoteMuted, false, isSpeaking, false));
    });
}


function _updateSpeakingIndicators() {
    // Full grid
    const grid = document.getElementById('voiceFullGrid');
    if (grid) {
        grid.querySelectorAll('.voice-tile').forEach(el => {
            const speaking = _activeSpeakerIds.has(el.dataset.userId);
            el.classList.toggle('speaking', speaking);
            el.querySelector('.voice-tile-av-wrap')?.classList.toggle('speaking', speaking);
        });
    }

    // DM voice bar grid
    const dmGrid = document.getElementById('dmVoiceGrid');
    if (dmGrid) {
        dmGrid.querySelectorAll('.voice-tile').forEach(el => {
            const speaking = _activeSpeakerIds.has(el.dataset.userId);
            el.classList.toggle('speaking', speaking);
            el.querySelector('.voice-tile-av-wrap')?.classList.toggle('speaking', speaking);
        });
    }

    // Mini panel participants
    const vmpParticipants = document.getElementById('vmpParticipants');
    if (vmpParticipants) {
        vmpParticipants.querySelectorAll('.vmp-participant').forEach(el => {
            const speaking = _activeSpeakerIds.has(el.dataset.userId);
            el.classList.toggle('vmp-speaking', speaking);
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

// Called by socket.js on every socket 'connect' event (initial + reconnect).
// Re-announces voice presence and syncs mute/deafen state so the server's
// in-memory voiceStates Map is never stale after a reconnect.
function onSocketReconnect() {
    if (!_lkRoom || _lkRoom.state === 'disconnected') return;
    if (!state.socket) return;

    if (_voiceDmId) {
        state.socket.emit('join_dm_voice', { dmId: _voiceDmId });
    } else if (_voiceChannelId && _voiceServerId) {
        state.socket.emit('join_voice', { channelId: _voiceChannelId, serverId: _voiceServerId });
    }

    // join_voice/join_dm_voice resets muted to false on the server, so re-sync immediately
    if (micMuted || deafened) {
        state.socket.emit('voice_state_change', { muted: micMuted, deafened });
    }
}

// ── Voice Mini Panel ──────────────────────────────────────────────────────────

function getVoiceDmId() {
    return _voiceDmId;
}

function showVoiceMiniPanel(label) {
    const panel   = document.getElementById('voiceMiniPanel');
    const labelEl = document.getElementById('vmpLabel');
    const iconEl  = document.getElementById('vmpIcon');
    if (!panel) return;
    if (labelEl) labelEl.textContent = label || 'Voice Connected';
    if (iconEl)  iconEl.textContent  = _voiceDmId ? '📞' : '🔊';
    panel.style.display = 'flex';

    // Sync mute/deafen button state to match the main toggle buttons
    const muteBtn   = document.getElementById('vmpMuteBtn');
    const deafBtn   = document.getElementById('vmpDeafBtn');
    if (muteBtn) {
        muteBtn.classList.toggle('active', !!micMuted);
        muteBtn.querySelector('img').src = `img/mute-${micMuted ? 'on' : 'off'}.png`;
    }
    if (deafBtn) {
        deafBtn.classList.toggle('active', !!deafened);
        deafBtn.querySelector('img').src = `img/deafen-${deafened ? 'on' : 'off'}.png`;
    }
}

function hideVoiceMiniPanel() {
    const panel = document.getElementById('voiceMiniPanel');
    if (panel) panel.style.display = 'none';
}

function returnToVoice() {
    if (_voiceDmId) {
        if (typeof selectDMConversation === 'function') selectDMConversation(_voiceDmId);
    } else if (_voiceChannelId) {
        if (typeof selectChannel === 'function') selectChannel(_voiceChannelId);
    }
}

function _updateMiniPanelParticipants() {
    const container = document.getElementById('vmpParticipants');
    if (!container || !_lkRoom) return;
    container.innerHTML = '';

    const local = _lkRoom.localParticipant;
    if (local) {
        const isSpeaking = _activeSpeakerIds.has(local.identity);
        container.appendChild(_makeMiniParticipant(local.identity, local.name || local.identity, isSpeaking));
    }

    _lkRoom.remoteParticipants.forEach(p => {
        const isSpeaking = _activeSpeakerIds.has(p.identity);
        container.appendChild(_makeMiniParticipant(p.identity, p.name || p.identity, isSpeaking));
    });

    _updateMiniPanelLastSpeaker();
}

function _makeMiniParticipant(userId, displayName, speaking) {
    const member = state.members?.find(m => m.id === userId);
    const avatar = member?.avatar;

    const el = document.createElement('div');
    el.className      = `vmp-participant${speaking ? ' vmp-speaking' : ''}`;
    el.dataset.userId = userId;
    el.title          = displayName;

    if (avatar) {
        el.innerHTML = `<img src="${avatar}" class="vmp-participant-avatar" alt="">`;
    } else {
        el.innerHTML = `<div class="vmp-participant-avatar vmp-participant-initials">${getInitials(displayName)}</div>`;
    }
    return el;
}

function _updateMiniPanelLastSpeaker() {
    const el = document.getElementById('vmpLastSpeaker');
    if (!el) return;
    if (!_lastSpeakerId || !_lastSpeakerName) {
        el.style.display = 'none';
        return;
    }
    const member   = state.members?.find(m => m.id === _lastSpeakerId);
    const avatar   = member?.avatar;
    const isLocal  = _lkRoom?.localParticipant?.identity === _lastSpeakerId;
    const label    = isLocal ? `${_lastSpeakerName} (you)` : _lastSpeakerName;
    const avatarHtml = avatar
        ? `<img src="${avatar}" class="vmp-ls-avatar" alt="">`
        : `<div class="vmp-ls-avatar vmp-ls-initials">${getInitials(_lastSpeakerName)}</div>`;
    el.style.display = 'flex';
    el.innerHTML = `<span class="vmp-ls-icon">🗣</span>${avatarHtml}<span class="vmp-ls-name">${label}</span>`;
}

// ── DM Voice Split Bar ────────────────────────────────────────────────────────

function showDMVoiceBar() {
    const bar = document.getElementById('dmVoiceBar');
    if (!bar || !_lkRoom) return;
    bar.style.display = 'flex';
    _renderDMBar();
}

function hideDMVoiceBar() {
    const bar = document.getElementById('dmVoiceBar');
    if (!bar) return;
    bar.style.display = 'none';
    const grid = document.getElementById('dmVoiceGrid');
    if (grid) grid.innerHTML = '';
}

function _renderDMBar() {
    const bar  = document.getElementById('dmVoiceBar');
    const grid = document.getElementById('dmVoiceGrid');
    if (!bar || bar.style.display === 'none' || !grid || !_lkRoom) return;

    grid.innerHTML = '';

    const local = _lkRoom.localParticipant;
    if (local) {
        const isSpeaking = _activeSpeakerIds.has(local.identity);
        const isMuted    = !local.isMicrophoneEnabled;
        grid.appendChild(_makeVoiceTile(local.identity, local.name || local.identity, isMuted, deafened, isSpeaking, true));
    }

    _lkRoom.remoteParticipants.forEach(p => {
        const isSpeaking = _activeSpeakerIds.has(p.identity);
        let remoteMuted  = false;
        p.trackPublications.forEach(pub => {
            if (pub.source === LivekitClient.Track.Source.Microphone) remoteMuted = pub.isMuted;
        });
        grid.appendChild(_makeVoiceTile(p.identity, p.name || p.identity, remoteMuted, false, isSpeaking, false));
    });
}
