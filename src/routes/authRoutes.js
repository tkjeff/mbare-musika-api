const express = require("express");
const { register, login, me } = require("../controllers/authController");
const { authenticate } = require("../middleware/authMiddleware");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many authentication attempts. Please try again later."
    }
});

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.get("/me", authenticate, me);

module.exports = router;
