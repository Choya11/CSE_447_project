/**
 * Admin-only: manage reviewers/custodians, assign reports, view audit logs.
 * Admin must NOT be able to decrypt report content — no response handler in
 * this file ever selects or returns titleEncrypted/descriptionEncrypted/
 * categoryEncrypted/evidenceEncrypted/reporterIdentityEncrypted, and the
 * report-assignment flow that necessarily touches plaintext in memory
 * (to re-encrypt under the new reviewer's key) never puts it on the response.
 */
import { authenticator } from "otplib";
import User from "../models/User.js";
import Report from "../models/Report.js";
import ReviewerKeys from "../models/ReviewerKeys.js";
import * as rsa from "../crypto/rsa.js";
import { hashPassword } from "../crypto/hash.js";
import {
  encryptPlatformField,
  decryptPlatformField,
  provisionKeysForReviewer,
  rotateKeys,
  getPublicKeys,
  getPrivateKeysForDecryption,
} from "../crypto/keyManager.js";
import { nextChainedEntry, writeAuditLog, verifyAuditChain } from "../utils/chain.js";
import AuditLog from "../models/AuditLog.js";

async function createStaffAccount(req, res, role) {
  try {
    const { username, password, email, contactInfo } = req.body;
    if (!username || !password || !email) {
      return res.status(400).json({ error: "username, password, and email are required" });
    }
    const existing = await User.findOne({ username });
    if (existing) return res.status(409).json({ error: "Username already taken" });

    const { hash, salt } = hashPassword(password);
    const [emailEncrypted, contactInfoEncrypted] = await Promise.all([
      encryptPlatformField(email),
      encryptPlatformField(contactInfo ?? null),
    ]);
    const totpSecret = authenticator.generateSecret();

    const user = await User.create({
      username,
      passwordHash: hash,
      passwordSalt: salt,
      emailEncrypted,
      contactInfoEncrypted,
      role,
      totpSecret,
      is2FAEnabled: true,
      status: "active",
    });

    if (role === "reviewer") {
      await provisionKeysForReviewer(user._id.toString());
    }

    await writeAuditLog({
      action: role === "reviewer" ? "REVIEWER_CREATED" : "CUSTODIAN_CREATED",
      performedBy: req.user.sub,
      targetId: user._id,
    });

    const otpauthUrl = authenticator.keyuri(username, "WhistleblowerTool", totpSecret);
    // otpauthUrl/totpSecret are shown exactly once here — relay to the new
    // staff member out of band. Never logged, never retrievable again.
    res.status(201).json({ id: user._id, username: user.username, role: user.role, otpauthUrl, totpSecret });
  } catch (err) {
    res.status(500).json({ error: `Failed to create ${role}` });
  }
}

export async function createReviewer(req, res) {
  return createStaffAccount(req, res, "reviewer");
}

export async function createCustodian(req, res) {
  return createStaffAccount(req, res, "custodian");
}

export async function listStaff(req, res) {
  try {
    const { role } = req.query;
    const filter = role ? { role } : { role: { $in: ["reviewer", "custodian"] } };
    const users = await User.find(filter).select("username role status createdAt");

    const withKeyInfo = await Promise.all(
      users.map(async (u) => {
        if (u.role !== "reviewer") return { id: u._id, username: u.username, role: u.role, status: u.status, createdAt: u.createdAt };
        const activeKey = await ReviewerKeys.findOne({ user: u._id, retiredAt: null }).select("version createdAt");
        return {
          id: u._id,
          username: u.username,
          role: u.role,
          status: u.status,
          createdAt: u.createdAt,
          keyVersion: activeKey?.version ?? null,
          keyActiveSince: activeKey?.createdAt ?? null,
        };
      })
    );

    res.json({ users: withKeyInfo });
  } catch (err) {
    res.status(500).json({ error: "Failed to list staff accounts" });
  }
}

export async function deactivateUser(req, res) {
  try {
    const { id } = req.params;
    const user = await User.findByIdAndUpdate(id, { status: "inactive" }, { new: true });
    if (!user) return res.status(404).json({ error: "User not found" });

    await writeAuditLog({ action: "USER_DEACTIVATED", performedBy: req.user.sub, targetId: id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to deactivate user" });
  }
}

export async function rotateReviewerKeys(req, res) {
  try {
    const { id } = req.params;
    const oldKeys = await ReviewerKeys.findOne({ user: id, retiredAt: null });
    if (!oldKeys) return res.status(404).json({ error: "No active keys found for this reviewer" });
    const oldVersion = oldKeys.version;

    await rotateKeys(id);
    const newKeys = await ReviewerKeys.findOne({ user: id, retiredAt: null });
    const newPublicKey = { e: BigInt(newKeys.rsaPublicKey.e), n: BigInt(newKeys.rsaPublicKey.n) };

    const assignedReports = await Report.find({ assignedReviewer: id, assignedReviewerKeyVersion: oldVersion });
    const oldPriv = await getPrivateKeysForDecryption(id, oldVersion);

    for (const report of assignedReports) {
      const title = rsa.decrypt(report.titleEncrypted, oldPriv.rsaPrivateKey);
      const description = rsa.decrypt(report.descriptionEncrypted, oldPriv.rsaPrivateKey);
      const category = rsa.decrypt(report.categoryEncrypted, oldPriv.rsaPrivateKey);
      const evidence = report.evidenceEncrypted ? rsa.decrypt(report.evidenceEncrypted, oldPriv.rsaPrivateKey) : null;

      report.titleEncrypted = rsa.encrypt(title, newPublicKey);
      report.descriptionEncrypted = rsa.encrypt(description, newPublicKey);
      report.categoryEncrypted = rsa.encrypt(category, newPublicKey);
      report.evidenceEncrypted = evidence ? rsa.encrypt(evidence, newPublicKey) : null;
      report.assignedReviewerKeyVersion = newKeys.version;
      await report.save();
    }

    await writeAuditLog({
      action: "REVIEWER_KEYS_ROTATED",
      performedBy: req.user.sub,
      targetId: id,
      details: { newVersion: newKeys.version, reportsReencrypted: assignedReports.length },
    });

    res.json({ newVersion: newKeys.version, reportsReencrypted: assignedReports.length });
  } catch (err) {
    res.status(500).json({ error: "Key rotation failed" });
  }
}

export async function listReports(req, res) {
  try {
    const reports = await Report.find()
      .select("status assignedReviewer createdAt")
      .populate("assignedReviewer", "username")
      .sort({ createdAt: -1 })
      .limit(500);

    res.json({
      reports: reports.map((r) => ({
        id: r._id,
        status: r.status,
        assignedReviewer: r.assignedReviewer ? { id: r.assignedReviewer._id, username: r.assignedReviewer.username } : null,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to list reports" });
  }
}

export async function assignReport(req, res) {
  try {
    const { id } = req.params;
    const { reviewerId } = req.body;
    if (!reviewerId) return res.status(400).json({ error: "reviewerId is required" });

    const reviewer = await User.findOne({ _id: reviewerId, role: "reviewer", status: "active" });
    if (!reviewer) return res.status(404).json({ error: "Active reviewer not found" });

    const report = await Report.findById(id);
    if (!report) return res.status(404).json({ error: "Report not found" });
    if (report.assignedReviewer && report.assignedReviewer.toString() === reviewerId) {
      return res.json({ ok: true, assignedReviewer: reviewerId }); // idempotent
    }

    let title, description, category, evidence;
    if (!report.assignedReviewer) {
      [title, description, category, evidence] = await Promise.all([
        decryptPlatformField(report.titleEncrypted),
        decryptPlatformField(report.descriptionEncrypted),
        decryptPlatformField(report.categoryEncrypted),
        report.evidenceEncrypted ? decryptPlatformField(report.evidenceEncrypted) : Promise.resolve(null),
      ]);
    } else {
      const oldPriv = await getPrivateKeysForDecryption(
        report.assignedReviewer.toString(),
        report.assignedReviewerKeyVersion
      );
      title = rsa.decrypt(report.titleEncrypted, oldPriv.rsaPrivateKey);
      description = rsa.decrypt(report.descriptionEncrypted, oldPriv.rsaPrivateKey);
      category = rsa.decrypt(report.categoryEncrypted, oldPriv.rsaPrivateKey);
      evidence = report.evidenceEncrypted ? rsa.decrypt(report.evidenceEncrypted, oldPriv.rsaPrivateKey) : null;
    }

    const { rsaPublicKey } = await getPublicKeys(reviewerId);
    const newKeyDoc = await ReviewerKeys.findOne({ user: reviewerId, retiredAt: null }).select("version");

    report.titleEncrypted = rsa.encrypt(title, rsaPublicKey);
    report.descriptionEncrypted = rsa.encrypt(description, rsaPublicKey);
    report.categoryEncrypted = rsa.encrypt(category, rsaPublicKey);
    report.evidenceEncrypted = evidence ? rsa.encrypt(evidence, rsaPublicKey) : null;
    report.assignedReviewer = reviewerId;
    report.assignedReviewerKeyVersion = newKeyDoc.version;

    const entry = nextChainedEntry(report.statusLog, {
      type: "assigned",
      status: null,
      changedBy: req.user.sub,
      timestamp: new Date(),
    });
    report.statusLog.push(entry);
    await report.save();

    await writeAuditLog({
      action: "REPORT_ASSIGNED",
      performedBy: req.user.sub,
      targetId: id,
      details: { reviewerId },
    });

    res.json({ ok: true, assignedReviewer: reviewerId });
  } catch (err) {
    res.status(500).json({ error: "Failed to assign report" });
  }
}

export async function getAuditLogs(req, res) {
  try {
    const { action, actor, from, to } = req.query;
    const filter = {};
    if (action) filter.action = action;
    if (actor) filter.performedBy = actor;
    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = new Date(from);
      if (to) filter.timestamp.$lte = new Date(to);
    }

    const [logs, chainVerified] = await Promise.all([
      AuditLog.find(filter).sort({ timestamp: -1 }).limit(500),
      verifyAuditChain(),
    ]);

    res.json({ logs, chainVerified });
  } catch (err) {
    res.status(500).json({ error: "Failed to load audit logs" });
  }
}

export async function getDashboardSummary(req, res) {
  try {
    const [reviewerCount, custodianCount, openReports, totalReports, recentLogs] = await Promise.all([
      User.countDocuments({ role: "reviewer", status: "active" }),
      User.countDocuments({ role: "custodian", status: "active" }),
      Report.countDocuments({ status: { $ne: "Resolved" } }),
      Report.countDocuments(),
      AuditLog.find().sort({ timestamp: -1 }).limit(10),
    ]);

    res.json({ reviewerCount, custodianCount, openReports, totalReports, recentLogs });
  } catch (err) {
    res.status(500).json({ error: "Failed to load dashboard summary" });
  }
}
