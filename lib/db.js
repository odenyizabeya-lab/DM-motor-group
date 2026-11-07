'use strict';
/* DM Motor Group — data layer (Node built-in SQLite, zero dependencies) */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(__dirname, '..', 'uploads'), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'dm.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

/* ---------- schema ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'customer',           -- admin | manager | viewer | customer
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reset_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',            -- draft | published | reserved | sold
  brand TEXT NOT NULL, model TEXT NOT NULL, year INTEGER NOT NULL,
  price REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
  mileage INTEGER NOT NULL DEFAULT 0,
  engine TEXT DEFAULT '', transmission TEXT DEFAULT '', fuel TEXT DEFAULT '',
  body_type TEXT DEFAULT '', exterior_color TEXT DEFAULT '', interior_color TEXT DEFAULT '',
  vin TEXT DEFAULT '', condition TEXT NOT NULL DEFAULT 'Used',
  registration TEXT DEFAULT '', location TEXT DEFAULT '',
  description TEXT DEFAULT '',
  features TEXT NOT NULL DEFAULT '[]',             -- JSON array
  safety_features TEXT NOT NULL DEFAULT '[]',      -- JSON array
  ownership_info TEXT DEFAULT '',                  -- verified ownership history (dealership-supplied)
  inspection_status TEXT NOT NULL DEFAULT 'none',  -- none | dealership_inspected | third_party_inspected
  inspection_report TEXT DEFAULT '',
  category TEXT NOT NULL DEFAULT 'sedan',          -- featured grouping: suv|sedan|sports|electric|luxury|truck|family
  is_featured INTEGER NOT NULL DEFAULT 0,
  cover_media_id INTEGER,                          -- FK set when cover chosen
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_brand ON vehicles(brand);
CREATE INDEX IF NOT EXISTS idx_vehicles_category ON vehicles(category);
CREATE INDEX IF NOT EXISTS idx_vehicles_price ON vehicles(price);
CREATE INDEX IF NOT EXISTS idx_vehicles_year ON vehicles(year);
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                              -- image | video
  url TEXT NOT NULL,
  thumb_url TEXT DEFAULT '',
  caption TEXT DEFAULT '',
  category TEXT DEFAULT 'exterior',                -- exterior|interior|engine|dashboard|boot|wheel|damage|video
  position INTEGER NOT NULL DEFAULT 0,
  is_video_cover INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_media_vehicle ON media(vehicle_id, position);
CREATE TABLE IF NOT EXISTS enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'question',           -- price|question|pictures|videos|inspection|testdrive|delivery|purchase|whatsapp
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',              -- new | in_progress | responded | closed
  admin_notes TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_enquiries_status ON enquiries(status);
CREATE TABLE IF NOT EXISTS favourites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, vehicle_id)
);
CREATE TABLE IF NOT EXISTS testimonials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, location TEXT DEFAULT '', rating INTEGER NOT NULL DEFAULT 5,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | approved
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, subtitle TEXT DEFAULT '',
  image TEXT DEFAULT '', link TEXT DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT DEFAULT '',
  link TEXT DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/* ---------- query helpers ---------- */
const q = {
  all(sql, ...p) { return db.prepare(sql).all(...p); },
  get(sql, ...p) { return db.prepare(sql).get(...p); },
  run(sql, ...p) { return db.prepare(sql).run(...p); },
};
const jparse = (s, d = []) => { try { return JSON.parse(s); } catch { return d; } };

/* ---------- auth primitives (built-in crypto, no deps) ---------- */
function secret() {
  const f = path.join(DATA_DIR, 'secret.key');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s);
  return s;
}
const hashPassword = (pw) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(String(pw), salt, 64).toString('hex');
};
const verifyPassword = (pw, stored) => {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
};
const signToken = (payload) => {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + sig;
};
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p.exp || Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}

function logActivity(actor, action, detail = '') {
  q.run('INSERT INTO activities (actor, action, detail) VALUES (?,?,?)', actor, action, detail);
}

module.exports = { db, q, jparse, hashPassword, verifyPassword, signToken, verifyToken, logActivity };
