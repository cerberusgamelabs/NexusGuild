// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /routes/vtt.js

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { uploadVTTMap, uploadVTTToken, handleUploadError } from '../middleware/upload.js';
import {
    getSession,
    uploadMap,
    updateMap,
    addToken,
    updateToken,
    removeToken,
    updateEncounter,
    getCharacters,
    createCharacter,
    updateCharacter,
    deleteCharacter,
    getDddiceToken,
    dddiceRoll,
    importDndbeyond,
} from '../controllers/vttController.js';

const router = express.Router();

// All VTT routes require auth. Server membership checked in controller via channel lookup.

router.get('/:channelId/session',  requireAuth, getSession);
router.get('/:channelId/dddice',   requireAuth, getDddiceToken);
router.post('/:channelId/roll',    requireAuth, dddiceRoll);

router.post('/:channelId/map/upload', requireAuth, uploadVTTMap, handleUploadError, uploadMap);
router.patch('/:channelId/map',       requireAuth, updateMap);

router.post('/:channelId/tokens',                          requireAuth, uploadVTTToken, handleUploadError, addToken);
router.patch('/:channelId/tokens/:tokenId',                requireAuth, updateToken);
router.delete('/:channelId/tokens/:tokenId',               requireAuth, removeToken);

router.put('/:channelId/encounter', requireAuth, updateEncounter);

router.get('/:channelId/characters',               requireAuth, getCharacters);
router.post('/:channelId/characters',              requireAuth, createCharacter);
router.post('/:channelId/characters/import-dndbeyond', requireAuth, importDndbeyond);
router.patch('/:channelId/characters/:charId',     requireAuth, updateCharacter);
router.delete('/:channelId/characters/:charId',    requireAuth, deleteCharacter);

export default router;
