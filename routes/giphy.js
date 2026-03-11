// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /routes/giphy.js

import express from "express";
const router = express.Router();
import GiphyController from "../controllers/giphyController.js";

router.get('/trending', GiphyController.trending);
router.get('/',         GiphyController.search);

export default router;
