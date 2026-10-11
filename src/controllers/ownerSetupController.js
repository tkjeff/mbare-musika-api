const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { z } = require("zod");
const pool = require("../config/db");

const ownerSchema = z.object({
    fullName: z.string().trim().min(2).max(150),
    email: z.string().trim().email().max(254),
    password: z.string().min(12).max(72),
    phone: z.string().trim().max(30).optional().or(z.literal(""))
});

function safeSecretMatch(provided, expected) {
    if (typeof provided !== "string" || typeof expected !== "string") {
        return false;
    }

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);

    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function setupOwner(req, res, next) {
    const expectedKey = process.env.OWNER_SETUP_KEY;
    const suppliedKey = req.get("x-owner-setup-key");

    if (!expectedKey || expectedKey.length < 32) {
        return res.status(503).json({
            success: false,
            message: "Owner setup is not configured. Contact the platform operator."
        });
    }

    if (!safeSecretMatch(suppliedKey, expectedKey)) {
        return res.status(403).json({
            success: false,
            message: "Owner setup authorization failed."
        });
    }

    const parsed = ownerSchema.safeParse(req.body || {});

    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            message: "Provide a valid name, email, phone and password of at least 12 characters."
        });
    }

    const data = parsed.data;
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [74110311]);

        const existing = await client.query(
            "SELECT id FROM users WHERE role = 'OWNER' LIMIT 1"
        );

        if (existing.rows.length) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                success: false,
                message: "Owner setup has already been completed."
            });
        }

        const passwordHash = await bcrypt.hash(data.password, 12);

        const created = await client.query(
            `INSERT INTO users
                (full_name, email, phone, password_hash, role)
             VALUES ($1, $2, $3, $4, 'OWNER')
             RETURNING id, full_name, email, phone, role, created_at`,
            [
                data.fullName,
                data.email.toLowerCase(),
                data.phone || null,
                passwordHash
            ]
        );

        const owner = created.rows[0];

        await client.query(
            `INSERT INTO audit_logs
                (actor_user_id, action, entity_type, entity_id, details)
             VALUES ($1::uuid, 'OWNER_INITIAL_SETUP', 'USER', $2::text, $3::jsonb)`,
            [owner.id, owner.id, JSON.stringify({ role: "OWNER" })]
        );

        await client.query("COMMIT");

        return res.status(201).json({
            success: true,
            message: "Owner account created. Sign in with your new credentials.",
            user: {
                id: owner.id,
                fullName: owner.full_name,
                email: owner.email,
                phone: owner.phone,
                role: owner.role,
                createdAt: owner.created_at
            }
        });
    } catch (error) {
        await client.query("ROLLBACK");

        if (error.code === "23505") {
            return res.status(409).json({
                success: false,
                message: "An account with this email already exists."
            });
        }

        return next(error);
    } finally {
        client.release();
    }
}

module.exports = { setupOwner };
