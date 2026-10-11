const express = require("express");
const {
  listProducts,
  getProduct,
  createProduct,
  myProducts,
  updateProduct,
  deactivateProduct
} = require("../controllers/productController");
const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");

const { uploadProductImage } = require("../controllers/imageUploadController");
const { uploadProductImageMiddleware } = require("../middleware/imageUploadMiddleware");

const router = express.Router();

router.get("/", listProducts);
router.post("/upload-image", authenticate, authorizeRoles("SELLER"), uploadProductImageMiddleware, uploadProductImage);
router.get("/mine", authenticate, authorizeRoles("SELLER"), myProducts);
router.get("/:id", getProduct);
router.post("/", authenticate, authorizeRoles("SELLER"), createProduct);
router.patch("/:id", authenticate, authorizeRoles("SELLER"), updateProduct);
router.delete("/:id", authenticate, authorizeRoles("SELLER"), deactivateProduct);

module.exports = router;
