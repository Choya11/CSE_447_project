import * as rsa from "./rsa.js";
import * as ecc from "./ecc.js";
import { encryptAtRest, decryptAtRest } from "./atRestCipher.js";
import User from "../models/User.js";
import ReviewerKeys from "../models/ReviewerKeys.js";

// --- serialization helpers: BigInt <-> plain strings for MongoDB ---

function serializeRSAPublicKey(pub) {
  return { e: pub.e.toString(), n: pub.n.toString() };
}
function deserializeRSAPublicKey(obj) {
  return { e: BigInt(obj.e), n: BigInt(obj.n) };
}
function serializeRSAPrivateKey(priv) {
  return JSON.stringify({ d: priv.d.toString(), n: priv.n.toString() });
}
function deserializeRSAPrivateKey(json) {
  const obj = JSON.parse(json);
  return { d: BigInt(obj.d), n: BigInt(obj.n) };
}

function serializeECCPublicKey(pub) {
  return { x: pub.x.toString(), y: pub.y.toString() };
}
function deserializeECCPublicKey(obj) {
  return { x: BigInt(obj.x), y: BigInt(obj.y) };
}
function serializeECCPrivateKey(priv) {
  return JSON.stringify({ privateKey: priv.toString() });
}
function deserializeECCPrivateKey(json) {
  return BigInt(JSON.parse(json).privateKey);
}

/**
 * Platform-level keypair, used to encrypt user PII (email, contact info) at
 * registration time — every user has this data encrypted even though most
 * users (reporters) never get their own keypair. Reuses the exact same
 * ReviewerKeys storage/rotation path as a real reviewer, just under a fixed
 * sentinel id instead of a real User document — no separate model needed,
 * and it inherits the same "private key never leaves the server" guarantee.
 * Only admin-facing code should ever call decryptPlatformField().
 */
const PLATFORM_KEY_ID = "000000000000000000000001";

async function ensurePlatformKeys() {
  const existing = await getPublicKeys(PLATFORM_KEY_ID);
  if (existing) return existing;
  return provisionKeysForReviewer(PLATFORM_KEY_ID);
}

/** RSA-encrypt a PII field (email, contact info, etc.) for storage. */
export async function encryptPlatformField(plaintext) {
  if (plaintext == null) return null;
  const { rsaPublicKey } = await ensurePlatformKeys();
  return rsa.encrypt(plaintext, rsaPublicKey);
}

/** INTERNAL / ADMIN-ONLY — decrypt a PII field encrypted with encryptPlatformField(). */
export async function decryptPlatformField(ciphertext) {
  if (ciphertext == null) return null;
  const { rsaPrivateKey } = await getPrivateKeysForDecryption(PLATFORM_KEY_ID);
  return rsa.decrypt(ciphertext, rsaPrivateKey);
}

/**
 * Generate and persist a fresh RSA + ECC keypair for a reviewer (version 1).
 * Call this once, right after a user is promoted to the "reviewer" role.
 * @param {string} userId
 * @returns {{ rsaPublicKey: {e:bigint,n:bigint}, eccPublicKey: {x:bigint,y:bigint} }}
 */
export async function provisionKeysForReviewer(userId) {
  const existing = await ReviewerKeys.findOne({ user: userId, retiredAt: null });
  if (existing) {
    throw new Error("provisionKeysForReviewer: active keys already exist — use rotateKeys instead");
  }

  const rsaKeys = rsa.generateKeyPair(1024);
  const eccKeys = ecc.generateKeyPair();

  const doc = await ReviewerKeys.create({
    user: userId,
    version: 1,
    rsaPublicKey: serializeRSAPublicKey(rsaKeys.publicKey),
    rsaPrivateKeyEncrypted: encryptAtRest(serializeRSAPrivateKey(rsaKeys.privateKey)),
    eccPublicKey: serializeECCPublicKey(eccKeys.publicKey),
    eccPrivateKeyEncrypted: encryptAtRest(serializeECCPrivateKey(eccKeys.privateKey)),
  });

  // Cache public keys on the User doc too, for convenient lookups elsewhere
  await User.findByIdAndUpdate(userId, {
    rsaPublicKey: doc.rsaPublicKey,
    eccPublicKey: doc.eccPublicKey,
  });

  return { rsaPublicKey: rsaKeys.publicKey, eccPublicKey: eccKeys.publicKey };
}

/**
 * Rotate a reviewer's keys: retires the current active key and generates a
 * new one. Old (retired) keys are kept so reports encrypted before rotation
 * can still be decrypted by whoever reviews them.
 * @param {string} userId
 * @returns {{ rsaPublicKey: {e:bigint,n:bigint}, eccPublicKey: {x:bigint,y:bigint} }}
 */
export async function rotateKeys(userId) {
  const current = await ReviewerKeys.findOne({ user: userId, retiredAt: null });
  if (!current) {
    throw new Error("rotateKeys: no active keys found — call provisionKeysForReviewer first");
  }

  current.retiredAt = new Date();
  await current.save();

  const rsaKeys = rsa.generateKeyPair(1024);
  const eccKeys = ecc.generateKeyPair();

  const doc = await ReviewerKeys.create({
    user: userId,
    version: current.version + 1,
    rsaPublicKey: serializeRSAPublicKey(rsaKeys.publicKey),
    rsaPrivateKeyEncrypted: encryptAtRest(serializeRSAPrivateKey(rsaKeys.privateKey)),
    eccPublicKey: serializeECCPublicKey(eccKeys.publicKey),
    eccPrivateKeyEncrypted: encryptAtRest(serializeECCPrivateKey(eccKeys.privateKey)),
  });

  await User.findByIdAndUpdate(userId, {
    rsaPublicKey: doc.rsaPublicKey,
    eccPublicKey: doc.eccPublicKey,
  });

  return { rsaPublicKey: rsaKeys.publicKey, eccPublicKey: eccKeys.publicKey };
}

/**
 * Fetch a reviewer's current (active) public keys — safe to expose to
 * anyone who needs to encrypt a report for this reviewer.
 * @param {string} userId
 * @returns {{ rsaPublicKey: {e:bigint,n:bigint}, eccPublicKey: {x:bigint,y:bigint} } | null}
 */
export async function getPublicKeys(userId) {
  const doc = await ReviewerKeys.findOne({ user: userId, retiredAt: null });
  if (!doc) return null;
  return {
    rsaPublicKey: deserializeRSAPublicKey(doc.rsaPublicKey),
    eccPublicKey: deserializeECCPublicKey(doc.eccPublicKey),
  };
}

/**
 * INTERNAL USE ONLY — never expose over an API route. Fetches the reviewer's
 * private keys so the server can decrypt a report the reviewer is opening.
 * Looks up by version so reports encrypted under a retired (rotated-out) key
 * can still be decrypted.
 * @param {string} userId
 * @param {number} [version] - omit to use the current active version
 * @returns {{ rsaPrivateKey: {d:bigint,n:bigint}, eccPrivateKey: bigint } | null}
 */
export async function getPrivateKeysForDecryption(userId, version) {
  const query = version ? { user: userId, version } : { user: userId, retiredAt: null };
  const doc = await ReviewerKeys.findOne(query);
  if (!doc) return null;

  return {
    rsaPrivateKey: deserializeRSAPrivateKey(decryptAtRest(doc.rsaPrivateKeyEncrypted)),
    eccPrivateKey: deserializeECCPrivateKey(decryptAtRest(doc.eccPrivateKeyEncrypted)),
    version: doc.version,
  };
}
