// Proprietary — Cerberus Game Labs. See LICENSE for terms.
﻿// File Location: /config/database.js

import { Pool } from "pg";
import dotenv from "dotenv";
import { log, tags } from "#utils/logging";
dotenv.config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
    log(tags.success, 'Database connected successfully');
});

pool.on('error', (err) => {
    log(tags.error, 'Unexpected error on idle client', err);
    process.exit(-1);
});

const initDB = async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(20) PRIMARY KEY,
                username VARCHAR(32) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                avatar VARCHAR(255),
                status VARCHAR(50) DEFAULT 'offline',
                custom_status VARCHAR(128),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS servers (
                id VARCHAR(20) PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                icon VARCHAR(255),
                owner_id VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id VARCHAR(20) PRIMARY KEY,
                server_id VARCHAR(20) REFERENCES servers(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                position INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS channels (
                id VARCHAR(20) PRIMARY KEY,
                server_id VARCHAR(20) REFERENCES servers(id) ON DELETE CASCADE,
                category_id VARCHAR(20) REFERENCES categories(id) ON DELETE SET NULL,
                name VARCHAR(100) NOT NULL,
                type VARCHAR(20) DEFAULT 'text',
                topic VARCHAR(1024),
                position INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id VARCHAR(20) PRIMARY KEY,
                channel_id VARCHAR(20) REFERENCES channels(id) ON DELETE CASCADE,
                user_id VARCHAR(20) REFERENCES users(id) ON DELETE SET NULL,
                content TEXT NOT NULL,
                attachments JSONB,
                edited_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS server_members (
                id VARCHAR(20) PRIMARY KEY,
                server_id VARCHAR(20) REFERENCES servers(id) ON DELETE CASCADE,
                user_id VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
                nickname VARCHAR(32),
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(server_id, user_id)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS roles (
                id VARCHAR(20) PRIMARY KEY,
                server_id VARCHAR(20) REFERENCES servers(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                color VARCHAR(7) DEFAULT '#99AAB5',
                permissions BIGINT DEFAULT 0,
                position INTEGER DEFAULT 0,
                mentionable BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS user_roles (
                user_id VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
                role_id VARCHAR(20) REFERENCES roles(id) ON DELETE CASCADE,
                server_id VARCHAR(20) REFERENCES servers(id) ON DELETE CASCADE,
                PRIMARY KEY (user_id, role_id, server_id)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS invites (
                id VARCHAR(20) PRIMARY KEY,
                code VARCHAR(10) UNIQUE NOT NULL,
                server_id VARCHAR(20) REFERENCES servers(id) ON DELETE CASCADE,
                inviter_id VARCHAR(20) REFERENCES users(id) ON DELETE SET NULL,
                uses INTEGER DEFAULT 0,
                max_uses INTEGER DEFAULT 0,
                expires_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS direct_messages (
                id VARCHAR(20) PRIMARY KEY,
                user1_id VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
                user2_id VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
                last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user1_id, user2_id)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS dm_messages (
                id VARCHAR(20) PRIMARY KEY,
                dm_id VARCHAR(20) REFERENCES direct_messages(id) ON DELETE CASCADE,
                sender_id VARCHAR(20) REFERENCES users(id) ON DELETE SET NULL,
                content TEXT NOT NULL DEFAULT '',
                attachments JSONB,
                edited_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Idempotent: add attachments column to existing dm_messages rows (no-op if already present)
        await client.query(`
            ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS attachments JSONB
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS dm_reactions (
                id VARCHAR(20) PRIMARY KEY,
                message_id VARCHAR(20) REFERENCES dm_messages(id) ON DELETE CASCADE,
                user_id    VARCHAR(20) REFERENCES users(id)       ON DELETE CASCADE,
                emoji      TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(message_id, user_id, emoji)
            )
        `);

                await client.query(`
            CREATE TABLE IF NOT EXISTS reactions (
                id VARCHAR(20) PRIMARY KEY,
                message_id VARCHAR(20) REFERENCES messages(id) ON DELETE CASCADE,
                user_id VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
                emoji TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(message_id, user_id, emoji)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS custom_emojis (
                id VARCHAR(20) PRIMARY KEY,
                server_id VARCHAR(20) REFERENCES servers(id) ON DELETE CASCADE,
                name VARCHAR(50) NOT NULL,
                filename VARCHAR(255) NOT NULL,
                created_by VARCHAR(20) REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(server_id, name)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS bans (
                id VARCHAR(20) PRIMARY KEY,
                server_id VARCHAR(20) REFERENCES servers(id) ON DELETE CASCADE,
                user_id VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
                banned_by VARCHAR(20) REFERENCES users(id) ON DELETE SET NULL,
                reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(server_id, user_id)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS pinned_messages (
                channel_id  VARCHAR(20) REFERENCES channels(id) ON DELETE CASCADE,
                message_id  VARCHAR(20) REFERENCES messages(id) ON DELETE CASCADE,
                pinned_by   VARCHAR(20) REFERENCES users(id) ON DELETE SET NULL,
                pinned_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (channel_id, message_id)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS group_dms (
                id              VARCHAR(20) PRIMARY KEY,
                name            VARCHAR(100),
                avatar          VARCHAR(255),
                owner_id        VARCHAR(20) REFERENCES users(id),
                last_message_at TIMESTAMP DEFAULT NOW(),
                created_at      TIMESTAMP DEFAULT NOW()
            )
        `);

        // Idempotent: add avatar column to existing group_dms rows
        await client.query(`
            ALTER TABLE group_dms ADD COLUMN IF NOT EXISTS avatar VARCHAR(255)
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS group_dm_members (
                group_dm_id VARCHAR(20) REFERENCES group_dms(id) ON DELETE CASCADE,
                user_id     VARCHAR(20) REFERENCES users(id)     ON DELETE CASCADE,
                joined_at   TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (group_dm_id, user_id)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS group_dm_messages (
                id          VARCHAR(20) PRIMARY KEY,
                group_dm_id VARCHAR(20) REFERENCES group_dms(id) ON DELETE CASCADE,
                sender_id   VARCHAR(20) REFERENCES users(id),
                content     TEXT NOT NULL DEFAULT '',
                attachments JSONB,
                edited_at   TIMESTAMP,
                created_at  TIMESTAMP DEFAULT NOW()
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS group_dm_reactions (
                id         VARCHAR(20) PRIMARY KEY,
                message_id VARCHAR(20) REFERENCES group_dm_messages(id) ON DELETE CASCADE,
                user_id    VARCHAR(20) REFERENCES users(id),
                emoji      VARCHAR(100) NOT NULL,
                UNIQUE(message_id, user_id, emoji)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS uptime_log (
                id SERIAL PRIMARY KEY,
                subsystem VARCHAR(50) NOT NULL,
                status VARCHAR(20) NOT NULL,
                response_ms INTEGER,
                checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS "session" (
                "sid"    varchar        NOT NULL COLLATE "default",
                "sess"   json           NOT NULL,
                "expire" timestamp(6)   NOT NULL,
                CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
            )
        `);

        await client.query('COMMIT');

        // Indexes must run outside a transaction
        await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_channel   ON messages(channel_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_created   ON messages(created_at DESC)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_server_members     ON server_members(server_id, user_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_channels_server    ON channels(server_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS "IDX_session_expire"   ON "session" ("expire")');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_reactions_user ON reactions(user_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_custom_emojis_server ON custom_emojis(server_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_bans_server ON bans(server_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_uptime_log_subsystem ON uptime_log(subsystem)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_uptime_log_checked_at ON uptime_log(checked_at DESC)');

        log(tags.success, 'Database schema initialized successfully');
    } catch (e) {
        await client.query('ROLLBACK');
        log(tags.error, 'Error initializing database:', e);
        throw e;
    } finally {
        client.release();
    }
};

const cleanupUptime = () =>
    pool.query(`DELETE FROM uptime_log WHERE checked_at < NOW() - INTERVAL '90 days'`);

export default {
    query: (text, params) => pool.query(text, params),
    pool,
    initDB,
    cleanupUptime
};