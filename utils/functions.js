// File Location: /utils/functions.js

import fs from 'fs';
const stateFile = './snowflake_state.json';

let state = { lastTimestamp: 0n, sequence: 0n };

// Load state if exists
if (fs.existsSync(stateFile)) {
    const raw = fs.readFileSync(stateFile, 'utf-8');
    const parsed = JSON.parse(raw);
    state.lastTimestamp = BigInt(parsed.lastTimestamp);
    state.sequence = BigInt(parsed.sequence);
}

const WORKER_ID = 1n;
const EPOCH = 1234147200000n;

function saveState() {
    fs.writeFileSync(stateFile, JSON.stringify({
        lastTimestamp: state.lastTimestamp.toString(),
        sequence: state.sequence.toString()
    }));
}

export function generateSnowflake() {
    const timestamp = BigInt(Date.now()) - EPOCH;

    if (timestamp === state.lastTimestamp) {
        state.sequence = (state.sequence + 1n) & 0xfffn;
        if (state.sequence === 0n) {
            // Wait for next millisecond
            while (BigInt(Date.now()) - EPOCH <= timestamp) { }
        }
    } else {
        state.sequence = 0n;
    }

    state.lastTimestamp = timestamp;
    saveState();

    return ((timestamp << 22n) | (WORKER_ID << 12n) | state.sequence).toString();
}
