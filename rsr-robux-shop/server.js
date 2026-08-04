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
  let store;
  try { store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); }
  catch { store = JSON.parse(fs.readFileSync(DEFAULT_FILE, 'utf8')); }
  store.users ||= []; store.orders ||= []; store.messages ||= []; store.activityLogs ||= []; store.vouchSubmissions ||= []; store.settings ||= {}; store.settings.methods ||= {};
  return store;
}
function writeStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}
function id(prefix) { return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`; }
function sanitizeUser(user) { const { passwordHash, ...safe } = user; return safe; }
function logActivity(store, actor, action, details='') { store.activityLogs.push({ id:id('log'), actorId:actor?.id||'', actorName:actor?.name||actor?.email||'System', action, details, createdAt:new Date().toISOString() }); store.activityLogs=store.activityLogs.slice(-1000); }
function calculateOrder(settings, method, amount) { const rate=Number(settings.rates?.[method]||0); const totalPhp=Math.round(amount*rate*100)/100; return {subtotal:totalPhp,totalPhp}; }
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
  const email = String(process.env.ADMIN_EMAIL || 'admin@rsrshop.com').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || 'Admin123!');
  let admin = store.users.find(u => u.role === 'admin');

  if (!admin) {
    admin = {
      id: id('usr'), name: 'RSR Administrator', email,
      passwordHash: bcrypt.hashSync(password, 10),
      role: 'admin', createdAt: new Date().toISOString()
    };
    store.users.push(admin);
  } else {
    admin.email = email;
    admin.passwordHash = bcrypt.hashSync(password, 10);
    admin.name ||= 'RSR Administrator';
  }

  store.users = store.users.filter(u => u.id === admin.id || u.email.toLowerCase() !== email);
  writeStore(store);
}
ensureAdmin();

app.get('/api/config', (req, res) => {
  const s = readStore().settings;
  const publicSettings={...s}; res.json({ ...publicSettings, shopName: process.env.SHOP_NAME || s.shopName, contactEmail: process.env.CONTACT_EMAIL || s.contactEmail, contactPhone: process.env.CONTACT_PHONE || s.contactPhone, facebookUrl: process.env.FACEBOOK_URL || s.facebookUrl, businessLocation: process.env.BUSINESS_LOCATION || s.businessLocation });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6) return res.status(400).json({ error: 'Enter a name, valid email, and password with at least 6 characters.' });
  const store = readStore();
  if (store.users.some(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ error: 'That email is already registered.' });
  const user = { id: id('usr'), name: name.trim(), email: email.trim().toLowerCase(), passwordHash: await bcrypt.hash(password, 10), role: 'customer', referralCode: crypto.randomBytes(4).toString('hex').toUpperCase(), referredBy: String(req.body.referralCode||'').trim().toUpperCase(), createdAt: new Date().toISOString() };
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
  const raw = decodeURIComponent(String(req.params.username || '')).trim();
  const idMatch = raw.match(/roblox\.com\/users\/(\d+)/i) || raw.match(/^\d+$/);
  try {
    let user;
    if (idMatch) {
      const userId = idMatch[1] || idMatch[0];
      const response = await fetch(`https://users.roblox.com/v1/users/${userId}`);
      if (!response.ok) return res.status(404).json({ error: 'Roblox account not found.' });
      const data = await response.json();
      user = { id: data.id, name: data.name, displayName: data.displayName || data.name };
    } else {
      if (!/^[A-Za-z0-9_]{3,20}$/.test(raw)) return res.status(400).json({ error: 'Enter a Roblox username, user ID, or profile link.' });
      const response = await fetch('https://users.roblox.com/v1/usernames/users', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ usernames:[raw], excludeBannedUsers:false }) });
      if (!response.ok) throw new Error('Roblox user lookup failed');
      user = (await response.json()).data?.[0];
      if (!user) return res.status(404).json({ error: 'Roblox account not found. Check the username or link.' });
    }
    let avatarUrl = '';
    try {
      const avatarResponse = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${user.id}&size=150x150&format=Png&isCircular=false`);
      if (avatarResponse.ok) avatarUrl = (await avatarResponse.json()).data?.[0]?.imageUrl || '';
    } catch {}
    res.json({ user:{ id:String(user.id), username:user.name, displayName:user.displayName || user.name, avatarUrl, profileUrl:`https://www.roblox.com/users/${user.id}/profile` } });
  } catch (error) {
    console.error('Roblox verification error:', error.message);
    res.status(502).json({ error: 'Roblox verification is temporarily unavailable. Please try again.' });
  }
});

app.post('/api/roblox/gamepasses/verify', async (req, res) => {
  const links = Array.isArray(req.body.links) ? req.body.links : String(req.body.links || '').split(/\n|,/);
  const ids = links.map(x => String(x).trim()).filter(Boolean).map(x => (x.match(/(?:game-pass|gamepass)\/(\d+)/i) || x.match(/id=(\d+)/i) || x.match(/^(\d+)$/))?.[1]).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'Paste at least one valid gamepass link or ID.' });
  if (ids.length > 10) return res.status(400).json({ error: 'You can verify up to 10 gamepasses per order.' });
  try {
    const passes = [];
    for (const assetId of ids) {
      const response = await fetch(`https://economy.roblox.com/v2/assets/${assetId}/details`);
      if (!response.ok) return res.status(404).json({ error: `Gamepass ${assetId} could not be found or is unavailable.` });
      const d = await response.json();
      passes.push({ id:String(assetId), name:d.Name || `Gamepass ${assetId}`, price:Number(d.PriceInRobux || 0), creatorName:d.Creator?.Name || '', creatorId:String(d.Creator?.Id || ''), link:`https://www.roblox.com/game-pass/${assetId}` });
    }
    res.json({ passes, totalPrice:passes.reduce((sum,p)=>sum+p.price,0) });
  } catch (error) {
    console.error('Gamepass verification error:', error.message);
    res.status(502).json({ error: 'Gamepass verification is temporarily unavailable. Please try again.' });
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



app.post('/api/vouches', auth, (req,res)=>{
  const text=String(req.body.text||'').trim(); const rating=Math.max(1,Math.min(5,Number(req.body.rating)||5));
  if(text.length<10||text.length>500) return res.status(400).json({error:'Vouch must be 10–500 characters.'});
  const store=readStore(); const user=store.users.find(u=>u.id===req.auth.id);
  const item={id:id('vch'),userId:req.auth.id,name:user?.name||'Customer',text,rating,status:'Pending',createdAt:new Date().toISOString()};
  store.vouchSubmissions.push(item); logActivity(store,user,'Submitted vouch',item.id); writeStore(store); res.status(201).json({vouch:item});
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
  if (!req.file) return res.status(400).json({ error: 'Upload a clear payment receipt before submitting the order.' });
  if (req.body.method === 'gifting' && !req.body.gameDetails) return res.status(400).json({ error: 'Verify the Roblox game before submitting a gifting order.' });
  const store = readStore();
  if (store.settings.maintenanceMode && req.auth.role !== 'admin') return res.status(503).json({ error: 'Shop is currently in maintenance mode.' });
  const methodSettings=store.settings.methods?.[req.body.method];
  if (methodSettings && !methodSettings.enabled) return res.status(400).json({error:'This order method is currently unavailable.'});
  if (methodSettings && (amount<Number(methodSettings.min||0)||amount>Number(methodSettings.max||Infinity))) return res.status(400).json({error:`Allowed amount for this method is ${methodSettings.min}–${methodSettings.max} Robux.`});
  if (methodSettings && amount>Number(methodSettings.stock||0)) return res.status(400).json({error:'Not enough Robux stock for this order.'});
  const calc=calculateOrder(store.settings,req.body.method,amount);
  const order = {
    id: id('RSR'), orderNo: `RSR-${Date.now().toString().slice(-8)}`, userId: req.auth.id,
    method: req.body.method, robloxUsername: req.body.robloxUsername.trim(),
    robloxUserId: req.body.robloxUserId?.trim() || '', gamepassLinks: JSON.parse(req.body.gamepassLinks || '[]'),
    gameLink: req.body.gameLink?.trim() || '', gameDetails: JSON.parse(req.body.gameDetails || 'null'),
    gamepassDetails: JSON.parse(req.body.gamepassDetails || 'null'),
    coveredGamepassAmount: req.body.method === 'covered' ? Math.ceil(amount / 0.7) : null,
    robuxAmount: amount, subtotalPhp: calc.subtotal, totalPhp: calc.totalPhp,
    paymentMethod: req.body.paymentMethod,
    receiptUrl: `/uploads/${req.file.filename}`, receiptVerified:false, notes: req.body.notes?.trim() || '',
    status: 'Pending Review', adminNote: '', deliveryProofUrl: '',
    verification: { account:false, method:false, payment:false, stock:false, delivery:false },
    verificationLog: [{ step:'Order submitted', result:'Pending', actorName:'Customer', createdAt:new Date().toISOString() }],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  store.orders.push(order); if(methodSettings) methodSettings.stock=Math.max(0,Number(methodSettings.stock||0)-amount); logActivity(store,store.users.find(u=>u.id===req.auth.id),'Created order',order.orderNo); writeStore(store);
  if (process.env.DISCORD_WEBHOOK_URL) {
    fetch(process.env.DISCORD_WEBHOOK_URL, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ content:`🛒 New order **${order.orderNo}** — ${amount.toLocaleString()} Robux via ${order.method}.` }) }).catch(()=>{});
  }
  res.status(201).json({ order });
});

app.get('/api/chat', auth, (req, res) => {
  const store = readStore();
  const threadUserId = req.auth.role === 'admin' ? String(req.query.userId || '') : req.auth.id;
  if (req.auth.role === 'admin' && !threadUserId) {
    const threads = store.users.filter(u => u.role === 'customer').map(u => {
      const msgs = store.messages.filter(m => m.userId === u.id);
      return { user:sanitizeUser(u), lastMessage:msgs.at(-1) || null, unread:msgs.filter(m => m.senderRole === 'customer' && !m.readByAdmin).length };
    }).filter(t => t.lastMessage).sort((a,b)=>new Date(b.lastMessage.createdAt)-new Date(a.lastMessage.createdAt));
    return res.json({ threads });
  }
  const messages = store.messages.filter(m => m.userId === threadUserId).slice(-200);
  if (req.auth.role === 'admin') messages.forEach(m => m.readByAdmin = true); else messages.forEach(m => m.readByCustomer = true);
  writeStore(store);
  res.json({ messages });
});

app.post('/api/chat', auth, (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text || text.length > 1000) return res.status(400).json({ error: 'Message must be between 1 and 1,000 characters.' });
  const store = readStore();
  const userId = req.auth.role === 'admin' ? String(req.body.userId || '') : req.auth.id;
  if (!userId || !store.users.some(u => u.id === userId && u.role === 'customer')) return res.status(400).json({ error: 'Select a customer conversation first.' });
  const message = { id:id('msg'), userId, senderId:req.auth.id, senderRole:req.auth.role, senderName:store.users.find(u=>u.id===req.auth.id)?.name || 'RSR Support', subject:String(req.body.subject||'General Support').slice(0,120), text, createdAt:new Date().toISOString(), readByAdmin:req.auth.role==='admin', readByCustomer:req.auth.role==='customer' };
  store.messages.push(message); writeStore(store); res.status(201).json({ message });
});

app.get('/api/admin/stats', auth, adminOnly, (req, res) => {
  const orders = readStore().orders;
  const completed = orders.filter(o => o.status === 'Completed');
  res.json({
    totalOrders: orders.length,
    pending: orders.filter(o => ['Pending Review','Payment Verified','Processing'].includes(o.status)).length,
    completed: completed.length,
    revenue: completed.reduce((sum,o) => sum + Number(o.totalPhp || 0), 0),
    robuxDelivered: completed.reduce((sum,o) => sum + Number(o.robuxAmount || 0), 0), declined:orders.filter(o=>o.status==='Declined').length, customers:readStore().users.filter(u=>u.role==='customer').length
  });
});

app.patch('/api/admin/orders/:id', auth, adminOnly, upload.single('deliveryProof'), (req, res) => {
  const store = readStore();
  const order = store.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const actor = store.users.find(u => u.id === req.auth.id);
  order.verification ||= { account:false, method:false, payment:false, stock:false, delivery:false };
  order.verificationLog ||= [];
  const record = (step, result='Updated', details='') => order.verificationLog.push({ id:id('chk'), step, result, details, actorId:actor?.id||'', actorName:actor?.name||'Administrator', createdAt:new Date().toISOString() });
  const action = String(req.body.action || '').trim();
  const adminNote = String(req.body.adminNote || '').trim();

  if (['Completed','Declined'].includes(order.status) && action !== 'reopen') {
    return res.status(400).json({ error: `This order is already ${order.status.toLowerCase()}.` });
  }

  if (req.file) order.deliveryProofUrl = `/uploads/${req.file.filename}`;

  if (action === 'verifyPayment') {
    if (!order.receiptUrl) return res.status(400).json({ error:'A receipt image is required before payment can be verified.' });
    order.receiptVerified = true;
    order.verification.payment = true;
    order.status = 'Payment Verified';
    if (adminNote) order.adminNote = adminNote;
    record('Receipt verified', 'Verified', adminNote || 'Receipt image and exact payment amount checked by administrator');
  } else if (action === 'startProcessing') {
    if (!order.receiptVerified && order.status !== 'Payment Verified') return res.status(400).json({ error:'Verify the payment receipt before processing this order.' });
    order.status = 'Processing';
    if (adminNote) order.adminNote = adminNote;
    record('Order processing', 'Updated', adminNote || 'Order moved to processing');
  } else if (action === 'complete') {
    if (order.status !== 'Processing') return res.status(400).json({ error:'Move the order to Processing before completing it.' });
    order.status = 'Completed';
    order.verification.delivery = Boolean(order.deliveryProofUrl);
    if (adminNote) order.adminNote = adminNote;
    record('Order completed', 'Approved', adminNote || (order.deliveryProofUrl ? 'Completed with delivery proof' : 'Completed by administrator'));
  } else if (action === 'decline') {
    if (adminNote.length < 4) return res.status(400).json({ error:'Write a short reason before declining the order.' });
    order.adminNote = adminNote;
    order.status = 'Declined';
    record('Order declined', 'Declined', adminNote);
  } else {
    return res.status(400).json({ error:'Choose a valid order action.' });
  }

  order.updatedAt = new Date().toISOString();
  logActivity(store, actor, `${action} — ${order.orderNo}`, adminNote);
  writeStore(store);
  res.json({ order });
});

app.get('/api/admin/settings', auth, adminOnly, (req, res) => res.json({ settings: readStore().settings }));
app.put('/api/admin/settings', auth, adminOnly, (req, res) => {
  const store = readStore();
  const allowed = ['shopName','tagline','announcement','contactEmail','contactPhone','facebookUrl','businessLocation','gcashName','gcashNumber','mayaName','mayaNumber','gotymeName','gotymeNumber','rates','tutorialVideoUrl','vouches','maintenanceMode','methods','referralReward','supportStatus'];
  for (const k of allowed) if (req.body[k] !== undefined) store.settings[k] = req.body[k];
  writeStore(store); res.json({ settings: store.settings });
});


app.get('/api/admin/operations', auth, adminOnly, (req,res)=>{
 const store=readStore(); res.json({settings:store.settings, users:store.users.map(sanitizeUser), pendingVouches:store.vouchSubmissions.filter(v=>v.status==='Pending'), logs:store.activityLogs.slice(-200).reverse()});
});
app.patch('/api/admin/vouches/:id', auth, adminOnly, (req,res)=>{ const store=readStore(); const v=store.vouchSubmissions.find(x=>x.id===req.params.id); if(!v)return res.status(404).json({error:'Vouch not found.'}); v.status=req.body.status==='Approved'?'Approved':'Declined'; if(v.status==='Approved')store.settings.vouches.unshift({name:v.name,text:v.text,rating:v.rating}); logActivity(store,store.users.find(u=>u.id===req.auth.id),`${v.status} vouch`,v.id); writeStore(store); res.json({vouch:v}); });
app.post('/api/admin/staff', auth, adminOnly, async (req,res)=>{ const store=readStore(); const email=String(req.body.email||'').trim().toLowerCase(); if(!email||String(req.body.password||'').length<8)return res.status(400).json({error:'Enter an email and password with at least 8 characters.'}); if(store.users.some(u=>u.email===email))return res.status(409).json({error:'Email already exists.'}); const user={id:id('usr'),name:String(req.body.name||'Staff'),email,passwordHash:await bcrypt.hash(String(req.body.password),10),role:'admin',staffRole:String(req.body.staffRole||'Support'),createdAt:new Date().toISOString()}; store.users.push(user); logActivity(store,store.users.find(u=>u.id===req.auth.id),'Created staff',email); writeStore(store); res.status(201).json({user:sanitizeUser(user)}); });
app.get('/api/admin/export/orders.csv', auth, adminOnly, (req,res)=>{ const store=readStore(); const q=v=>'"'+String(v??'').replaceAll('"','""')+'"'; const rows=[['Order No','Customer','Method','Robux','Total PHP','Status','Created']]; for(const o of store.orders){const u=store.users.find(x=>x.id===o.userId);rows.push([o.orderNo,u?.email||'',o.method,o.robuxAmount,o.totalPhp,o.status,o.createdAt]);} res.type('text/csv').set('Content-Disposition','attachment; filename="rsr-orders.csv"').send(rows.map(r=>r.map(q).join(',')).join('\n')); });

app.get('*', (_, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5 MB or smaller.' : err.message });
  console.error(err); res.status(500).json({ error: 'Something went wrong.' });
});
app.listen(PORT, () => console.log(`RSR Shop running on port ${PORT}`));
