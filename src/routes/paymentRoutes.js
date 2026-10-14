"use strict";

const express = require("express");
const router = express.Router();
const {
    startPaynowPayment,
    verifyMyPayment,
    handlePaynowResult
} = require("../controllers/paynowController");
const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");

// Paynow callback must be reachable without a customer JWT.
// The controller independently polls Paynow before accepting payment.
router.post("/paynow/result/:transactionId", handlePaynowResult);

router.use(authenticate);

router.post(
    "/orders/:orderId/paynow",
    authorizeRoles("CUSTOMER"),
    startPaynowPayment
);

router.get(
    "/:transactionId/verify",
    authorizeRoles("CUSTOMER"),
    verifyMyPayment
);

module.exports = router;
