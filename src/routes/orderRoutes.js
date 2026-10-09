const express = require("express");
const {
    createOrder,
    listMyOrders,
    getMyOrder
} = require("../controllers/orderController");
const {
    authenticate,
    authorizeRoles
} = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authenticate, authorizeRoles("CUSTOMER"));

router.post("/", createOrder);
router.get("/mine", listMyOrders);
router.get("/:orderId", getMyOrder);

module.exports = router;
