// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/ascensionController.js

import db from '../config/database.js';
import { log, tags } from '#utils/logging';
import { generateSnowflake } from '../utils/functions.js';

// ── Module-level helpers ──────────────────────────────────────────────────────

async function getUserActiveBalance(userId) {
    const r = await db.query(
        `SELECT COALESCE(SUM(remaining), 0) AS balance
         FROM ascension_purchases
         WHERE user_id = $1 AND expires_at > NOW()`,
        [userId]
    );
    return parseInt(r.rows[0].balance, 10);
}

async function getServerActiveBalance(serverId) {
    const r = await db.query(
        `SELECT COALESCE(SUM(amount), 0) AS balance
         FROM ascension_donations
         WHERE server_id = $1 AND expires_at > NOW()`,
        [serverId]
    );
    return parseInt(r.rows[0].balance, 10);
}

async function getUserUnlockCost(userId) {
    const r = await db.query(
        `SELECT COALESCE(SUM(n.cost), 0) AS spent
         FROM user_skill_unlocks u
         JOIN skill_tree_nodes n ON n.id = u.node_id
         WHERE u.user_id = $1 AND u.is_active = true`,
        [userId]
    );
    return parseInt(r.rows[0].spent, 10);
}

async function getServerUnlockCost(serverId) {
    const r = await db.query(
        `SELECT COALESCE(SUM(n.cost), 0) AS spent
         FROM server_skill_unlocks s
         JOIN skill_tree_nodes n ON n.id = s.node_id
         WHERE s.server_id = $1 AND s.is_active = true`,
        [serverId]
    );
    return parseInt(r.rows[0].spent, 10);
}

// Deduct `amount` from user's oldest non-expired purchase batches (FIFO).
// Returns true if fully covered, false if insufficient balance.
async function deductUserPoints(userId, amount) {
    const purchases = await db.query(
        `SELECT id, remaining FROM ascension_purchases
         WHERE user_id = $1 AND remaining > 0 AND expires_at > NOW()
         ORDER BY expires_at ASC`,
        [userId]
    );
    let needed = amount;
    for (const row of purchases.rows) {
        if (needed <= 0) break;
        const take = Math.min(needed, parseInt(row.remaining, 10));
        await db.query(
            `UPDATE ascension_purchases SET remaining = remaining - $1 WHERE id = $2`,
            [take, row.id]
        );
        needed -= take;
    }
    return needed <= 0;
}

// ── Controller ────────────────────────────────────────────────────────────────

class AscensionController {

    // GET /api/ascension/nodes?type=user|server
    static async getNodes(req, res) {
        try {
            const { type } = req.query;
            const params = [];
            let where = 'WHERE is_active = true';
            if (type) { where += ' AND type = $1'; params.push(type); }
            const result = await db.query(
                `SELECT * FROM skill_tree_nodes ${where} ORDER BY tier, sort_order`,
                params
            );
            res.json({ nodes: result.rows });
        } catch (error) {
            log(tags.error, 'getNodes error:', error);
            res.status(500).json({ error: 'Failed to get nodes' });
        }
    }

    // GET /api/ascension/balance
    static async getBalance(req, res) {
        try {
            const userId = req.session.user.id;
            const [balance, spent] = await Promise.all([
                getUserActiveBalance(userId),
                getUserUnlockCost(userId)
            ]);
            res.json({ balance, spent, available: balance });
        } catch (error) {
            log(tags.error, 'getBalance error:', error);
            res.status(500).json({ error: 'Failed to get balance' });
        }
    }

    // GET /api/ascension/ledger
    static async getLedger(req, res) {
        try {
            const userId = req.session.user.id;
            const result = await db.query(
                `SELECT id, delta, reason, ref_id, created_at
                 FROM ascension_ledger
                 WHERE user_id = $1
                 ORDER BY created_at DESC
                 LIMIT 50`,
                [userId]
            );
            res.json({ entries: result.rows });
        } catch (error) {
            log(tags.error, 'getLedger error:', error);
            res.status(500).json({ error: 'Failed to get ledger' });
        }
    }

    // GET /api/ascension/unlocks
    static async getUnlocks(req, res) {
        try {
            const userId = req.session.user.id;
            const result = await db.query(
                `SELECT node_id, unlocked_at, is_active
                 FROM user_skill_unlocks
                 WHERE user_id = $1`,
                [userId]
            );
            res.json({ unlocks: result.rows });
        } catch (error) {
            log(tags.error, 'getUnlocks error:', error);
            res.status(500).json({ error: 'Failed to get unlocks' });
        }
    }

    // POST /api/ascension/grant  — dev only, body: { amount }
    static async grantPoints(req, res) {
        try {
            const userId = req.session.user.id;
            const amount = parseInt(req.body.amount, 10) || 500;
            if (amount <= 0) return res.status(400).json({ error: 'amount must be positive' });

            const purchaseId = generateSnowflake();
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30 days
            await db.query(
                `INSERT INTO ascension_purchases (id, user_id, amount, remaining, source, expires_at)
                 VALUES ($1, $2, $3, $3, 'on_demand', $4)`,
                [purchaseId, userId, amount, expiresAt]
            );

            const ledgerId = generateSnowflake();
            await db.query(
                `INSERT INTO ascension_ledger (id, user_id, delta, reason, ref_id)
                 VALUES ($1, $2, $3, 'grant', $4)`,
                [ledgerId, userId, amount, purchaseId]
            );

            const balance = await getUserActiveBalance(userId);
            res.json({ balance, granted: amount });
        } catch (error) {
            log(tags.error, 'grantPoints error:', error);
            res.status(500).json({ error: 'Failed to grant points' });
        }
    }

    // POST /api/ascension/unlock/:nodeId
    static async unlockNode(req, res) {
        try {
            const userId = req.session.user.id;
            const { nodeId } = req.params;

            const nodeRes = await db.query(
                `SELECT * FROM skill_tree_nodes WHERE id = $1 AND type = 'user' AND is_active = true`,
                [nodeId]
            );
            if (nodeRes.rows.length === 0) return res.status(404).json({ error: 'Node not found' });
            const node = nodeRes.rows[0];

            // Already unlocked?
            const existingRes = await db.query(
                `SELECT is_active FROM user_skill_unlocks WHERE user_id = $1 AND node_id = $2`,
                [userId, nodeId]
            );
            if (existingRes.rows.length > 0 && existingRes.rows[0].is_active) {
                return res.status(409).json({ error: 'Already unlocked' });
            }

            // Prereq check
            if (node.parent_id) {
                const prereqRes = await db.query(
                    `SELECT is_active FROM user_skill_unlocks WHERE user_id = $1 AND node_id = $2`,
                    [userId, node.parent_id]
                );
                if (prereqRes.rows.length === 0 || !prereqRes.rows[0].is_active) {
                    return res.status(400).json({ error: 'Prerequisite not unlocked' });
                }
            }

            // Balance check
            const balance = await getUserActiveBalance(userId);
            if (balance < node.cost) return res.status(402).json({ error: 'Insufficient points' });

            // Deduct
            const ok = await deductUserPoints(userId, node.cost);
            if (!ok) return res.status(402).json({ error: 'Insufficient points' });

            // Insert or reactivate unlock
            await db.query(
                `INSERT INTO user_skill_unlocks (user_id, node_id, is_active)
                 VALUES ($1, $2, true)
                 ON CONFLICT (user_id, node_id) DO UPDATE SET is_active = true, unlocked_at = NOW()`,
                [userId, nodeId]
            );

            const ledgerId = generateSnowflake();
            await db.query(
                `INSERT INTO ascension_ledger (id, user_id, delta, reason, ref_id)
                 VALUES ($1, $2, $3, $4, $5)`,
                [ledgerId, userId, -node.cost, `unlock:${node.name}`, nodeId]
            );

            const newBalance = await getUserActiveBalance(userId);
            res.json({ success: true, balance: newBalance });
        } catch (error) {
            log(tags.error, 'unlockNode error:', error);
            res.status(500).json({ error: 'Failed to unlock node' });
        }
    }

    // GET /api/ascension/servers/:serverId/balance
    static async getServerBalance(req, res) {
        try {
            const { serverId } = req.params;
            const [balance, spent] = await Promise.all([
                getServerActiveBalance(serverId),
                getServerUnlockCost(serverId)
            ]);
            res.json({ balance, spent });
        } catch (error) {
            log(tags.error, 'getServerBalance error:', error);
            res.status(500).json({ error: 'Failed to get server balance' });
        }
    }

    // GET /api/ascension/servers/:serverId/unlocks
    static async getServerUnlocks(req, res) {
        try {
            const { serverId } = req.params;
            const result = await db.query(
                `SELECT node_id, unlocked_by, unlocked_at, is_active
                 FROM server_skill_unlocks
                 WHERE server_id = $1`,
                [serverId]
            );
            res.json({ unlocks: result.rows });
        } catch (error) {
            log(tags.error, 'getServerUnlocks error:', error);
            res.status(500).json({ error: 'Failed to get server unlocks' });
        }
    }

    // POST /api/ascension/servers/:serverId/donate  body: { amount }
    static async donateToServer(req, res) {
        try {
            const userId = req.session.user.id;
            const { serverId } = req.params;
            const amount = parseInt(req.body.amount, 10);
            if (!amount || amount <= 0) return res.status(400).json({ error: 'amount must be positive' });

            const balance = await getUserActiveBalance(userId);
            if (balance < amount) return res.status(402).json({ error: 'Insufficient points' });

            // Deduct FIFO; also track which purchase we're drawing from for expiry linkage
            const purchases = await db.query(
                `SELECT id, remaining, expires_at FROM ascension_purchases
                 WHERE user_id = $1 AND remaining > 0 AND expires_at > NOW()
                 ORDER BY expires_at ASC`,
                [userId]
            );

            let needed = amount;
            for (const row of purchases.rows) {
                if (needed <= 0) break;
                const take = Math.min(needed, parseInt(row.remaining, 10));
                await db.query(
                    `UPDATE ascension_purchases SET remaining = remaining - $1 WHERE id = $2`,
                    [take, row.id]
                );

                const donId = generateSnowflake();
                await db.query(
                    `INSERT INTO ascension_donations (id, purchase_id, user_id, server_id, amount, expires_at)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [donId, row.id, userId, serverId, take, row.expires_at]
                );
                needed -= take;
            }

            const ledgerId = generateSnowflake();
            await db.query(
                `INSERT INTO ascension_ledger (id, user_id, delta, reason, ref_id)
                 VALUES ($1, $2, $3, $4, $5)`,
                [ledgerId, userId, -amount, `donate:${serverId}`, serverId]
            );

            const [newUserBal, newServerBal] = await Promise.all([
                getUserActiveBalance(userId),
                getServerActiveBalance(serverId)
            ]);
            res.json({ success: true, userBalance: newUserBal, serverBalance: newServerBal });
        } catch (error) {
            log(tags.error, 'donateToServer error:', error);
            res.status(500).json({ error: 'Failed to donate' });
        }
    }

    // POST /api/ascension/servers/:serverId/unlock/:nodeId
    static async unlockServerNode(req, res) {
        try {
            const userId = req.session.user.id;
            const { serverId, nodeId } = req.params;

            // Owner or admin check
            const serverRes = await db.query('SELECT owner_id FROM servers WHERE id = $1', [serverId]);
            if (serverRes.rows.length === 0) return res.status(404).json({ error: 'Server not found' });
            const isOwner = serverRes.rows[0].owner_id === userId;
            if (!isOwner) {
                const adminRes = await db.query(
                    `SELECT 1 FROM user_roles ur
                     JOIN roles r ON r.id = ur.role_id
                     WHERE ur.user_id = $1 AND ur.server_id = $2
                       AND (r.permissions & 8) > 0`,
                    [userId, serverId]
                );
                if (adminRes.rows.length === 0) return res.status(403).json({ error: 'Forbidden' });
            }

            const nodeRes = await db.query(
                `SELECT * FROM skill_tree_nodes WHERE id = $1 AND type = 'server' AND is_active = true`,
                [nodeId]
            );
            if (nodeRes.rows.length === 0) return res.status(404).json({ error: 'Node not found' });
            const node = nodeRes.rows[0];

            const existingRes = await db.query(
                `SELECT is_active FROM server_skill_unlocks WHERE server_id = $1 AND node_id = $2`,
                [serverId, nodeId]
            );
            if (existingRes.rows.length > 0 && existingRes.rows[0].is_active) {
                return res.status(409).json({ error: 'Already unlocked' });
            }

            if (node.parent_id) {
                const prereqRes = await db.query(
                    `SELECT is_active FROM server_skill_unlocks WHERE server_id = $1 AND node_id = $2`,
                    [serverId, node.parent_id]
                );
                if (prereqRes.rows.length === 0 || !prereqRes.rows[0].is_active) {
                    return res.status(400).json({ error: 'Prerequisite not unlocked' });
                }
            }

            const serverBalance = await getServerActiveBalance(serverId);
            const serverSpent = await getServerUnlockCost(serverId);
            const available = serverBalance - serverSpent;
            if (available < node.cost) return res.status(402).json({ error: 'Insufficient server points' });

            await db.query(
                `INSERT INTO server_skill_unlocks (server_id, node_id, unlocked_by, is_active)
                 VALUES ($1, $2, $3, true)
                 ON CONFLICT (server_id, node_id) DO UPDATE SET is_active = true, unlocked_at = NOW(), unlocked_by = $3`,
                [serverId, nodeId, userId]
            );

            const ledgerId = generateSnowflake();
            await db.query(
                `INSERT INTO ascension_ledger (id, user_id, delta, reason, ref_id)
                 VALUES ($1, $2, $3, $4, $5)`,
                [ledgerId, userId, -node.cost, `server_unlock:${node.name}`, nodeId]
            );

            const newBalance = await getServerActiveBalance(serverId);
            res.json({ success: true, serverBalance: newBalance });
        } catch (error) {
            log(tags.error, 'unlockServerNode error:', error);
            res.status(500).json({ error: 'Failed to unlock server node' });
        }
    }

    // PATCH /api/ascension/servers/:serverId/unlocks/:nodeId/enable
    static async enableServerNode(req, res) {
        try {
            const userId = req.session.user.id;
            const { serverId, nodeId } = req.params;

            const serverRes = await db.query('SELECT owner_id FROM servers WHERE id = $1', [serverId]);
            if (serverRes.rows.length === 0) return res.status(404).json({ error: 'Server not found' });
            const isOwner = serverRes.rows[0].owner_id === userId;
            if (!isOwner) {
                const adminRes = await db.query(
                    `SELECT 1 FROM user_roles ur
                     JOIN roles r ON r.id = ur.role_id
                     WHERE ur.user_id = $1 AND ur.server_id = $2
                       AND (r.permissions & 8) > 0`,
                    [userId, serverId]
                );
                if (adminRes.rows.length === 0) return res.status(403).json({ error: 'Forbidden' });
            }

            const nodeRes = await db.query(
                `SELECT * FROM skill_tree_nodes WHERE id = $1 AND type = 'server'`,
                [nodeId]
            );
            if (nodeRes.rows.length === 0) return res.status(404).json({ error: 'Node not found' });
            const node = nodeRes.rows[0];

            const serverBalance = await getServerActiveBalance(serverId);
            const serverSpent = await getServerUnlockCost(serverId);
            const available = serverBalance - serverSpent;
            if (available < node.cost) return res.status(402).json({ error: 'Insufficient server points to re-enable' });

            await db.query(
                `UPDATE server_skill_unlocks SET is_active = true WHERE server_id = $1 AND node_id = $2`,
                [serverId, nodeId]
            );

            res.json({ success: true });
        } catch (error) {
            log(tags.error, 'enableServerNode error:', error);
            res.status(500).json({ error: 'Failed to enable node' });
        }
    }
}

// ── Expiration job ────────────────────────────────────────────────────────────

export async function runExpirationJob() {
    try {
        // 1. Expire purchase batches
        const expiredPurchases = await db.query(
            `UPDATE ascension_purchases SET remaining = 0
             WHERE expires_at <= NOW() AND remaining > 0
             RETURNING user_id`
        );

        const affectedUsers = [...new Set(expiredPurchases.rows.map(r => r.user_id))];

        for (const userId of affectedUsers) {
            const available = await getUserActiveBalance(userId);
            const spent = await getUserUnlockCost(userId);

            if (available < spent) {
                // Deficit — deactivate unlocks LIFO until cost fits
                const unlocks = await db.query(
                    `SELECT u.node_id, n.cost FROM user_skill_unlocks u
                     JOIN skill_tree_nodes n ON n.id = u.node_id
                     WHERE u.user_id = $1 AND u.is_active = true
                     ORDER BY u.unlocked_at DESC`,
                    [userId]
                );
                let surplus = spent - available;
                for (const u of unlocks.rows) {
                    if (surplus <= 0) break;
                    await db.query(
                        `UPDATE user_skill_unlocks SET is_active = false WHERE user_id = $1 AND node_id = $2`,
                        [userId, u.node_id]
                    );
                    const ledgerId = generateSnowflake();
                    await db.query(
                        `INSERT INTO ascension_ledger (id, user_id, delta, reason, ref_id)
                         VALUES ($1, $2, 0, 'expiry_suspend', $3)`,
                        [ledgerId, userId, u.node_id]
                    );
                    surplus -= parseInt(u.cost, 10);
                }
            } else if (available > 0) {
                // Surplus — try to reactivate suspended unlocks newest-first
                const suspended = await db.query(
                    `SELECT u.node_id, n.cost FROM user_skill_unlocks u
                     JOIN skill_tree_nodes n ON n.id = u.node_id
                     WHERE u.user_id = $1 AND u.is_active = false
                     ORDER BY u.unlocked_at DESC`,
                    [userId]
                );
                let freePool = available - spent;
                for (const u of suspended.rows) {
                    if (freePool < parseInt(u.cost, 10)) continue;
                    await db.query(
                        `UPDATE user_skill_unlocks SET is_active = true WHERE user_id = $1 AND node_id = $2`,
                        [userId, u.node_id]
                    );
                    freePool -= parseInt(u.cost, 10);
                }
            }
        }

        // 2. Expire donations
        const expiredDonations = await db.query(
            `UPDATE ascension_donations SET amount = 0
             WHERE expires_at <= NOW() AND amount > 0
             RETURNING server_id, user_id`
        );

        const affectedServers = [...new Set(expiredDonations.rows.map(r => r.server_id))];

        for (const serverId of affectedServers) {
            const serverBalance = await getServerActiveBalance(serverId);
            const serverSpent = await getServerUnlockCost(serverId);

            if (serverBalance < serverSpent) {
                // Deactivate server unlocks LIFO — no auto-reactivation
                const unlocks = await db.query(
                    `SELECT u.node_id, n.cost FROM server_skill_unlocks u
                     JOIN skill_tree_nodes n ON n.id = u.node_id
                     WHERE u.server_id = $1 AND u.is_active = true
                     ORDER BY u.unlocked_at DESC`,
                    [serverId]
                );
                let surplus = serverSpent - serverBalance;
                const ownerRes = await db.query('SELECT owner_id FROM servers WHERE id = $1', [serverId]);
                const ownerId = ownerRes.rows[0]?.owner_id;

                for (const u of unlocks.rows) {
                    if (surplus <= 0) break;
                    await db.query(
                        `UPDATE server_skill_unlocks SET is_active = false WHERE server_id = $1 AND node_id = $2`,
                        [serverId, u.node_id]
                    );
                    if (ownerId) {
                        const ledgerId = generateSnowflake();
                        await db.query(
                            `INSERT INTO ascension_ledger (id, user_id, delta, reason, ref_id)
                             VALUES ($1, $2, 0, 'server_expiry', $3)`,
                            [ledgerId, ownerId, u.node_id]
                        );
                    }
                    surplus -= parseInt(u.cost, 10);
                }
            }
        }

        log(tags.system, `[Ascension] Expiration job complete. Users: ${affectedUsers.length}, Servers: ${affectedServers.length}`);
    } catch (error) {
        log(tags.error, 'runExpirationJob error:', error);
    }
}

export default AscensionController;
