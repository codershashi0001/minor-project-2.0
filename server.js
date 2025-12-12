import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import fetch from 'node-fetch';
import { upsertUser, getUserById, addFavourite, removeFavourite, listFavourites, getUserByEmail, createUser, addDownload, listDownloads, listAllUsers } from './db.js';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(morgan('dev'));
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

// Load gallery data (fallback)
const dataPath = path.join(__dirname, 'data', 'gallery.json');
function loadLocalItems() {
  try {
    const raw = fs.readFileSync(dataPath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

// Harvard Art Museums API
const HARVARD_API_KEY = process.env.HARVARD_API_KEY || '0898278e-ca69-43ce-9901-510a9dfc7512';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

function signToken(userId) {
  return jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: '7d' });
}
async function fetchHarvardItems() {
  const params = new URLSearchParams({
    apikey: HARVARD_API_KEY,
    size: '24',
    hasimage: '1',
    q: 'clock OR watch OR time OR chronometer',
    fields: 'id,title,dated,creditline,primaryimageurl,people,century,period,division,description',
    sort: 'random'
  });
  const url = `https://api.harvardartmuseums.org/object?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Harvard API error');
  const json = await res.json();
  const records = Array.isArray(json.records) ? json.records : [];
  return records
    .filter(r => r && r.primaryimageurl)
    .map((r) => ({
      id: r.id,
      title: r.title || 'Untitled',
      year: r.dated || r.period || r.century || 'Unknown',
      description: r.description || r.creditline || 'Artifact from Harvard Art Museums.',
      imageUrl: r.primaryimageurl
    }));
}

async function fetchHarvardItemById(objectId) {
  try {
    const url = `https://api.harvardartmuseums.org/object/${objectId}?apikey=${HARVARD_API_KEY}&fields=id,title,dated,primaryimageurl`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || !j.primaryimageurl) return null;
    return {
      id: j.id,
      title: j.title || `image_${objectId}`,
      year: j.dated || 'Unknown',
      imageUrl: j.primaryimageurl,
    };
  } catch {
    return null;
  }
}

function ensureUser(req, res, next) {
  let uid = null;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length);
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      uid = decoded.uid;
    } catch {}
  }
  if (!uid) uid = req.cookies.uid || req.header('x-user-id');
  if (!uid) return res.status(401).json({ error: 'Not authenticated' });
  const user = getUserById(Number(uid));
  if (!user) return res.status(401).json({ error: 'Invalid user' });
  req.user = user;
  next();
}

// Auth (mock login)
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const user = getUserByEmail(String(email).toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = user.password_hash ? bcrypt.compareSync(password, user.password_hash) : false;
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  try { app.locals?.db?.prepare?.("UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")?.run(user.id); } catch {}
  const token = signToken(user.id);
  res.cookie('uid', user.id, { httpOnly: false, sameSite: 'lax' });
  res.json({ token, user: { uid: user.id, username: user.username, email: user.email, name: user.name, mobile: user.mobile } });
});

app.post('/api/signup', (req, res) => {
  const { name, email, mobile, phone, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
  const emailLc = String(email).toLowerCase();
  const existing = getUserByEmail(emailLc);
  if (existing) return res.status(409).json({ error: 'Email already registered' });
  const username = emailLc.split('@')[0];
  const passwordHash = bcrypt.hashSync(password, 10);
  const user = createUser({ username, name, email: emailLc, mobile: mobile || null, phone: phone || null, passwordHash, provider: 'local' });
  const token = signToken(user.id);
  res.cookie('uid', user.id, { httpOnly: false, sameSite: 'lax' });
  res.json({ token, user: { uid: user.id, username: user.username, email } });
});

// Current user info
app.get('/api/me', (req, res) => {
  const uid = req.cookies.uid || req.header('x-user-id');
  if (!uid) return res.json({ user: null });
  const user = getUserById(Number(uid));
  if (!user) return res.json({ user: null });
  res.json({ user });
});

// Logout
app.post('/api/logout', (req, res) => {
  res.clearCookie('uid');
  res.json({ ok: true });
});

// Google login
app.post('/api/google-login', async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!googleClient || !credential) return res.status(400).json({ error: 'Google login not configured' });
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = payload.email;
    const name = payload.name || payload.given_name || '';
    if (!email) return res.status(400).json({ error: 'Email missing' });
    let user = getUserByEmail(email);
    if (!user) {
      const username = email.split('@')[0];
      user = createUser({ username, name, email, mobile: '', phone: '', passwordHash: '', avatarUrl: payload.picture || '', provider: 'google' });
    }
    try { app.locals?.db?.prepare?.("UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")?.run(user.id); } catch {}
    const token = signToken(user.id);
    res.cookie('uid', user.id, { httpOnly: false, sameSite: 'lax' });
    res.json({ token, user: { uid: user.id, email, name } });
  } catch (e) {
    res.status(401).json({ error: 'Google authentication failed' });
  }
});

// Public config for frontend
app.get('/api/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

// Items
app.get('/api/items', async (req, res) => {
  try {
    const externalItems = await fetchHarvardItems();
    if (externalItems && externalItems.length) {
      return res.json(externalItems);
    }
  } catch (e) {
    // fall back to local
  }
  const items = loadLocalItems();
  res.json(items);
});

// Single item by id (local or Harvard)
app.get('/api/items/:id', async (req, res) => {
  const id = String(req.params.id);
  // try local first
  let item = loadLocalItems().find(i => String(i.id) === id);
  if (!item) {
    try { item = await fetchHarvardItemById(id); } catch {}
  }
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

// Favorites
app.get('/api/favorites', ensureUser, (req, res) => {
  const favs = listFavourites(req.user.id);
  res.json({ favorites: favs });
});

app.post('/api/favorites', ensureUser, (req, res) => {
  const { id, action } = req.body || {};
  if (!id || !action) return res.status(400).json({ error: 'id and action required' });
  if (action === 'add') addFavourite(req.user.id, id);
  if (action === 'remove') removeFavourite(req.user.id, id);
  res.json({ favorites: listFavourites(req.user.id) });
});

// Download proxy by id
app.get('/download/:id', async (req, res) => {
  const id = req.params.id;
  const items = loadLocalItems();
  let item = items.find(i => String(i.id) === String(id));
  if (!item) {
    item = await fetchHarvardItemById(id);
    if (!item) return res.status(404).send('Item not found');
  }
  try {
    const response = await fetch(item.imageUrl);
    if (!response.ok) {
      return res.status(502).send('Failed to fetch image');
    }
    const filename = (item.title || `image_${id}`).replace(/[^a-z0-9_\-]/gi, '_') + '.jpg';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
    response.body.pipe(res);
  } catch (e) {
    res.status(500).send('Error downloading image');
  }
});

// Record download with snapshot
app.get('/api/downloads', ensureUser, (req, res) => {
  res.json({ downloads: listDownloads(req.user.id) });
});

app.post('/api/downloads', ensureUser, (req, res) => {
  const { id, title, year, imageUrl } = req.body || {};
  if (!id || !imageUrl) return res.status(400).json({ error: 'id and imageUrl required' });
  addDownload(req.user.id, { id, title, year, imageUrl });
  res.json({ downloads: listDownloads(req.user.id) });
});

// Admin: Get all registered users (shows id, name, email, registration date, etc.)
app.get('/api/admin/users', (req, res) => {
  try {
    const users = listAllUsers();
    res.json({ users, count: users.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Static
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`CHRONOMUSIOUN server running on http://localhost:${PORT}`);
});


