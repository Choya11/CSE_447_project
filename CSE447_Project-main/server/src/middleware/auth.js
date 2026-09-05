/**
 * Session/auth middleware.
 * Session tokens are signed with our own HMAC (crypto/mac.js), not jsonwebtoken,
 * to keep "encryption/signing" in-house per assignment rules. A token is just
 * `payload.base64 + "." + mac` — verify by recomputing the MAC.
 */
import { computeMAC, verifyMAC } from "../crypto/mac.js";

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Build a signed session token from a payload (e.g. { sub, role, username }).
 * Adds `exp` automatically. Used by authController after login/2FA success.
 * @param {object} payload
 * @param {number} [ttlMs]
 * @returns {string} "payloadBase64.macHex"
 */
export function createSessionToken(payload, ttlMs = SESSION_TTL_MS) {
  const fullPayload = { ...payload, exp: Date.now() + ttlMs };
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString("base64");
  const tag = computeMAC(payloadB64, process.env.SESSION_SECRET);
  return `${payloadB64}.${tag}`;
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.session;
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  const parts = token.split(".");
  if (parts.length !== 2) return res.status(401).json({ error: "Malformed session token" });
  const [payloadB64, tag] = parts;

  if (!verifyMAC(payloadB64, process.env.SESSION_SECRET, tag)) {
    return res.status(401).json({ error: "Invalid session token" });
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64").toString());
  } catch {
    return res.status(401).json({ error: "Malformed session token" });
  }

  if (!payload.exp || payload.exp < Date.now()) {
    return res.status(401).json({ error: "Session expired" });
  }

  req.user = payload; // { sub, role, username, exp }
  next();
}

/**
 * RBAC guard. Usage: router.get('/x', requireAuth, requireRole('admin'), handler)
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient privileges" });
    }
    next();
  };
}
