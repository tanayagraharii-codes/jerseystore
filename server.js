require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const crypto = require('crypto');
const { initDB, readDB, writeDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const DOMAIN = process.env.DOMAIN || `http://localhost:${PORT}`;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const MONGODB_URI = process.env.MONGODB_URI || '';

// Razorpay is optional at boot so the store still runs before you've added keys.
let razorpay = null;
if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
  const Razorpay = require('razorpay');
  razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
} else {
  console.warn('⚠️  RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set. Checkout will run in TEST mode without real payments.');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// On serverless platforms (Vercel) each request can land on a fresh
// instance with no memory of earlier ones, so the default in-memory session
// store would silently log admins out constantly. When MongoDB is
// configured, sessions are stored there instead — this works correctly on
// both a long-running server (Render) and serverless functions (Vercel).
// Without MongoDB configured, it falls back to in-memory sessions, which is
// fine for local testing but will not behave correctly if deployed to Vercel.
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  store: MONGODB_URI ? MongoStore.create({ mongoUrl: MONGODB_URI, dbName: 'jerseystore', collectionName: 'sessions' }) : undefined,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 hours
}));

// Ensures the database connection is ready before any route handles a
// request. Cheap to call on every request — initDB() only actually connects
// once per warm process (see db.js), so this doesn't add real overhead on a
// long-running server, and is exactly what's needed on serverless where a
// "cold" function instance hasn't connected yet.
app.use(async (req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('Database connection failed:', err.message);
    res.status(500).json({ error: 'Database unavailable' });
  }
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

// ---------- Public product routes ----------

app.get('/api/products', async (req, res) => {
  const db = await readDB();
  res.json(db.products);
});

app.get('/api/products/:id', async (req, res) => {
  const db = await readDB();
  const product = db.products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });
  res.json(product);
});

app.get('/api/config', (req, res) => {
  res.json({ razorpayKeyId: RAZORPAY_KEY_ID || null });
});

// ---------- Coupons ----------

// Given a coupon and a subtotal, returns the discount amount in rupees, or
// throws a descriptive error if the coupon can't be applied. Used by both
// the preview endpoint and checkout itself, so the rules are enforced in
// exactly one place — the server never trusts a discount amount from the client.
function computeDiscount(coupon, subtotal) {
  if (!coupon.active) throw new Error('This coupon is no longer active');
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    throw new Error('This coupon has reached its usage limit');
  }
  if (subtotal < (coupon.minOrder || 0)) {
    throw new Error(`Minimum order of ₹${coupon.minOrder} required for this coupon`);
  }
  const raw = coupon.type === 'percent' ? subtotal * (coupon.value / 100) : coupon.value;
  return Math.min(Math.round(raw * 100) / 100, subtotal);
}

app.post('/api/coupons/validate', async (req, res) => {
  const { code, subtotal } = req.body;
  if (!code || typeof subtotal !== 'number') {
    return res.status(400).json({ error: 'Missing code or subtotal' });
  }
  const db = await readDB();
  const coupon = (db.coupons || []).find(c => c.code.toUpperCase() === String(code).toUpperCase());
  if (!coupon) return res.status(404).json({ error: 'Coupon not found' });
  try {
    const discount = computeDiscount(coupon, subtotal);
    res.json({ valid: true, code: coupon.code, type: coupon.type, value: coupon.value, discount, newTotal: Math.round((subtotal - discount) * 100) / 100 });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Order tracking (public — no login required) ----------
// Customer looks up their own order using the order ID and the email they
// checked out with. We deliberately don't require an account for this.

app.get('/api/track', async (req, res) => {
  const { orderId, email } = req.query;
  if (!orderId || !email) {
    return res.status(400).json({ error: 'Order ID and email are required' });
  }
  const db = await readDB();
  const order = db.orders.find(o =>
    o.id === orderId && o.customer.email.toLowerCase() === String(email).toLowerCase()
  );
  if (!order) {
    return res.status(404).json({ error: 'No order found with that ID and email' });
  }
  res.json({
    id: order.id,
    status: order.status,
    paymentMethod: order.paymentMethod,
    total: order.total,
    items: order.items,
    createdAt: order.createdAt
  });
});

// ---------- Checkout ----------
// Flow: client posts cart -> we validate stock, create a pending order,
// create a Razorpay order, return details for the client to open checkout.
// Stock is decremented only once payment is confirmed (or immediately for COD).

app.post('/api/checkout', async (req, res) => {
  const { items, customer, paymentMethod, couponCode } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }
  const requiredFields = ['name', 'email', 'phone', 'address1', 'city', 'state', 'pincode'];
  const missing = !customer || requiredFields.some(f => !customer[f]);
  if (missing) {
    return res.status(400).json({ error: 'Missing required customer/shipping details' });
  }
  if (!/^[0-9]{10}$/.test(customer.phone)) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }
  if (!/^[0-9]{6}$/.test(customer.pincode)) {
    return res.status(400).json({ error: 'Invalid PIN code' });
  }

  const db = await readDB();
  let subtotal = 0;

  for (const item of items) {
    const product = db.products.find(p => p.id === item.productId);
    if (!product) return res.status(400).json({ error: `Unknown product ${item.productId}` });
    const available = product.sizes[item.size] || 0;
    if (available < item.qty) {
      return res.status(400).json({ error: `Not enough stock for ${product.name} (${item.size})` });
    }
    if (product.customizable && (!item.customName || !item.customNumber)) {
      return res.status(400).json({ error: `Please provide a name and number for ${product.name}` });
    }
    subtotal += product.price * item.qty;
  }
  subtotal = Math.round(subtotal * 100) / 100;

  let discount = 0;
  let appliedCoupon = null;
  if (couponCode) {
    const coupon = (db.coupons || []).find(c => c.code.toUpperCase() === String(couponCode).toUpperCase());
    if (!coupon) return res.status(400).json({ error: 'Coupon not found' });
    try {
      discount = computeDiscount(coupon, subtotal);
      appliedCoupon = coupon.code;
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
  const total = Math.round((subtotal - discount) * 100) / 100;

  const orderId = crypto.randomUUID();
  const order = {
    id: orderId,
    items,
    customer,
    paymentMethod: paymentMethod === 'cod' ? 'cod' : 'online',
    subtotal,
    couponCode: appliedCoupon,
    discount,
    total,
    status: 'pending',
    razorpayOrderId: null,
    createdAt: new Date().toISOString()
  };
  db.orders.push(order);
  await writeDB(db);

  // Cash on Delivery: the order is confirmed right away, nothing to charge
  // online. Stock is deducted immediately since this is a firm order.
  if (paymentMethod === 'cod') {
    for (const item of order.items) {
      const product = db.products.find(p => p.id === item.productId);
      if (product) product.sizes[item.size] = Math.max(0, product.sizes[item.size] - item.qty);
    }
    if (appliedCoupon) {
      const coupon = db.coupons.find(c => c.code === appliedCoupon);
      if (coupon) coupon.usedCount = (coupon.usedCount || 0) + 1;
    }
    order.status = 'cod';
    await writeDB(db);
    return res.json({ ok: true, orderId, cod: true });
  }

  // No Razorpay keys configured: simulate instant "payment" so you can test
  // the full flow (stock deduction, order appearing in admin) without keys.
  if (!razorpay) {
    return confirmOrderPaid(orderId, res, { simulated: true });
  }

  try {
    const amountInPaise = Math.round(order.total * 100);
    const rpOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: orderId
    });

    order.razorpayOrderId = rpOrder.id;
    await writeDB(db);

    res.json({
      orderId,
      razorpayOrderId: rpOrder.id,
      amount: amountInPaise,
      currency: 'INR',
      keyId: RAZORPAY_KEY_ID,
      customer
    });
  } catch (err) {
    console.error('Razorpay error:', JSON.stringify(err, null, 2));
    const description = err?.error?.description || err?.message || 'Unknown error';
    res.status(500).json({ error: `Payment order could not be created: ${description}` });
  }
});

async function confirmOrderPaid(orderId, res, opts = {}) {
  const db = await readDB();
  const order = db.orders.find(o => o.id === orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status === 'pending') {
    // Deduct stock now that payment is confirmed
    for (const item of order.items) {
      const product = db.products.find(p => p.id === item.productId);
      if (product) product.sizes[item.size] = Math.max(0, product.sizes[item.size] - item.qty);
    }
    if (order.couponCode) {
      const coupon = db.coupons.find(c => c.code === order.couponCode);
      if (coupon) coupon.usedCount = (coupon.usedCount || 0) + 1;
    }
    order.status = 'paid';
    await writeDB(db);
  }
  res.json({ ok: true, orderId, simulated: !!opts.simulated });
}

// Client calls this after the Razorpay checkout popup succeeds, passing back
// the payment id/order id/signature Razorpay gave it, so we can verify the
// payment is genuine before marking the order paid and deducting stock.
app.post('/api/checkout/confirm', async (req, res) => {
  const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

  if (razorpay && razorpay_order_id) {
    if (!razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment verification fields' });
    }
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment signature could not be verified' });
    }
  }
  await confirmOrderPaid(orderId, res);
});

app.post('/api/checkout/cancel', async (req, res) => {
  const { orderId } = req.body;
  const db = await readDB();
  const order = db.orders.find(o => o.id === orderId);
  if (order && order.status === 'pending') {
    order.status = 'cancelled';
    await writeDB(db);
  }
  res.json({ ok: true });
});

// ---------- Admin auth ----------

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Wrong password' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/session', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// ---------- Admin: orders ----------

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  const db = await readDB();
  res.json(db.orders.slice().reverse());
});

app.post('/api/admin/orders/:id/fulfill', requireAdmin, async (req, res) => {
  const db = await readDB();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  order.status = 'fulfilled';
  await writeDB(db);
  res.json(order);
});

// ---------- Admin: products & inventory ----------

app.post('/api/admin/products', requireAdmin, async (req, res) => {
  const db = await readDB();
  const { name, team, price, image, description, sizes, category, customizable } = req.body;
  if (!name || !team || !price) return res.status(400).json({ error: 'Missing fields' });
  const product = {
    id: crypto.randomUUID(),
    name, team,
    category: category || 'new-season',
    customizable: !!customizable,
    price: Number(price),
    image: image || '',
    description: description || '',
    sizes: sizes || { S: 0, M: 0, L: 0, XL: 0 }
  };
  db.products.push(product);
  await writeDB(db);
  res.json(product);
});

app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
  const db = await readDB();
  const product = db.products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });
  const { name, team, price, image, description, sizes, category, customizable } = req.body;
  if (name !== undefined) product.name = name;
  if (team !== undefined) product.team = team;
  if (category !== undefined) product.category = category;
  if (customizable !== undefined) product.customizable = !!customizable;
  if (price !== undefined) product.price = Number(price);
  if (image !== undefined) product.image = image;
  if (description !== undefined) product.description = description;
  if (sizes !== undefined) product.sizes = sizes;
  await writeDB(db);
  res.json(product);
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
  const db = await readDB();
  db.products = db.products.filter(p => p.id !== req.params.id);
  await writeDB(db);
  res.json({ ok: true });
});

// ---------- Admin: coupons ----------

app.get('/api/admin/coupons', requireAdmin, async (req, res) => {
  const db = await readDB();
  res.json(db.coupons || []);
});

app.post('/api/admin/coupons', requireAdmin, async (req, res) => {
  const db = await readDB();
  const { code, type, value, minOrder, usageLimit } = req.body;
  if (!code || !type || value == null) return res.status(400).json({ error: 'Missing fields' });
  if (!db.coupons) db.coupons = [];
  const normalizedCode = String(code).toUpperCase().trim();
  if (db.coupons.some(c => c.code === normalizedCode)) {
    return res.status(400).json({ error: 'A coupon with this code already exists' });
  }
  const coupon = {
    id: crypto.randomUUID(),
    code: normalizedCode,
    type: type === 'flat' ? 'flat' : 'percent',
    value: Number(value),
    minOrder: Number(minOrder) || 0,
    usageLimit: usageLimit ? Number(usageLimit) : null,
    usedCount: 0,
    active: true,
    createdAt: new Date().toISOString()
  };
  db.coupons.push(coupon);
  await writeDB(db);
  res.json(coupon);
});

app.put('/api/admin/coupons/:id', requireAdmin, async (req, res) => {
  const db = await readDB();
  const coupon = (db.coupons || []).find(c => c.id === req.params.id);
  if (!coupon) return res.status(404).json({ error: 'Not found' });
  const { active, value, minOrder, usageLimit } = req.body;
  if (active !== undefined) coupon.active = !!active;
  if (value !== undefined) coupon.value = Number(value);
  if (minOrder !== undefined) coupon.minOrder = Number(minOrder);
  if (usageLimit !== undefined) coupon.usageLimit = usageLimit ? Number(usageLimit) : null;
  await writeDB(db);
  res.json(coupon);
});

app.delete('/api/admin/coupons/:id', requireAdmin, async (req, res) => {
  const db = await readDB();
  db.coupons = (db.coupons || []).filter(c => c.id !== req.params.id);
  await writeDB(db);
  res.json({ ok: true });
});

// Vercel imports this file and calls the exported app directly as a
// serverless function — it never runs the code below this point, so
// app.listen() is skipped automatically there (the VERCEL env var is set
// by Vercel's platform). On Render, or when running locally with
// "npm start", this starts a normal persistent server as usual.
if (!process.env.VERCEL) {
  initDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Jersey store running at http://localhost:${PORT}`);
        console.log(`Admin panel at http://localhost:${PORT}/admin.html`);
      });
    })
    .catch(err => {
      console.error('❌ Failed to initialize database:', err.message);
      process.exit(1);
    });
}

module.exports = app;
