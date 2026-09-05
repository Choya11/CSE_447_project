import crypto from "crypto";
import {
  modPow,
  modInverse,
  gcd,
  generatePrime,
  byteLength,
  bigIntToBytes,
  bytesToBigInt,
} from "./bigintUtils.js";

const PUBLIC_EXPONENT = 65537n;

/**
 * @param {number} bits - total modulus size in bits (e.g. 1024, 2048).
 */
export function generateKeyPair(bits = 1024) {
  const half = Math.floor(bits / 2);
  let p, q, n, phi;

  while (true) {
    p = generatePrime(half);
    q = generatePrime(bits - half);
    if (p === q) continue;
    n = p * q;
    phi = (p - 1n) * (q - 1n);
    if (gcd(PUBLIC_EXPONENT, phi) === 1n) break;
  }

  const d = modInverse(PUBLIC_EXPONENT, phi);

  return {
    publicKey: { e: PUBLIC_EXPONENT, n },
    privateKey: { d, n },
  };
}

function randomNonZeroBytes(len) {
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) if (bytes[i] === 0) bytes[i] = 1;
  return bytes;
}

/**
 * @param {string} plaintext
 * @param {{e: bigint, n: bigint}} publicKey
 * @returns {string} colon-separated hex ciphertext blocks
 */
export function encrypt(plaintext, publicKey) {
  const { e, n } = publicKey;
  const k = byteLength(n); // total bytes per RSA block
  const maxDataBytes = k - 11; // 0x00 0x02 <>=8 pad bytes> 0x00 <data>
  if (maxDataBytes <= 0) throw new Error("RSA key too small for this padding scheme");

  const msgBytes = new TextEncoder().encode(plaintext);
  const chunks = [];
  for (let offset = 0; offset < msgBytes.length; offset += maxDataBytes) {
    chunks.push(msgBytes.slice(offset, offset + maxDataBytes));
  }
  if (chunks.length === 0) chunks.push(new Uint8Array(0)); // allow empty string

  const cipherBlocks = chunks.map((chunk) => {
    const padLen = k - 3 - chunk.length;
    const eb = new Uint8Array(k);
    eb[0] = 0x00;
    eb[1] = 0x02;
    eb.set(randomNonZeroBytes(padLen), 2);
    eb[2 + padLen] = 0x00;
    eb.set(chunk, 3 + padLen);

    const m = bytesToBigInt(eb);
    const c = modPow(m, e, n);
    return c.toString(16).padStart(k * 2, "0");
  });

  return cipherBlocks.join(":");
}

/**
 * @param {string} ciphertext
 * @param {{d: bigint, n: bigint}} privateKey
 * @returns {string} plaintext
 */
export function decrypt(ciphertext, privateKey) {
  const { d, n } = privateKey;
  const k = byteLength(n);

  const blocks = ciphertext.split(":");
  const plainChunks = [];

  for (const hex of blocks) {
    const c = BigInt("0x" + hex);
    const m = modPow(c, d, n);
    const eb = bigIntToBytes(m, k);

    if (eb[0] !== 0x00 || eb[1] !== 0x02) {
      throw new Error("RSA decrypt: invalid padding (data corrupted, wrong key, or tampered)");
    }
    let sepIndex = 2;
    while (sepIndex < eb.length && eb[sepIndex] !== 0x00) sepIndex++;
    if (sepIndex === eb.length) throw new Error("RSA decrypt: padding separator not found");

    plainChunks.push(eb.slice(sepIndex + 1));
  }

  const totalLen = plainChunks.reduce((sum, c) => sum + c.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of plainChunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(combined);
}
