// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/integrationsController.js

import https from 'https';
import db from '../config/database.js';
import { log, tags } from '#utils/logging';

const DDDICE_API = 'https://dddice.com/api/1.0';
const NEXUSGUILD_SHARE_CODE = '614648f2-1bee-11f1-9b69-969c76305473';

// GET /api/integrations/dddice — current integration status for the logged-in user
export async function getDddiceIntegration(req, res) {
    try {
        const result = await db.query(
            'SELECT dddice_token, dddice_theme FROM users WHERE id=$1',
            [req.session.user.id]
        );
        const { dddice_token, dddice_theme } = result.rows[0];
        if (!dddice_token) return res.json({ connected: false });

        // Fetch their dddice username to confirm token is still valid
        const userRes = await fetch(`${DDDICE_API}/user`, {
            headers: { 'Authorization': `Bearer ${dddice_token}` }
        });
        if (!userRes.ok) {
            // Token invalid — clear it
            await db.query('UPDATE users SET dddice_token=NULL, dddice_theme=NULL WHERE id=$1', [req.session.user.id]);
            return res.json({ connected: false });
        }
        const userData = await userRes.json();
        res.json({ connected: true, username: userData.data.username, theme: dddice_theme });
    } catch (e) {
        log(tags.error, 'getDddiceIntegration:', e.message);
        res.status(500).json({ error: 'Failed to get integration status' });
    }
}

// POST /api/integrations/dddice/activate — start activation flow, return code + secret
export async function startDddiceActivation(req, res) {
    try {
        const activateRes = await fetch(`${DDDICE_API}/activate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.DDDICE_API_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        if (!activateRes.ok) throw new Error('Failed to create activation code');
        const data = await activateRes.json();
        // Return code + secret — frontend shows code to user, polls with secret
        res.json({ code: data.data.code, secret: data.data.secret });
    } catch (e) {
        log(tags.error, 'startDddiceActivation:', e.message);
        res.status(500).json({ error: 'Failed to start dddice activation' });
    }
}

// Helper: GET request with a JSON body (Node.js fetch blocks this)
function getWithBody(url, body, token) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const u = new URL(url);
        const opts = {
            hostname: u.hostname,
            path: u.pathname,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            }
        };
        const req = https.request(opts, (r) => {
            let raw = '';
            r.on('data', c => raw += c);
            r.on('end', () => {
                try { resolve({ ok: r.statusCode < 400, json: () => JSON.parse(raw) }); }
                catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

// GET /api/integrations/dddice/activate/:code?secret= — poll activation status
export async function pollDddiceActivation(req, res) {
    const { code } = req.params;
    const { secret } = req.query;
    if (!secret) return res.status(400).json({ error: 'secret required' });
    try {
        const pollRes = await fetch(`${DDDICE_API}/activate/${code}`, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Secret ${secret}`,
            }
        });
        const data = await pollRes.json();
        if (!pollRes.ok) return res.json({ status: 'pending' });

        // Token appears in response once the user has authorized on dddice.com
        const token = data.data?.token;
        if (!token) return res.json({ status: 'pending' });

        // Store token and add NexusGuild theme to their dice box
        await db.query('UPDATE users SET dddice_token=$1 WHERE id=$2', [token, req.session.user.id]);
        await fetch(`${DDDICE_API}/share/${NEXUSGUILD_SHARE_CODE}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });

        const username = data.data?.user?.username;
        res.json({ status: 'complete', username });
    } catch (e) {
        log(tags.error, 'pollDddiceActivation:', e.message);
        res.status(500).json({ error: 'Failed to poll activation' });
    }
}

// GET /api/integrations/dddice/dice-box — fetch user's available themes
export async function getDddiceDiceBox(req, res) {
    try {
        const result = await db.query('SELECT dddice_token FROM users WHERE id=$1', [req.session.user.id]);
        const token = result.rows[0]?.dddice_token;
        if (!token) return res.status(401).json({ error: 'Not connected' });

        const boxRes = await fetch(`${DDDICE_API}/dice-box`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!boxRes.ok) throw new Error('Failed to fetch dice box');
        const data = await boxRes.json();

        // Return just what the UI needs: id, name, preview image
        const themes = (data.data || []).map(t => ({
            id: t.id,
            name: t.name,
            preview: t.preview?.d20 || t.preview?.preview || null
        }));
        res.json({ themes });
    } catch (e) {
        log(tags.error, 'getDddiceDiceBox:', e.message);
        res.status(500).json({ error: 'Failed to fetch dice box' });
    }
}

// PATCH /api/integrations/dddice/theme — save chosen theme
export async function setDddiceTheme(req, res) {
    const { theme } = req.body;
    if (!theme) return res.status(400).json({ error: 'theme required' });
    try {
        await db.query('UPDATE users SET dddice_theme=$1 WHERE id=$2', [theme, req.session.user.id]);
        res.json({ success: true });
    } catch (e) {
        log(tags.error, 'setDddiceTheme:', e.message);
        res.status(500).json({ error: 'Failed to save theme' });
    }
}

// DELETE /api/integrations/dddice — disconnect integration
export async function disconnectDddice(req, res) {
    try {
        await db.query('UPDATE users SET dddice_token=NULL, dddice_theme=NULL WHERE id=$1', [req.session.user.id]);
        res.json({ success: true });
    } catch (e) {
        log(tags.error, 'disconnectDddice:', e.message);
        res.status(500).json({ error: 'Failed to disconnect' });
    }
}
