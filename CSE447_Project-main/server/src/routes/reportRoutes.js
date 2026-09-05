import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { submitLimiter, trackLimiter } from "../middleware/rateLimit.js";
import {
  submitReport,
  getReportByTrackingId,
  getAssignedReports,
  getReportById,
  updateReportStatus,
  getReportHistory,
  requestIdentityReveal,
  getIdentityRevealResult,
} from "../controllers/reportController.js";

const router = Router();

// Public — no auth required (supports fully anonymous submission)
router.post("/", submitLimiter, submitReport);
router.get("/track/:trackingId", trackLimiter, getReportByTrackingId);

// Reviewer-only
router.get("/assigned", requireAuth, requireRole("reviewer"), getAssignedReports);
router.get("/:id", requireAuth, requireRole("reviewer"), getReportById);
router.patch("/:id/status", requireAuth, requireRole("reviewer"), updateReportStatus);
router.get("/:id/history", requireAuth, requireRole("reviewer", "admin"), getReportHistory);

// Identity reveal governance (reviewer or admin can request; result is only
// ever delivered to whoever made the request)
router.post("/:id/reveal-identity", requireAuth, requireRole("reviewer", "admin"), requestIdentityReveal);
router.get("/:id/reveal-identity", requireAuth, requireRole("reviewer", "admin"), getIdentityRevealResult);

export default router;
