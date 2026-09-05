/**
 * Custodian-only: review and decide pending identity-reveal requests.
 * The custodian key itself lives in crypto/custodianKeyManager.js and is
 * never touched here directly — decryptIdentityField is only ever called
 * once a request's k-of-n approval threshold is actually met.
 */
import RevealRequest from "../models/RevealRequest.js";
import { nextChainedEntry, writeAuditLog } from "../utils/chain.js";
import Report from "../models/Report.js";

export async function listPendingRequests(req, res) {
  try {
    const requests = await RevealRequest.find({ status: "pending" })
      .populate("requestedBy", "username role")
      .sort({ createdAt: 1 });

    res.json({
      requests: requests.map((r) => ({
        id: r._id,
        report: r.report,
        requestedBy: r.requestedBy ? { id: r.requestedBy._id, username: r.requestedBy.username, role: r.requestedBy.role } : null,
        reason: r.reason,
        threshold: r.threshold,
        approvalsCount: r.approvals.filter((a) => a.decision === "approve").length,
        alreadyVoted: r.approvals.some((a) => a.custodian.toString() === req.user.sub),
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load pending requests" });
  }
}

export async function decideRequest(req, res) {
  try {
    const { id } = req.params;
    const { decision, reason } = req.body;
    if (!["approve", "deny"].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approve' or 'deny'" });
    }

    const revealRequest = await RevealRequest.findById(id);
    if (!revealRequest) return res.status(404).json({ error: "Request not found" });

    if (revealRequest.status !== "pending") {
      return res.json({ status: revealRequest.status, approvalsCount: revealRequest.approvals.length, threshold: revealRequest.threshold });
    }

    const existingVote = revealRequest.approvals.find((a) => a.custodian.toString() === req.user.sub);
    if (existingVote) {
      return res.json({ status: revealRequest.status, decision: existingVote.decision, approvalsCount: revealRequest.approvals.length, threshold: revealRequest.threshold });
    }

    revealRequest.approvals.push({ custodian: req.user.sub, decision, reason, decidedAt: new Date() });

    const report = await Report.findById(revealRequest.report).select("statusLog");
    let logType = null;

    if (decision === "deny") {
      revealRequest.status = "denied";
      revealRequest.resolvedAt = new Date();
      logType = "identity_reveal_denied";
    } else {
      const approvalsCount = revealRequest.approvals.filter((a) => a.decision === "approve").length;
      if (approvalsCount >= revealRequest.threshold) {
        revealRequest.status = "approved";
        revealRequest.resolvedAt = new Date();
        logType = "identity_reveal_approved";
      }
    }

    await revealRequest.save();

    if (logType && report) {
      const entry = nextChainedEntry(report.statusLog, {
        type: logType,
        status: null,
        changedBy: req.user.sub,
        timestamp: new Date(),
      });
      report.statusLog.push(entry);
      await report.save();

      await writeAuditLog({
        action: logType.toUpperCase(),
        performedBy: req.user.sub,
        targetId: revealRequest.report,
        details: { revealRequestId: revealRequest._id.toString() },
      });
    }

    res.json({
      status: revealRequest.status,
      approvalsCount: revealRequest.approvals.filter((a) => a.decision === "approve").length,
      threshold: revealRequest.threshold,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to record decision" });
  }
}
