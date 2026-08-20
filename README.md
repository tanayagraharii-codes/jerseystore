# Matchday Kits — Football Jersey Store

A self-contained store: product catalog with per-size stock, name/number
customization, coupon codes, a shopping cart, Razorpay checkout (online +
Cash on Delivery), order tracking, and a password-protected admin dashboard.

## What's included

- **Storefront** (`public/index.html`) — browse by team/category, pick a size, customize where offered, apply a coupon code, add to cart, check out
- **Order tracking** (`public/track-order.html`) — customers look up their own order status with order ID + email, no account needed
- **Admin dashboard** (`public/admin.html`) — view orders, mark them fulfilled, edit stock counts, add new products, create/manage coupon codes
- **Backend** (`server.js`) — Express server/serverless function handling products, checkout, coupons, tracking, and admin routes
- **Storage** (`db.js`) — uses MongoDB Atlas (free tier) when configured. Falls back to a local JSON file if you haven't set up MongoDB yet, purely for quick local testing — this fallback does **not** persist on Render or Vercel.

## 1. Install

You'll need [Node.js](https://nodejs.org) (v18 or later) installed.

```bash
cd jersey-store
npm install
```

## 2. Configure

```bash
cp .env.example .env
```

Open `.env` and set:
- `ADMIN_PASSWORD` — the password you'll use to log into `/admin.html`
- `SESSION_SECRET` — any long random string
- `MONGODB_URI` — see the walkthrough below. **This is required if you're deploying to Vercel** (not just recommended) — without it, admin login won't work correctly on serverless.
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — leave both blank at first to test the whole flow without real payments. When ready, get **Test Mode** keys from your [Razorpay dashboard](https://dashboard.razorpay.com/app/keys) — test everything with those first, then switch to **Live Mode** keys once checkout works end-to-end.

### Setting up MongoDB Atlas (free, ~5 minutes)

1. Go to [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas) and sign up (free)
2. Create a new **free (M0) cluster** — accept the defaults
3. Under **Database Access**, create a database user — click **Autogenerate Secure Password** and copy it immediately (it's only shown once)
4. Under **Network Access**, click **Add IP Address** → **Allow access from anywhere** (`0.0.0.0/0`)
5. Go to your cluster → **Connect** → **Drivers** → copy the connection string, e.g.:
   ```
   mongodb+srv://yourusername:yourpassword@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
6. Make sure the password is substituted in with **no `<` or `>` characters** left over — those are placeholder markers, not literal characters
7. Paste the whole thing into `.env` as `MONGODB_URI=...`

## 3. Run it locally

```bash
npm start
```

Check the startup log — you should see `✅ Connected to MongoDB` if your `MONGODB_URI` is working.

- Storefront: http://localhost:3000
- Admin panel: http://localhost:3000/admin.html
- Track an order: http://localhost:3000/track-order.html

## 4. Managing your store

**Adding products**: Admin panel → Inventory tab → "+ Add product".

**Adjusting stock**: Inventory tab, edit the S/M/L/XL numbers, click Save.

**Orders**: Orders tab shows every order with status (`pending` → `paid`/`cod` → `fulfilled`, or `cancelled`). Stock is deducted once paid (or immediately for Cash on Delivery). Click "Mark fulfilled" once shipped.

**Customers can track their own orders** at `/track-order.html` using their order ID and checkout email.

**Coupon codes**: Admin panel → Coupons tab → "+ Add coupon". Percentage or flat ₹ off, optional minimum order, optional usage limit. The discount is always recalculated server-side at checkout, so nothing can be tampered with client-side.

## 5. Taking real payments

Once you've added your Razorpay keys, checkout opens Razorpay's hosted payment popup. In **Test Mode**, use card `4111 1111 1111 1111` (any future expiry, any CVC) or UPI ID `success@razorpay`. Full test credentials: https://razorpay.com/docs/payments/payments/test-card-upi-details/

To go live: complete Razorpay's KYC/activation, then switch your `.env` keys from Test Mode to Live Mode — and **double-check** you're not accidentally using a `rzp_live_...` key while still testing, since that processes real money.

## 6. Deploying

You have two good options. Both need your GitHub repo set up first.

### Getting your code onto GitHub

1. Create a repo at [github.com](https://github.com)
2. Easiest path: install [GitHub Desktop](https://desktop.github.com), **File → Add Local Repository**, select this folder, commit, and publish. It automatically respects `.gitignore`, so `node_modules` and `.env` never get uploaded.
3. If using the website's drag-and-drop upload instead, only drag in the files listed under "What's included" above plus `package.json`, `package-lock.json`, `.gitignore`, and `.env.example` — **never** `node_modules` (GitHub's uploader can't handle that many files) or your real `.env`.

### Option A: Render (simpler, recommended for this app)

1. [render.com](https://render.com) → **New → Web Service** → connect your repo
2. Build command: `npm install` — Start command: `npm start`
3. Add environment variables: `ADMIN_PASSWORD`, `SESSION_SECRET`, `MONGODB_URI`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
4. Deploy, then set `DOMAIN` to your live Render URL
5. Free tier sleeps after inactivity (~50s wake-up delay for the next visitor) — upgrade to the Starter plan (~$7/month) to remove this if it matters for your launch

### Option B: Vercel

This app runs as a serverless function on Vercel via the included `vercel.json`. **`MONGODB_URI` is required**, not optional, when deploying here — admin login sessions are stored in MongoDB specifically so they survive across Vercel's stateless function invocations.

1. [vercel.com](https://vercel.com) → **Add New → Project** → import your GitHub repo
2. Vercel should auto-detect the Node.js setup from `vercel.json` — no build command needed
3. Add the same environment variables under **Settings → Environment Variables**: `ADMIN_PASSWORD`, `SESSION_SECRET`, `MONGODB_URI`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
4. Deploy, then set `DOMAIN` to your live Vercel URL
5. Vercel doesn't sleep the way Render's free tier does — cold starts add a small delay only after long inactivity, and are much shorter

## 7. Connecting to Instagram

Once your store is live at a real domain:
1. Set up a [Meta Business Suite](https://business.facebook.com) account and link your Instagram as a Business account
2. In **Commerce Manager**, create a catalog and add your products
3. Once approved, tag products in Instagram posts/Reels and run Shopping ads linking to your live site
4. Add the Meta Pixel snippet to `public/index.html`'s `<head>` to track visitors and build retargeting ads

## A note on licensing

If selling officially branded jerseys (club crests, league/manufacturer logos), that generally requires a licensing agreement with the brand or league — unlicensed replicas can carry legal risk, and Meta will also reject ads for counterfeit goods.
