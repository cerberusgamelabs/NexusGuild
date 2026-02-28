// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /routes/embed.js

import express from "express";
const router = express.Router();
import EmbedController from "../controllers/embedController.js";

router.get('/', EmbedController.getEmbed);

export default router;
