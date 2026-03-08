// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// Discord-compatible bot REST API — all routes require bot token auth

import { Router } from 'express';
import { requireBotAuth } from '../middleware/auth.js';
import V1Controller from '../controllers/v1Controller.js';

const router = Router();
router.use(requireBotAuth);

// Current bot user
router.get('/users/@me', V1Controller.getMe);

// Channels
router.get('/channels/:channelId',                                                V1Controller.getChannel);
router.get('/channels/:channelId/messages',                                       V1Controller.getMessages);
router.post('/channels/:channelId/messages',                                      V1Controller.createMessage);
router.patch('/channels/:channelId/messages/:messageId',                          V1Controller.editMessage);
router.delete('/channels/:channelId/messages/bulk-delete',                        V1Controller.bulkDeleteMessages);
router.delete('/channels/:channelId/messages/:messageId',                         V1Controller.deleteMessage);

// Reactions — emoji in URL must be encoded (e.g. %F0%9F%91%8D for 👍)
router.put('/channels/:channelId/messages/:messageId/reactions/:emoji/@me',       V1Controller.addReaction);
router.delete('/channels/:channelId/messages/:messageId/reactions/:emoji/@me',    V1Controller.removeReaction);

// Pins
router.get('/channels/:channelId/pins',               V1Controller.getPins);
router.put('/channels/:channelId/pins/:messageId',    V1Controller.addPin);
router.delete('/channels/:channelId/pins/:messageId', V1Controller.removePin);

// Guilds
router.get('/guilds/:guildId',                                    V1Controller.getGuild);
router.get('/guilds/:guildId/channels',                           V1Controller.getGuildChannels);
router.get('/guilds/:guildId/members',                            V1Controller.getGuildMembers);
router.get('/guilds/:guildId/members/:userId',                    V1Controller.getGuildMember);

// Roles
router.get('/guilds/:guildId/roles',                              V1Controller.getGuildRoles);
router.post('/guilds/:guildId/roles',                             V1Controller.createGuildRole);
router.patch('/guilds/:guildId/roles/:roleId',                    V1Controller.editGuildRole);
router.delete('/guilds/:guildId/roles/:roleId',                   V1Controller.deleteGuildRole);
router.put('/guilds/:guildId/members/:userId/roles/:roleId',      V1Controller.addMemberRole);
router.delete('/guilds/:guildId/members/:userId/roles/:roleId',   V1Controller.removeMemberRole);

export default router;
