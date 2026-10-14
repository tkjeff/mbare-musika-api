const pool = require("../config/db");

function getUserId(req) {
    return req.user.sub || req.user.id;
}

async function getSellerFinancialSummary(req, res, next) {
    try {
        const sellerId = getUserId(req);

        const result = await pool.query(
            `SELECT
                currency,
                COALESCE(SUM(seller_amount), 0)::numeric(12,2) AS total_earnings,
                COALESCE(SUM(seller_amount) FILTER (
                    WHERE status = 'HELD'
                ), 0)::numeric(12,2) AS held_balance,
                COALESCE(SUM(seller_amount) FILTER (
                    WHERE status = 'AVAILABLE'
                ), 0)::numeric(12,2) AS available_balance,
                COALESCE(SUM(seller_amount) FILTER (
                    WHERE status = 'PAID'
                ), 0)::numeric(12,2) AS recorded_paid_balance,
                COALESCE(SUM(commission_amount), 0)::numeric(12,2)
                    AS platform_commission
             FROM marketplace_commissions
             WHERE seller_id = $1
             GROUP BY currency
             ORDER BY currency`,
            [sellerId]
        );

        res.json({
            success: true,
            financialSummary: result.rows,
            note: "Recorded balances are ledger values, not a guarantee of bank settlement."
        });
    } catch (error) {
        next(error);
    }
}

async function getOwnerFinancialSummary(req, res, next) {
    try {
        const result = await pool.query(
            `SELECT
                currency,
                COUNT(*)::integer AS commission_records,
                COALESCE(SUM(gross_amount), 0)::numeric(12,2)
                    AS recorded_gross_sales,
                COALESCE(SUM(commission_amount), 0)::numeric(12,2)
                    AS platform_commission,
                COALESCE(SUM(seller_amount) FILTER (
                    WHERE status = 'HELD'
                ), 0)::numeric(12,2) AS held_seller_funds,
                COALESCE(SUM(seller_amount) FILTER (
                    WHERE status = 'AVAILABLE'
                ), 0)::numeric(12,2) AS available_seller_funds,
                COALESCE(SUM(seller_amount) FILTER (
                    WHERE status = 'PAID'
                ), 0)::numeric(12,2) AS recorded_paid_funds
             FROM marketplace_commissions
             GROUP BY currency
             ORDER BY currency`
        );

        res.json({
            success: true,
            financialSummary: result.rows,
            note: "Recorded PAID amounts must be reconciled against actual provider settlement."
        });
    } catch (error) {
        next(error);
    }
}

async function confirmReceipt(req, res, next) {
    const client = await pool.connect();

    try {
        const customerId = getUserId(req);
        const orderId = req.params.orderId;

        await client.query("BEGIN");

        const orderResult = await client.query(
            `SELECT id, status
             FROM orders
             WHERE id = $1 AND customer_id = $2
             FOR UPDATE`,
            [orderId, customerId]
        );

        if (!orderResult.rowCount) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                success: false,
                message: "Order not found."
            });
        }

        const order = orderResult.rows[0];

        if (order.status !== "DELIVERED") {
            await client.query("ROLLBACK");

            return res.status(409).json({
                success: false,
                message: "Receipt can only be confirmed after the order is marked DELIVERED."
            });
        }

        const paymentResult = await client.query(
            `SELECT id
             FROM marketplace_payment_transactions
             WHERE order_id = $1 AND status = 'SUCCESS'
             LIMIT 1`,
            [orderId]
        );

        if (!paymentResult.rowCount) {
            await client.query("ROLLBACK");

            return res.status(409).json({
                success: false,
                message: "No successfully recorded payment exists for this order."
            });
        }

        const updateResult = await client.query(
            `UPDATE marketplace_commissions
             SET status = 'AVAILABLE', updated_at = NOW()
             WHERE order_id = $1 AND status = 'HELD'
             RETURNING id`,
            [orderId]
        );

        await client.query(
            `INSERT INTO marketplace_financial_audit
                (actor_user_id, order_id, action, details)
             VALUES ($1, $2, 'CUSTOMER_CONFIRMED_RECEIPT',
                jsonb_build_object(
                    'commission_records_released',
                    $3::integer
                ))`,
            [customerId, orderId, updateResult.rowCount]
        );

        await client.query("COMMIT");

        return res.json({
            success: true,
            message: "Receipt recorded. Eligible held seller balances are now available for payout processing.",
            commissionRecordsReleased: updateResult.rowCount,
            actualTransferPerformed: false
        });
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (_) {
        }

        next(error);
    } finally {
        client.release();
    }
}

module.exports = {
    getSellerFinancialSummary,
    getOwnerFinancialSummary,
    confirmReceipt
};
