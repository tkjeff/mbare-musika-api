const express = require("express");
const {
    getPendingSellers,
    reviewSeller,
    getPendingRiders,
    reviewRider
} = require("../controllers/adminController");
const { getMarketplaceStats } = require("../controllers/marketplaceStatsController");
const {
    authenticate,
    authorizeRoles
} = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authenticate, authorizeRoles("OWNER", "ADMIN"));

router.get("/marketplace-stats", getMarketplaceStats);
router.get("/sellers/pending", getPendingSellers);
router.patch("/sellers/:sellerProfileId/approval", reviewSeller);

router.get("/riders/pending", getPendingRiders);
router.patch("/riders/:riderProfileId/approval", reviewRider);

module.exports = router;

