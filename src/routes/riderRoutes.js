import express from 'express';
import { authenticate } from '../middleware/auth.js';
const router = express.Router();

// GET /api/rider/deliveries - pending + accepted
router.get('/deliveries', authenticate, async (req,res)=>{
  // TODO: replace with real DB query - mock for now
  const mock = [
    { id: 1, order_id: 101, status: 'PENDING', seller_name: 'Mama Chipo Tomatoes', stall_no: 'A12', customer_name: 'John Doe', customer_phone: '+263771234567', customer_address: '123 Samora Machel, Harare', pickup_address: 'Mbare Musika Stall A12', dropoff_address: '123 Samora Machel', delivery_fee: 5, distance_km: 8.2, eta_min: 25, pickup_lat: -17.857, pickup_lng: 31.044, dropoff_lat: -17.825, dropoff_lng: 31.052, created_at: new Date() },
  ];
  res.json({ deliveries: mock, newOffer: null });
});

router.post('/deliveries/:id/accept', authenticate, async (req,res)=> res.json({ success: true }));
router.post('/deliveries/:id/deliver', authenticate, async (req,res)=> res.json({ success: true }));
router.get('/earnings', authenticate, async (req,res)=> res.json({ earnings: { today: 15, week: 45, total: 320, count: 2 }, subscription: { freeUsed: 2, needsPayment: false }}));

export default router;
