const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { z } = require("zod");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

const registerSchema = z.object({
    fullName: z.string().trim().min(2).max(150),
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(72),
    phone: z.string().trim().max(30).optional().or(z.literal("")),
    role: z.enum(["CUSTOMER", "SELLER", "RIDER"]).default("CUSTOMER"),
    businessName: z.string().trim().min(2).max(180).optional(),
    businessDescription: z.string().trim().max(2000).optional(),
    vehicleType: z.string().trim().max(50).optional(),
    licenseNumber: z.string().trim().max(100).optional()
});

const loginSchema = z.object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(72)
});

function createToken(user) {
    return jwt.sign(
        {
            sub: user.id,
            email: user.email,
            role: user.role
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "1d" }
    );
}

function publicUser(user) {
    return {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        createdAt: user.created_at
    };
}

async function register(req, res, next) {
    const parsed = registerSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            message: "Please check your registration details.",
            errors: parsed.error.issues.map(issue => ({
                field: issue.path.join("."),
                message: issue.message
            }))
        });
    }

    const data = parsed.data;
    const email = data.email.toLowerCase();

    if (data.role === "SELLER" && !data.businessName) {
        return res.status(400).json({
            success: false,
            message: "Business name is required for seller registration."
        });
    }

    if (data.role === "RIDER" && !data.vehicleType) {
        return res.status(400).json({
            success: false,
            message: "Vehicle type is required for rider registration."
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const passwordHash = await bcrypt.hash(data.password, 12);

        const result = await client.query(
            `INSERT INTO users
                (full_name, email, phone, password_hash, role)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, full_name, email, phone, role, created_at`,
            [
                data.fullName,
                email,
                data.phone || null,
                passwordHash,
                data.role
            ]
        );

        const user = result.rows[0];

        if (data.role === "SELLER") {
            await client.query(
                `INSERT INTO seller_profiles
                    (user_id, business_name, business_description)
                 VALUES ($1, $2, $3)`,
                [
                    user.id,
                    data.businessName,
                    data.businessDescription || null
                ]
            );
        }

        if (data.role === "RIDER") {
            await client.query(
                `INSERT INTO rider_profiles
                    (user_id, vehicle_type, license_number)
                 VALUES ($1, $2, $3)`,
                [
                    user.id,
                    data.vehicleType,
                    data.licenseNumber || null
                ]
            );
        }

        await client.query(
            `INSERT INTO audit_logs
                (actor_user_id, action, entity_type, entity_id)
             VALUES ($1, $2, $3, $4)`,
            [user.id, "REGISTER", "USER", user.id]
        );

        await client.query("COMMIT");

        return res.status(201).json({
            success: true,
            message: data.role === "SELLER"
                ? "Seller account created. Your seller profile is pending approval."
                : data.role === "RIDER"
                    ? "Rider account created. Your rider profile is pending approval."
                    : "Account created successfully.",
            token: createToken(user),
            user: publicUser(user)
        });
    } catch (error) {
        await client.query("ROLLBACK");

        if (error.code === "23505") {
            return res.status(409).json({
                success: false,
                message: "An account with this email already exists."
            });
        }

        next(error);
    } finally {
        client.release();
    }
}

async function login(req, res, next) {
    const parsed = loginSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            message: "Please provide a valid email and password."
        });
    }

    try {
        const email = parsed.data.email.toLowerCase();

        const result = await pool.query(
            `SELECT id, full_name, email, phone, password_hash,
                    role, is_active, created_at
             FROM users
             WHERE email = $1`,
            [email]
        );

        const user = result.rows[0];

        if (
            !user ||
            !user.is_active ||
            !(await bcrypt.compare(parsed.data.password, user.password_hash))
        ) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        await pool.query(
            `INSERT INTO audit_logs
                (actor_user_id, action, entity_type, entity_id)
             VALUES ($1, $2, $3, $4)`,
            [user.id, "LOGIN", "USER", user.id]
        );

        return res.json({
            success: true,
            message: "Login successful.",
            token: createToken(user),
            user: publicUser(user)
        });
    } catch (error) {
        next(error);
    }
}

async function me(req, res, next) {
    try {
        const result = await pool.query(
            `SELECT id, full_name, email, phone, role, is_active, created_at
             FROM users
             WHERE id = $1`,
            [req.user.sub]
        );

        if (!result.rows.length || !result.rows[0].is_active) {
            return res.status(401).json({
                success: false,
                message: "Account not found or disabled."
            });
        }

        return res.json({
            success: true,
            user: publicUser(result.rows[0])
        });
    } catch (error) {
        next(error);
    }
}

module.exports = { register, login, me };
