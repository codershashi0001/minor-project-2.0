import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'app.db');
const db = new Database(dbPath);

// Initialize schema
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    name TEXT,
    email TEXT UNIQUE,
    mobile TEXT,
    phone TEXT,
    password_hash TEXT,
    avatar_url TEXT,
    provider TEXT,
    last_login_at TEXT,
    updated_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS favourites (
    user_id INTEGER NOT NULL,
    item_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, item_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_id TEXT NOT NULL,
    title TEXT,
    year TEXT,
    image_url TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Lightweight migration to add missing columns if the DB was created earlier
try {
  const cols = new Set(db.prepare("PRAGMA table_info(users)").all().map(c => c.name));
  const addCol = (name, type) => { if (!cols.has(name)) { try { db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`); cols.add(name); } catch {} } };
  addCol('name', 'TEXT');
  addCol('email', 'TEXT');
  addCol('mobile', 'TEXT');
  addCol('password_hash', 'TEXT');
  addCol('phone', 'TEXT');
  addCol('avatar_url', 'TEXT');
  addCol('provider', 'TEXT');
  addCol('last_login_at', 'TEXT');
  addCol('updated_at', 'TEXT');
} catch {}

export function upsertUser(username) {
  const insert = db.prepare('INSERT OR IGNORE INTO users(username) VALUES (?)');
  insert.run(username);
  const row = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
  return row;
}

export function getUserById(userId) {
  return db.prepare('SELECT id, username, name, email, mobile, phone, avatar_url, provider, last_login_at, created_at, updated_at FROM users WHERE id = ?').get(userId);
}

export function getUserByEmail(email) {
  return db.prepare('SELECT id, username, name, email, mobile, phone, password_hash, avatar_url, provider, last_login_at, created_at, updated_at FROM users WHERE email = ?').get(email);
}

export function createUser({ username, name, email, mobile, phone, passwordHash, avatarUrl, provider }) {
  const stmt = db.prepare('INSERT INTO users(username, name, email, mobile, phone, password_hash, avatar_url, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const info = stmt.run(username, name, email, mobile || phone || null, phone || mobile || null, passwordHash || '', avatarUrl || '', provider || 'local');
  return getUserById(info.lastInsertRowid);
}

export function addFavourite(userId, itemId) {
  db.prepare('INSERT OR IGNORE INTO favourites(user_id, item_id) VALUES (?, ?)').run(userId, String(itemId));
}

export function removeFavourite(userId, itemId) {
  db.prepare('DELETE FROM favourites WHERE user_id = ? AND item_id = ?').run(userId, String(itemId));
}

export function listFavourites(userId) {
  const rows = db.prepare('SELECT item_id FROM favourites WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  return rows.map(r => isNaN(r.item_id) ? r.item_id : Number(r.item_id));
}

export function addDownload(userId, item) {
  const { id, title, year, imageUrl } = item;
  db.prepare('INSERT INTO downloads(user_id, item_id, title, year, image_url) VALUES (?, ?, ?, ?, ?)')
    .run(userId, String(id), title || null, year || null, imageUrl || null);
}

export function listDownloads(userId) {
  return db.prepare('SELECT item_id as id, title, year, image_url as imageUrl, created_at FROM downloads WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId);
}

// Admin: List all registered users (without password_hash for security)
export function listAllUsers() {
  return db.prepare('SELECT id, username, name, email, mobile, phone, provider, created_at, last_login_at, updated_at FROM users ORDER BY created_at DESC').all();
}


