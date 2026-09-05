import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { listPendingRequests, decideRequest } from "../controllers/custodianController.js";

const router = Router();
router.use(requireAuth, requireRole("custodian"));

router.get("/requests", listPendingRequests);
router.post("/requests/:id/decision", decideRequest);

export default router;
