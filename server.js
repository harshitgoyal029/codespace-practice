const path = require('path');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'perk-counter-development-secret';
const db = new DatabaseSync(process.env.DB_FILE || path.join(__dirname, 'perk-counter.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
function transaction(callback) {
  db.exec('BEGIN');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS staff_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    member_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    email TEXT,
    points_balance INTEGER NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
    lifetime_points INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_points >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    staff_id INTEGER NOT NULL REFERENCES staff_users(id),
    type TEXT NOT NULL CHECK (type IN ('purchase', 'redemption')),
    points INTEGER NOT NULL,
    amount_cents INTEGER,
    reward_name TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone);
  CREATE INDEX IF NOT EXISTS idx_members_name ON members(name);
  CREATE INDEX IF NOT EXISTS idx_transactions_member ON transactions(member_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS point_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    points_remaining REAL NOT NULL CHECK (points_remaining >= 0),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS point_expiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    points REAL NOT NULL,
    expired_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivered INTEGER NOT NULL DEFAULT 0
  );
`);

const staffColumns = db.prepare('PRAGMA table_info(staff_users)').all().map(column => column.name);
if (!staffColumns.includes('role')) db.exec("ALTER TABLE staff_users ADD COLUMN role TEXT NOT NULL DEFAULT 'staff'");
if (!staffColumns.includes('member_id')) db.exec('ALTER TABLE staff_users ADD COLUMN member_id INTEGER');
db.prepare("UPDATE staff_users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM staff_users)").run();
db.prepare(`UPDATE staff_users SET member_id = (
  SELECT id FROM members WHERE lower(trim(members.name)) = lower(trim(staff_users.name)) LIMIT 1
) WHERE role = 'member' AND EXISTS (
  SELECT 1 FROM members WHERE lower(trim(members.name)) = lower(trim(staff_users.name))
)`).run();

const rewards = [
  { id: 'coffee', name: 'Free crafted drink', cost: 100, description: 'Any regular-size brewed coffee, tea, or iced drink' },
  { id: 'pastry', name: 'Bakery treat', cost: 250, description: 'A pastry or cookie from the counter' },
  { id: 'lunch', name: 'Lunch on us', cost: 500, description: 'One sandwich, salad, or lunch special' }
];

function tierFor(points) {
  if (points >= 5000) return { name: 'Platinum', multiplier: 0.3, next: null };
  if (points >= 1500) return { name: 'Gold', multiplier: 3, next: null };
  if (points >= 500) return { name: 'Silver', multiplier: 2, next: 1500 };
  return { name: 'Bronze', multiplier: 1, next: 500 };
}
function memberView(member) {
  return { ...member, tier: tierFor(member.lifetime_points) };
}
function issueToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role, memberId: user.member_id || null }, JWT_SECRET, { expiresIn: '12h' });
}
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Session expired. Please sign in again.' }); }
}
function cleanPhone(phone) { return String(phone || '').replace(/[^0-9+]/g, ''); }
function getMember(id) { return db.prepare('SELECT * FROM members WHERE id = ?').get(id); }
function tierCrossed(before, after) { return tierFor(before).name !== tierFor(after).name; }
function clockSql(date = new Date()) { return date.toISOString().slice(0, 19).replace('T', ' '); }
function backfillPointLots() {
  db.prepare(`INSERT INTO point_lots (member_id, points_remaining, expires_at)
    SELECT m.id, m.points_balance, datetime('now', '+90 days')
    FROM members m
    WHERE m.points_balance > 0 AND NOT EXISTS (SELECT 1 FROM point_lots p WHERE p.member_id = m.id)`).run();
}
const notificationService = {
  tierCrossed(memberId, from, to) {
    db.prepare('INSERT INTO notifications (member_id, event_type, payload_json) VALUES (?, ?, ?)').run(memberId, 'tier.crossed', JSON.stringify({ memberId, from, to, message: `Member reached ${to} tier` }));
  }
};
function seedDemoMembers(staffId) {
  if (!staffId || db.prepare('SELECT COUNT(*) AS count FROM members').get().count >= 10) return;
  const demoMembers = [
    ['Amara Okafor', '5550101001', 'amara@example.com', 182, 1682],
    ['Theo Martin', '5550101002', 'theo@example.com', 74, 574],
    ['Priya Shah', '5550101003', 'priya@example.com', 315, 315],
    ['Jordan Lee', '5550101004', 'jordan@example.com', 487, 487],
    ['Nia Williams', '5550101005', 'nia@example.com', 1120, 1120],
    ['Owen Brooks', '5550101006', 'owen@example.com', 36, 36],
    ['Camila Santos', '5550101007', 'camila@example.com', 248, 748],
    ['Eli Bennett', '5550101008', 'eli@example.com', 92, 92],
    ['Sofia Rossi', '5550101009', 'sofia@example.com', 1540, 1540],
    ['Malik Johnson', '5550101010', 'malik@example.com', 61, 61],
    ['Grace Kim', '5550101011', 'grace@example.com', 703, 703],
    ['Noah Patel', '5550101012', 'noah@example.com', 421, 421],
    ['Lena Fischer', '5550101013', 'lena@example.com', 133, 133],
    ['Mateo Garcia', '5550101014', 'mateo@example.com', 267, 767],
    ['Zoe Turner', '5550101015', 'zoe@example.com', 49, 49],
    ['Iris Chen', '5550101016', 'iris@example.com', 890, 890],
    ['Sam Rivera', '5550101017', 'sam@example.com', 208, 208],
    ['Ruby Wilson', '5550101018', 'ruby@example.com', 150, 150]
  ];
  const insertMember = db.prepare('INSERT INTO members (name, phone, email, points_balance, lifetime_points) VALUES (?, ?, ?, ?, ?)');
  const insertTransaction = db.prepare('INSERT INTO transactions (member_id, staff_id, type, points, amount_cents, note) VALUES (?, ?, \'purchase\', ?, ?, ?)');
  const seed = transaction(() => demoMembers.forEach(([name, phone, email, balance, lifetime]) => {
    const result = insertMember.run(name, phone, email, balance, lifetime);
    insertTransaction.run(result.lastInsertRowid, staffId, lifetime, lifetime * 100, 'Opening balance imported for demo');
  }));
  seed();
  backfillPointLots();
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/register', (req, res) => {
  const { name, email, password, role = 'staff', memberPhone } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password || password.length < 8) return res.status(400).json({ error: 'Name, email, and a password of at least 8 characters are required.' });
  if (!['staff', 'member'].includes(role)) return res.status(400).json({ error: 'Choose a valid account role.' });
  const linkedMember = role === 'member' ? db.prepare('SELECT id FROM members WHERE phone = ?').get(cleanPhone(memberPhone)) : null;
  if (role === 'member' && !linkedMember) return res.status(400).json({ error: 'Member phone number was not found. Ask the cafe team to add you first.' });
  if (role === 'member' && linkedMember && !db.prepare('SELECT 1 FROM members WHERE id = ? AND lower(trim(name)) = lower(trim(?))').get(linkedMember.id, name.trim())) return res.status(400).json({ error: 'The account name must match the member name linked to that phone number.' });
  try {
    const result = db.prepare('INSERT INTO staff_users (name, email, password_hash, role, member_id) VALUES (?, ?, ?, ?, ?)').run(name.trim(), email.trim().toLowerCase(), bcrypt.hashSync(password, 10), role, linkedMember?.id || null);
    const user = db.prepare('SELECT id, name, email, role, member_id FROM staff_users WHERE id = ?').get(result.lastInsertRowid);
    seedDemoMembers(user.id);
    backfillPointLots();
    res.status(201).json({ token: issueToken(user), user });
  } catch (error) { res.status(error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 500).json({ error: error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'An account with that email already exists.' : 'Could not create account.' }); }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM staff_users WHERE email = ? COLLATE NOCASE').get(String(email || '').trim());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  res.json({ token: issueToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role, memberId: user.member_id || null } });
});
app.get('/api/auth/me', auth, (req, res) => res.json({ user: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role, memberId: req.user.memberId || null } }));

app.post('/clock', (req, res) => {
  const requested = req.body?.now ? new Date(req.body.now) : new Date();
  if (Number.isNaN(requested.getTime())) return res.status(400).json({ error: 'now must be a valid ISO date.' });
  const now = clockSql(requested);
  const expire = transaction(() => {
    const lots = db.prepare('SELECT member_id, SUM(points_remaining) AS points FROM point_lots WHERE points_remaining > 0 AND expires_at <= ? GROUP BY member_id').all(now);
    let expired = 0;
    for (const lot of lots) {
      db.prepare('UPDATE members SET points_balance = MAX(0, points_balance - ?), updated_at = ? WHERE id = ?').run(lot.points, now, lot.member_id);
      db.prepare('INSERT INTO point_expiries (member_id, points, expired_at) VALUES (?, ?, ?)').run(lot.member_id, lot.points, now);
      expired += lot.points;
    }
    db.prepare('UPDATE point_lots SET points_remaining = 0 WHERE points_remaining > 0 AND expires_at <= ?').run(now);
    return { members: lots.length, points: expired, now };
  });
  res.json({ expired: expire });
});
app.get('/outbox', (req, res) => {
  const notifications = db.prepare('SELECT id, member_id, event_type, payload_json, created_at, delivered FROM notifications ORDER BY id ASC').all().map(item => ({ ...item, payload: JSON.parse(item.payload_json) }));
  res.json({ notifications });
});

app.get('/api/rewards', auth, (req, res) => res.json({ rewards }));
app.get('/api/members', auth, (req, res) => {
  if (req.user.role === 'member') return res.status(403).json({ error: 'Member accounts should use their own points view.' });
  const search = String(req.query.search || '').trim();
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(5, Number.parseInt(req.query.limit, 10) || 10));
  const sortMap = { name: 'name COLLATE NOCASE', points: 'points_balance', tier: 'lifetime_points', recent: 'updated_at' };
  const sort = sortMap[req.query.sort] || sortMap.recent;
  const direction = String(req.query.direction).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const where = search ? 'WHERE name LIKE @search OR phone LIKE @search OR COALESCE(email, \'\') LIKE @search' : '';
  const params = search ? { search: `%${search}%` } : {};
  const total = db.prepare(`SELECT COUNT(*) AS count FROM members ${where}`).get(params).count;
  const rows = db.prepare(`SELECT * FROM members ${where} ORDER BY ${sort} ${direction}, id DESC LIMIT @limit OFFSET @offset`).all({ ...params, limit, offset: (page - 1) * limit }).map(memberView);
  res.json({ members: rows, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }, sort: { field: req.query.sort || 'recent', direction } });
});
app.get('/api/members/:id', auth, (req, res) => {
  if (req.user.role === 'member' && Number(req.user.memberId) !== Number(req.params.id)) return res.status(403).json({ error: 'Members can only view their own points.' });
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'Member not found.' });
  const transactions = db.prepare('SELECT id, type, points, amount_cents, reward_name, note, created_at FROM transactions WHERE member_id = ? ORDER BY created_at DESC, id DESC LIMIT 20').all(member.id);
  res.json({ member: memberView(member), transactions });
});
app.post('/api/members', auth, (req, res) => {
  if (req.user.role === 'member') return res.status(403).json({ error: 'Member accounts cannot add members.' });
  const { name, email } = req.body || {};
  const phone = cleanPhone(req.body?.phone);
  if (!name?.trim() || phone.length < 7) return res.status(400).json({ error: 'Member name and a valid phone number are required.' });
  try {
    const result = db.prepare('INSERT INTO members (name, phone, email) VALUES (?, ?, ?)').run(name.trim(), phone, email?.trim() || null);
    res.status(201).json({ member: memberView(getMember(result.lastInsertRowid)) });
  } catch (error) { res.status(error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 500).json({ error: error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'That phone number is already registered.' : 'Could not add member.' }); }
});

app.post('/api/members/:id/purchases', auth, (req, res) => {
  if (req.user.role === 'member') return res.status(403).json({ error: 'Member accounts cannot record purchases.' });
  const amountCents = Math.round(Number(req.body?.amount) * 100);
  if (!Number.isFinite(amountCents) || amountCents < 1) return res.status(400).json({ error: 'Purchase amount must be greater than zero.' });
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'Member not found.' });
  const beforeTier = tierFor(member.lifetime_points);
  const points = beforeTier.multiplier < 1 ? Number((amountCents / 100 * beforeTier.multiplier).toFixed(2)) : Math.floor(amountCents / 100) * beforeTier.multiplier;
  if (points <= 0) return res.status(400).json({ error: 'Purchase is too small to earn points at this tier.' });
  transaction(() => {
    db.prepare('UPDATE members SET points_balance = points_balance + ?, lifetime_points = lifetime_points + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(points, points, member.id);
    db.prepare('INSERT INTO transactions (member_id, staff_id, type, points, amount_cents, note) VALUES (?, ?, \'purchase\', ?, ?, ?)').run(member.id, req.user.id, points, amountCents, req.body.note?.trim() || null);
    db.prepare('INSERT INTO point_lots (member_id, points_remaining, expires_at) VALUES (?, ?, datetime(\'now\', \'+90 days\'))').run(member.id, points);
    const afterLifetime = member.lifetime_points + points;
    if (tierCrossed(member.lifetime_points, afterLifetime)) notificationService.tierCrossed(member.id, beforeTier.name, tierFor(afterLifetime).name);
  });
  res.status(201).json({ member: memberView(getMember(member.id)), earned: points });
});

app.post('/api/members/:id/redemptions', auth, (req, res) => {
  if (req.user.role === 'member') return res.status(403).json({ error: 'Member accounts cannot redeem rewards from this view.' });
  const reward = rewards.find(item => item.id === req.body?.rewardId);
  if (!reward) return res.status(400).json({ error: 'Choose a valid reward.' });
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'Member not found.' });
  if (member.points_balance < reward.cost) return res.status(400).json({ error: `This reward needs ${reward.cost} points. The member has ${member.points_balance}.` });
  transaction(() => {
    const result = db.prepare('UPDATE members SET points_balance = points_balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND points_balance >= ?').run(reward.cost, member.id, reward.cost);
    if (!result.changes) throw new Error('INSUFFICIENT_POINTS');
    let remaining = reward.cost;
    const lots = db.prepare('SELECT id, points_remaining FROM point_lots WHERE member_id = ? AND points_remaining > 0 ORDER BY expires_at ASC, id ASC').all(member.id);
    for (const lot of lots) {
      const used = Math.min(remaining, lot.points_remaining);
      db.prepare('UPDATE point_lots SET points_remaining = points_remaining - ? WHERE id = ?').run(used, lot.id);
      remaining -= used;
      if (remaining <= 0) break;
    }
    db.prepare('INSERT INTO transactions (member_id, staff_id, type, points, reward_name, note) VALUES (?, ?, \'redemption\', ?, ?, ?)').run(member.id, req.user.id, -reward.cost, reward.name, req.body.note?.trim() || null);
  });
  try { res.status(201).json({ member: memberView(getMember(member.id)), redeemed: reward }); }
  catch (error) { res.status(400).json({ error: error.message === 'INSUFFICIENT_POINTS' ? 'Points changed before this redemption completed. Please try again.' : 'Could not redeem reward.' }); }
});

app.get('/api/members/:id/transactions', auth, (req, res) => {
  if (req.user.role === 'member' && Number(req.user.memberId) !== Number(req.params.id)) return res.status(403).json({ error: 'Members can only view their own activity.' });
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'Member not found.' });
  res.json({ transactions: db.prepare('SELECT * FROM transactions WHERE member_id = ? ORDER BY created_at DESC, id DESC LIMIT 100').all(member.id) });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
const firstStaff = db.prepare('SELECT id FROM staff_users ORDER BY id LIMIT 1').get();
seedDemoMembers(firstStaff?.id);
backfillPointLots();
app.listen(PORT, () => console.log(`Perk Counter running at http://localhost:${PORT}`));

function closeDatabase() {
  db.close();
}
process.once('SIGINT', () => { closeDatabase(); process.exit(0); });
process.once('SIGTERM', () => { closeDatabase(); process.exit(0); });
