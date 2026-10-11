const pool = require("../config/db");

async function getPendingSellers(req, res, next) {
    try {
        const result = await pool.query(`
            SELECT sp.id AS seller_profile_id,
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

async function getPendingRiders(req, res, next) {
    try {
        const result = await pool.query(`
            SELECT rp.id AS rider_profile_id,
                   rp.vehicle_type,
                   rp.license_number,
                   rp.approval_status,
                   rp.availability_status,
                   u.id AS user_id,
                   u.full_name,
                   u.email,
                   u.phone
            FROM rider_profiles rp
            JOIN users u ON u.id = rp.user_id
            WHERE rp.approval_status = 'PENDING'
            ORDER BY u.created_at ASC
        `);

        return res.json({
            success: true,
            count: result.rows.length,
            riders: result.rows
        });
    } catch (error) {
        next(error);
    }
}

async function reviewApplication(req, res, next) {
    const { profileId } = req.params;
    const { status, reason } = req.body || {};
    const profileType = req.params.profileType;

    if (!["APPROVED", "REJECTED"].includes(status)) {
        return res.status(400).json({
            success: false,
            message: "Status must be APPROVED or REJECTED."
        });
    }

    if (reason !== undefined &&
        (typeof reason !== "string" || reason.length > 1000)) {
        return res.status(400).json({
            success: false,
            message: "Reason must be a string of no more than 1000 characters."
        });
    }

    const table = profileType === "seller"
        ? "seller_profiles"
        : profileType === "rider"
            ? "rider_profiles"
            : null;

    if (!table) {
        return res.status(400).json({
            success: false,
            message: "Invalid application type."
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const updated = await client.query(`
            UPDATE ${table}
            SET approval_status = $1
            WHERE id = $2
              AND approval_status = 'PENDING'
            RETURNING id, user_id, approval_status
        `, [status, profileId]);

        if (!updated.rows.length) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                success: false,
                message: "Pending application not found. It may already have been reviewed."
            });
        }

        const application = updated.rows[0];

        await client.query(`
            INSERT INTO audit_logs
                (actor_user_id, action, entity_type, entity_id)
            VALUES ($1, $2, $3, $4)
        `, [
            req.user.sub,
            `${profileType.toUpperCase()}_${status}`,
            `${profileType.toUpperCase()}_PROFILE`,
            application.id
        ]);

        await client.query("COMMIT");

        return res.json({
            success: true,
            message: `${profileType === "seller" ? "Seller" : "Rider"} application ${status.toLowerCase()}.`,
            application: {
                id: application.id,
                userId: application.user_id,
                approvalStatus: application.approval_status,
                reason: reason || null
            }
        });
    } catch (error) {
        await client.query("ROLLBACK");
        next(error);
    } finally {
        client.release();
    }
}

async function reviewSeller(req, res, next) {
    req.params.profileType = "seller";
    req.params.profileId = req.params.sellerProfileId;
    return reviewApplication(req, res, next);
}

async function reviewRider(req, res, next) {
    req.params.profileType = "rider";
    req.params.profileId = req.params.riderProfileId;
    return reviewApplication(req, res, next);
}

module.exports = {
    getPendingSellers,
    reviewSeller,
    getPendingRiders,
    reviewRider
};
