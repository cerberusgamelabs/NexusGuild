// File Location: /config/permissions.js

// Permission flags using bitwise operations
const PERMISSIONS = {
    // Channel Permissions
    VIEW_CHANNEL: 1n << 0n,           // 1
    SEND_MESSAGES: 1n << 1n,          // 2
    MANAGE_MESSAGES: 1n << 2n,        // 4
    EMBED_LINKS: 1n << 3n,            // 8
    ATTACH_FILES: 1n << 4n,           // 16
    ADD_REACTIONS: 1n << 5n,          // 32
    MENTION_EVERYONE: 1n << 6n,       // 64

    // Server Permissions
    MANAGE_CHANNELS: 1n << 7n,        // 128
    MANAGE_SERVER: 1n << 8n,          // 256
    MANAGE_ROLES: 1n << 9n,           // 512
    KICK_MEMBERS: 1n << 10n,          // 1024
    BAN_MEMBERS: 1n << 11n,           // 2048
    CREATE_INVITE: 1n << 12n,         // 4096
    CHANGE_NICKNAME: 1n << 13n,       // 8192
    MANAGE_NICKNAMES: 1n << 14n,      // 16384

    // Voice Permissions
    CONNECT: 1n << 15n,               // 32768
    SPEAK: 1n << 16n,                 // 65536
    MUTE_MEMBERS: 1n << 17n,          // 131072
    DEAFEN_MEMBERS: 1n << 18n,        // 262144
    MOVE_MEMBERS: 1n << 19n,          // 524288

    // Special Permission
    ADMINISTRATOR: 1n << 20n          // 1048576
};

// Default permissions for @everyone role
const DEFAULT_PERMISSIONS =
    PERMISSIONS.VIEW_CHANNEL |
    PERMISSIONS.SEND_MESSAGES |
    PERMISSIONS.EMBED_LINKS |
    PERMISSIONS.ATTACH_FILES |
    PERMISSIONS.ADD_REACTIONS |
    PERMISSIONS.CONNECT |
    PERMISSIONS.SPEAK |
    PERMISSIONS.CHANGE_NICKNAME;

// Permission checker utility
class PermissionHandler {
    static hasPermission(userPermissions, permission) {
        userPermissions = BigInt(userPermissions);
        permission = BigInt(permission);

        // Administrator has all permissions
        if ((userPermissions & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR) {
            return true;
        }

        return (userPermissions & permission) === permission;
    }

    static addPermission(currentPermissions, permission) {
        return BigInt(currentPermissions) | BigInt(permission);
    }

    static removePermission(currentPermissions, permission) {
        return BigInt(currentPermissions) & ~BigInt(permission);
    }

    static getPermissionsList(permissions) {
        const permList = [];
        permissions = BigInt(permissions);

        for (const [name, value] of Object.entries(PERMISSIONS)) {
            if ((permissions & value) === value) {
                permList.push(name);
            }
        }

        return permList;
    }

    static calculatePermissions(permissions) {
        let total = 0n;

        for (const perm of permissions) {
            if (PERMISSIONS[perm]) {
                total = total | PERMISSIONS[perm];
            }
        }

        return total;
    }
}

export {
    PERMISSIONS,
    DEFAULT_PERMISSIONS,
    PermissionHandler
};