/**
 * Registration / login / 2FA verification.
 * Password hashing: from-scratch salted+iterated SHA-256 (crypto/hash.js) —
 * no bcrypt, no Node `crypto` hash functions, consistent with the rest of
 * this project's from-scratch rule.
 */
import { authenticator } from "otplib";
import { hashPassword, verifyPassword } from "../crypto/hash.js";
import { encryptPlatformField } from "../crypto/keyManager.js";
import { createSessionToken } from "../middleware/auth.js";
import { verifyMAC } from "../crypto/mac.js";
import { writeAuditLog } from "../utils/chain.js";
import User from "../models/User.js";

const PENDING_2FA_TTL_MS = 5 * 60 * 1000; // 5 minutes to enter the TOTP code
const MAX_FAILED_2FA = 3;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function setSessionCookie(res, token, ttlMs) {
  res.cookie("session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ttlMs,
  });
}

export async function register(req, res) {
  try {
    const { username, password, email, contactInfo } = req.body;
    if (!username || !password || !email) {
      return res.status(400).json({ error: "username, password, and email are required" });
    }

    const existing = await User.findOne({ username });
    if (existing) return res.status(409).json({ error: "Username already taken" });

    // 1. hash + salt password (from-scratch)
    const { hash, salt } = hashPassword(password);

    // 2. encrypt PII before storing (RSA, via the platform keypair)
    const emailEncrypted = await encryptPlatformField(email);
    const contactInfoEncrypted = await encryptPlatformField(contactInfo ?? null);

    // 3. Self-registration always creates a "reporter" — reviewer/admin
    //    accounts are provisioned separately by an admin (adminController),
    //    which also runs provisionKeysForReviewer for them. This prevents
    //    a client from just POSTing { role: "admin" } to escalate privilege.
    const user = await User.create({
      username,
      passwordHash: hash,
      passwordSalt: salt,
      emailEncrypted,
      contactInfoEncrypted,
      role: "reporter",
    });

    res.status(201).json({
      id: user._id,
      username: user.username,
      role: user.role,
    });
  } catch (err) {
    res.status(500).json({ error: "Registration failed", details: err.message });
  }
}

export async function login(req, res) {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "username and password are required" });
    }

    const user = await User.findOne({ username });
    // Same error for "no such user" and "wrong password" — don't leak which one
    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    if (user.status !== "active") {
      return res.status(401).json({ error: "Account is not active" });
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return res.status(401).json({ error: "Account temporarily locked. Try again later." });
    }

    if (user.is2FAEnabled) {
      // Don't issue a full session yet — issue a short-lived, MAC-signed
      // "pending" token that only proves password step passed, and only
      // identifies which user must now supply a TOTP code.
      const pendingToken = createSessionToken(
        { sub: user._id.toString(), stage: "pending2fa" },
        PENDING_2FA_TTL_MS
      );
      return res.json({ requires2FA: true, pendingToken });
    }

    const sessionToken = createSessionToken({
      sub: user._id.toString(),
      username: user.username,
      role: user.role,
    });
    setSessionCookie(res, sessionToken);
    res.json({ id: user._id, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ error: "Login failed", details: err.message });
  }
}

export async function verify2FA(req, res) {
  try {
    const { pendingToken, code } = req.body;
    if (!pendingToken || !code) {
      return res.status(400).json({ error: "pendingToken and code are required" });
    }

    const [payloadB64, tag] = pendingToken.split(".");
    if (!payloadB64 || !tag || !verifyMAC(payloadB64, process.env.SESSION_SECRET, tag)) {
      return res.status(401).json({ error: "Invalid or expired pending token" });
    }
    const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString());
    if (payload.stage !== "pending2fa" || payload.exp < Date.now()) {
      return res.status(401).json({ error: "Invalid or expired pending token" });
    }

    const user = await User.findById(payload.sub);
    if (!user || !user.is2FAEnabled || !user.totpSecret) {
      return res.status(401).json({ error: "2FA not set up for this account" });
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return res.status(401).json({ error: "Account temporarily locked. Try again later." });
    }

    const valid = authenticator.verify({ token: code, secret: user.totpSecret });
    if (!valid) {
      user.failed2FACount += 1;
      if (user.failed2FACount >= MAX_FAILED_2FA) {
        user.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
        user.failed2FACount = 0;
        await user.save();
        await writeAuditLog({ action: "ACCOUNT_LOCKED", targetId: user._id, details: { reason: "3 failed 2FA attempts" } });
        return res.status(401).json({ error: "Too many failed attempts — account temporarily locked." });
      }
      await user.save();
      return res.status(401).json({ error: "Invalid 2FA code" });
    }

    user.failed2FACount = 0;
    user.lockedUntil = null;
    await user.save();

    const sessionToken = createSessionToken({
      sub: user._id.toString(),
      username: user.username,
      role: user.role,
    });
    setSessionCookie(res, sessionToken);
    res.json({ id: user._id, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ error: "2FA verification failed", details: err.message });
  }
}

/**
 * Enable 2FA for the currently logged-in user (reviewers/admins should call
 * this right after their account is provisioned). Returns an otpauth:// URL
 * the client turns into a QR code; 2FA isn't enforced until the user proves
 * they scanned it correctly via /confirm-2fa (not built yet — TODO).
 */
export async function setup2FA(req, res) {
  try {
    const secret = authenticator.generateSecret();
    const user = await User.findByIdAndUpdate(
      req.user.sub,
      { totpSecret: secret, is2FAEnabled: true },
      { new: true }
    );
    const otpauthUrl = authenticator.keyuri(user.username, "WhistleblowerTool", secret);
    res.json({ otpauthUrl });
  } catch (err) {
    res.status(500).json({ error: "2FA setup failed", details: err.message });
  }
}

export async function logout(req, res) {
  res.clearCookie("session");
  res.json({ ok: true });
}

/** Hydrate client-side auth state on page load/refresh from the session cookie. */
export async function me(req, res) {
  res.json({ id: req.user.sub, username: req.user.username, role: req.user.role });
}
