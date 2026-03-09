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
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('connect', () => {
    log(tags.success, 'Database connected successfully');
});

pool.on('error', (err) => {
    log(tags.error, 'Unexpected error on idle client', err);
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

        // Idempotent: profile columns
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_layout TEXT`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_banner VARCHAR(255)`);

        // Idempotent: embed suppression
        await client.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS embed_suppressed BOOLEAN DEFAULT FALSE`);

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

        // ── Ascension System ─────────────────────────────────────────────────

        await client.query(`
            CREATE TABLE IF NOT EXISTS skill_tree_nodes (
                id          VARCHAR(20) PRIMARY KEY,
                type        VARCHAR(10) NOT NULL CHECK (type IN ('user','server')),
                parent_id   VARCHAR(20) REFERENCES skill_tree_nodes(id) ON DELETE SET NULL,
                tier        INTEGER NOT NULL DEFAULT 1,
                name        VARCHAR(100) NOT NULL,
                description TEXT,
                icon        VARCHAR(255),
                cost        INTEGER NOT NULL DEFAULT 0,
                is_active   BOOLEAN DEFAULT true,
                sort_order  INTEGER DEFAULT 0,
                created_at  TIMESTAMP DEFAULT NOW()
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS ascension_purchases (
                id              VARCHAR(20) PRIMARY KEY,
                user_id         VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
                amount          INTEGER NOT NULL,
                remaining       INTEGER NOT NULL,
                source          VARCHAR(20) DEFAULT 'on_demand',
                subscription_id VARCHAR(20) NULL,
                expires_at      TIMESTAMP NOT NULL,
                created_at      TIMESTAMP DEFAULT NOW()
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS ascension_donations (
                id          VARCHAR(20) PRIMARY KEY,
                purchase_id VARCHAR(20) REFERENCES ascension_purchases(id) ON DELETE CASCADE,
                user_id     VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
                server_id   VARCHAR(20) REFERENCES servers(id) ON DELETE CASCADE,
                amount      INTEGER NOT NULL,
                expires_at  TIMESTAMP NOT NULL,
                created_at  TIMESTAMP DEFAULT NOW()
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS user_skill_unlocks (
                user_id     VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
                node_id     VARCHAR(20) REFERENCES skill_tree_nodes(id) ON DELETE CASCADE,
                unlocked_at TIMESTAMP DEFAULT NOW(),
                is_active   BOOLEAN DEFAULT true,
                PRIMARY KEY (user_id, node_id)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS server_skill_unlocks (
                server_id   VARCHAR(20) REFERENCES servers(id) ON DELETE CASCADE,
                node_id     VARCHAR(20) REFERENCES skill_tree_nodes(id) ON DELETE CASCADE,
                unlocked_by VARCHAR(20) REFERENCES users(id) ON DELETE SET NULL,
                unlocked_at TIMESTAMP DEFAULT NOW(),
                is_active   BOOLEAN DEFAULT true,
                PRIMARY KEY (server_id, node_id)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS ascension_ledger (
                id         VARCHAR(20) PRIMARY KEY,
                user_id    VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
                delta      INTEGER NOT NULL,
                reason     VARCHAR(255),
                ref_id     VARCHAR(20),
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS ascension_subscriptions (
                id               VARCHAR(20) PRIMARY KEY,
                user_id          VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
                points_per_month INTEGER NOT NULL,
                price_usd        DECIMAL(8,2),
                auto_renew       BOOLEAN DEFAULT true,
                next_renewal_at  TIMESTAMP,
                cancelled_at     TIMESTAMP NULL,
                created_at       TIMESTAMP DEFAULT NOW()
            )
        `);

        // ── Staff Portal ──────────────────────────────────────────────────────

        await client.query(`
            CREATE TABLE IF NOT EXISTS staff_members (
                id         VARCHAR(20) PRIMARY KEY,
                user_id    VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
                role       VARCHAR(20) NOT NULL DEFAULT 'viewer'
                              CHECK (role IN ('owner','superadmin','moderator','viewer')),
                granted_by VARCHAR(20) REFERENCES users(id) ON DELETE SET NULL,
                granted_at TIMESTAMP DEFAULT NOW(),
                is_active  BOOLEAN DEFAULT true,
                UNIQUE(user_id)
            )
        `);

        await client.query(`
            INSERT INTO staff_members (id, user_id, role, granted_by)
            VALUES ('sstaff_owner_001', '2251086793225015296', 'owner', '2251086793225015296')
            ON CONFLICT (user_id) DO NOTHING
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS cors_origins (
                id          VARCHAR(20) PRIMARY KEY,
                origin      VARCHAR(500) UNIQUE NOT NULL,
                description VARCHAR(255),
                is_default  BOOLEAN DEFAULT false,
                added_by    VARCHAR(20) REFERENCES staff_members(id) ON DELETE SET NULL,
                added_at    TIMESTAMP DEFAULT NOW()
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS global_bans (
                id        VARCHAR(20) PRIMARY KEY,
                user_id   VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE UNIQUE,
                banned_by VARCHAR(20) REFERENCES staff_members(id) ON DELETE SET NULL,
                reason    TEXT,
                banned_at TIMESTAMP DEFAULT NOW()
            )
        `);

        // ── Audit Log ─────────────────────────────────────────────────────────

        await client.query(`
            CREATE TABLE IF NOT EXISTS server_audit_log (
                id          VARCHAR(20) PRIMARY KEY,
                server_id   VARCHAR(20) REFERENCES servers(id) ON DELETE CASCADE,
                action      VARCHAR(50) NOT NULL,
                actor_id    VARCHAR(20) REFERENCES users(id) ON DELETE SET NULL,
                target_id   VARCHAR(20),
                target_type VARCHAR(20),
                changes     JSONB,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // ── Webhooks ──────────────────────────────────────────────────────────

        await client.query(`
            CREATE TABLE IF NOT EXISTS webhooks (
                id          VARCHAR(20) PRIMARY KEY,
                server_id   VARCHAR(20) REFERENCES servers(id) ON DELETE CASCADE,
                channel_id  VARCHAR(20) REFERENCES channels(id) ON DELETE CASCADE,
                name        VARCHAR(80) NOT NULL,
                token       VARCHAR(64) UNIQUE NOT NULL,
                avatar      VARCHAR(255),
                created_by  VARCHAR(20) REFERENCES users(id) ON DELETE SET NULL,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Idempotent: webhook message columns
        await client.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS webhook_id    VARCHAR(20) REFERENCES webhooks(id) ON DELETE SET NULL`);
        await client.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS display_name  VARCHAR(80)`);
        await client.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS display_avatar VARCHAR(255)`);

        // Idempotent: bot flag on users
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT FALSE`);

        // ── Bot API ───────────────────────────────────────────────────────────

        await client.query(`
            CREATE TABLE IF NOT EXISTS bots (
                id           VARCHAR(20) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                owner_id     VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE NOT NULL,
                description  TEXT,
                token        VARCHAR(64) UNIQUE NOT NULL,
                public_bot   BOOLEAN DEFAULT FALSE,
                callback_url VARCHAR(500),
                created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS slash_commands (
                id          VARCHAR(20) PRIMARY KEY,
                bot_id      VARCHAR(20) REFERENCES bots(id) ON DELETE CASCADE NOT NULL,
                server_id   VARCHAR(20) REFERENCES servers(id) ON DELETE CASCADE NOT NULL,
                name        VARCHAR(32) NOT NULL,
                description VARCHAR(100) NOT NULL DEFAULT '',
                options     JSONB DEFAULT '[]',
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(bot_id, server_id, name)
            )
        `);

        // Idempotent: bot permissions
        await client.query(`ALTER TABLE bots ADD COLUMN IF NOT EXISTS default_permissions BIGINT DEFAULT 0`);

        // Idempotent: replies + threads
        await client.query(`ALTER TABLE messages  ADD COLUMN IF NOT EXISTS reply_to_id        VARCHAR(20) REFERENCES messages(id)  ON DELETE SET NULL`);
        await client.query(`ALTER TABLE channels  ADD COLUMN IF NOT EXISTS parent_message_id  VARCHAR(20) REFERENCES messages(id)  ON DELETE CASCADE`);
        await client.query(`ALTER TABLE channels  ADD COLUMN IF NOT EXISTS is_private         BOOLEAN DEFAULT FALSE`);
        await client.query(`
            CREATE TABLE IF NOT EXISTS thread_members (
                thread_id  VARCHAR(20) REFERENCES channels(id)  ON DELETE CASCADE,
                user_id    VARCHAR(20) REFERENCES users(id)     ON DELETE CASCADE,
                added_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                PRIMARY KEY (thread_id, user_id)
            )
        `);

        // Seed skill tree nodes (ON CONFLICT DO NOTHING — safe to re-run)
        await client.query(`
            INSERT INTO skill_tree_nodes (id, type, parent_id, tier, name, description, icon, cost, sort_order)
            VALUES
                ('stn_u_flair',   'user', NULL,          1, 'Profile Flair',      'Unlock custom profile decorations',         '✨', 100, 0),
                ('stn_u_status',  'user', NULL,          1, 'Extended Status',    'Use longer and richer status messages',     '💬', 150, 1),
                ('stn_u_anim_av', 'user', 'stn_u_flair', 2, 'Animated Avatar',   'Use an animated GIF as your avatar',        '🎞️', 300, 0),
                ('stn_u_stat_em', 'user', 'stn_u_status',2, 'Status Emoji',      'Add a custom emoji to your status',         '🎨', 200, 1),
                ('stn_s_emoji',   'server', NULL,        1, 'Extra Emoji Slots',  'Add more custom emoji slots to the server', '😄', 500, 0),
                ('stn_s_upload',  'server', NULL,        1, 'Higher Upload Limit','Raise the file upload size limit',          '📦', 400, 1),
                ('stn_s_anim_ic', 'server', 'stn_s_emoji',2,'Animated Server Icon','Use an animated GIF as the server icon',  '🖼️', 800, 0)
            ON CONFLICT (id) DO NOTHING
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                token      VARCHAR(64) PRIMARY KEY,
                user_id    VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
                expires_at TIMESTAMP NOT NULL,
                used       BOOLEAN DEFAULT FALSE
            )
        `);

        // ── Reports ───────────────────────────────────────────────────────────

        await client.query(`
            CREATE TABLE IF NOT EXISTS reports (
                id               VARCHAR(20) PRIMARY KEY,
                type             VARCHAR(10)  NOT NULL CHECK (type IN ('message','user')),
                scope            VARCHAR(10)  NOT NULL CHECK (scope IN ('server','global')),
                reporter_id      VARCHAR(20)  REFERENCES users(id) ON DELETE SET NULL,
                reported_user_id VARCHAR(20)  REFERENCES users(id) ON DELETE SET NULL,
                message_id       VARCHAR(20)  REFERENCES messages(id) ON DELETE SET NULL,
                message_content  TEXT,
                server_id        VARCHAR(20)  REFERENCES servers(id) ON DELETE CASCADE,
                reason           VARCHAR(50)  NOT NULL,
                details          TEXT,
                is_anonymous     BOOLEAN DEFAULT FALSE,
                status           VARCHAR(20)  NOT NULL DEFAULT 'open'
                                     CHECK (status IN ('open','reviewed','dismissed','escalated')),
                reviewed_by      VARCHAR(20)  REFERENCES users(id) ON DELETE SET NULL,
                reviewed_at      TIMESTAMP,
                escalated_at     TIMESTAMP,
                created_at       TIMESTAMP DEFAULT NOW()
            )
        `);

        // ── VTT ───────────────────────────────────────────────────────────────

        await client.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS dddice_room_slug VARCHAR(64)`);

        await client.query(`
            CREATE TABLE IF NOT EXISTS vtt_maps (
                id          VARCHAR(20) PRIMARY KEY,
                channel_id  VARCHAR(20) REFERENCES channels(id) ON DELETE CASCADE,
                map_url     TEXT,
                grid_size   INTEGER DEFAULT 64,
                fog_data    JSONB,
                updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(channel_id)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS vtt_tokens (
                id          VARCHAR(20) PRIMARY KEY,
                channel_id  VARCHAR(20) REFERENCES channels(id) ON DELETE CASCADE,
                owner_id    VARCHAR(20) REFERENCES users(id) ON DELETE SET NULL,
                x           FLOAT NOT NULL DEFAULT 0,
                y           FLOAT NOT NULL DEFAULT 0,
                size        INTEGER DEFAULT 1,
                image_url   TEXT,
                label       VARCHAR(64),
                hp          INTEGER,
                hp_max      INTEGER,
                conditions  JSONB DEFAULT '[]',
                size_x      INTEGER DEFAULT 1,
                size_y      INTEGER DEFAULT 1
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS vtt_encounters (
                id           VARCHAR(20) PRIMARY KEY,
                channel_id   VARCHAR(20) REFERENCES channels(id) ON DELETE CASCADE,
                round        INTEGER DEFAULT 1,
                active_index INTEGER DEFAULT 0,
                is_active    BOOLEAN DEFAULT FALSE,
                combatants   JSONB NOT NULL DEFAULT '[]',
                updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(channel_id)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS vtt_characters (
                id          VARCHAR(20) PRIMARY KEY,
                channel_id  VARCHAR(20) REFERENCES channels(id) ON DELETE CASCADE,
                user_id     VARCHAR(20) REFERENCES users(id) ON DELETE SET NULL,
                token_id    VARCHAR(20) REFERENCES vtt_tokens(id) ON DELETE SET NULL,
                system      VARCHAR(32) NOT NULL DEFAULT 'generic',
                name        VARCHAR(64) NOT NULL,
                sheet_data  JSONB NOT NULL DEFAULT '{}',
                updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // ── VTT Dice Rolls ─────────────────────────────────────────────────────

        await client.query(`
            CREATE TABLE IF NOT EXISTS vtt_dice_rolls (
                id               VARCHAR(20) PRIMARY KEY,
                channel_id       VARCHAR(20) REFERENCES channels(id) ON DELETE CASCADE,
                user_id          VARCHAR(20) REFERENCES users(id) ON DELETE SET NULL,
                notation         TEXT NOT NULL,
                total            INTEGER NOT NULL,
                dice             JSONB NOT NULL,
                dddice_roll_id   TEXT,
                modifier         INTEGER DEFAULT 0,
                created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // ── Inbound Email ─────────────────────────────────────────────────────

        await client.query(`
            CREATE TABLE IF NOT EXISTS inbound_emails (
                id           VARCHAR(20) PRIMARY KEY,
                from_address TEXT NOT NULL,
                to_address   TEXT,
                subject      TEXT,
                body_html    TEXT,
                body_text    TEXT,
                raw_payload  JSONB,
                is_read      BOOLEAN DEFAULT FALSE,
                read_by      VARCHAR(20) REFERENCES users(id) ON DELETE SET NULL,
                read_at      TIMESTAMP,
                received_at  TIMESTAMP DEFAULT NOW()
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

        // Ascension indexes
        await pool.query('CREATE INDEX IF NOT EXISTS idx_asc_purchases_user   ON ascension_purchases(user_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_asc_purchases_expiry ON ascension_purchases(expires_at)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_asc_donations_server ON ascension_donations(server_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_asc_ledger_user      ON ascension_ledger(user_id, created_at DESC)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_skill_nodes_type     ON skill_tree_nodes(type, tier, sort_order)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_staff_members_user   ON staff_members(user_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_cors_origins_origin  ON cors_origins(origin)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_log_server     ON server_audit_log(server_id, created_at DESC)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_webhooks_server      ON webhooks(server_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_webhook     ON messages(webhook_id)          WHERE webhook_id IS NOT NULL');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_reply_to   ON messages(reply_to_id)         WHERE reply_to_id IS NOT NULL');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_channels_parent_msg ON channels(parent_message_id)   WHERE parent_message_id IS NOT NULL');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_thread_members      ON thread_members(thread_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_bots_owner          ON bots(owner_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_bots_token          ON bots(token)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_slash_commands_bot  ON slash_commands(bot_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_slash_commands_srv  ON slash_commands(server_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_vtt_tokens_channel  ON vtt_tokens(channel_id)');
        await pool.query('ALTER TABLE vtt_tokens ADD COLUMN IF NOT EXISTS size_x INTEGER DEFAULT 1');
        await pool.query('ALTER TABLE vtt_tokens ADD COLUMN IF NOT EXISTS size_y INTEGER DEFAULT 1');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_vtt_chars_channel   ON vtt_characters(channel_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_vtt_chars_user      ON vtt_characters(user_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_vtt_dice_rolls_channel ON vtt_dice_rolls(channel_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_vtt_dice_rolls_created ON vtt_dice_rolls(created_at DESC)');

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