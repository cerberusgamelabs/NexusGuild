# NexusGuild

A full-featured real-time chat platform built with Node.js, Express, Socket.io, and PostgreSQL. Inspired by Discord's feature set, with a vanilla JavaScript web client and a REST + WebSocket API that can be used to build alternative clients.

> **License Notice:** This repository uses a dual-license model. The backend/infrastructure is source-available (view only). Client applications and SDKs are licensed under BSL 1.1, converting to MIT on January 1, 2031. See [LICENSE](./LICENSE) for full terms.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [REST API Reference](#rest-api-reference)
  - [Authentication](#authentication)
  - [Users](#users)
  - [Servers](#servers)
  - [Roles & Permissions](#roles--permissions)
  - [Member Management](#member-management)
  - [Channels & Categories](#channels--categories)
  - [Channel Permission Overrides](#channel-permission-overrides)
  - [Messages](#messages)
  - [Reactions & Emojis](#reactions--emojis)
  - [Direct Messages](#direct-messages)
  - [Invites](#invites)
  - [Import](#import)
  - [Forum](#forum)
  - [System](#system)
- [Real-Time Events (Socket.io)](#real-time-events-socketio)
  - [Client → Server Events](#client--server-events)
  - [Server → Client Events](#server--client-events)
- [Building a Client](#building-a-client)
  - [Authentication Flow](#authentication-flow)
  - [Connecting to the Socket](#connecting-to-the-socket)
  - [Loading the Initial State](#loading-the-initial-state)
  - [Permission Flags](#permission-flags)
  - [ID Format](#id-format)
  - [File Uploads](#file-uploads)
- [License](#license)

---

## Features

| Category | Status |
|---|---|
| Registration, login, session persistence | Implemented |
| Server create / rename / delete / icon upload | Implemented |
| Invite links with expiry and use limits | Implemented |
| Text, voice, announcement, forum, and media channels | Implemented |
| Categories (create / rename / delete) | Implemented |
| Real-time messaging with file attachments | Implemented |
| Message edit and delete | Implemented |
| Paginated message history (scroll-to-load) | Implemented |
| Unicode and custom server emoji reactions | Implemented |
| Direct messages (1:1) | Implemented |
| Role system with 21 Discord-compatible permission flags | Implemented |
| Channel-level permission overrides per role/member | Implemented |
| Kick, ban, unban, nickname | Implemented |
| Unread counts and mention badges (DB-persisted) | Implemented |
| @mention autocomplete (@everyone, @here, @username) | Implemented |
| Desktop notifications on mention | Implemented |
| Typing indicators | Implemented |
| Forum channel post/reply view | Implemented |
| Media channel gallery view | Implemented |
| Discord server structure import | Implemented |
| Mobile-responsive web client | Implemented |
| Voice channels | Schema wired, audio not yet integrated |
| Message pinning | Stub only |
| Message threading / replies | Not yet built |
| Voice / video (LiveKit) | Planned |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ESM) |
| HTTP framework | Express 4 |
| Real-time | Socket.io 4 |
| Database | PostgreSQL (via `pg`) |
| Session store | `connect-pg-simple` |
| Password hashing | bcryptjs |
| File uploads | multer |
| Frontend | Vanilla JS, CSS3 |

---

## REST API Reference

All endpoints are relative to the server root (e.g., `http://localhost:3000`).
All endpoints require an active session cookie unless marked **Public**.
Session cookies are set on successful login and must be sent with every subsequent request (`credentials: 'include'` / `withCredentials: true`).

Request bodies are JSON unless the endpoint accepts file uploads (multipart/form-data).

---

### Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | Public | Create a new account |
| `POST` | `/api/auth/login` | Public | Log in and receive a session cookie |
| `POST` | `/api/auth/logout` | Required | Invalidate the current session |
| `GET` | `/api/auth/me` | Required | Return the authenticated user's profile |

**POST /api/auth/register**
```json
{
  "username": "string",
  "email": "string",
  "password": "string"
}
```

**POST /api/auth/login**
```json
{
  "email": "string",
  "password": "string"
}
```

**GET /api/auth/me** — Response:
```json
{
  "id": "snowflake",
  "username": "string",
  "email": "string",
  "avatar": "string | null",
  "created_at": "ISO8601"
}
```

---

### Users

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/users/me/avatar` | Required | Upload a profile avatar (multipart/form-data, field: `file`) |

---

### Servers

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/servers` | Required | List servers the current user is a member of |
| `POST` | `/api/servers` | Required | Create a new server |
| `GET` | `/api/servers/:serverId` | Member | Get server details |
| `PATCH` | `/api/servers/:serverId` | MANAGE_GUILD | Rename the server or update settings |
| `DELETE` | `/api/servers/:serverId` | Owner | Delete the server permanently |
| `POST` | `/api/servers/join` | Required | Join a server via invite code |
| `POST` | `/api/servers/:serverId/leave` | Member | Leave the server |
| `POST` | `/api/servers/:serverId/icon` | Owner | Upload a server icon (multipart/form-data, field: `file`) |

**POST /api/servers** body:
```json
{ "name": "string" }
```

**POST /api/servers/join** body:
```json
{ "code": "invite-code-string" }
```

---

### Roles & Permissions

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/servers/:serverId/roles` | Member | List all roles |
| `POST` | `/api/servers/:serverId/roles` | MANAGE_ROLES | Create a new role |
| `PATCH` | `/api/servers/:serverId/roles/reorder` | MANAGE_ROLES | Reorder roles by position |
| `PATCH` | `/api/servers/:serverId/roles/:roleId` | MANAGE_ROLES | Update role name, color, permissions, hoist, mentionable |
| `DELETE` | `/api/servers/:serverId/roles/:roleId` | MANAGE_ROLES | Delete a role |

**POST /api/servers/:serverId/roles** body:
```json
{
  "name": "string",
  "color": "#RRGGBB",
  "permissions": "integer (bitmask)",
  "hoist": false,
  "mentionable": false
}
```

**PATCH /api/servers/:serverId/roles/reorder** body:
```json
[
  { "id": "roleId", "position": 1 },
  { "id": "roleId", "position": 2 }
]
```

---

### Member Management

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/servers/:serverId/members` | Member | List members with roles and computed permissions |
| `GET` | `/api/servers/:serverId/settings/members` | Member | Member list for the settings panel |
| `GET` | `/api/servers/:serverId/members/:memberId/roles` | Member | List roles assigned to a member |
| `POST` | `/api/servers/:serverId/members/:memberId/roles` | MANAGE_ROLES | Assign a role to a member |
| `DELETE` | `/api/servers/:serverId/members/:memberId/roles/:roleId` | MANAGE_ROLES | Remove a role from a member |
| `PATCH` | `/api/servers/:serverId/members/:memberId` | Member | Set a nickname |
| `DELETE` | `/api/servers/:serverId/members/:memberId` | KICK_MEMBERS | Kick a member |
| `GET` | `/api/servers/:serverId/bans` | BAN_MEMBERS | List bans |
| `POST` | `/api/servers/:serverId/bans/:memberId` | BAN_MEMBERS | Ban a member |
| `DELETE` | `/api/servers/:serverId/bans/:memberId` | BAN_MEMBERS | Unban a member |

**GET /api/servers/:serverId/members** — Response includes:
```json
{
  "members": [ { "id": "...", "username": "...", "roles": [], "nickname": null } ],
  "myPermissions": 12345678
}
```
`myPermissions` is the caller's computed permission bitmask (BigInt serialised as a Number). Use this to drive client-side UI gating.

---

### Channels & Categories

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/channels/servers/:serverId/channels` | Member | List all channels and categories |
| `POST` | `/api/channels/servers/:serverId/channels` | MANAGE_CHANNELS | Create a channel |
| `POST` | `/api/channels/servers/:serverId/categories` | MANAGE_CHANNELS | Create a category |
| `PATCH` | `/api/channels/servers/:serverId/categories/:categoryId` | MANAGE_CHANNELS | Rename a category |
| `DELETE` | `/api/channels/servers/:serverId/categories/:categoryId` | MANAGE_CHANNELS | Delete a category (channels become uncategorized) |
| `PATCH` | `/api/channels/:channelId` | Required | Update a channel (name, topic, etc.) |
| `DELETE` | `/api/channels/:channelId` | Required | Delete a channel |
| `PATCH` | `/api/channels/:channelId/read` | Required | Mark a channel as read (updates DB cursor) |

**POST /api/channels/servers/:serverId/channels** body:
```json
{
  "name": "string",
  "type": "text | voice | announcement | forum | media",
  "categoryId": "snowflake | null"
}
```

**GET /api/channels/servers/:serverId/channels** — Response:
```json
{
  "categories": [ { "id": "...", "name": "..." } ],
  "channels": [
    {
      "id": "...",
      "name": "...",
      "type": "text",
      "category_id": "... | null",
      "unread_count": 3,
      "mention_count": 1
    }
  ]
}
```

---

### Channel Permission Overrides

Overrides layer on top of server-level role permissions per channel. Both role-based and per-member overrides are supported.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/channels/:channelId/permissions` | Required | Get all overrides for a channel |
| `PUT` | `/api/channels/:channelId/permissions/:targetId` | Required | Create or update an override (role or member) |
| `DELETE` | `/api/channels/:channelId/permissions/:targetId` | Required | Delete an override |

**PUT /api/channels/:channelId/permissions/:targetId** body:
```json
{
  "type": "role | member",
  "allow": 1024,
  "deny": 2048
}
```
`allow` and `deny` are permission bitmasks. A permission bit set in `allow` grants it; set in `deny` denies it; absent from both inherits from the role.

---

### Messages

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/messages/channels/:channelId/messages` | Required | Fetch messages (paginated) |
| `POST` | `/api/messages/channels/:channelId/messages` | Required | Send a message (supports file attachments) |
| `PATCH` | `/api/messages/:messageId` | Required | Edit a message (own only) |
| `DELETE` | `/api/messages/:messageId` | Required | Delete a message (own or MANAGE_MESSAGES) |

**GET /api/messages/channels/:channelId/messages** query params:
- `before` — snowflake ID to paginate backwards (load older messages)
- `limit` — number of messages to return (default 50, max 100)

**POST /api/messages/channels/:channelId/messages** — multipart/form-data:
- `content` — message text (required if no files)
- `file` — one or more file attachments (optional)

**Message object:**
```json
{
  "id": "snowflake",
  "content": "string",
  "author": { "id": "...", "username": "...", "avatar": "..." },
  "attachments": [ { "url": "...", "filename": "...", "content_type": "..." } ],
  "created_at": "ISO8601",
  "updated_at": "ISO8601 | null"
}
```

---

### Reactions & Emojis

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/reactions/messages/:messageId/reactions` | Required | Get all reactions on a message |
| `POST` | `/api/reactions/messages/:messageId/reactions` | Required | Add a reaction |
| `DELETE` | `/api/reactions/messages/:messageId/reactions` | Required | Remove a reaction |
| `GET` | `/api/reactions/servers/:serverId/emojis` | Required | List custom emojis for a server |
| `POST` | `/api/reactions/servers/:serverId/emojis` | Required | Upload a custom emoji (multipart/form-data, field: `file`) |

**POST /api/reactions/messages/:messageId/reactions** body:
```json
{ "emoji": "👍" }
```
For custom emoji, pass the emoji name prefixed with `:`: `{ "emoji": ":custom_name:" }`.

---

### Direct Messages

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/dm/users/search` | Required | Search users by username (query param: `q`) |
| `GET` | `/api/dm` | Required | List open DM conversations |
| `POST` | `/api/dm` | Required | Open or create a DM with a user |
| `GET` | `/api/dm/:dmId/messages` | Required | Fetch messages in a DM conversation |
| `POST` | `/api/dm/:dmId/messages` | Required | Send a message in a DM |
| `PATCH` | `/api/dm/:dmId/messages/:messageId` | Required | Edit a DM message (sender only) |
| `DELETE` | `/api/dm/:dmId/messages/:messageId` | Required | Delete a DM message (sender only) |

**POST /api/dm** body:
```json
{ "userId": "snowflake" }
```

Response includes `{ "dmId": "snowflake" }` for the conversation.

---

### Invites

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/servers/:serverId/invites` | CREATE_INSTANT_INVITE | Create an invite link |
| `GET` | `/api/servers/:serverId/invites` | Member | List active invites |

**POST /api/servers/:serverId/invites** body:
```json
{
  "maxUses": 0,
  "expiresAt": "ISO8601 | null"
}
```
`maxUses: 0` means unlimited uses. Response includes `{ "code": "abc123" }`.

Invite URL format: `https://your-domain.com/invite/:code`

---

### Import

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/import` | Required | Import a Discord server export JSON to create a new server |

**POST /api/import** body: the raw Discord export JSON object.

---

### Forum

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/forum/channels/:channelId/posts` | Required | List forum posts in a channel |
| `POST` | `/api/forum/channels/:channelId/posts` | Required | Create a new forum post |
| `GET` | `/api/forum/posts/:postId/messages` | Required | Fetch messages in a forum post |
| `POST` | `/api/forum/posts/:postId/messages` | Required | Reply to a forum post |

---

### System

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Server health check (uptime, memory) |
| `GET` | `/api/permissions` | Public | Returns all permission flag names and their numeric values |

**GET /api/permissions** — use this endpoint to retrieve the current permission bitmask values rather than hardcoding them:
```json
{
  "VIEW_CHANNEL": 1024,
  "SEND_MESSAGES": 2048,
  "MANAGE_CHANNELS": 16,
  "ADMINISTRATOR": 8,
  ...
}
```

---

## Real-Time Events (Socket.io)

The server uses Socket.io on the same port as HTTP. Connect using the Socket.io client library with `withCredentials: true`.

### Room model

| Room | Purpose |
|---|---|
| `server:<serverId>` | Broadcast events to all members of a server |
| `channel:<channelId>` | Broadcast message events to members viewing a channel |
| `user:<userId>` | Deliver DMs and personal notifications to a specific user |

---

### Client → Server Events

| Event | Payload | Description |
|---|---|---|
| `join_server` | `{ serverId }` | Join a server's broadcast room |
| `join_channel` | `{ channelId }` | Join a channel's message room |
| `leave_channel` | `{ channelId }` | Leave a channel's message room |
| `typing_start` | `{ channelId, serverId, username }` | Broadcast a typing indicator |

---

### Server → Client Events

| Event | Payload | Description |
|---|---|---|
| `message_created` | Message object | New message sent in a joined channel |
| `message_updated` | `{ id, content, updated_at }` | A message was edited |
| `message_deleted` | `{ id, channelId }` | A message was deleted |
| `channel_notification` | `{ channelId, serverId, authorId }` | Fires on every new message — used for unread badges |
| `channel_created` | Channel object | A channel was created in a server you're in |
| `channel_updated` | Channel object | A channel was renamed or updated |
| `channel_deleted` | `{ channelId, serverId }` | A channel was deleted |
| `category_created` | Category object | A category was created |
| `category_updated` | Category object | A category was renamed |
| `category_deleted` | `{ categoryId, serverId }` | A category was deleted |
| `reaction_added` | `{ messageId, emoji, userId, username }` | A reaction was added |
| `reaction_removed` | `{ messageId, emoji, userId }` | A reaction was removed |
| `typing` | `{ channelId, username }` | Another user is typing |
| `member_joined` | Member object | A user joined the server |
| `member_left` | `{ userId, serverId }` | A user left or was kicked |
| `dm_message` | DM message object | A direct message delivered to `user:<userId>` |
| `dm_message_updated` | `{ dmId, messageId, content }` | A DM message was edited |
| `dm_message_deleted` | `{ dmId, messageId }` | A DM message was deleted |
| `role_updated` | `{ serverId }` | Roles or permissions changed — re-fetch members |
| `permissions_updated` | `{ channelId }` | Channel overrides changed — re-fetch |

---

## Building a Client

This section describes how to write a custom client (desktop app, mobile app, bot, etc.) that interacts with the NexusGuild API.

> **License check:** Before building a client, read Section 2 of the [LICENSE](./LICENSE). Client code is under BSL 1.1. Production deployment requires written permission from Cerberus Game Labs until the Change Date (January 1, 2031).

---

### Authentication Flow

1. **Register** — `POST /api/auth/register` with username, email, password.
2. **Login** — `POST /api/auth/login`. The server responds with a `Set-Cookie` header containing the session cookie.
3. Store and send this cookie on every subsequent request (`credentials: 'include'` for fetch, `withCredentials: true` for axios/socket.io).
4. On app start, call `GET /api/auth/me` to check if an existing session is valid.
5. **Logout** — `POST /api/auth/logout`.

---

### Connecting to the Socket

```js
import { io } from 'socket.io-client';

const socket = io('https://nexusguild.gg', {
  withCredentials: true // required — sends the session cookie
});

socket.on('connect', () => {
  // Join all servers the user is a member of
  for (const server of servers) {
    socket.emit('join_server', { serverId: server.id });
  }
});
```

Join the specific channel the user is viewing:
```js
socket.emit('join_channel', { channelId });
// When navigating away:
socket.emit('leave_channel', { channelId: previousChannelId });
```

---

### Loading the Initial State

Recommended startup sequence after authentication:

```
1. GET /api/auth/me              → current user object
2. GET /api/servers              → list of servers
3. For each server:
   GET /api/channels/servers/:id/channels   → channels + unread counts
4. GET /api/permissions          → permission flag values (cache this)
5. socket.connect() → join_server for each server
```

When the user selects a server:
```
GET /api/servers/:serverId/members  → members list + myPermissions (bitmask)
```

Use the returned `myPermissions` bitmask to gate UI elements (show/hide create channel button, show/hide settings, etc.).

---

### Permission Flags

Fetch the current flags from `/api/permissions` rather than hardcoding values. All flags are integers that map to bit positions in a bitmask:

```js
const PERMS = await fetch('/api/permissions').then(r => r.json());

function hasPermission(myPerms, flag) {
  const p = BigInt(myPerms);
  const f = BigInt(flag);
  if (p & BigInt(PERMS.ADMINISTRATOR)) return true; // admin bypass
  return (p & f) === f;
}

// Example
if (hasPermission(myPermissions, PERMS.MANAGE_CHANNELS)) {
  // show create channel button
}
```

Server owners bypass all permission checks (the API enforces this server-side too, but clients should also reflect it).

---

### ID Format

All entity IDs are 20-character decimal string snowflakes:
- Epoch: `1234147200000` (Unix ms)
- Worker: `1`
- Do not parse or sort IDs numerically as standard integers — use `BigInt` if you need ordering.

IDs are present on: users, servers, channels, categories, messages, roles, DM conversations.

---

### File Uploads

Endpoints that accept files use `multipart/form-data`. The field name is always `file` (or `file` repeated for multiple uploads on message send).

```js
const form = new FormData();
form.append('content', 'Hello!');
form.append('file', fileBlob, 'image.png');

fetch(`/api/messages/channels/${channelId}/messages`, {
  method: 'POST',
  credentials: 'include',
  body: form
});
```

Uploaded files are served from `/uploads/` on the main server. Avatar URLs and attachment URLs in API responses are relative paths — prepend the server origin to resolve them.

---

## License

This repository uses a dual-license model. See [LICENSE](./LICENSE) for the complete terms.

| Component | License |
|---|---|
| Backend, infrastructure, server code | Proprietary Source-Available — view only |
| Client applications, SDKs, protocol | Business Source License 1.1 (BSL 1.1) |

The BSL-licensed client components convert automatically to the **MIT License** on **January 1, 2031**.

Any contributions are licensed under the same terms as the component they are contributed to.

Copyright (c) 2026 Cerberus Game Labs. All rights reserved.
