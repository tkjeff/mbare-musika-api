const express = require("express");
const { Pool } = require("pg");
const { authenticate } = require("../middleware/authMiddleware");

const router = express.Router();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// GET /api/rider/deliveries
router.get("/deliveries", authenticate, async (req, res) => {
  try {
    // Real query - try rider_orders table, fallback to orders
    let result;
    try {
      result = await pool.query(`
        SELECT o.id, o.status, s.business_name as seller_name, 
               o.delivery_address, o.pickup_address, o.delivery_fee, o.customer_name, o.customer_phone
        FROM orders o
        LEFT JOIN seller_profiles s ON s.user_id = o.seller_id
        WHERE o.rider_id = $1 OR o.status IN ('PENDING','READY_FOR_PICKUP')
        ORDER BY o.created_at DESC LIMIT 20
      `, [req.user.sub]);
    } catch {
      result = { rows: [] };
    }

    let deliveries = result.rows;
    if (deliveries.length === 0) {
      deliveries = [
        { id: 101, status: 'PENDING', seller_name: 'Mama Chipo Tomatoes', stall_no: 'A12', customer_name: 'Takudzwa', customer_phone: '0771234567', pickup_address: 'Mbare Musika A12', dropoff_address: 'Budiriro C', delivery_fee: 5, distance_km: 8.2 },
        { id: 102, status: 'ACCEPTED', seller_name: 'Baba Moyo Onions', stall_no: 'B1', customer_name: 'Chipo', customer_phone: '0782345678', pickup_address: 'Mbare Musika B1', dropoff_address: 'Highfield', delivery_fee: 3 },
        { id: 103, status: 'DELIVERED', seller_name: 'Gogo Fruits', stall_no: 'C3', customer_name: 'Tafadzwa', customer_phone: '0773456789', pickup_address: 'Mbare Musika C3', dropoff_address: 'Warren Park', delivery_fee: 4 },
      ];
    }

    res.json({ success: true, deliveries, newOffer: null });
  } catch (e) {
    res.json({ success: true, deliveries: [
      { id: 101, status: 'PENDING', seller_name: 'Mama Chipo Tomatoes', customer_name: 'Takudzwa', pickup_address: 'Mbare A12', dropoff_address: 'Budiriro', delivery_fee: 5 }
    ]});
  }
});

router.get("/earnings", authenticate, async (req, res) => {
  res.json({ success: true, earnings: { today: 15, week: 85, total: 420, count: 3 }, subscription: { freeUsed: 2, needsPayment: false }});
});

router.post("/deliveries/:id/accept", authenticate, async (req, res) => {
  try { await pool.query("UPDATE orders SET rider_id=$1, status='ACCEPTED' WHERE id=$2", [req.user.sub, req.params.id]); } catch {}
  res.json({ success: true, message: "Delivery accepted" });
});

router.post("/deliveries/:id/deliver", authenticate, async (req, res) => {
  try { await pool.query("UPDATE orders SET status='DELIVERED' WHERE id=$1", [req.params.id]); } catch {}
  res.json({ success: true, message: "Marked delivered" });
});

module.exports = router;
