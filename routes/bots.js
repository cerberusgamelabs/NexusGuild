// Proprietary — Cerberus Game Labs. See LICENSE for terms.
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import BotController from '../controllers/botController.js';

const router = Router();

// Public bot info (for invite page — no auth required)
router.get('/:botId/public', BotController.getPublicBot);

// Returns only servers where the user is owner or has ADMINISTRATOR — used by bot invite page
router.get('/eligible-servers', requireAuth, BotController.getEligibleServers);

// Bot CRUD (dev portal)
router.post('/',                                           requireAuth, BotController.createBot);
router.get('/',                                            requireAuth, BotController.listBots);
router.get('/:botId',                                      requireAuth, BotController.getBot);
router.patch('/:botId',                                    requireAuth, BotController.updateBot);
router.delete('/:botId',                                   requireAuth, BotController.deleteBot);
router.post('/:botId/token/regenerate',                    requireAuth, BotController.regenerateToken);
router.get('/:botId/token',                                requireAuth, BotController.getToken);

// Server installs
router.get('/:botId/servers',                              requireAuth, BotController.listBotServers);
router.put('/:botId/servers/:serverId',                    requireAuth, BotController.addBotToServer);
router.delete('/:botId/servers/:serverId',                 requireAuth, BotController.removeBotFromServer);

// Slash commands
router.get('/:botId/servers/:serverId/commands',           requireAuth, BotController.listCommands);
router.put('/:botId/servers/:serverId/commands',           requireAuth, BotController.upsertCommand);
router.delete('/:botId/servers/:serverId/commands/:commandId', requireAuth, BotController.deleteCommand);

export default router;
