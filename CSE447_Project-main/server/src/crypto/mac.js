import { sha256 } from "./hash.js";

const BLOCK_SIZE = 64; // SHA-256 block size in bytes

function toBytes(strOrBytes) {
  return typeof strOrBytes === "string" ? new TextEncoder().encode(strOrBytes) : strOrBytes;
}

function xorPad(keyBytes, padByte) {
  const out = new Uint8Array(BLOCK_SIZE);
  for (let i = 0; i < BLOCK_SIZE; i++) out[i] = (keyBytes[i] || 0) ^ padByte;
  return out;
}

function concatBytes(...arrs) {
  const total = arrs.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrs) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

/**
 * @param {string} message
 * @param {string} key
 * @returns {string} hex-encoded MAC tag
 */
export function computeMAC(message, key) {
  let keyBytes = toBytes(key);
  if (keyBytes.length > BLOCK_SIZE) keyBytes = sha256(keyBytes);
  if (keyBytes.length < BLOCK_SIZE) {
    const padded = new Uint8Array(BLOCK_SIZE);
    padded.set(keyBytes);
    keyBytes = padded;
  }

  const ipad = xorPad(keyBytes, 0x36);
  const opad = xorPad(keyBytes, 0x5c);
  const msgBytes = toBytes(message);

  const inner = sha256(concatBytes(ipad, msgBytes));
  const outer = sha256(concatBytes(opad, inner));

  return Buffer.from(outer).toString("hex");
}

/** Timing-safer equality check for verifying a MAC. */
export function verifyMAC(message, key, tag) {
  const computed = computeMAC(message, key);
  if (computed.length !== tag.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ tag.charCodeAt(i);
  return diff === 0;
}

/**
 * @param {string} previousMAC - MAC of the previous log entry (use a fixed genesis string for the first)
 * @param {object} entry { reportId, newStatus, changedBy, timestamp }
 * @param {string} key
 */
export function appendChainedEntry(previousMAC, entry, key) {
  const payload = previousMAC + JSON.stringify(entry);
  return { entry, mac: computeMAC(payload, key) };
}
