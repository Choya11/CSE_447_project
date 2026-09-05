import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { register, login, verify2FA, setup2FA, logout } from "../controllers/authController.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/verify-2fa", verify2FA);
router.post("/setup-2fa", requireAuth, setup2FA);
router.post("/logout", logout);

export default router;
