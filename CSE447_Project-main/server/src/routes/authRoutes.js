import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { register, login, verify2FA, setup2FA, logout, me } from "../controllers/authController.js";

const router = Router();

router.post("/register", register);
router.post("/login", authLimiter, login);
router.post("/verify-2fa", authLimiter, verify2FA);
router.post("/setup-2fa", requireAuth, setup2FA);
router.post("/logout", logout);
router.get("/me", requireAuth, me);

export default router;
