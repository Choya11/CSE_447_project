import { appendChainedEntry, verifyMAC } from "../crypto/mac.js";
import AuditLog from "../models/AuditLog.js";

const GENESIS = "GENESIS";

function chainKey() {
  return process.env.CHAIN_SECRET || process.env.KEY_ENCRYPTION_SECRET;
}

// Explicit, fixed field order for statusLog payload serialization — must
// stay identical between nextChainedEntry (write) and verifyChain (read),
// independent of however Mongoose orders keys on a retrieved subdocument.
const STATUS_LOG_FIELDS = ["type", "status", "changedBy", "timestamp"];

function canonicalPayload(entry, fields) {
  const out = {};
  for (const f of fields) {
    let v = entry[f];
    if (v && typeof v === "object" && typeof v.toJSON === "function") v = v.toJSON();
    if (v instanceof Date) v = v.toISOString();
    out[f] = v === undefined ? null : v;
  }
  return out;
}

/**
 * Build the next entry for an embedded, append-only array (e.g.
 * Report.statusLog) chained off the previous entry's mac.
 * @param {Array<{mac:string}>} existingEntries
 * @param {object} entryData - { type, status, changedBy, timestamp }
 * @returns {object} entryData + { mac }
 */
export function nextChainedEntry(existingEntries, entryData) {
  const prevMac = existingEntries.length
    ? existingEntries[existingEntries.length - 1].mac
    : GENESIS;
  const payload = canonicalPayload(entryData, STATUS_LOG_FIELDS);
  const { mac } = appendChainedEntry(prevMac, payload, chainKey());
  return { ...entryData, mac };
}

/**
 * Verify an embedded chain end-to-end. Returns false the moment any link's
 * mac doesn't match what it should be given the previous link + payload.
 */
export function verifyChain(entries) {
  let prevMac = GENESIS;
  for (const raw of entries) {
    const entry = raw.toObject ? raw.toObject() : raw;
    const payload = canonicalPayload(entry, STATUS_LOG_FIELDS);
    const { mac: expected } = appendChainedEntry(prevMac, payload, chainKey());
    if (entry.mac !== expected) return false;
    prevMac = entry.mac;
  }
  return true;
}

const AUDIT_FIELDS = ["action", "performedBy", "targetId", "details", "timestamp"];

/**
 * Append one entry to the global AuditLog collection, chained off the most
 * recently written entry (across the whole collection, not per-actor).
 * Content-free by construction — `details` must never carry report content.
 */
export async function writeAuditLog({ action, performedBy = null, targetId = null, details = {} }) {
  const last = await AuditLog.findOne().sort({ timestamp: -1 });
  const prevMac = last ? last.mac : GENESIS;
  const timestamp = new Date();
  const payload = canonicalPayload({ action, performedBy, targetId, details, timestamp }, AUDIT_FIELDS);
  const { mac } = appendChainedEntry(prevMac, payload, chainKey());

  return AuditLog.create({ action, performedBy, targetId, details, timestamp, mac });
}

/** Verify the AuditLog collection's full chain, oldest to newest. */
export async function verifyAuditChain() {
  const entries = await AuditLog.find().sort({ timestamp: 1 });
  let prevMac = GENESIS;
  for (const entry of entries) {
    const payload = canonicalPayload(entry.toObject ? entry.toObject() : entry, AUDIT_FIELDS);
    const { mac: expected } = appendChainedEntry(prevMac, payload, chainKey());
    if (expected !== entry.mac) return false;
    prevMac = entry.mac;
  }
  return true;
}

export { verifyMAC };
