const express = require("express");
const { z } = require("zod");
const pool = require("../config/db");
const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authenticate, authorizeRoles("OWNER", "ADMIN"));

const productInput = z.object({
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().max(5000).nullable().optional(),
  price: z.coerce.number().min(0).max(100000000),
  currency: z.string().trim().length(3).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  stockQuantity: z.coerce.number().int().min(0).max(1000000),
  imageUrl: z.string().url().max(2000).nullable().optional(),
  isActive: z.boolean().optional()
});

const createProductInput = productInput.extend({ sellerId: z.string().uuid() });

router.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const values = [];
    const conditions = [];

    if (req.query.search) {
      values.push(`%${String(req.query.search).trim().slice(0, 100)}%`);
      conditions.push(`(p.name ILIKE $${values.length} OR COALESCE(p.description, '') ILIKE $${values.length})`);
    }

    if (req.query.categoryId) {
      values.push(req.query.categoryId);
      conditions.push(`p.category_id = $${values.length}::uuid`);
    }

    if (req.query.status === "active") conditions.push("p.is_active = TRUE");
    if (req.query.status === "inactive") conditions.push("p.is_active = FALSE");

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query(`
      SELECT p.id, p.name, p.description, p.price, p.currency,
             p.stock_quantity, p.image_url, p.seller_id, p.category_id, p.is_active,
             p.created_at, p.updated_at,
             c.name AS category_name,
             u.full_name AS seller_name,
             u.email AS seller_email
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN users u ON u.id = p.seller_id
      ${where}
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `, values);

    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM products p ${where}`,
      values
    );

    const categories = await pool.query(
      "SELECT id, name FROM categories ORDER BY name"
    );
    
    const sellers = await pool.query(
      SELECT u.id, u.full_name, u.email, sp.business_name
      FROM users u
      JOIN seller_profiles sp ON sp.user_id = u.id
      WHERE u.role = 'SELLER'
        AND u.is_active = TRUE
        AND sp.approval_status = 'APPROVED'
      ORDER BY COALESCE(sp.business_name, u.full_name), u.email
    );

    res.json({
      success: true,
      products: result.rows,
      categories: categories.rows,
      sellers: sellers.rows,
      pagination: {
        page,
        limit,
        total: count.rows[0].total,
        pages: Math.ceil(count.rows[0].total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = createProductInput.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Check the product details and try again.",
        errors: parsed.error.issues
      });
    }

    const data = parsed.data;

    if (data.categoryId) {
      const category = await pool.query(
        "SELECT id FROM categories WHERE id = $1::uuid",
        [data.categoryId]
      );

      if (!category.rowCount) {
        return res.status(400).json({
          success: false,
          message: "The selected category does not exist."
        });
      }
    }

    const seller = await pool.query(
      "SELECT u.id FROM users u JOIN seller_profiles sp ON sp.user_id = u.id WHERE u.id = $1::uuid AND u.role = 'SELLER' AND u.is_active = TRUE AND sp.approval_status = 'APPROVED'",
      [data.sellerId]
    );

    if (!seller.rowCount) {
      return res.status(400).json({
        success: false,
        message: "Select an active, approved seller."
      });
    });

router.patch("/:id", async (req, res, next) => {
  try {
    const parsed = productInput.partial().safeParse(req.body);

    if (!parsed.success || !Object.keys(parsed.data || {}).length) {
      return res.status(400).json({
        success: false,
        message: "Provide valid product fields to update.",
        errors: parsed.success ? [] : parsed.error.issues
      });
    }

    const data = parsed.data;

    if (data.categoryId) {
      const category = await pool.query(
        "SELECT id FROM categories WHERE id = $1::uuid",
        [data.categoryId]
      );

      if (!category.rowCount) {
        return res.status(400).json({
          success: false,
          message: "The selected category does not exist."
        });
      }
    }

    const columns = {
      name: "name",
      description: "description",
      price: "price",
      currency: "currency",
      categoryId: "category_id",
      stockQuantity: "stock_quantity",
      imageUrl: "image_url",
      isActive: "is_active"
    };

    const values = [];
    const updates = [];

    for (const [key, value] of Object.entries(data)) {
      values.push(
        key === "currency" && typeof value === "string"
          ? value.toUpperCase()
          : value
      );

      updates.push(`${columns[key]} = $${values.length}`);
    }

    updates.push("updated_at = NOW()");
    values.push(req.params.id);

    const result = await pool.query(`
      UPDATE products
      SET ${updates.join(", ")}
      WHERE id = $${values.length}::uuid
      RETURNING *
    `, values);

    if (!result.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Product not found."
      });
    }

    res.json({
      success: true,
      message: "Product updated.",
      product: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const result = await pool.query(`
      UPDATE products
      SET is_active = FALSE, updated_at = NOW()
      WHERE id = $1::uuid AND is_active = TRUE
      RETURNING id
    `, [req.params.id]);

    if (!result.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Active product not found."
      });
    }

    res.json({
      success: true,
      message: "Product deactivated."
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

