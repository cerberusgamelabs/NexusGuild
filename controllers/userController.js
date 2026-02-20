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
}

export default UserController;
