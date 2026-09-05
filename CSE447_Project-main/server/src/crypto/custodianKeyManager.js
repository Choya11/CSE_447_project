import * as ecc from "./ecc.js";
import { encryptAtRest, decryptAtRest } from "./atRestCipher.js";
import CustodianKeys from "../models/CustodianKeys.js";

/**
 * Structurally isolated from keyManager.js (reviewer/platform keys) per the
 * TDD's "identity-custodian key held outside the reviewer key pool" decision
 * — no reviewer- or admin-scoped code path imports this module, and this
 * module never imports ReviewerKeys. Only custodianController (reachable
 * only via the reveal-approval flow, after a k-of-n threshold is met) may
 * call decryptIdentityField.
 */
const ACTIVE_KEY_ID = "custodian-group-key";

function serializePublicKey(pub) {
  return { x: pub.x.toString(), y: pub.y.toString() };
}
function deserializePublicKey(obj) {
  return { x: BigInt(obj.x), y: BigInt(obj.y) };
}
function serializePrivateKey(priv) {
  return JSON.stringify({ privateKey: priv.toString() });
}
function deserializePrivateKey(json) {
  return BigInt(JSON.parse(json).privateKey);
}

async function ensureCustodianKeys() {
  const existing = await CustodianKeys.findOne({ keyId: ACTIVE_KEY_ID, retiredAt: null });
  if (existing) return existing;

  const eccKeys = ecc.generateKeyPair();
  return CustodianKeys.create({
    keyId: ACTIVE_KEY_ID,
    version: 1,
    eccPublicKey: serializePublicKey(eccKeys.publicKey),
    eccPrivateKeyEncrypted: encryptAtRest(serializePrivateKey(eccKeys.privateKey)),
  });
}

/** Encrypt a reporter identity string under the system custodian key. */
export async function encryptIdentityField(plaintext) {
  if (plaintext == null) return null;
  const doc = await ensureCustodianKeys();
  return ecc.encrypt(plaintext, deserializePublicKey(doc.eccPublicKey));
}

/**
 * INTERNAL — only called by custodianController once a RevealRequest has
 * met its k-of-n approval threshold. Never exposed directly by any route.
 */
export async function decryptIdentityField(ciphertext) {
  if (ciphertext == null) return null;
  const doc = await CustodianKeys.findOne({ keyId: ACTIVE_KEY_ID, retiredAt: null });
  if (!doc) throw new Error("decryptIdentityField: no active custodian key");
  const privateKey = deserializePrivateKey(decryptAtRest(doc.eccPrivateKeyEncrypted));
  return ecc.decrypt(ciphertext, privateKey);
}
