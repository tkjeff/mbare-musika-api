const pool = require("../config/db");

async function listCategories(req, res, next) {
  try {
    const result = await pool.query(`
      SELECT c.id, c.name, c.description,
             COUNT(p.id)::int AS product_count
      FROM categories c
      LEFT JOIN products p
        ON p.category_id = c.id
       AND p.is_active = TRUE
      GROUP BY c.id
      ORDER BY c.name ASC
    `);

    res.json({ success: true, categories: result.rows });
  } catch (error) {
    next(error);
  }
}

module.exports = { listCategories };
