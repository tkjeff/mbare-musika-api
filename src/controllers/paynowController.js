"use strict";

const crypto = require("crypto");
const { URL } = require("url");
const pool = require("../config/db");
const { Paynow } = require("paynow");
const { recordOrderCommissions } = require("../services/commissionService");

function requiredPaynowConfig() {
    const integrationId = process.env.PAYNOW_INTEGRATION_ID;
    const integrationKey = process.env.PAYNOW_INTEGRATION_KEY;
    const apiUrl = (process.env.PUBLIC_API_URL || "https://mbare-musika-api.onrender.com").replace(/\/+$/, "");
    const webUrl = (process.env.WEB_APP_URL || "https://mbare-musika-web.vercel.app").replace(/\/+$/, "");

    if (!integrationId || !integrationKey) {
        const error = new Error("Paynow credentials are not configured on the server.");
        error.statusCode = 503;
        throw error;
    }

    if (!apiUrl.startsWith("https://") || !webUrl.startsWith("https://")) {
        const error = new Error("Public API and website URLs must use HTTPS.");
        error.statusCode = 500;
        throw error;
    }

    const paynow = new Paynow(integrationId, integrationKey);

    return { paynow, apiUrl, webUrl };
}

function isTrustedPollUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" &&
            ["paynow.co.zw", "www.paynow.co.zw"].includes(url.hostname.toLowerCase());
    } catch {
        return false;
    }
}

function money(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return NaN;
    return Math.round((number + Number.EPSILON) * 100) / 100;
}

async function startPaynowPayment(req, res, next) {
    let transactionId;

    try {
        const { paynow, apiUrl, webUrl } = requiredPaynowConfig();
        const orderId = req.params.orderId;
        const customerId = req.user.sub || req.user.id;

        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            const orderResult = await client.query(
                `SELECT id, customer_id, total, currency, status
                 FROM orders
                 WHERE id = $1 AND customer_id = $2
                 FOR UPDATE`,
                [orderId, customerId]
            );

            if (orderResult.rows.length === 0) {
                const error = new Error("Order not found.");
                error.statusCode = 404;
                throw error;
            }

            const order = orderResult.rows[0];

            if (order.status !== "PENDING") {
                const error = new Error("Only pending orders can start a new payment.");
                error.statusCode = 409;
                throw error;
            }

            if (String(order.currency).toUpperCase() !== "USD") {
                const error = new Error("Paynow checkout is currently restricted to USD orders.");
                error.statusCode = 400;
                throw error;
            }

            const amount = money(order.total);

            if (!Number.isFinite(amount) || amount <= 0) {
                const error = new Error("The order total is invalid.");
                error.statusCode = 400;
                throw error;
            }

            const existing = await client.query(
                `SELECT id, status
                 FROM marketplace_payment_transactions
                 WHERE order_id = $1
                   AND status IN ('PENDING', 'SUCCESS')
                 ORDER BY created_at DESC
                 LIMIT 1
                 FOR UPDATE`,
                [orderId]
            );

            if (existing.rows.length > 0) {
                const previous = existing.rows[0];

                if (previous.status === "SUCCESS") {
                    const error = new Error("This order already has a verified successful payment.");
                    error.statusCode = 409;
                    throw error;
                }

                const error = new Error("A payment attempt is already pending for this order. Verify its status before retrying.");
                error.statusCode = 409;
                throw error;
            }

            transactionId = crypto.randomUUID();

            const merchantReference = `MM-${transactionId}`;

            await client.query(
                `INSERT INTO marketplace_payment_transactions
                    (id, order_id, customer_id, merchant_reference, amount, currency, status)
                 VALUES ($1, $2, $3, $4, $5, 'USD', 'PENDING')`,
                [transactionId, orderId, customerId, merchantReference, amount.toFixed(2)]
            );

            await client.query("COMMIT");

            const payment = paynow.createPayment(merchantReference);
            payment.add(`Mbare Musika order ${orderId}`, amount);

            paynow.resultUrl =
                `${apiUrl}/api/payments/paynow/result/${transactionId}`;

            paynow.returnUrl =
                `${webUrl}/payment-return?transactionId=${encodeURIComponent(transactionId)}`;

            const response = await paynow.send(payment);

            if (!response || !response.success || !response.redirectUrl || !response.pollUrl) {
                const reason = response && response.error
                    ? String(response.error).slice(0, 500)
                    : "Paynow did not return a successful checkout response.";

                await pool.query(
                    `UPDATE marketplace_payment_transactions
                     SET status = 'FAILED',
                         provider_status = 'INITIATION_FAILED',
                         failure_reason = $2,
                         updated_at = NOW()
                     WHERE id = $1 AND status = 'PENDING'`,
                    [transactionId, reason]
                );

                return res.status(502).json({
                    success: false,
                    message: "Could not initiate Paynow checkout.",
                    transactionId
                });
            }

            if (!isTrustedPollUrl(response.pollUrl)) {
                await pool.query(
                    `UPDATE marketplace_payment_transactions
                     SET status = 'FAILED',
                         provider_status = 'INVALID_POLL_URL',
                         failure_reason = 'Paynow returned an unexpected polling URL.',
                         updated_at = NOW()
                     WHERE id = $1 AND status = 'PENDING'`,
                    [transactionId]
                );

                return res.status(502).json({
                    success: false,
                    message: "Paynow returned an invalid polling URL."
                });
            }

            await pool.query(
                `UPDATE marketplace_payment_transactions
                 SET checkout_url = $2,
                     poll_url = $3,
                     updated_at = NOW()
                 WHERE id = $1 AND status = 'PENDING'`,
                [transactionId, response.redirectUrl, response.pollUrl]
            );

            return res.status(201).json({
                success: true,
                message: "Paynow checkout initiated. Payment is not yet verified.",
                transactionId,
                checkoutUrl: response.redirectUrl,
                amount: amount.toFixed(2),
                currency: "USD",
                paymentVerified: false
            });
        } catch (error) {
            try {
                await client.query("ROLLBACK");
            } catch {}

            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        next(error);
    }
}

async function verifyStoredTransaction(transactionId) {
    const lookup = await pool.query(
        `SELECT id, order_id, customer_id, merchant_reference,
                provider_reference, amount, currency, status, poll_url
         FROM marketplace_payment_transactions
         WHERE id = $1`,
        [transactionId]
    );

    if (lookup.rows.length === 0) {
        const error = new Error("Payment transaction not found.");
        error.statusCode = 404;
        throw error;
    }

    const transaction = lookup.rows[0];

    if (transaction.status === "SUCCESS") {
        await recordOrderCommissions(transaction.order_id);

        return {
            verified: true,
            status: "SUCCESS",
            orderId: transaction.order_id,
            transactionId: transaction.id
        };
    }

    if (!transaction.poll_url || !isTrustedPollUrl(transaction.poll_url)) {
        return {
            verified: false,
            status: transaction.status,
            message: "No trusted Paynow polling URL is available."
        };
    }

    const { paynow } = requiredPaynowConfig();
    const providerStatus = await paynow.pollTransaction(transaction.poll_url);

    if (!providerStatus) {
        return {
            verified: false,
            status: "PENDING",
            message: "Paynow has not returned a usable status."
        };
    }

    const statusText = String(providerStatus.status || "UNKNOWN").toUpperCase();

    if (typeof providerStatus.paid !== "function" || !providerStatus.paid()) {
        const isFailed = /\b(cancelled|canceled|failed)\b/i.test(statusText);

        if (isFailed) {
            await pool.query(
                `UPDATE marketplace_payment_transactions
                 SET status = $2,
                     provider_status = $3,
                     updated_at = NOW()
                 WHERE id = $1 AND status = 'PENDING'`,
                [transactionId, "FAILED", statusText]
            );
        } else {
            await pool.query(
                `UPDATE marketplace_payment_transactions
                 SET provider_status = $2,
                     updated_at = NOW()
                 WHERE id = $1 AND status = 'PENDING'`,
                [transactionId, statusText]
            );
        }

        return {
            verified: false,
            status: isFailed ? (/cancel/i.test(statusText) ? "CANCELLED" : "FAILED") : "PENDING",
            message: "Paynow has not confirmed successful payment."
        };
    }

    const providerAmount = money(providerStatus.amount);

    if (!Number.isFinite(providerAmount) ||
        providerAmount !== money(transaction.amount)) {
        const error = new Error("Paynow amount does not match the stored order payment amount.");
        error.statusCode = 409;
        throw error;
    }

    if (providerStatus.reference &&
        String(providerStatus.reference) !== String(transaction.merchant_reference)) {
        const error = new Error("Paynow transaction reference does not match.");
        error.statusCode = 409;
        throw error;
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const locked = await client.query(
            `SELECT id, order_id, customer_id, merchant_reference,
                    amount, currency, status
             FROM marketplace_payment_transactions
             WHERE id = $1
             FOR UPDATE`,
            [transactionId]
        );

        if (locked.rows.length === 0) {
            throw new Error("Payment transaction disappeared during verification.");
        }

        const current = locked.rows[0];

        if (current.status !== "SUCCESS") {
            const orderResult = await client.query(
                `SELECT id, customer_id, total, currency, status
                 FROM orders
                 WHERE id = $1
                 FOR UPDATE`,
                [current.order_id]
            );

            if (orderResult.rows.length === 0) {
                throw new Error("Order associated with payment was not found.");
            }

            const order = orderResult.rows[0];

            if (String(order.customer_id) !== String(current.customer_id) ||
                money(order.total) !== money(current.amount) ||
                String(order.currency).toUpperCase() !== String(current.currency).toUpperCase()) {
                throw new Error("Stored order details do not match the payment transaction.");
            }

            if (order.status === "CANCELLED") {
                throw new Error("A cancelled order cannot be automatically confirmed as paid.");
            }

            await client.query(
                `UPDATE marketplace_payment_transactions
                 SET status = 'SUCCESS',
                     provider_reference = $2,
                     provider_status = $3,
                     failure_reason = NULL,
                     updated_at = NOW()
                 WHERE id = $1`,
                [
                    transactionId,
                    (providerStatus.paynowreference || providerStatus.paynowReference)
                        ? String(providerStatus.paynowreference || providerStatus.paynowReference).slice(0, 160)
                        : null,
                    statusText
                ]
            );

            if (order.status === "PENDING") {
                await client.query(
                    `UPDATE orders
                     SET status = 'CONFIRMED'
                     WHERE id = $1 AND status = 'PENDING'`,
                    [current.order_id]
                );
            }
        }

        await client.query("COMMIT");
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch {}

        throw error;
    } finally {
        client.release();
    }

    // Idempotent commission recording: repeat verification can retry
    // ledger creation if a previous attempt failed after payment was verified.
    const commissionResult = await recordOrderCommissions(transaction.order_id);

    return {
        verified: true,
        status: "SUCCESS",
        orderId: transaction.order_id,
        transactionId,
        commission: commissionResult,
        actualSellerTransferPerformed: false
    };
}

async function verifyMyPayment(req, res, next) {
    try {
        const transactionId = req.params.transactionId;

        const result = await pool.query(
            `SELECT id, order_id, status
             FROM marketplace_payment_transactions
             WHERE id = $1 AND customer_id = $2`,
            [transactionId, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Payment transaction not found."
            });
        }

        const verification = await verifyStoredTransaction(transactionId);

        return res.json({
            success: true,
            ...verification
        });
    } catch (error) {
        next(error);
    }
}

async function handlePaynowResult(req, res) {
    try {
        const transactionId = req.params.transactionId;

        await verifyStoredTransaction(transactionId);

        return res.status(200).send("OK");
    } catch (error) {
        console.error("Paynow result callback verification failed:", error.message);
        return res.status(200).send("Received");
    }
}

module.exports = {
    startPaynowPayment,
    verifyMyPayment,
    handlePaynowResult
};
