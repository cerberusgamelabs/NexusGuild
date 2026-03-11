// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/giphyController.js

import { log, tags } from "#utils/logging";

const GIPHY_API_BASE  = 'https://api.giphy.com/v1/gifs';
const GIPHY_LIMIT     = 24;
const GIPHY_RATING    = 'pg-13';

// ── Server-side cache ─────────────────────────────────────────────────────────
const CACHE_TTL_SEARCH   = 10 * 60 * 1000; // 10 min for search queries
const CACHE_TTL_TRENDING = 30 * 60 * 1000; // 30 min for trending
const CACHE_MAX_SIZE     = 200;             // max entries before evicting oldest

const _cache = new Map(); // key → { gifs, expiresAt }

function _cacheGet(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
    return entry.gifs;
}

function _cacheSet(key, gifs, ttl) {
    if (_cache.size >= CACHE_MAX_SIZE) {
        _cache.delete(_cache.keys().next().value); // evict oldest
    }
    _cache.set(key, { gifs, expiresAt: Date.now() + ttl });
}

// Shape a raw Giphy data item into the minimal object the client needs.
// Prefer fixed_height for chat — capped width, consistent row height.
// Fall back to downsized if fixed_height is absent.
function _shapeGif(item) {
    const images = item.images || {};
    const rendition = images.fixed_height || images.downsized || {};
    return {
        id:    item.id    || '',
        title: item.title || '',
        url:   rendition.url || '',
    };
}

class GiphyController {
    static async search(req, res) {
        if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });

        const { q } = req.query;
        if (!q || !q.trim()) return res.status(400).json({ error: 'q is required' });

        const apiKey = process.env.GIPHY_API_KEY;
        if (!apiKey) {
            log(tags.error, 'GIPHY_API_KEY is not set');
            return res.status(503).json({ error: 'GIF search unavailable' });
        }

        const cacheKey = `search:${q.trim().toLowerCase()}`;
        const cached = _cacheGet(cacheKey);
        if (cached) return res.json(cached);

        const url = `${GIPHY_API_BASE}/search?api_key=${apiKey}&q=${encodeURIComponent(q.trim())}&limit=${GIPHY_LIMIT}&rating=${GIPHY_RATING}`;

        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), 6000);

        try {
            const resp = await fetch(url, {
                signal:  controller.signal,
                headers: { 'User-Agent': 'NexusGuild/1.0' },
            });
            clearTimeout(timeoutId);

            if (!resp.ok) {
                log(tags.error, `Giphy search error: HTTP ${resp.status}`);
                return res.status(502).json({ error: 'Giphy API error' });
            }

            const json = await resp.json();
            const gifs = (json.data || []).map(_shapeGif).filter(g => g.url);
            _cacheSet(cacheKey, gifs, CACHE_TTL_SEARCH);
            log(tags.info, `Giphy search [${gifs.length} results]: "${q.trim().substring(0, 40)}"`);
            res.json(gifs);
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                log(tags.error, 'Giphy search timed out');
                return res.status(504).json({ error: 'Request timed out' });
            }
            log(tags.error, 'Giphy search fetch error:', err.message);
            res.status(502).json({ error: 'Failed to reach Giphy' });
        }
    }

    static async trending(req, res) {
        if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });

        const apiKey = process.env.GIPHY_API_KEY;
        if (!apiKey) {
            log(tags.error, 'GIPHY_API_KEY is not set');
            return res.status(503).json({ error: 'GIF search unavailable' });
        }

        const cached = _cacheGet('trending');
        if (cached) return res.json(cached);

        const url = `${GIPHY_API_BASE}/trending?api_key=${apiKey}&limit=${GIPHY_LIMIT}&rating=${GIPHY_RATING}`;

        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), 6000);

        try {
            const resp = await fetch(url, {
                signal:  controller.signal,
                headers: { 'User-Agent': 'NexusGuild/1.0' },
            });
            clearTimeout(timeoutId);

            if (!resp.ok) {
                log(tags.error, `Giphy trending error: HTTP ${resp.status}`);
                return res.status(502).json({ error: 'Giphy API error' });
            }

            const json = await resp.json();
            const gifs = (json.data || []).map(_shapeGif).filter(g => g.url);
            _cacheSet('trending', gifs, CACHE_TTL_TRENDING);
            log(tags.info, `Giphy trending [${gifs.length} results]`);
            res.json(gifs);
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                log(tags.error, 'Giphy trending timed out');
                return res.status(504).json({ error: 'Request timed out' });
            }
            log(tags.error, 'Giphy trending fetch error:', err.message);
            res.status(502).json({ error: 'Failed to reach Giphy' });
        }
    }
}

export default GiphyController;
