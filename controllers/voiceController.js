// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/voiceController.js

import { AccessToken } from 'livekit-server-sdk';
import db from '../config/database.js';
import { PermissionHandler, PERMISSIONS } from '../config/permissions.js';

class VoiceController {
    static async getToken(req, res) {
        try {
            const userId = req.session.user.id;
            const username = req.session.user.username;
            const { channelId, serverId } = req.query;

            if (!channelId || !serverId) {
                return res.status(400).json({ error: 'channelId and serverId are required' });
            }

            // Verify channel exists, is voice, belongs to this server
            const chanResult = await db.query(
                `SELECT id, type FROM channels WHERE id = $1 AND server_id = $2`,
                [channelId, serverId]
            );
            if (chanResult.rows.length === 0) {
                return res.status(404).json({ error: 'Channel not found' });
            }
            if (chanResult.rows[0].type !== 'voice') {
                return res.status(400).json({ error: 'Not a voice channel' });
            }

            // Verify user is a server member
            const memberResult = await db.query(
                `SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2`,
                [serverId, userId]
            );
            if (memberResult.rows.length === 0) {
                return res.status(403).json({ error: 'You are not a member of this server' });
            }

            // Check owner
            const ownerResult = await db.query(
                `SELECT owner_id FROM servers WHERE id = $1`,
                [serverId]
            );
            const isOwner = ownerResult.rows[0]?.owner_id === userId;

            // Compute effective permissions for non-owners
            let userPerms = 0n;
            if (!isOwner) {
                const [rolesRes, everyoneRes] = await Promise.all([
                    db.query(
                        `SELECT COALESCE(bit_or(r.permissions::bigint), 0)::text AS perms
                         FROM roles r
                         JOIN user_roles ur ON r.id = ur.role_id
                         WHERE ur.user_id = $1 AND ur.server_id = $2`,
                        [userId, serverId]
                    ),
                    db.query(
                        `SELECT permissions FROM roles WHERE server_id = $1 AND name = '@everyone'`,
                        [serverId]
                    ),
                ]);

                userPerms = BigInt(rolesRes.rows[0]?.perms || '0');
                if (everyoneRes.rows[0]) userPerms |= BigInt(everyoneRes.rows[0].permissions);

                // ADMINISTRATOR bypasses all checks
                const isAdmin = PermissionHandler.hasPermission(userPerms, PERMISSIONS.ADMINISTRATOR);
                if (!isAdmin && !PermissionHandler.hasPermission(userPerms, PERMISSIONS.CONNECT)) {
                    return res.status(403).json({ error: 'You do not have permission to connect to voice channels' });
                }
            }

            const canSpeak = isOwner || PermissionHandler.hasPermission(userPerms, PERMISSIONS.ADMINISTRATOR)
                           || PermissionHandler.hasPermission(userPerms, PERMISSIONS.SPEAK);

            // Fetch display name (server nickname or username)
            const nickResult = await db.query(
                `SELECT nickname FROM server_members WHERE server_id = $1 AND user_id = $2`,
                [serverId, userId]
            );
            const displayName = nickResult.rows[0]?.nickname || username;

            // Generate LiveKit token
            const at = new AccessToken(
                process.env.LIVEKIT_API_KEY,
                process.env.LIVEKIT_API_SECRET,
                {
                    identity: userId,
                    name: displayName,
                    ttl: '4h',
                }
            );

            at.addGrant({
                roomJoin: true,
                room: channelId,
                canPublish: canSpeak,
                canSubscribe: true,
                canPublishData: false,
            });

            const token = await at.toJwt();

            return res.json({
                token,
                url: process.env.LIVEKIT_URL,
                channelId,
            });

        } catch (error) {
            console.error('Voice token error:', error);
            return res.status(500).json({ error: 'Failed to generate voice token' });
        }
    }

    /**
     * Get a LiveKit token for a DM voice call (audio-only).
     * GET /api/voice/dm/:dmId
     */
    static async getDMToken(req, res) {
        try {
            const userId   = req.session.user.id;
            const username = req.session.user.username;
            const { dmId } = req.params;

            // Verify user is a participant in this DM conversation
            const dmResult = await db.query(
                `SELECT id FROM direct_messages WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)`,
                [dmId, userId]
            );
            if (dmResult.rows.length === 0) {
                return res.status(403).json({ error: 'You are not in this conversation' });
            }

            const at = new AccessToken(
                process.env.LIVEKIT_API_KEY,
                process.env.LIVEKIT_API_SECRET,
                { identity: userId, name: username, ttl: '4h' }
            );

            at.addGrant({
                roomJoin:       true,
                room:           `dm_${dmId}`,
                canPublish:     true,
                canSubscribe:   true,
                canPublishData: false,
            });

            const token = await at.toJwt();
            return res.json({ token, url: process.env.LIVEKIT_URL, dmId });

        } catch (error) {
            console.error('DM voice token error:', error);
            return res.status(500).json({ error: 'Failed to generate voice token' });
        }
    }
}

export default VoiceController;
