const pool = require("../config/db");

async function getPendingSellers(req, res, next) {
    try {
        const result = await pool.query(`
            SELECT
                sp.id AS seller_profile_id,
                sp.business_name,
                sp.business_description,
                sp.approval_status,
                sp.created_at AS application_date,
                u.id AS user_id,
                u.full_name,
                u.email,
                u.phone
            FROM seller_profiles sp
            JOIN users u ON u.id = sp.user_id
            WHERE sp.approval_status = 'PENDING'
            ORDER BY sp.created_at ASC
        `);

        return res.json({
            success: true,
            count: result.rows.length,
            sellers: result.rows
        });
    } catch (error) {
        next(error);
    }
}

async function reviewSeller(req, res, next) {
    const { sellerProfileId } = req.params;
    const { status, reason } = req.body || {};

    if (!["APPROVED", "REJECTED"].includes(status)) {
        return res.status(400).json({
            success: false,
            message: "Status must be APPROVED or REJECTED."
        });
    }

    if (
        reason !== undefined &&
        (typeof reason !== "string" || reason.length > 1000)
    ) {
        return res.status(400).json({
            success: false,
            message: "Reason must be a string of no more than 1000 characters."
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const updated = await client.query(`
            UPDATE seller_profiles
            SET approval_status = $1
            WHERE id = $2
              AND approval_status = 'PENDING'
            RETURNING id, user_id, business_name, approval_status
        `, [status, sellerProfileId]);

        if (!updated.rows.length) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                success: false,
                message: "Pending seller application not found."
            });
        }

        const seller = updated.rows[0];

        await client.query(`
            INSERT INTO audit_logs
                (actor_user_id, action, entity_type, entity_id)
            VALUES ($1, $2, $3, $4)
        `, [
            req.user.sub,
            status === "APPROVED" ? "SELLER_APPROVED" : "SELLER_REJECTED",
            "SELLER_PROFILE",
            seller.id
        ]);

        await client.query("COMMIT");

        return res.json({
            success: true,
            message: status === "APPROVED"
                ? "Seller approved. The seller can now publish products."
                : "Seller application rejected.",
            seller: {
                id: seller.id,
                userId: seller.user_id,
                businessName: seller.business_name,
                approvalStatus: seller.approval_status
            }
        });
    } catch (error) {
        await client.query("ROLLBACK");
        next(error);
    } finally {
        client.release();
    }
}

module.exports = {
    getPendingSellers,
    reviewSeller
};
