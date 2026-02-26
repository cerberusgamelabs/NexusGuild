// Proprietary — Cerberus Game Labs. See LICENSE for terms.
import express from 'express';
import path from 'path';

import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

const folder = 'public_developer';
const port = 3001;

// Serve static files (CSS)
app.use(express.static(path.join(__dirname, folder)));

// Serve privacy.html at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, folder, 'index.html'));
});

app.listen(port, () => {
    console.log('Privacy server running at http://localhost:${port}');
});