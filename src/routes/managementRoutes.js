const express = require("express");
const {
    listAdministrators,
    createAdministrator,
    setAdministratorStatus
} = require("../controllers/managementController");
const {
    authenticate,
    authorizeRoles
} = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authenticate, authorizeRoles("OWNER"));

router.get("/administrators", listAdministrators);
router.post("/administrators", createAdministrator);
router.patch("/administrators/:id/status", setAdministratorStatus);

module.exports = router;
