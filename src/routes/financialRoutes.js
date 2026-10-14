const express = require("express");

const {
    getSellerFinancialSummary,
    getOwnerFinancialSummary,
    confirmReceipt
} = require("../controllers/financialController");

const {
    authenticate,
    authorizeRoles
} = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authenticate);

router.get(
    "/seller/summary",
    authorizeRoles("SELLER"),
    getSellerFinancialSummary
);

router.get(
    "/owner/summary",
    authorizeRoles("OWNER"),
    getOwnerFinancialSummary
);

router.post(
    "/orders/:orderId/confirm-receipt",
    authorizeRoles("CUSTOMER"),
    confirmReceipt
);

module.exports = router;
