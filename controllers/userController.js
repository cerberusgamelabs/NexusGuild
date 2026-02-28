// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/userController.js

import db from "../config/database.js";
import { log, tags } from "#utils/logging";

class UserController {
    static async uploadAvatar(req, res) {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            const avatarUrl = `/uploads/${req.file.filename}`;
            await db.query(`UPDATE users SET avatar = $1 WHERE id = $2`, [avatarUrl, req.session.user.id]);
            log(tags.info, `Avatar updated for user ${req.session.user.id}`);
            res.json({ avatar: avatarUrl });
        } catch (error) {
            log(tags.error, 'Upload avatar error:', error);
            res.status(500).json({ error: 'Failed to upload avatar' });
        }
    }

    static async setCustomStatus(req, res) {
        try {
            const userId = req.session.user.id;
            let { custom_status } = req.body;

            if (typeof custom_status !== 'string') custom_status = '';
            custom_status = custom_status.trim().slice(0, 128);

            await db.query(
                'UPDATE users SET custom_status = $1 WHERE id = $2',
                [custom_status || null, userId]
            );

            // Broadcast to all servers the user belongs to
            const io = req.app.get('io');
            if (io) {
                const serverRes = await db.query(
                    'SELECT server_id FROM server_members WHERE user_id = $1',
                    [userId]
                );
                serverRes.rows.forEach(row => {
                    io.to(`server:${row.server_id}`).emit('custom_status_update', {
                        userId,
                        custom_status: custom_status || null
                    });
                });
            }

            log(tags.info, `Custom status updated for user ${userId}`);
            res.json({ custom_status: custom_status || null });
        } catch (error) {
            log(tags.error, 'Set custom status error:', error);
            res.status(500).json({ error: 'Failed to update custom status' });
        }
    }
}

export default UserController;
