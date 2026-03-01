// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/groupDmController.js

import db from '../config/database.js';
import { log, tags } from '#utils/logging';
import { generateSnowflake } from '../utils/functions.js';

// Helper: fetch all member IDs of a group DM, returns [] if not found
async function getGroupMembers(groupDmId) {
    const r = await db.query(
        `SELECT user_id FROM group_dm_members WHERE group_dm_id = $1`,
        [groupDmId]
    );
    return r.rows.map(row => row.user_id);
}

// Helper: emit an event to every member of the group via their personal room
function emitToMembers(io, memberIds, event, payload) {
    for (const uid of memberIds) {
        io.to(`user:${uid}`).emit(event, payload);
    }
}

class GroupDmController {

    // POST /api/group-dm  { name?, userIds[] }
    static async createGroupDm(req, res) {
        try {
            const ownerId = req.session.user.id;
            const { name, userIds } = req.body;

            if (!Array.isArray(userIds) || userIds.length < 1) {
                return res.status(400).json({ error: 'At least 1 other user is required' });
            }

            // Deduplicate and ensure requester is included
            const allIds = [...new Set([ownerId, ...userIds])];

            // Verify all target users exist
            const usersCheck = await db.query(
                `SELECT id FROM users WHERE id = ANY($1::varchar[])`,
                [allIds]
            );
            if (usersCheck.rows.length !== allIds.length) {
                return res.status(400).json({ error: 'One or more users not found' });
            }

            const id = generateSnowflake();
            await db.query(
                `INSERT INTO group_dms (id, name, owner_id) VALUES ($1, $2, $3)`,
                [id, name?.trim() || null, ownerId]
            );

            const memberInserts = allIds.map(uid =>
                db.query(
                    `INSERT INTO group_dm_members (group_dm_id, user_id) VALUES ($1, $2)`,
                    [id, uid]
                )
            );
            await Promise.all(memberInserts);

            const gdm = await GroupDmController._fetchGroupDm(id, ownerId);
            res.status(201).json({ groupDm: gdm });
        } catch (error) {
            log(tags.error, 'createGroupDm error:', error);
            res.status(500).json({ error: 'Failed to create group DM' });
        }
    }

    // GET /api/group-dm
    static async getGroupConversations(req, res) {
        try {
            const userId = req.session.user.id;

            const result = await db.query(
                `SELECT
                    g.id,
                    g.name,
                    g.avatar,
                    g.owner_id,
                    g.last_message_at,
                    g.created_at,
                    (SELECT content FROM group_dm_messages WHERE group_dm_id = g.id ORDER BY created_at DESC LIMIT 1) AS last_message,
                    (SELECT attachments FROM group_dm_messages WHERE group_dm_id = g.id ORDER BY created_at DESC LIMIT 1) AS last_attachments
                 FROM group_dms g
                 JOIN group_dm_members m ON m.group_dm_id = g.id AND m.user_id = $1
                 ORDER BY g.last_message_at DESC`,
                [userId]
            );

            // Fetch members for each group
            const groups = await Promise.all(result.rows.map(async row => {
                const members = await db.query(
                    `SELECT u.id, u.username, u.avatar, u.status
                     FROM group_dm_members gm
                     JOIN users u ON u.id = gm.user_id
                     WHERE gm.group_dm_id = $1`,
                    [row.id]
                );

                let lastMessage = row.last_message || '';
                if (!lastMessage && row.last_attachments) {
                    lastMessage = '📎 Attachment';
                }

                return {
                    id: row.id,
                    type: 'group',
                    name: row.name,
                    avatar: row.avatar,
                    owner_id: row.owner_id,
                    last_message_at: row.last_message_at,
                    created_at: row.created_at,
                    last_message: lastMessage,
                    members: members.rows,
                };
            }));

            res.json({ groups });
        } catch (error) {
            log(tags.error, 'getGroupConversations error:', error);
            res.status(500).json({ error: 'Failed to get group conversations' });
        }
    }

    // GET /api/group-dm/:id/messages
    static async getGroupMessages(req, res) {
        try {
            const { id } = req.params;
            const userId = req.session.user.id;
            const { before, limit = 50 } = req.query;

            const memberCheck = await db.query(
                `SELECT 1 FROM group_dm_members WHERE group_dm_id = $1 AND user_id = $2`,
                [id, userId]
            );
            if (memberCheck.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

            const params = [id, parseInt(limit)];
            const whereClause = before ? 'AND m.id < $3' : '';
            if (before) params.push(before);

            const result = await db.query(
                `SELECT m.*, u.username, u.avatar,
                    COALESCE(
                        (SELECT json_agg(json_build_object('emoji', r.emoji, 'count', r.cnt, 'users', r.users))
                         FROM (
                             SELECT emoji,
                                    COUNT(*) AS cnt,
                                    json_agg(json_build_object('userId', gr.user_id, 'username', u2.username)) AS users
                             FROM group_dm_reactions gr
                             JOIN users u2 ON u2.id = gr.user_id
                             WHERE gr.message_id = m.id
                             GROUP BY emoji
                         ) r),
                        '[]'
                    ) AS reactions
                 FROM group_dm_messages m
                 JOIN users u ON u.id = m.sender_id
                 WHERE m.group_dm_id = $1 ${whereClause}
                 ORDER BY m.created_at DESC
                 LIMIT $2`,
                params
            );

            res.json({ messages: result.rows.reverse() });
        } catch (error) {
            log(tags.error, 'getGroupMessages error:', error);
            res.status(500).json({ error: 'Failed to get messages' });
        }
    }

    // POST /api/group-dm/:id/messages
    static async sendGroupMessage(req, res) {
        try {
            const { id } = req.params;
            const userId = req.session.user.id;
            const { content } = req.body;

            let attachments = null;
            if (req.files && req.files.length > 0) {
                attachments = req.files.map(file => ({
                    filename: file.filename,
                    originalName: file.originalname,
                    mimetype: file.mimetype,
                    size: file.size,
                    url: `/uploads/${file.filename}`
                }));
            }

            const trimmed = content?.trim() || '';
            if (!trimmed && !attachments) {
                return res.status(400).json({ error: 'Message must have content or attachments' });
            }

            const memberIds = await getGroupMembers(id);
            if (!memberIds.includes(userId)) return res.status(403).json({ error: 'Access denied' });

            const msgId = generateSnowflake();
            const result = await db.query(
                `INSERT INTO group_dm_messages (id, group_dm_id, sender_id, content, attachments)
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [msgId, id, userId, trimmed, attachments ? JSON.stringify(attachments) : null]
            );

            await db.query(
                `UPDATE group_dms SET last_message_at = NOW() WHERE id = $1`,
                [id]
            );

            const userResult = await db.query(
                `SELECT username, avatar FROM users WHERE id = $1`,
                [userId]
            );

            const message = {
                ...result.rows[0],
                username: userResult.rows[0].username,
                avatar: userResult.rows[0].avatar,
                reactions: [],
                dm_id: id,  // normalized field for client compatibility
                type: 'group',
            };

            const io = req.app.get('io');
            if (io) emitToMembers(io, memberIds, 'dm_message_created', message);

            res.status(201).json({ message });
        } catch (error) {
            log(tags.error, 'sendGroupMessage error:', error);
            res.status(500).json({ error: 'Failed to send message' });
        }
    }

    // PATCH /api/group-dm/:id  { name }
    static async updateGroupDm(req, res) {
        try {
            const { id } = req.params;
            const userId = req.session.user.id;
            const { name } = req.body;

            const ownerCheck = await db.query(
                `SELECT owner_id FROM group_dms WHERE id = $1`,
                [id]
            );
            if (ownerCheck.rows.length === 0) return res.status(404).json({ error: 'Not found' });
            if (ownerCheck.rows[0].owner_id !== userId) return res.status(403).json({ error: 'Only the owner can rename this group' });

            await db.query(`UPDATE group_dms SET name = $1 WHERE id = $2`, [name?.trim() || null, id]);

            const memberIds = await getGroupMembers(id);
            const io = req.app.get('io');
            if (io) emitToMembers(io, memberIds, 'group_dm_updated', { id, name: name?.trim() || null });

            res.json({ success: true });
        } catch (error) {
            log(tags.error, 'updateGroupDm error:', error);
            res.status(500).json({ error: 'Failed to update group DM' });
        }
    }

    // POST /api/group-dm/:id/members  { userId }
    static async addGroupMember(req, res) {
        try {
            const { id } = req.params;
            const userId = req.session.user.id;
            const { userId: targetId } = req.body;

            if (!targetId) return res.status(400).json({ error: 'userId is required' });

            const ownerCheck = await db.query(
                `SELECT owner_id FROM group_dms WHERE id = $1`,
                [id]
            );
            if (ownerCheck.rows.length === 0) return res.status(404).json({ error: 'Not found' });
            if (ownerCheck.rows[0].owner_id !== userId) return res.status(403).json({ error: 'Only the owner can add members' });

            const userExists = await db.query(`SELECT id FROM users WHERE id = $1`, [targetId]);
            if (userExists.rows.length === 0) return res.status(404).json({ error: 'User not found' });

            await db.query(
                `INSERT INTO group_dm_members (group_dm_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [id, targetId]
            );

            const memberIds = await getGroupMembers(id);
            const gdm = await GroupDmController._fetchGroupDm(id, userId);
            const io = req.app.get('io');
            if (io) emitToMembers(io, memberIds, 'group_dm_updated', { id, members: gdm.members });

            res.json({ success: true });
        } catch (error) {
            log(tags.error, 'addGroupMember error:', error);
            res.status(500).json({ error: 'Failed to add member' });
        }
    }

    // DELETE /api/group-dm/:id/members/:userId
    static async removeGroupMember(req, res) {
        try {
            const { id, userId: targetId } = req.params;
            const userId = req.session.user.id;

            const ownerCheck = await db.query(
                `SELECT owner_id FROM group_dms WHERE id = $1`,
                [id]
            );
            if (ownerCheck.rows.length === 0) return res.status(404).json({ error: 'Not found' });

            const isSelf = targetId === userId;
            const isOwner = ownerCheck.rows[0].owner_id === userId;

            if (!isSelf && !isOwner) {
                return res.status(403).json({ error: 'Only the owner can remove other members' });
            }

            const memberIdsBefore = await getGroupMembers(id);

            await db.query(
                `DELETE FROM group_dm_members WHERE group_dm_id = $1 AND user_id = $2`,
                [id, targetId]
            );

            const io = req.app.get('io');
            if (io) {
                const payload = { id, removedUserId: targetId };
                emitToMembers(io, memberIdsBefore, 'group_dm_member_removed', payload);
            }

            res.json({ success: true });
        } catch (error) {
            log(tags.error, 'removeGroupMember error:', error);
            res.status(500).json({ error: 'Failed to remove member' });
        }
    }

    // POST /api/group-dm/:id/messages/:mid/reactions  { emoji }
    static async addGroupReaction(req, res) {
        try {
            const { id, mid } = req.params;
            const { emoji } = req.body;
            const userId = req.session.user.id;

            if (!emoji?.trim()) return res.status(400).json({ error: 'Emoji is required' });

            const memberIds = await getGroupMembers(id);
            if (!memberIds.includes(userId)) return res.status(403).json({ error: 'Access denied' });

            const msgCheck = await db.query(
                `SELECT id FROM group_dm_messages WHERE id = $1 AND group_dm_id = $2`,
                [mid, id]
            );
            if (msgCheck.rows.length === 0) return res.status(404).json({ error: 'Message not found' });

            const existing = await db.query(
                `SELECT id FROM group_dm_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
                [mid, userId, emoji]
            );
            if (existing.rows.length > 0) return res.status(400).json({ error: 'Already reacted' });

            await db.query(
                `INSERT INTO group_dm_reactions (id, message_id, user_id, emoji) VALUES ($1, $2, $3, $4)`,
                [generateSnowflake(), mid, userId, emoji]
            );

            const reactions = await GroupDmController._getReactions(mid);
            const io = req.app.get('io');
            if (io) emitToMembers(io, memberIds, 'dm_reaction_added', { messageId: mid, dmId: id, reactions });

            res.json({ reactions });
        } catch (error) {
            log(tags.error, 'addGroupReaction error:', error);
            res.status(500).json({ error: 'Failed to add reaction' });
        }
    }

    // DELETE /api/group-dm/:id/messages/:mid/reactions  { emoji }
    static async removeGroupReaction(req, res) {
        try {
            const { id, mid } = req.params;
            const { emoji } = req.body;
            const userId = req.session.user.id;

            if (!emoji?.trim()) return res.status(400).json({ error: 'Emoji is required' });

            const memberIds = await getGroupMembers(id);
            if (!memberIds.includes(userId)) return res.status(403).json({ error: 'Access denied' });

            await db.query(
                `DELETE FROM group_dm_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
                [mid, userId, emoji]
            );

            const reactions = await GroupDmController._getReactions(mid);
            const io = req.app.get('io');
            if (io) emitToMembers(io, memberIds, 'dm_reaction_removed', { messageId: mid, dmId: id, reactions });

            res.json({ reactions });
        } catch (error) {
            log(tags.error, 'removeGroupReaction error:', error);
            res.status(500).json({ error: 'Failed to remove reaction' });
        }
    }

    // PATCH /api/group-dm/:id/messages/:mid  { content }
    static async editGroupMessage(req, res) {
        try {
            const { id, mid } = req.params;
            const { content } = req.body;
            const userId = req.session.user.id;

            if (!content?.trim()) return res.status(400).json({ error: 'Content cannot be empty' });

            const check = await db.query(
                `SELECT * FROM group_dm_messages WHERE id = $1 AND group_dm_id = $2 AND sender_id = $3`,
                [mid, id, userId]
            );
            if (check.rows.length === 0) return res.status(404).json({ error: 'Message not found or not yours' });

            const result = await db.query(
                `UPDATE group_dm_messages SET content = $1, edited_at = NOW() WHERE id = $2 RETURNING *`,
                [content.trim(), mid]
            );

            const message = { ...result.rows[0], dm_id: id, type: 'group' };
            const memberIds = await getGroupMembers(id);
            const io = req.app.get('io');
            if (io) emitToMembers(io, memberIds, 'dm_message_updated', message);

            res.json({ message });
        } catch (error) {
            log(tags.error, 'editGroupMessage error:', error);
            res.status(500).json({ error: 'Failed to edit message' });
        }
    }

    // DELETE /api/group-dm/:id/messages/:mid
    static async deleteGroupMessage(req, res) {
        try {
            const { id, mid } = req.params;
            const userId = req.session.user.id;

            const check = await db.query(
                `SELECT * FROM group_dm_messages WHERE id = $1 AND group_dm_id = $2 AND sender_id = $3`,
                [mid, id, userId]
            );
            if (check.rows.length === 0) return res.status(404).json({ error: 'Message not found or not yours' });

            await db.query(`DELETE FROM group_dm_messages WHERE id = $1`, [mid]);

            const memberIds = await getGroupMembers(id);
            const io = req.app.get('io');
            if (io) emitToMembers(io, memberIds, 'dm_message_deleted', { message_id: mid, dm_id: id });

            res.json({ success: true });
        } catch (error) {
            log(tags.error, 'deleteGroupMessage error:', error);
            res.status(500).json({ error: 'Failed to delete message' });
        }
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    // PATCH /api/group-dm/:id/avatar  (multipart/form-data, field: 'file')
    static async uploadGroupAvatar(req, res) {
        try {
            const { id } = req.params;
            const userId = req.session.user.id;

            const ownerCheck = await db.query(
                `SELECT owner_id FROM group_dms WHERE id = $1`, [id]
            );
            if (ownerCheck.rows.length === 0) return res.status(404).json({ error: 'Not found' });
            if (ownerCheck.rows[0].owner_id !== userId) return res.status(403).json({ error: 'Only the owner can change the group picture' });

            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

            const avatarUrl = `/uploads/${req.file.filename}`;
            await db.query(`UPDATE group_dms SET avatar = $1 WHERE id = $2`, [avatarUrl, id]);

            const memberIds = await getGroupMembers(id);
            const io = req.app.get('io');
            if (io) emitToMembers(io, memberIds, 'group_dm_updated', { id, avatar: avatarUrl });

            res.json({ avatar: avatarUrl });
        } catch (error) {
            log(tags.error, 'uploadGroupAvatar error:', error);
            res.status(500).json({ error: 'Failed to upload group avatar' });
        }
    }

    static async _fetchGroupDm(groupDmId, userId) {
        const row = await db.query(`SELECT * FROM group_dms WHERE id = $1`, [groupDmId]);
        const members = await db.query(
            `SELECT u.id, u.username, u.avatar, u.status
             FROM group_dm_members gm JOIN users u ON u.id = gm.user_id
             WHERE gm.group_dm_id = $1`,
            [groupDmId]
        );
        const r = row.rows[0];
        return {
            id: r.id,
            type: 'group',
            name: r.name,
            avatar: r.avatar,
            owner_id: r.owner_id,
            last_message_at: r.last_message_at,
            created_at: r.created_at,
            last_message: '',
            members: members.rows,
        };
    }

    static async _getReactions(messageId) {
        const r = await db.query(
            `SELECT emoji, COUNT(*) AS count,
                    ARRAY_AGG(JSON_BUILD_OBJECT('userId', user_id, 'username', u.username)) AS users
             FROM group_dm_reactions gr JOIN users u ON gr.user_id = u.id
             WHERE message_id = $1 GROUP BY emoji`,
            [messageId]
        );
        return r.rows;
    }
}

export default GroupDmController;
