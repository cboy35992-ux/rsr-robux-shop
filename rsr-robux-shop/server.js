require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const DEFAULT_FILE = path.join(DATA_DIR, 'default-store.json');
const UPLOAD_DIR = path.join(ROOT, 'public', 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(STORE_FILE)) fs.copyFileSync(DEFAULT_FILE, STORE_FILE);

function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); }
  catch { return JSON.parse(fs.readFileSync(DEFAULT_FILE, 'utf8')); }
}
function writeStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}
function id(prefix) { return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`; }
function sanitizeUser(user) { const { passwordHash, ...safe } = user; return safe; }
function tokenFor(user) { return jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '7d' }); }
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Please log in first.' });
  try { req.auth = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Your session expired. Please log in again.' }); }
}
function adminOnly(req, res, next) {
  if (req.auth?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_, file, cb) => cb(null, /^image\//.test(file.mimetype)) });

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(ROOT, 'public')));

function ensureAdmin() {
  const store = readStore();
  const email = (process.env.ADMIN_EMAIL || 'admin@rsrshop.com').toLowerCase();
  if (!store.users.some(u => u.role === 'admin')) {
    store.users.push({
      id: id('usr'), name: 'RSR Administrator', email,
      passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Admin123!', 10),
      role: 'admin', createdAt: new Date().toISOString()
    });
    writeStore(store);
  }
}
ensureAdmin();

app.get('/api/config', (req, res) => {
  const s = readStore().settings;
  res.json({ ...s, shopName: process.env.SHOP_NAME || s.shopName, contactEmail: process.env.CONTACT_EMAIL || s.contactEmail, contactPhone: process.env.CONTACT_PHONE || s.contactPhone, facebookUrl: process.env.FACEBOOK_URL || s.facebookUrl, businessLocation: process.env.BUSINESS_LOCATION || s.businessLocation });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6) return res.status(400).json({ error: 'Enter a name, valid email, and password with at least 6 characters.' });
  const store = readStore();
  if (store.users.some(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ error: 'That email is already registered.' });
  const user = { id: id('usr'), name: name.trim(), email: email.trim().toLowerCase(), passwordHash: await bcrypt.hash(password, 10), role: 'customer', createdAt: new Date().toISOString() };
  store.users.push(user); writeStore(store);
  res.status(201).json({ token: tokenFor(user), user: sanitizeUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = readStore().users.find(u => u.email.toLowerCase() === String(email || '').toLowerCase());
  if (!user || !(await bcrypt.compare(String(password || ''), user.passwordHash))) return res.status(401).json({ error: 'Incorrect email or password.' });
  res.json({ token: tokenFor(user), user: sanitizeUser(user) });
});


app.get('/api/roblox/user/:username', async (req, res) => {
  const username = String(req.params.username || '').trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Enter a valid Roblox username.' });
  }
  try {
    const userResponse = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
    });
    if (!userResponse.ok) throw new Error('Roblox user lookup failed');
    const userData = await userResponse.json();
    const user = userData.data?.[0];
    if (!user) return res.status(404).json({ error: 'Roblox account not found. Check the username and try again.' });

    let avatarUrl = '';
    try {
      const avatarResponse = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${user.id}&size=150x150&format=Png&isCircular=false`);
      if (avatarResponse.ok) {
        const avatarData = await avatarResponse.json();
        avatarUrl = avatarData.data?.[0]?.imageUrl || '';
      }
    } catch {}

    res.json({
      user: {
        id: String(user.id),
        username: user.name,
        displayName: user.displayName || user.name,
        avatarUrl,
        profileUrl: `https://www.roblox.com/users/${user.id}/profile`
      }
    });
  } catch (error) {
    console.error('Roblox verification error:', error.message);
    res.status(502).json({ error: 'Roblox verification is temporarily unavailable. Please try again.' });
  }
});



app.post('/api/roblox/game/verify', async (req, res) => {
  const gameLink = String(req.body.gameLink || '').trim();
  const match = gameLink.match(/roblox\.com\/(?:games|share)\/(?:g\/)?(\d+)/i) || gameLink.match(/(?:placeId=|games\/)(\d+)/i);
  const placeId = match?.[1];
  if (!placeId) return res.status(400).json({ error: 'Enter a valid Roblox game link containing a Place ID.' });
  try {
    const universeResponse = await fetch(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
    if (!universeResponse.ok) return res.status(404).json({ error: 'Roblox game not found or unavailable.' });
    const { universeId } = await universeResponse.json();
    if (!universeId) return res.status(404).json({ error: 'Roblox game not found.' });

    const gameResponse = await fetch(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
    if (!gameResponse.ok) throw new Error('Game details lookup failed');
    const game = (await gameResponse.json()).data?.[0];
    if (!game) return res.status(404).json({ error: 'Roblox game details could not be found.' });

    let iconUrl = '';
    try {
      const iconResponse = await fetch(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`);
      if (iconResponse.ok) iconUrl = (await iconResponse.json()).data?.[0]?.imageUrl || '';
    } catch {}

    res.json({ game: {
      placeId: String(placeId), universeId: String(universeId), name: game.name,
      description: game.description || '', creatorName: game.creator?.name || '',
      creatorId: String(game.creator?.id || ''), iconUrl,
      gameUrl: `https://www.roblox.com/games/${placeId}`
    }});
  } catch (error) {
    console.error('Roblox game verification error:', error.message);
    res.status(502).json({ error: 'Roblox game verification is temporarily unavailable. Please try again.' });
  }
});

app.get('/api/me', auth, (req, res) => {
  const user = readStore().users.find(u => u.id === req.auth.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: sanitizeUser(user) });
});

app.get('/api/orders', auth, (req, res) => {
  const store = readStore();
  const orders = req.auth.role === 'admin' ? store.orders : store.orders.filter(o => o.userId === req.auth.id);
  res.json({ orders: orders.sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)) });
});

app.post('/api/orders', auth, upload.single('receipt'), async (req, res) => {
  const required = ['method','robloxUsername','robuxAmount','paymentMethod'];
  if (required.some(k => !req.body[k])) return res.status(400).json({ error: 'Please complete every required checkout field.' });
  const amount = Number(req.body.robuxAmount);
  if (!Number.isFinite(amount) || amount < 50) return res.status(400).json({ error: 'Minimum order is 50 Robux.' });
  if (!req.file && !req.body.referenceNumber) return res.status(400).json({ error: 'Upload a receipt or enter a payment reference number.' });
  if (req.body.method === 'gifting' && !req.body.gameDetails) return res.status(400).json({ error: 'Verify the Roblox game before submitting a gifting order.' });
  const store = readStore();
  const rate = Number(store.settings.rates[req.body.method] || 0.45);
  const order = {
    id: id('RSR'), orderNo: `RSR-${Date.now().toString().slice(-8)}`, userId: req.auth.id,
    method: req.body.method, robloxUsername: req.body.robloxUsername.trim(),
    robloxUserId: req.body.robloxUserId?.trim() || '', gamepassLinks: JSON.parse(req.body.gamepassLinks || '[]'),
    gameLink: req.body.gameLink?.trim() || '', gameDetails: JSON.parse(req.body.gameDetails || 'null'),
    coveredGamepassAmount: req.body.method === 'covered' ? Math.ceil(amount / 0.7) : null,
    robuxAmount: amount, totalPhp: Math.round(amount * rate * 100) / 100,
    paymentMethod: req.body.paymentMethod, referenceNumber: req.body.referenceNumber?.trim() || '',
    receiptUrl: req.file ? `/uploads/${req.file.filename}` : '', notes: req.body.notes?.trim() || '',
    status: 'Pending Review', adminNote: '', deliveryProofUrl: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  store.orders.push(order); writeStore(store);
  if (process.env.DISCORD_WEBHOOK_URL) {
    fetch(process.env.DISCORD_WEBHOOK_URL, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ content:`🛒 New order **${order.orderNo}** — ${amount.toLocaleString()} Robux via ${order.method}.` }) }).catch(()=>{});
  }
  res.status(201).json({ order });
});

app.get('/api/admin/stats', auth, adminOnly, (req, res) => {
  const orders = readStore().orders;
  const completed = orders.filter(o => o.status === 'Completed');
  res.json({
    totalOrders: orders.length,
    pending: orders.filter(o => ['Pending Review','Payment Verified','Processing'].includes(o.status)).length,
    completed: completed.length,
    revenue: completed.reduce((sum,o) => sum + Number(o.totalPhp || 0), 0),
    robuxDelivered: completed.reduce((sum,o) => sum + Number(o.robuxAmount || 0), 0)
  });
});

app.patch('/api/admin/orders/:id', auth, adminOnly, upload.single('deliveryProof'), (req, res) => {
  const store = readStore();
  const order = store.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (req.body.status) order.status = req.body.status;
  if (req.body.adminNote !== undefined) order.adminNote = req.body.adminNote;
  if (req.file) order.deliveryProofUrl = `/uploads/${req.file.filename}`;
  order.updatedAt = new Date().toISOString(); writeStore(store);
  res.json({ order });
});

app.get('/api/admin/settings', auth, adminOnly, (req, res) => res.json({ settings: readStore().settings }));
app.put('/api/admin/settings', auth, adminOnly, (req, res) => {
  const store = readStore();
  const allowed = ['shopName','tagline','announcement','contactEmail','contactPhone','facebookUrl','businessLocation','gcashName','gcashNumber','mayaName','mayaNumber','gotymeName','gotymeNumber','rates'];
  for (const k of allowed) if (req.body[k] !== undefined) store.settings[k] = req.body[k];
  writeStore(store); res.json({ settings: store.settings });
});

app.get('*', (_, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5 MB or smaller.' : err.message });
  console.error(err); res.status(500).json({ error: 'Something went wrong.' });
});
app.listen(PORT, () => console.log(`RSR Shop running on port ${PORT}`));
