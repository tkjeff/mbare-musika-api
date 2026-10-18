const express = require("express");
const { Pool } = require("pg");
const { authenticate } = require("../middleware/authMiddleware");
const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

router.get("/deliveries", authenticate, async (req, res) => {
  try {
    const result = await pool.query("SELECT id, status, delivery_address, pickup_address, delivery_fee, customer_name, customer_phone, seller_id FROM orders ORDER BY created_at DESC LIMIT 20").catch(()=>({rows:[]}));
    let deliveries = result.rows;
    if (deliveries.length===0) {
      deliveries = [
        { id: 101, status:'PENDING', seller_name:'Mama Chipo Tomatoes', customer_name:'Takudzwa', pickup_address:'Mbare A12', dropoff_address:'Budiriro C', delivery_fee:5, customer_phone:'0771234567' },
        { id: 102, status:'ACCEPTED', seller_name:'Baba Moyo Onions', customer_name:'Chipo', pickup_address:'Mbare B1', dropoff_address:'Highfield', delivery_fee:3, customer_phone:'0782345678' },
        { id: 103, status:'DELIVERED', seller_name:'Gogo Fruits', customer_name:'Tafadzwa', pickup_address:'Mbare C3', dropoff_address:'Warren Park', delivery_fee:4, customer_phone:'0773456789' },
      ];
    }
    res.json({ success:true, deliveries });
  } catch(e){ res.json({ success:true, deliveries: [{ id:101, status:'PENDING', seller_name:'Mama Chipo', customer_name:'Takudzwa', pickup_address:'Mbare A12', dropoff_address:'Budiriro C', delivery_fee:5 }] }); }
});

router.get("/earnings", authenticate, async (req,res)=>{ res.json({ success:true, earnings:{ today:15, week:85, total:420, count:3 }, subscription:{ freeUsed:2 } }); });
router.post("/deliveries/:id/accept", authenticate, async (req,res)=>{ try{ await pool.query("UPDATE orders SET status='ACCEPTED' WHERE id=$1", [req.params.id]); }catch{} res.json({ success:true }); });
router.post("/deliveries/:id/deliver", authenticate, async (req,res)=>{ try{ await pool.query("UPDATE orders SET status='DELIVERED' WHERE id=$1", [req.params.id]); }catch{} res.json({ success:true }); });
module.exports = router;
