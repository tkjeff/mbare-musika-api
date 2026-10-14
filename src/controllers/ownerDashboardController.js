const pool = require("../config/db");

async function getDashboardStats(req, res, next) {
    try {
        const result = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM users) AS total_users,
                (SELECT COUNT(*) FROM users WHERE role = 'CUSTOMER') AS total_customers,
                (SELECT COUNT(*) FROM users WHERE role = 'SELLER') AS total_sellers,
                (SELECT COUNT(*) FROM seller_profiles WHERE approval_status = 'PENDING') AS pending_sellers,
                (SELECT COUNT(*) FROM seller_profiles WHERE approval_status = 'APPROVED') AS approved_sellers,
                (SELECT COUNT(*) FROM users WHERE role = 'RIDER') AS total_riders,
                (SELECT COUNT(*) FROM rider_profiles WHERE approval_status = 'PENDING') AS pending_riders,
                (SELECT COUNT(*) FROM rider_profiles WHERE approval_status = 'APPROVED') AS approved_riders,
                (SELECT COUNT(*) FROM products) AS total_products,
                (SELECT COUNT(*) FROM products WHERE is_active = TRUE) AS active_products,
                (SELECT COUNT(*) FROM orders) AS total_orders,
                (SELECT COUNT(*) FROM orders WHERE status = 'PENDING') AS pending_orders,
                (SELECT COUNT(*) FROM orders WHERE status = 'DELIVERED') AS delivered_orders,
                (SELECT COUNT(*) FROM payments) AS total_payment_records,
                (SELECT COUNT(*) FROM marketplace_payment_transactions WHERE status = 'SUCCESS') AS successful_payment_records,
                (SELECT COALESCE(SUM(amount), 0) FROM marketplace_payment_transactions WHERE status = 'SUCCESS') AS successful_payment_amount,
                (SELECT COUNT(*) FROM users WHERE is_active = FALSE) AS disabled_users
        `);

        const row = result.rows[0];
        const count = (value) => Number(value);

        return res.json({
            success: true,
            dashboard: {
                users: {
                    total: count(row.total_users),
                    customers: count(row.total_customers),
                    sellers: count(row.total_sellers),
                    riders: count(row.total_riders),
                    disabled: count(row.disabled_users)
                },
                sellers: {
                    pending: count(row.pending_sellers),
                    approved: count(row.approved_sellers)
                },
                riders: {
                    pending: count(row.pending_riders),
                    approved: count(row.approved_riders)
                },
                products: {
                    total: count(row.total_products),
                    active: count(row.active_products)
                },
                orders: {
                    total: count(row.total_orders),
                    pending: count(row.pending_orders),
                    delivered: count(row.delivered_orders)
                },
                payments: {
                    records: count(row.total_payment_records),
                    successfulRecords: count(row.successful_payment_records),
                    successfulAmount: count(row.successful_payment_amount),
                    note: "Successful payment records are not the same as settled seller payouts or platform commission."
                }
            }
        });
    } catch (error) {
        return next(error);
    }
}

module.exports = { getDashboardStats };