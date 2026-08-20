// Storage layer: uses MongoDB Atlas when MONGODB_URI is set (this is what
// makes your data survive server restarts/redeploys on Render — Render's
// free-tier disk is wiped on every restart, but a real database is not).
// Falls back to a local JSON file when no MONGODB_URI is set, purely so you
// can run/test the store on your own machine without setting up Mongo.

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const DB_PATH = path.join(__dirname, 'data', 'db.json');
const MONGODB_URI = process.env.MONGODB_URI || '';

let mongoClient = null;
let collection = null;
let connectPromise = null; // caches the in-flight/completed connection so a
                            // warm serverless instance doesn't reconnect on
                            // every single request

function seed() {
  return {
    products: [
      {
        id: 'p1',
        name: 'Home Kit 25/26',
        team: 'Red United',
        category: 'new-season',
        price: 2499,
        image: 'https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=600',
        description: 'Official-style home shirt, breathable mesh panels.',
        sizes: { S: 12, M: 20, L: 15, XL: 8 }
      },
      {
        id: 'p2',
        name: 'Away Kit 25/26',
        team: 'Red United',
        category: 'new-season',
        price: 2499,
        image: 'https://images.unsplash.com/photo-1602293589930-45aad59ba3ab?w=600',
        description: 'Away colours, same fit and fabric as the home shirt.',
        sizes: { S: 10, M: 14, L: 10, XL: 6 }
      },
      {
        id: 'p3',
        name: 'Home Kit 25/26',
        team: 'Blue Athletic',
        category: 'new-season',
        price: 2699,
        image: 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=600',
        description: 'Classic stripes, embroidered crest.',
        sizes: { S: 8, M: 16, L: 12, XL: 5 }
      },
      {
        id: 'p4',
        name: 'Third Kit 25/26',
        team: 'Blue Athletic',
        category: 'sale',
        price: 2299,
        image: 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=600',
        description: 'Limited third strip. Clearance pricing.',
        sizes: { S: 6, M: 9, L: 7, XL: 4 }
      },
      {
        id: 'p5',
        name: 'Retro Kit 1998',
        team: 'Red United',
        category: 'retro',
        price: 1999,
        image: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600',
        description: 'Vintage-cut throwback shirt from the treble-winning era.',
        sizes: { S: 5, M: 10, L: 8, XL: 3 }
      },
      {
        id: 'p6',
        name: 'Retro Kit 1992',
        team: 'Blue Athletic',
        category: 'retro',
        price: 1999,
        image: 'https://images.unsplash.com/photo-1511886929837-354d827aae26?w=600',
        description: 'Classic collar, boxy vintage fit.',
        sizes: { S: 4, M: 8, L: 6, XL: 2 }
      },
      {
        id: 'p7',
        name: 'Home Kit 25/26 — Name & Number',
        team: 'Red United',
        category: 'customized',
        customizable: true,
        price: 2999,
        image: 'https://images.unsplash.com/photo-1543326727-cf6c39e8f84c?w=600',
        description: 'Same home kit, printed with your name and number at checkout.',
        sizes: { S: 10, M: 15, L: 12, XL: 6 }
      },
      {
        id: 'p8',
        name: 'Away Kit 24/25',
        team: 'Blue Athletic',
        category: 'sale',
        price: 1799,
        image: 'https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?w=600',
        description: "Last season's away kit — clearance priced.",
        sizes: { S: 7, M: 11, L: 9, XL: 4 }
      }
    ],
    orders: [],
    coupons: [
      {
        id: 'c1',
        code: 'WELCOME10',
        type: 'percent',
        value: 10,
        minOrder: 0,
        usageLimit: null,
        usedCount: 0,
        active: true,
        createdAt: new Date().toISOString()
      }
    ]
  };
}

function ensureFileDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(seed(), null, 2));
  }
}

// Safe to call on every request — only actually connects once per warm
// process, thanks to connectPromise caching. This is what makes the app work
// correctly both as a long-running server (Render) and as serverless
// functions (Vercel), where a fresh request might reuse a warm instance that
// already has a live connection.
async function initDB() {
  if (!MONGODB_URI) {
    if (!connectPromise) {
      console.warn("⚠️  MONGODB_URI not set — using local file storage. This is fine for testing on your own machine, but data will NOT persist on serverless platforms like Vercel, or on Render's free tier. Set MONGODB_URI in your environment for production use.");
      ensureFileDB();
      connectPromise = Promise.resolve();
    }
    return connectPromise;
  }
  if (!connectPromise) {
    connectPromise = (async () => {
      mongoClient = new MongoClient(MONGODB_URI);
      await mongoClient.connect();
      collection = mongoClient.db('jerseystore').collection('store');
      const existing = await collection.findOne({ _id: 'main' });
      if (!existing) {
        await collection.insertOne({ _id: 'main', ...seed() });
      }
      console.log('✅ Connected to MongoDB — inventory and orders will persist across restarts.');
    })();
  }
  return connectPromise;
}

async function readDB() {
  if (collection) {
    const doc = await collection.findOne({ _id: 'main' });
    const { _id, ...data } = doc;
    return data;
  }
  ensureFileDB();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

async function writeDB(data) {
  if (collection) {
    await collection.updateOne({ _id: 'main' }, { $set: data }, { upsert: true });
    return;
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = { initDB, readDB, writeDB };
