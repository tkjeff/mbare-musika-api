const pool = require("../config/db");

async function recordOrderCommissions(orderId) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const orderResult = await client.query(
            `SELECT id, currency
             FROM orders
             WHERE id = $1
             FOR UPDATE`,
            [orderId]
        );

        if (orderResult.rows.length === 0) {
            throw new Error("Order not found.");
        }

        const order = orderResult.rows[0];

        const itemsResult = await client.query(
            `SELECT
                oi.id AS order_item_id,
                oi.order_id,
                oi.line_total,
                p.seller_id
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             JOIN seller_profiles sp ON sp.id = p.seller_id
             WHERE oi.order_id = $1
             ORDER BY oi.id
             FOR UPDATE OF oi`,
            [orderId]
        );

        if (itemsResult.rows.length === 0) {
            throw new Error("Cannot calculate commission: order has no items.");
        }

        let inserted = 0;

        for (const item of itemsResult.rows) {
            const gross = Number(item.line_total);

            if (!Number.isFinite(gross) || gross < 0) {
                throw new Error("Invalid order item amount.");
            }

            const commission = Math.round((gross * 3 + Number.EPSILON)) / 100;
            const sellerAmount = Math.round((gross - commission + Number.EPSILON) * 100) / 100;

            const result = await client.query(
                `INSERT INTO marketplace_commissions (
                    order_item_id,
                    order_id,
                    seller_id,
                    gross_amount,
                    commission_rate,
                    commission_amount,
                    seller_amount,
                    currency,
                    status
                )
                VALUES ($1, $2, $3, $4, 3.00, $5, $6, $7, 'PENDING')
                ON CONFLICT (order_item_id) DO NOTHING
                RETURNING id`,
                [
                    item.order_item_id,
                    item.order_id,
                    item.seller_id,
                    gross.toFixed(2),
                    commission.toFixed(2),
                    sellerAmount.toFixed(2),
                    order.currency
                ]
            );

            inserted += result.rowCount;
        }

        await client.query("COMMIT");

        return {
            orderId,
            commissionRate: 3,
            commissionRecordsCreated: inserted,
            message: "Commission records saved as PENDING."
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { recordOrderCommissions };
