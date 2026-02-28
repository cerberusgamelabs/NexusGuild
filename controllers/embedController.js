// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /controllers/embedController.js

import { log, tags } from "#utils/logging";

// Block private/loopback IP ranges to prevent SSRF
function isBlockedUrl(urlStr) {
    try {
        const u = new URL(urlStr);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
        const h = u.hostname;
        // localhost and loopback
        if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
        // Private IPv4 ranges
        const ipv4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
        if (ipv4) {
            const [, a, b] = ipv4.map(Number);
            if (a === 10) return true;
            if (a === 172 && b >= 16 && b <= 31) return true;
            if (a === 192 && b === 168) return true;
            if (a === 169 && b === 254) return true;
            if (a === 0) return true;
        }
        return false;
    } catch {
        return true;
    }
}

function extractMeta(html) {
    const ogTitle       = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
                       || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1];
    const ogDesc        = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1]
                       || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)?.[1];
    const ogImage       = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
                       || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
    const ogSiteName    = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1]
                       || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i)?.[1];
    const titleTag      = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];

    return {
        title:    (ogTitle || titleTag || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim(),
        description: (ogDesc || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim(),
        image:    ogImage || null,
        siteName: (ogSiteName || '').trim(),
    };
}

class EmbedController {
    static async getEmbed(req, res) {
        const { url } = req.query;
        if (!url) return res.status(400).json({ error: 'url query param required' });
        if (isBlockedUrl(url)) return res.status(403).json({ error: 'Blocked URL' });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        try {
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control': 'no-cache',
                },
                redirect: 'follow',
            });

            if (!response.ok) {
                clearTimeout(timeoutId);
                return res.status(204).end();
            }

            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('text/html')) {
                clearTimeout(timeoutId);
                return res.status(204).end();
            }

            // Limit to first 200KB — enough to capture <head> OG tags on any site
            const html = (await response.text()).slice(0, 200 * 1024);
            clearTimeout(timeoutId);

            const meta = extractMeta(html);
            log(tags.info, `Embed [${meta.title ? 'hit' : 'miss'}]: ${url.substring(0, 80)}`);

            if (!meta.title && !meta.description && !meta.image) {
                return res.status(204).end();
            }

            res.json({ ...meta, url });
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name !== 'AbortError') {
                log(tags.error, 'Embed fetch error:', err.message);
            }
            res.status(204).end();
        }
    }
}

export default EmbedController;
