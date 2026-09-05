import { sha256 } from "./hash.js";
import { computeMAC, verifyMAC } from "./mac.js";
import crypto from "crypto"; // only for a random per-record nonce, not for encryption itself

function getMasterKeyBytes() {
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "KEY_ENCRYPTION_SECRET is not set in .env — required to encrypt private keys at rest"
    );
  }
  return new TextEncoder().encode(secret);
}

function deriveKeystream(seedBytes, len) {
  const out = new Uint8Array(len);
  let generated = 0;
  let counter = 0;
  while (generated < len) {
    const counterBytes = new Uint8Array(4);
    new DataView(counterBytes.buffer).setUint32(0, counter);
    const block = sha256(Uint8Array.from([...seedBytes, ...counterBytes]));
    const take = Math.min(32, len - generated);
    out.set(block.slice(0, take), generated);
    generated += take;
    counter++;
  }
  return out;
}

function xorBytes(a, b) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

/**
 * @param {string} plaintext
 * @returns {string} "nonceHex:cipherHex:macHex"
 */
export function encryptAtRest(plaintext) {
  const masterKey = getMasterKeyBytes();
  const nonce = crypto.randomBytes(16);
  const seed = sha256(Uint8Array.from([...masterKey, ...nonce]));

  const plainBytes = new TextEncoder().encode(plaintext);
  const keystream = deriveKeystream(seed, plainBytes.length);
  const cipherBytes = xorBytes(plainBytes, keystream);
  const cipherHex = Buffer.from(cipherBytes).toString("hex");

  const mac = computeMAC(nonce.toString("hex") + cipherHex, process.env.KEY_ENCRYPTION_SECRET);

  return [nonce.toString("hex"), cipherHex, mac].join(":");
}

/**
 * @param {string} ciphertext - produced by encryptAtRest()
 * @returns {string} plaintext
 */
export function decryptAtRest(ciphertext) {
  const masterKey = getMasterKeyBytes();
  const [nonceHex, cipherHex, macHex] = ciphertext.split(":");

  if (!verifyMAC(nonceHex + cipherHex, process.env.KEY_ENCRYPTION_SECRET, macHex)) {
    throw new Error("decryptAtRest: MAC verification failed — data corrupted or tampered");
  }

  const nonce = Uint8Array.from(Buffer.from(nonceHex, "hex"));
  const cipherBytes = Uint8Array.from(Buffer.from(cipherHex, "hex"));
  const seed = sha256(Uint8Array.from([...masterKey, ...nonce]));
  const keystream = deriveKeystream(seed, cipherBytes.length);
  const plainBytes = xorBytes(cipherBytes, keystream);

  return new TextDecoder().decode(plainBytes);
}
