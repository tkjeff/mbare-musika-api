const pool = require("../config/db");

const DELIVERY_FEE = 0;

function validUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function money(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function createOrder(req, res, next) {
    const customerId = req.user.sub || req.user.id;
    const { items, deliveryAddress } = req.body || {};

    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
        return res.status(400).json({
            success: false,
            message: "Provide between 1 and 50 order items."
        });
    }

    if (typeof deliveryAddress !== "string" || deliveryAddress.trim().length < 5 || deliveryAddress.trim().length > 1000) {
        return res.status(400).json({
            success: false,
            message: "Provide a valid delivery address."
        });
    }

    const quantities = new Map();

    for (const item of items) {
        if (!item || !validUuid(item.productId) ||
            !Number.isSafeInteger(item.quantity) ||
            item.quantity < 1 || item.quantity > 1000) {
            return res.status(400).json({
                success: false,
                message: "Every item needs a valid productId and quantity between 1 and 1000."
            });
        }

        quantities.set(
            item.productId,
            (quantities.get(item.productId) || 0) + item.quantity
        );
    }

    for (const quantity of quantities.values()) {
        if (quantity > 1000) {
            return res.status(400).json({
                success: false,
                message: "Combined quantity for a product cannot exceed 1000."
            });
        }
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const customer = await client.query(
            "SELECT id FROM users WHERE id = $1 AND role = 'CUSTOMER' AND is_active = TRUE FOR UPDATE",
            [customerId]
        );

        if (customer.rows.length === 0) {
            const error = new Error("Active customer account not found.");
            error.status = 403;
            throw error;
        }

        const productIds = [...quantities.keys()].sort();

        const productResult = await client.query(
            `SELECT
                p.id,
                p.name,
                p.price,
                p.currency,
                p.stock_quantity,
                p.is_active,
                p.seller_id,
                sp.approval_status
             FROM products p
             JOIN seller_profiles sp ON sp.user_id = p.seller_id
             WHERE p.id = ANY($1::uuid[])
             ORDER BY p.id
             FOR UPDATE OF p`,
            [productIds]
        );

        if (productResult.rows.length !== productIds.length) {
            const error = new Error("One or more products were not found.");
            error.status = 400;
            throw error;
        }

        const products = new Map(
            productResult.rows.map(product => [product.id, product])
        );

        let subtotal = 0;
        const preparedItems = [];
        let currency = null;

        for (const [productId, quantity] of quantities.entries()) {
            const product = products.get(productId);

            if (!product.is_active || product.approval_status !== "APPROVED") {
                const error = new Error(`Product "${product.name}" is unavailable.`);
                error.status = 400;
                throw error;
            }

            if (product.stock_quantity < quantity) {
                const error = new Error(`Insufficient stock for "${product.name}".`);
                error.status = 409;
                throw error;
            }

            const productCurrency = String(product.currency).trim().toUpperCase();

            if (!currency) currency = productCurrency;

            if (currency !== productCurrency) {
                const error = new Error("All items in one order must use the same currency.");
                error.status = 400;
                throw error;
            }

            const unitPrice = money(product.price);
            const lineTotal = money(unitPrice * quantity);

            if (unitPrice <= 0 || !Number.isFinite(lineTotal)) {
                const error = new Error("A product has an invalid price.");
                error.status = 400;
                throw error;
            }

            subtotal = money(subtotal + lineTotal);

            preparedItems.push({
                productId,
                name: product.name,
                quantity,
                unitPrice,
                lineTotal
            });
        }

        const deliveryFee = DELIVERY_FEE;
        const total = money(subtotal + deliveryFee);

        const orderResult = await client.query(
            `INSERT INTO orders (
                customer_id, status, subtotal, delivery_fee,
                total, currency, delivery_address
             )
             VALUES ($1, 'PENDING', $2, $3, $4, $5, $6)
             RETURNING *`,
            [
                customerId,
                subtotal.toFixed(2),
                deliveryFee.toFixed(2),
                total.toFixed(2),
                currency,
                deliveryAddress.trim()
            ]
        );

        const order = orderResult.rows[0];

        for (const item of preparedItems) {
            await client.query(
                `INSERT INTO order_items (
                    order_id, product_id, product_name,
                    quantity, unit_price, line_total
                 )
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    order.id,
                    item.productId,
                    item.name,
                    item.quantity,
                    item.unitPrice.toFixed(2),
                    item.lineTotal.toFixed(2)
                ]
            );

            const stockUpdate = await client.query(
                `UPDATE products
                 SET stock_quantity = stock_quantity - $1,
                     updated_at = NOW()
                 WHERE id = $2
                   AND stock_quantity >= $1
                   AND is_active = TRUE
                 RETURNING id`,
                [item.quantity, item.productId]
            );

            if (stockUpdate.rowCount !== 1) {
                const error = new Error(`Stock changed while placing order for "${item.name}".`);
                error.status = 409;
                throw error;
            }
        }

        await client.query("COMMIT");

        return res.status(201).json({
            success: true,
            message: "Order created. Payment is still pending.",
            order: {
                id: order.id,
                status: order.status,
                subtotal: Number(order.subtotal),
                deliveryFee: Number(order.delivery_fee),
                total: Number(order.total),
                currency: String(order.currency).trim(),
                deliveryAddress: order.delivery_address,
                items: preparedItems
            },
            paymentRequired: true,
            paymentVerified: false
        });
    } catch (error) {
        await client.query("ROLLBACK");
        next(error);
    } finally {
        client.release();
    }
}

async function listMyOrders(req, res, next) {
    try {
        const customerId = req.user.sub || req.user.id;

        const result = await pool.query(
            `SELECT
                o.id, o.status, o.subtotal, o.delivery_fee,
                o.total, o.currency, o.delivery_address,
                o.created_at, o.updated_at,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'productId', oi.product_id,
                            'productName', oi.product_name,
                            'quantity', oi.quantity,
                            'unitPrice', oi.unit_price,
                            'lineTotal', oi.line_total
                        )
                    ) FILTER (WHERE oi.id IS NOT NULL),
                    '[]'::json
                ) AS items
             FROM orders o
             LEFT JOIN order_items oi ON oi.order_id = o.id
             WHERE o.customer_id = $1
             GROUP BY o.id
             ORDER BY o.created_at DESC
             LIMIT 100`,
            [customerId]
        );

        res.json({
            success: true,
            orders: result.rows
        });
    } catch (error) {
        next(error);
    }
}

async function getMyOrder(req, res, next) {
    try {
        const customerId = req.user.sub || req.user.id;

        if (!validUuid(req.params.orderId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid order ID."
            });
        }

        const result = await pool.query(
            `SELECT
                o.id, o.status, o.subtotal, o.delivery_fee,
                o.total, o.currency, o.delivery_address,
                o.created_at, o.updated_at,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'productId', oi.product_id,
                            'productName', oi.product_name,
                            'quantity', oi.quantity,
                            'unitPrice', oi.unit_price,
                            'lineTotal', oi.line_total
                        )
                    ) FILTER (WHERE oi.id IS NOT NULL),
                    '[]'::json
                ) AS items
             FROM orders o
             LEFT JOIN order_items oi ON oi.order_id = o.id
             WHERE o.id = $1 AND o.customer_id = $2
             GROUP BY o.id`,
            [req.params.orderId, customerId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Order not found."
            });
        }

        res.json({
            success: true,
            order: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    createOrder,
    listMyOrders,
    getMyOrder
};
