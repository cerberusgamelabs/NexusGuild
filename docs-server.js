// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// Docs server — developer documentation for NexusGuild client & bot API
// Run: node docs-server.js   (separate process from server.js)

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.DOCS_PORT || 3007;
const folder = 'public_docs';

app.use(express.static(path.join(__dirname, folder)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, folder, 'index.html'));
});

app.get('*', (req, res) => {
    const file = path.join(__dirname, folder, req.path.endsWith('.html') ? req.path : req.path + '.html');
    res.sendFile(file, err => {
        if (err) res.status(404).sendFile(path.join(__dirname, folder, '404.html'), () => {
            res.end('Not found');
        });
    });
});

app.listen(PORT, () => {
    console.log(`Docs server running at http://localhost:${PORT}`);
});
