// File Location: /utils/logging.js

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";

// ======= LOGGING CONSTANTS ======= //
const tags = {
    error: chalk.bold.red('[ERROR]'),
    warning: chalk.bold.yellow('[WARNING]'),
    success: chalk.bold.green('[SUCCESS]'),
    info: chalk.bold.blue('[INFO]'),
    services: chalk.bold.cyan('[SERVICES]'),
    system: chalk.bold.ansi256(208)('[SYSTEM]'),
};

// Discord Logging Init
import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

let logsChannel;

client.once('ready', async () => {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    logsChannel = await guild.channels.fetch(process.env.LOGS_CHANNEL_ID);
    console.log(`[LOGS] Discord logging ready in channel: ${logsChannel.name}`);
});

client.login(process.env.TOKEN);

// Create logs directory if it doesn't exist
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGS_DIR = path.resolve(__dirname, "../logs");
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Create log file with timestamp
function createLogFilename() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}.log`;
}

const LOG_FILE_PATH = path.join(LOGS_DIR, createLogFilename());
const logStream = fs.createWriteStream(LOG_FILE_PATH, { flags: 'a' });

// Strip ANSI color codes for plain text logging
function stripAnsiCodes(text) {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, "");
}
let lastDiscordLog = '';
let lastDiscordLogTime = 0;

// Dual-output logging function
function log(...args) {
    console.log(...args);

    const plainText = args
        .map(arg => {
            if (typeof arg === "string") return stripAnsiCodes(arg);
            if (typeof arg === "object") return JSON.stringify(arg, null, 2);
            return String(arg);
        })
        .join(" ");

    logStream.write(plainText + "\n");

    // New: send to Discord
    if (logsChannel) {
        let now = Date.now();
        if (plainText === lastDiscordLog && (now - lastDiscordLogTime) < 60000) return;

        lastDiscordLog = plainText;
        lastDiscordLogTime = now;

        // Make sure message <= 2000 characters
        const MAX_LENGTH = 2000;
        if (plainText.length <= MAX_LENGTH) {
            logsChannel.send(`\`\`\`\n${plainText}\n\`\`\``).catch(console.error);
        } else {
            // Split large messages into chunks
            for (let i = 0; i < plainText.length; i += MAX_LENGTH) {
                const chunk = plainText.slice(i, i + MAX_LENGTH);
                logsChannel.send(`\`\`\`\n${chunk}\n\`\`\``).catch(console.error);
            }
        }
    }
}

// Close stream on exit
process.on("exit", () => logStream.end());

process.on("uncaughtException", (err, origin) => {
    log("[FATAL] Uncaught Exception:", err.stack || err, "\nOrigin:", origin);
    process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
    log("[FATAL] Unhandled Rejection at:", promise, "reason:", reason);
    process.exit(1);
});

process.on("SIGINT", () => {
    log("[SIGNAL] SIGINT received (Ctrl+C). Shutting down.");
    process.exit(130);
});

process.on("SIGTERM", () => {
    log("[SIGNAL] SIGTERM received. Process terminated externally.");
    process.exit(143);
});

export { chalk, log, tags };