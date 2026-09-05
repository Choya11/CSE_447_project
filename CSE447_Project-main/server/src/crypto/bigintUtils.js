import crypto from "crypto";

/** Random BigInt with an exact bit length (top bit forced to 1). */
export function randomBigInt(bits) {
  const byteLen = Math.ceil(bits / 8);
  const bytes = crypto.randomBytes(byteLen);
  const extraBits = byteLen * 8 - bits;
  bytes[0] |= 0x80 >> extraBits;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

/** Fast modular exponentiation: base^exp mod m. */
export function modPow(base, exp, mod) {
  if (mod === 1n) return 0n;
  let result = 1n;
  base = ((base % mod) + mod) % mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

/** Greatest common divisor. */
export function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Extended Euclidean algorithm: returns [gcd, x, y] such that a*x + b*y = gcd. */
function extendedGCD(a, b) {
  if (b === 0n) return [a, 1n, 0n];
  const [g, x1, y1] = extendedGCD(b, a % b);
  return [g, y1, x1 - (a / b) * y1];
}

/** Modular inverse of a mod m (requires gcd(a, m) === 1). */
export function modInverse(a, m) {
  const [g, x] = extendedGCD(((a % m) + m) % m, m);
  if (g !== 1n) throw new Error("modInverse: no inverse exists (gcd != 1)");
  return ((x % m) + m) % m;
}

/** Miller-Rabin probabilistic primality test. */
export function isProbablePrime(n, rounds = 20) {
  if (n < 2n) return false;
  const smallPrimes = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
  for (const p of smallPrimes) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }

  let d = n - 1n;
  let r = 0n;
  while (d % 2n === 0n) {
    d /= 2n;
    r += 1n;
  }

  witnessLoop: for (let i = 0; i < rounds; i++) {
    // random witness in [2, n-2]
    const a = 2n + (randomBigInt(64) % (n - 4n));
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    for (let j = 0n; j < r - 1n; j++) {
      x = (x * x) % n;
      if (x === n - 1n) continue witnessLoop;
    }
    return false;
  }
  return true;
}

/** Generate a random probable prime with the given exact bit length. */
export function generatePrime(bits) {
  while (true) {
    let candidate = randomBigInt(bits);
    candidate |= 1n; // ensure odd
    if (isProbablePrime(candidate)) return candidate;
  }
}

export function bitLength(n) {
  return n.toString(2).length;
}

export function byteLength(n) {
  return Math.ceil(bitLength(n) / 8);
}

/** Convert a BigInt to a fixed-length big-endian byte array. */
export function bigIntToBytes(num, length) {
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(num & 0xffn);
    num >>= 8n;
  }
  return bytes;
}

/** Convert a big-endian byte array/Buffer to a BigInt. */
export function bytesToBigInt(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

export function bytesToHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

export function hexToBytes(hex) {
  return new Uint8Array(Buffer.from(hex, "hex"));
}
