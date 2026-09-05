import { modPow, modInverse, randomBigInt, bytesToBigInt, bigIntToBytes } from "./bigintUtils.js";
import { sha256 } from "./hash.js";

// secp256k1 parameters
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const A = 0n;
const B = 7n;
const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = { x: Gx, y: Gy };
const INFINITY = { x: null, y: null };

function mod(a, m) {
  return ((a % m) + m) % m;
}

function isInfinity(pt) {
  return pt.x === null && pt.y === null;
}

function pointAdd(p1, p2) {
  if (isInfinity(p1)) return p2;
  if (isInfinity(p2)) return p1;

  if (p1.x === p2.x && mod(p1.y + p2.y, P) === 0n) return INFINITY;

  let m;
  if (p1.x === p2.x && p1.y === p2.y) {
    // point doubling
    m = mod((3n * p1.x * p1.x + A) * modInverse(mod(2n * p1.y, P), P), P);
  } else {
    m = mod((p2.y - p1.y) * modInverse(mod(p2.x - p1.x, P), P), P);
  }

  const x3 = mod(m * m - p1.x - p2.x, P);
  const y3 = mod(m * (p1.x - x3) - p1.y, P);
  return { x: x3, y: y3 };
}

function scalarMult(k, point) {
  let result = INFINITY;
  let addend = point;
  while (k > 0n) {
    if (k & 1n) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    k >>= 1n;
  }
  return result;
}

/** @returns {{ publicKey: {x: bigint, y: bigint}, privateKey: bigint }} */
export function generateKeyPair() {
  let privateKey;
  do {
    privateKey = randomBigInt(256) % N;
  } while (privateKey === 0n);
  const publicKey = scalarMult(privateKey, G);
  return { publicKey, privateKey };
}

/** Expand a shared-secret x-coordinate into a keystream of `len` bytes via hashing in counter mode. */
function deriveKeystream(sharedXBytes, len) {
  const out = new Uint8Array(len);
  let generated = 0;
  let counter = 0;
  while (generated < len) {
    const counterBytes = bigIntToBytes(BigInt(counter), 4);
    const block = sha256(Uint8Array.from([...sharedXBytes, ...counterBytes]));
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
 * @param {{x: bigint, y: bigint}} publicKey - recipient's ECC public key
 * @returns {string} "Rx:Ry:ciphertextHex:macHex"
 */
export function encrypt(plaintext, publicKey) {
  const { privateKey: r, publicKey: R } = generateKeyPair(); // ephemeral keypair
  const S = scalarMult(r, publicKey); // shared point
  const sharedXBytes = bigIntToBytes(S.x, 32);

  const msgBytes = new TextEncoder().encode(plaintext);
  const keystream = deriveKeystream(sharedXBytes, msgBytes.length);
  const cipherBytes = xorBytes(msgBytes, keystream);

  const macKey = sha256(Uint8Array.from([...sharedXBytes, 0x4d, 0x41, 0x43])); // sharedX || "MAC"
  const macTag = sha256(Uint8Array.from([...macKey, ...cipherBytes]));

  return [
    R.x.toString(16),
    R.y.toString(16),
    Buffer.from(cipherBytes).toString("hex"),
    Buffer.from(macTag).toString("hex"),
  ].join(":");
}

/**
 * @param {string} ciphertext - as produced by encrypt()
 * @param {bigint} privateKey - recipient's ECC private key
 * @returns {string} plaintext
 */
export function decrypt(ciphertext, privateKey) {
  const [rxHex, ryHex, cipherHex, macHex] = ciphertext.split(":");
  const R = { x: BigInt("0x" + rxHex), y: BigInt("0x" + ryHex) };
  const cipherBytes = Uint8Array.from(Buffer.from(cipherHex, "hex"));

  const S = scalarMult(privateKey, R);
  const sharedXBytes = bigIntToBytes(S.x, 32);

  const macKey = sha256(Uint8Array.from([...sharedXBytes, 0x4d, 0x41, 0x43]));
  const expectedMac = Buffer.from(sha256(Uint8Array.from([...macKey, ...cipherBytes]))).toString(
    "hex"
  );
  if (expectedMac !== macHex) {
    throw new Error("ECC decrypt: MAC verification failed (wrong key or tampered ciphertext)");
  }

  const keystream = deriveKeystream(sharedXBytes, cipherBytes.length);
  const plainBytes = xorBytes(cipherBytes, keystream);
  return new TextDecoder().decode(plainBytes);
}
