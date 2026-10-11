const bcrypt = require("bcryptjs");
const { z } = require("zod");
const pool = require("../config/db");

const createAdminSchema = z.object({
    fullName: z.string().trim().min(2).max(150),
    email: z.string().trim().email().max(254),
    password: z.string().min(12).max(72),
    phone: z.string().trim().max(30).optional().or(z.literal(""))
});

async function listAdministrators(req, res, next) {
    try {
        const result = await pool.query(
            `SELECT id, full_name, email, phone, is_active, created_at
             FROM users
             WHERE role = 'ADMIN'
             ORDER BY created_at DESC`
        );

        return res.json({
            success: true,
            administrators: result.rows.map(user => ({
                id: user.id,
                fullName: user.full_name,
                email: user.email,
                phone: user.phone,
                isActive: user.is_active,
                createdAt: user.created_at
            }))
        });
    } catch (error) {
        return next(error);
    }
}

async function createAdministrator(req, res, next) {
    const parsed = createAdminSchema.safeParse(req.body || {});

    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            message: "Provide a valid name and email, and a password of at least 12 characters."
        });
    }

    const data = parsed.data;
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const passwordHash = await bcrypt.hash(data.password, 12);
        const created = await client.query(
            `INSERT INTO users
                (full_name, email, phone, password_hash, role)
             VALUES ($1, $2, $3, $4, 'ADMIN')
             RETURNING id, full_name, email, phone, is_active, created_at`,
            [
                data.fullName,
                data.email.toLowerCase(),
                data.phone || null,
                passwordHash
            ]
        );

        const admin = created.rows[0];

        await client.query(
            `INSERT INTO audit_logs
                (actor_user_id, action, entity_type, entity_id, details)
             VALUES ($1, 'ADMIN_CREATED', 'USER', $2, $3::jsonb)`,
            [
                req.user.sub,
                admin.id,
                JSON.stringify({ email: admin.email, role: "ADMIN" })
            ]
        );

        await client.query("COMMIT");

        return res.status(201).json({
            success: true,
            message: "Administrator account created.",
            administrator: {
                id: admin.id,
                fullName: admin.full_name,
                email: admin.email,
                phone: admin.phone,
                isActive: admin.is_active,
                createdAt: admin.created_at
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

async function setAdministratorStatus(req, res, next) {
    const { id } = req.params;
    const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body || {});

    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            message: "isActive must be true or false."
        });
    }

    if (id === req.user.sub) {
        return res.status(400).json({
            success: false,
            message: "You cannot change your own account through this endpoint."
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const updated = await client.query(
            `UPDATE users
             SET is_active = $1, updated_at = NOW()
             WHERE id = $2 AND role = 'ADMIN'
             RETURNING id, full_name, email, is_active`,
            [parsed.data.isActive, id]
        );

        if (!updated.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                success: false,
                message: "Administrator not found."
            });
        }

        await client.query(
            `INSERT INTO audit_logs
                (actor_user_id, action, entity_type, entity_id, details)
             VALUES ($1, $2, 'USER', $3, $4::jsonb)`,
            [
                req.user.sub,
                parsed.data.isActive ? "ADMIN_ACTIVATED" : "ADMIN_DEACTIVATED",
                id,
                JSON.stringify({ isActive: parsed.data.isActive })
            ]
        );

        await client.query("COMMIT");

        return res.json({
            success: true,
            message: parsed.data.isActive
                ? "Administrator activated."
                : "Administrator deactivated.",
            administrator: {
                id: updated.rows[0].id,
                fullName: updated.rows[0].full_name,
                email: updated.rows[0].email,
                isActive: updated.rows[0].is_active
            }
        });
    } catch (error) {
        await client.query("ROLLBACK");
        return next(error);
    } finally {
        client.release();
    }
}

module.exports = {
    listAdministrators,
    createAdministrator,
    setAdministratorStatus
};
