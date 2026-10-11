const pool = require("../config/db");

async function getMarketplaceStats(req, res, next) {
    try {
        const result = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM users
                 WHERE UPPER(role::text) = 'CUSTOMER') AS total_customers,

                (SELECT COUNT(*) FROM users
                 WHERE UPPER(role::text) = 'SELLER') AS total_sellers,

                (SELECT COUNT(*) FROM users
                 WHERE UPPER(role::text) = 'RIDER') AS total_riders,

                (SELECT COUNT(*) FROM seller_profiles
                 WHERE UPPER(approval_status::text) = 'APPROVED') AS approved_sellers,

                (SELECT COUNT(*) FROM seller_profiles
                 WHERE UPPER(approval_status::text) = 'PENDING') AS pending_sellers,

                (SELECT COUNT(*) FROM rider_profiles
                 WHERE UPPER(approval_status::text) = 'APPROVED') AS approved_riders,

                (SELECT COUNT(*) FROM rider_profiles
                 WHERE UPPER(approval_status::text) = 'PENDING') AS pending_riders
        `);

        const row = result.rows[0];

        return res.json({
            success: true,
            stats: {
                totalCustomers: Number(row.total_customers),
                totalSellers: Number(row.total_sellers),
                totalRiders: Number(row.total_riders),
                approvedSellers: Number(row.approved_sellers),
                pendingSellers: Number(row.pending_sellers),
                approvedRiders: Number(row.approved_riders),
                pendingRiders: Number(row.pending_riders),
                updatedAt: new Date().toISOString()
            }
        });
    } catch (error) {
        next(error);
    }
}

module.exports = { getMarketplaceStats };