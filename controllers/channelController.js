// File Location: /controllers/channelController.js

import db from "../config/database.js";
import { generateSnowflake } from "#utils/functions";
import { log, tags } from "#utils/logging";

class ChannelController {
    static async getServerChannels(req, res) {
        try {
            const { serverId } = req.params;

            const categoriesResult = await db.query(
                `SELECT * FROM categories WHERE server_id = $1 ORDER BY position`,
                [serverId]
            );

            const channelsResult = await db.query(
                `SELECT * FROM channels WHERE server_id = $1 ORDER BY position`,
                [serverId]
            );

            res.json({
                categories: categoriesResult.rows,
                channels: channelsResult.rows
            });
        } catch (error) {
            log(tags.error, 'Get server channels error:', error);
            res.status(500).json({ error: 'Failed to get channels' });
        }
    }

    static async createChannel(req, res) {
        try {
            const { serverId } = req.params;
            const { name, type = 'text', categoryId, topic } = req.body;

            const positionResult = await db.query(
                `SELECT COALESCE(MAX(position), -1) + 1 as next_position
                 FROM channels
                 WHERE server_id = $1 AND category_id = $2`,
                [serverId, categoryId || null]
            );

            const position = positionResult.rows[0].next_position;
            const id = generateSnowflake();

            const result = await db.query(
                `INSERT INTO channels (id, server_id, category_id, name, type, topic, position)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING *`,
                [id, serverId, categoryId || null, name, type, topic || null, position]
            );

            log(tags.success, `Channel created: "${name}" (${id}) in server ${serverId}`);
            res.status(201).json({
                message: 'Channel created successfully',
                channel: result.rows[0]
            });
        } catch (error) {
            log(tags.error, 'Create channel error:', error);
            res.status(500).json({ error: 'Failed to create channel' });
        }
    }

    static async updateChannel(req, res) {
        try {
            const { channelId } = req.params;
            const { name, topic, position } = req.body;

            const result = await db.query(
                `UPDATE channels
                 SET name = COALESCE($1, name),
                     topic = COALESCE($2, topic),
                     position = COALESCE($3, position)
                 WHERE id = $4
                 RETURNING *`,
                [name, topic, position, channelId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Channel not found' });
            }

            log(tags.info, `Channel updated: "${result.rows[0].name}" [${channelId}]`);
            res.json({
                message: 'Channel updated successfully',
                channel: result.rows[0]
            });
        } catch (error) {
            log(tags.error, 'Update channel error:', error);
            res.status(500).json({ error: 'Failed to update channel' });
        }
    }

    static async deleteChannel(req, res) {
        try {
            const { channelId } = req.params;
            const nameResult = await db.query('SELECT name FROM channels WHERE id = $1', [channelId]);
            const channelName = nameResult.rows[0]?.name || 'Unknown';
            await db.query('DELETE FROM channels WHERE id = $1', [channelId]);
            log(tags.warning, `Channel deleted: "${channelName}" [${channelId}]`);
            res.json({ message: 'Channel deleted successfully' });
        } catch (error) {
            log(tags.error, 'Delete channel error:', error);
            res.status(500).json({ error: 'Failed to delete channel' });
        }
    }

    static async createCategory(req, res) {
        try {
            const { serverId } = req.params;
            const { name } = req.body;

            const positionResult = await db.query(
                `SELECT COALESCE(MAX(position), -1) + 1 as next_position
                 FROM categories
                 WHERE server_id = $1`,
                [serverId]
            );

            const position = positionResult.rows[0].next_position;
            const id = generateSnowflake();

            const result = await db.query(
                `INSERT INTO categories (id, server_id, name, position)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
                [id, serverId, name, position]
            );

            log(tags.success, `Category created: "${name}" (${id}) in server ${serverId}`);
            res.status(201).json({
                message: 'Category created successfully',
                category: result.rows[0]
            });
        } catch (error) {
            log(tags.error, 'Create category error:', error);
            res.status(500).json({ error: 'Failed to create category' });
        }
    }
}

export default ChannelController;