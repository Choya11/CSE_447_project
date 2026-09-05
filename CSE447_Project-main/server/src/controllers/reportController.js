/**
 * Report submission, status lookup by tracking ID, reviewer read/update,
 * and identity-reveal request creation/delivery.
 */
import Report from "../models/Report.js";
import RevealRequest from "../models/RevealRequest.js";
import User from "../models/User.js";
import * as rsa from "../crypto/rsa.js";
import { computeMAC } from "../crypto/mac.js";
import { encryptPlatformField, getPrivateKeysForDecryption } from "../crypto/keyManager.js";
import { encryptIdentityField, decryptIdentityField } from "../crypto/custodianKeyManager.js";
import { generateTrackingId } from "../utils/trackingId.js";
import { nextChainedEntry, verifyChain, writeAuditLog } from "../utils/chain.js";

const STATUS_ORDER = { Open: 0, Investigating: 1, Resolved: 2 };

function contentMacKey() {
  return process.env.KEY_ENCRYPTION_SECRET;
}

/** MAC over the plaintext content fields — recomputed on every read to detect tampering. */
function computeContentMac({ title, description, category, evidence }) {
  const payload = JSON.stringify({
    title,
    description,
    category,
    evidence: evidence ?? null,
  });
  return computeMAC(payload, contentMacKey());
}

export async function submitReport(req, res) {
  try {
    const { title, description, category, evidence, identity } = req.body;
    if (!title || !description || !category) {
      return res.status(400).json({ error: "title, description, and category are required" });
    }

    const mac = computeContentMac({ title, description, category, evidence });

    // Not yet assigned to a specific reviewer — encrypted under the platform
    // key for now; re-encrypted under the assigned reviewer's own RSA key
    // once an admin assigns it (see adminController.assignReport).
    const [titleEncrypted, descriptionEncrypted, categoryEncrypted, evidenceEncrypted, reporterIdentityEncrypted] =
      await Promise.all([
        encryptPlatformField(title),
        encryptPlatformField(description),
        encryptPlatformField(category),
        evidence ? encryptPlatformField(evidence) : Promise.resolve(null),
        identity ? encryptIdentityField(identity) : Promise.resolve(null),
      ]);

    const trackingId = generateTrackingId();
    const firstEntry = nextChainedEntry([], {
      type: "status_change",
      status: "Open",
      changedBy: null,
      timestamp: new Date(),
    });

    await Report.create({
      trackingId,
      titleEncrypted,
      descriptionEncrypted,
      categoryEncrypted,
      evidenceEncrypted,
      reporterIdentityEncrypted,
      mac,
      status: "Open",
      assignedReviewer: null,
      assignedReviewerKeyVersion: null,
      statusLog: [firstEntry],
    });

    res.status(201).json({ trackingId });
  } catch (err) {
    res.status(500).json({ error: "Submission failed" });
  }
}

export async function getReportByTrackingId(req, res) {
  try {
    const { trackingId } = req.params;
    // Same query shape and response for a malformed, made-up, or valid-but-
    // wrong ID — no branch on input shape before hitting the DB.
    const report = await Report.findOne({ trackingId }).select("status");
    if (!report) return res.status(404).json({ error: "Report not found" });
    res.json({ status: report.status });
  } catch (err) {
    res.status(404).json({ error: "Report not found" });
  }
}

export async function getAssignedReports(req, res) {
  try {
    const reports = await Report.find({ assignedReviewer: req.user.sub }).select(
      "titleEncrypted categoryEncrypted status assignedReviewerKeyVersion createdAt"
    );

    const keys = await getPrivateKeysForDecryption(req.user.sub);
    const list = reports.map((r) => {
      let title = "(decryption unavailable)";
      let category = "(decryption unavailable)";
      try {
        const priv =
          r.assignedReviewerKeyVersion && keys.version !== r.assignedReviewerKeyVersion
            ? null
            : keys?.rsaPrivateKey;
        if (priv) {
          title = rsa.decrypt(r.titleEncrypted, priv);
          category = rsa.decrypt(r.categoryEncrypted, priv);
        }
      } catch {
        title = "(decryption failed)";
        category = "(decryption failed)";
      }
      return { id: r._id, title, category, status: r.status, createdAt: r.createdAt };
    });

    res.json({ reports: list });
  } catch (err) {
    res.status(500).json({ error: "Failed to load assigned reports" });
  }
}

export async function getReportById(req, res) {
  try {
    const { id } = req.params;
    const stub = await Report.findById(id).select("assignedReviewer");
    if (!stub) return res.status(404).json({ error: "Report not found" });

    if (!stub.assignedReviewer || stub.assignedReviewer.toString() !== req.user.sub) {
      await writeAuditLog({
        action: "UNAUTHORIZED_REPORT_ACCESS_ATTEMPT",
        performedBy: req.user.sub,
        targetId: id,
      });
      return res.status(403).json({ error: "Not authorized to view this report" });
    }

    const report = await Report.findById(id);
    const keys = await getPrivateKeysForDecryption(req.user.sub, report.assignedReviewerKeyVersion || undefined);
    if (!keys) return res.status(500).json({ error: "Decryption key unavailable" });

    let title, description, category, evidence;
    try {
      title = rsa.decrypt(report.titleEncrypted, keys.rsaPrivateKey);
      description = rsa.decrypt(report.descriptionEncrypted, keys.rsaPrivateKey);
      category = rsa.decrypt(report.categoryEncrypted, keys.rsaPrivateKey);
      evidence = report.evidenceEncrypted ? rsa.decrypt(report.evidenceEncrypted, keys.rsaPrivateKey) : null;
    } catch {
      return res.status(409).json({ integrityOk: false, error: "Integrity check failed" });
    }

    const recomputedMac = computeContentMac({ title, description, category, evidence });
    if (recomputedMac !== report.mac) {
      return res.status(409).json({ integrityOk: false, error: "Integrity check failed" });
    }

    report.readReceipts.push({ reviewer: req.user.sub, openedAt: new Date() });
    await report.save();

    res.json({
      id: report._id,
      title,
      description,
      category,
      evidence,
      status: report.status,
      createdAt: report.createdAt,
      hasIdentity: !!report.reporterIdentityEncrypted,
      integrityOk: true,
      chainVerified: verifyChain(report.statusLog),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load report" });
  }
}

export async function updateReportStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status || !(status in STATUS_ORDER)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    const report = await Report.findOne({ _id: id, assignedReviewer: req.user.sub });
    if (!report) return res.status(403).json({ error: "Not authorized to update this report" });

    if (status === report.status) {
      return res.json({ status: report.status }); // idempotent no-op
    }
    if (STATUS_ORDER[status] < STATUS_ORDER[report.status]) {
      return res.status(400).json({ error: "Cannot move status backward" });
    }

    const entry = nextChainedEntry(report.statusLog, {
      type: "status_change",
      status,
      changedBy: req.user.sub,
      timestamp: new Date(),
    });
    report.statusLog.push(entry);
    report.status = status;
    await report.save();

    res.json({ status: report.status });
  } catch (err) {
    res.status(500).json({ error: "Failed to update status" });
  }
}

export async function getReportHistory(req, res) {
  try {
    const { id } = req.params;
    const report = await Report.findById(id).select("assignedReviewer statusLog");
    if (!report) return res.status(404).json({ error: "Report not found" });

    const isAssignedReviewer =
      req.user.role === "reviewer" &&
      report.assignedReviewer &&
      report.assignedReviewer.toString() === req.user.sub;
    const isAdmin = req.user.role === "admin";
    if (!isAssignedReviewer && !isAdmin) {
      return res.status(403).json({ error: "Not authorized to view this report's history" });
    }

    res.json({
      entries: report.statusLog.map((e) => ({
        type: e.type,
        status: e.status,
        changedBy: e.changedBy,
        timestamp: e.timestamp,
      })),
      chainVerified: verifyChain(report.statusLog),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load history" });
  }
}

export async function requestIdentityReveal(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: "reason is required" });

    const report = await Report.findById(id).select("assignedReviewer reporterIdentityEncrypted statusLog");
    if (!report) return res.status(404).json({ error: "Report not found" });
    if (!report.reporterIdentityEncrypted) {
      return res.status(400).json({ error: "This report has no identity field to reveal" });
    }
    if (req.user.role === "reviewer" && (!report.assignedReviewer || report.assignedReviewer.toString() !== req.user.sub)) {
      await writeAuditLog({
        action: "UNAUTHORIZED_REVEAL_REQUEST_ATTEMPT",
        performedBy: req.user.sub,
        targetId: id,
      });
      return res.status(403).json({ error: "Not authorized to request a reveal for this report" });
    }

    const activeCustodians = await User.countDocuments({ role: "custodian", status: "active" });
    if (activeCustodians === 0) {
      return res.status(400).json({ error: "No custodians are configured" });
    }
    const threshold = Math.max(1, Math.min(Number(process.env.CUSTODIAN_THRESHOLD || 2), activeCustodians));

    const revealRequest = await RevealRequest.create({
      report: id,
      requestedBy: req.user.sub,
      reason,
      threshold,
      status: "pending",
    });

    const entry = nextChainedEntry(report.statusLog, {
      type: "identity_reveal_requested",
      status: null,
      changedBy: req.user.sub,
      timestamp: new Date(),
    });
    report.statusLog.push(entry);
    await report.save();

    await writeAuditLog({
      action: "IDENTITY_REVEAL_REQUESTED",
      performedBy: req.user.sub,
      targetId: id,
      details: { revealRequestId: revealRequest._id.toString() },
    });

    res.status(201).json({ revealRequestId: revealRequest._id, threshold });
  } catch (err) {
    res.status(500).json({ error: "Failed to create reveal request" });
  }
}

export async function getIdentityRevealResult(req, res) {
  try {
    const { id } = req.params;
    const revealRequest = await RevealRequest.findOne({ report: id, requestedBy: req.user.sub }).sort({
      createdAt: -1,
    });
    if (!revealRequest) return res.status(404).json({ error: "No reveal request found" });

    if (revealRequest.status === "pending") {
      const approvals = revealRequest.approvals.filter((a) => a.decision === "approve").length;
      return res.status(202).json({ status: "pending", approvals, threshold: revealRequest.threshold });
    }
    if (revealRequest.status === "denied") {
      return res.json({ status: "denied" });
    }

    const report = await Report.findById(id).select("reporterIdentityEncrypted");
    const identity = await decryptIdentityField(report.reporterIdentityEncrypted);
    res.json({ status: "approved", identity });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch reveal result" });
  }
}
