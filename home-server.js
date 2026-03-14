// Proprietary — Cerberus Game Labs. See LICENSE for terms.
import express from 'express';
import path from 'path';

import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

const folder = 'public_home';
const port = 3000;

app.use(express.static(path.join(__dirname, folder)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, folder, 'index.html'));
});

// NIC moved to nic.nexusguild.gg — redirect old path
app.get('/nic*', (req, res) => {
    res.redirect(301, 'https://nic.nexusguild.gg');
});

app.listen(port, () => {
    console.log(`[home] Server running at http://localhost:${port}`);
});
