import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  createReviewer,
  createCustodian,
  listStaff,
  deactivateUser,
  rotateReviewerKeys,
  listReports,
  assignReport,
  getAuditLogs,
  getDashboardSummary,
} from "../controllers/adminController.js";

const router = Router();
router.use(requireAuth, requireRole("admin"));

router.get("/dashboard", getDashboardSummary);

router.post("/reviewers", createReviewer);
router.post("/custodians", createCustodian);
router.get("/staff", listStaff);
router.patch("/staff/:id/deactivate", deactivateUser);
router.post("/reviewers/:id/rotate-keys", rotateReviewerKeys);

router.get("/reports", listReports);
router.patch("/reports/:id/assign", assignReport);

router.get("/audit-logs", getAuditLogs);

export default router;
