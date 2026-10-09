const pool = require("../config/db");
const { z } = require("zod");

const productSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(5000).optional().nullable(),
  price: z.coerce.number().positive().max(100000000),
  categoryId: z.string().uuid().optional().nullable(),
  stockQuantity: z.coerce.number().int().min(0).max(1000000).default(0),
  imageUrl: z.string().url().max(2000).optional().nullable()
});

async function listProducts(req, res, next) {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 12));
    const offset = (page - 1) * limit;
    const values = [];
    const conditions = ["p.is_active = TRUE", "p.stock_quantity > 0"];

    if (req.query.search) {
      values.push(`%${String(req.query.search).trim().slice(0, 100)}%`);
      conditions.push(`(p.name ILIKE $${values.length} OR p.description ILIKE $${values.length})`);
    }

    if (req.query.categoryId) {
      values.push(req.query.categoryId);
      conditions.push(`p.category_id = $${values.length}::uuid`);
    }

    if (req.query.minPrice !== undefined) {
      const min = Number(req.query.minPrice);
      if (!Number.isFinite(min) || min < 0) {
        return res.status(400).json({ success: false, message: "minPrice must be a non-negative number." });
      }
      values.push(min);
      conditions.push(`p.price >= $${values.length}`);
    }

    if (req.query.maxPrice !== undefined) {
      const max = Number(req.query.maxPrice);
      if (!Number.isFinite(max) || max < 0) {
        return res.status(400).json({ success: false, message: "maxPrice must be a non-negative number." });
      }
      values.push(max);
      conditions.push(`p.price <= $${values.length}`);
    }

    if (req.query.minPrice !== undefined && req.query.maxPrice !== undefined &&
        Number(req.query.minPrice) > Number(req.query.maxPrice)) {
      return res.status(400).json({ success: false, message: "minPrice cannot exceed maxPrice." });
    }

    const where = conditions.join(" AND ");

    const result = await pool.query(`
      SELECT p.id, p.name, p.description, p.price, p.currency,
             p.stock_quantity, p.image_url, p.category_id,
             c.name AS category_name,
             sp.business_name AS seller_name,
             p.created_at
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      JOIN seller_profiles sp ON sp.user_id = p.seller_id
      WHERE ${where}
        AND sp.approval_status = 'APPROVED'
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `, values);

    const countResult = await pool.query(`
      SELECT COUNT(*)::int AS total
      FROM products p
      JOIN seller_profiles sp ON sp.user_id = p.seller_id
      WHERE ${where}
        AND sp.approval_status = 'APPROVED'
    `, values);

    res.json({
      success: true,
      products: result.rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0].total,
        pages: Math.ceil(countResult.rows[0].total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
}

async function getProduct(req, res, next) {
  try {
    const result = await pool.query(`
      SELECT p.id, p.name, p.description, p.price, p.currency,
             p.stock_quantity, p.image_url, p.category_id,
             c.name AS category_name,
             sp.business_name AS seller_name
      FROM products p
      JOIN seller_profiles sp ON sp.user_id = p.seller_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = $1::uuid
        AND p.is_active = TRUE
        AND sp.approval_status = 'APPROVED'
    `, [req.params.id]);

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "Product not found." });
    }

    res.json({ success: true, product: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

async function createProduct(req, res, next) {
  try {
    const parsed = productSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid product details.",
        errors: parsed.error.issues
      });
    }

    const seller = await pool.query(`
      SELECT approval_status
      FROM seller_profiles
      WHERE user_id = $1::uuid
    `, [req.user.sub]);

    if (!seller.rows.length) {
      return res.status(403).json({
        success: false,
        message: "A seller profile is required to create products."
      });
    }

    if (seller.rows[0].approval_status !== "APPROVED") {
      return res.status(403).json({
        success: false,
        message: "Your seller account must be approved before listing products."
      });
    }

    const data = parsed.data;

    if (data.categoryId) {
      const category = await pool.query(
        "SELECT id FROM categories WHERE id = $1::uuid",
        [data.categoryId]
      );

      if (!category.rows.length) {
        return res.status(400).json({ success: false, message: "Category not found." });
      }
    }

    const result = await pool.query(`
      INSERT INTO products
        (seller_id, category_id, name, description, price, currency,
         stock_quantity, image_url, is_active)
      VALUES
        ($1::uuid, $2::uuid, $3, $4, $5, 'U', $6, $7, TRUE)
      RETURNING *
    `, [
      req.user.sub,
      data.categoryId || null,
      data.name,
      data.description || null,
      data.price,
      data.stockQuantity,
      data.imageUrl || null
    ]);

    res.status(201).json({ success: true, product: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

async function myProducts(req, res, next) {
  try {
    const result = await pool.query(`
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.seller_id = $1::uuid
      ORDER BY p.created_at DESC
    `, [req.user.sub]);

    res.json({ success: true, products: result.rows });
  } catch (error) {
    next(error);
  }
}

async function updateProduct(req, res, next) {
  try {
    const parsed = productSchema.partial().safeParse(req.body);

    if (!parsed.success || Object.keys(parsed.data || {}).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide valid product fields to update.",
        errors: parsed.success ? [] : parsed.error.issues
      });
    }

    const allowed = {
      name: "name",
      description: "description",
      price: "price",
      categoryId: "category_id",
      stockQuantity: "stock_quantity",
      imageUrl: "image_url"
    };

    const values = [];
    const assignments = [];

    for (const [key, column] of Object.entries(allowed)) {
      if (Object.prototype.hasOwnProperty.call(parsed.data, key)) {
        values.push(parsed.data[key] ?? null);
        assignments.push(`${column} = $${values.length}`);
      }
    }

    if (Object.prototype.hasOwnProperty.call(parsed.data, "categoryId") &&
        parsed.data.categoryId) {
      const category = await pool.query(
        "SELECT id FROM categories WHERE id = $1::uuid",
        [parsed.data.categoryId]
      );
      if (!category.rows.length) {
        return res.status(400).json({ success: false, message: "Category not found." });
      }
    }

    values.push(req.params.id, req.user.sub);

    const result = await pool.query(`
      UPDATE products
      SET ${assignments.join(", ")}, updated_at = NOW()
      WHERE id = $${values.length - 1}::uuid
        AND seller_id = $${values.length}::uuid
      RETURNING *
    `, values);

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Product not found or you do not own it."
      });
    }

    res.json({ success: true, product: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

async function deactivateProduct(req, res, next) {
  try {
    const result = await pool.query(`
      UPDATE products
      SET is_active = FALSE, updated_at = NOW()
      WHERE id = $1::uuid AND seller_id = $2::uuid
      RETURNING id
    `, [req.params.id, req.user.sub]);

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Product not found or you do not own it."
      });
    }

    res.json({ success: true, message: "Product removed from the public catalogue." });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  myProducts,
  updateProduct,
  deactivateProduct
};
