const jwt = require("jsonwebtoken");
const pool = require("../config/db");

async function authenticate(req, res, next) {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Authentication required."
        });
    }

    try {
        const payload = jwt.verify(
            header.slice(7),
            process.env.JWT_SECRET
        );

        const result = await pool.query(
            "SELECT id, email, role, is_active FROM users WHERE id = $1",
            [payload.sub]
        );

        const user = result.rows[0];

        if (!user || !user.is_active) {
            return res.status(401).json({
                success: false,
                message: "Account not found or disabled."
            });
        }

        req.user = {
            ...payload,
            sub: user.id,
            email: user.email,
            role: user.role
        };

        return next();
    } catch (error) {
        if (error.name === "JsonWebTokenError" ||
            error.name === "TokenExpiredError" ||
            error.name === "NotBeforeError") {
            return res.status(401).json({
                success: false,
                message: "Invalid or expired token."
            });
        }

        return next(error);
    }
}

function authorizeRoles(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to perform this action."
            });
        }

        return next();
    };
}

module.exports = { authenticate, authorizeRoles };
