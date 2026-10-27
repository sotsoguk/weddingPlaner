const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Database setup
const dbPath = path.join(DATA_DIR, 'wedding.db');
const db = new Database(dbPath);

// Vor der ersten Schema-Migration automatisch eine Datenbank-Sicherung anlegen.
const peopleTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'people'").get();
if (!peopleTableExists && fs.existsSync(dbPath)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(DATA_DIR, `wedding.backup-${stamp}.db`);
  try {
    fs.copyFileSync(dbPath, backupPath);
    fs.chmodSync(backupPath, 0o600);
  } catch (e) {
    console.error('Could not create database backup:', e);
  }
}

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS rsvps (
    code TEXT PRIMARY KEY,
    status TEXT NOT NULL, -- 'attending' or 'declined'
    comment TEXT,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS attendees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rsvp_code TEXT NOT NULL,
    name TEXT NOT NULL,
    dish_id TEXT,
    dietary_notes TEXT,
    FOREIGN KEY (rsvp_code) REFERENCES rsvps(code) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
  );

  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_child INTEGER NOT NULL DEFAULT 0,
    rsvp_code TEXT,
    dish_id TEXT,
    dietary_notes TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    rsvp_listed INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS seating_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    state_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    meta_key TEXT PRIMARY KEY,
    meta_value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_people_rsvp_code ON people(rsvp_code);
  CREATE INDEX IF NOT EXISTS idx_people_sort_order ON people(sort_order);
`);

const peopleColumns = db.prepare('PRAGMA table_info(people)').all();
if (!peopleColumns.some((column) => column.name === 'rsvp_listed')) {
  db.exec('ALTER TABLE people ADD COLUMN rsvp_listed INTEGER DEFAULT NULL');
}

// Admin secret / password setup
function verifyAdminPassword(input) {
  if (process.env.ADMIN_PASSWORD) {
    return String(input) === process.env.ADMIN_PASSWORD;
  }

  const adminConfigFile = path.join(DATA_DIR, 'admin-config.json');
  let config = {};
  if (fs.existsSync(adminConfigFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(adminConfigFile, 'utf8'));
      if (parsed && typeof parsed === 'object') config = parsed;
    } catch (e) {
      console.error('Failed to read admin-config.json:', e);
    }
  }

  let valid = false;
  if (config.password_hash) {
    valid = bcrypt.compareSync(String(input), String(config.password_hash));
  } else if (config.password) {
    valid = String(input) === String(config.password);
  }

  if (valid) {
    // Klartext-Passwort oder noch nicht migrierten Standard durch Hash ersetzen.
    config.password_hash = bcrypt.hashSync(String(input), 10);
    delete config.password;
    if (!config.note) {
      config.note = 'Passwort kann über ADMIN_PASSWORD oder diese Datei geändert werden.';
    }
    try {
      if (fs.existsSync(adminConfigFile)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const configBackup = path.join(DATA_DIR, `admin-config.backup-${stamp}.json`);
        fs.copyFileSync(adminConfigFile, configBackup);
        fs.chmodSync(configBackup, 0o600);
      }
      fs.writeFileSync(adminConfigFile, JSON.stringify(config, null, 2), { mode: 0o600 });
    } catch (e) {
      console.error('Failed to persist admin password hash:', e);
    }
  }

  return valid;
}

// Cookie secret
function getCookieSecret() {
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }
  const secretFile = path.join(DATA_DIR, '.session-secret');
  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, 'utf8').trim();
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

const COOKIE_SECRET = getCookieSecret();

// Helper to load guests list (supports JSON and CSV)
function loadGuests() {
  const jsonPath = path.join(DATA_DIR, 'guests.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const raw = fs.readFileSync(jsonPath, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.error('Error parsing guests.json:', e);
    }
  }

  const csvPath = path.join(DATA_DIR, 'guests.csv');
  if (fs.existsSync(csvPath)) {
    try {
      const lines = fs.readFileSync(csvPath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length > 1) {
        const guests = [];
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',').map(s => s.replace(/^"|"$/g, '').trim());
          if (parts[0]) {
            guests.push({
              code: parts[0],
              name: parts[1] || parts[0],
              maxPersons: parseInt(parts[2], 10) || 2,
              group: parts[3] || ''
            });
          }
        }
        return guests;
      }
    } catch (e) {
      console.error('Error reading guests.csv:', e);
    }
  }

  return [];
}

// Helper to load menu
function loadMenu() {
  const menuPath = path.join(DATA_DIR, 'menu.json');
  if (fs.existsSync(menuPath)) {
    try {
      return JSON.parse(fs.readFileSync(menuPath, 'utf8'));
    } catch (e) {
      console.error('Error loading menu.json:', e);
    }
  }
  return { title: 'Hochzeitsmenü', mains: [] };
}

// Helper to load wedding config
function loadWeddingConfig() {
  const configPath = path.join(DATA_DIR, 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error('Error loading config.json:', e);
    }
  }
  return { couple: { partner1: 'Bine', partner2: 'Bert' } };
}

// ----------------------------------------------------
// Helpers: Personen & Tischplan
// ----------------------------------------------------

function makePersonKey() {
  return crypto.randomBytes(16).toString('hex');
}

function normalizePersonName(name) {
  return String(name || '').trim().toLocaleLowerCase('de-DE');
}

function requireJsonSameOrigin(req, res) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    res.status(415).json({ error: 'Content-Type application/json erforderlich' });
    return false;
  }
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        res.status(403).json({ error: 'Ungültige Anfrage-Herkunft' });
        return false;
      }
    } catch (e) {
      res.status(403).json({ error: 'Ungültige Anfrage-Herkunft' });
      return false;
    }
  }
  return true;
}

function getParties() {
  const guests = loadGuests();
  const statusMap = new Map();
  for (const row of db.prepare('SELECT code, status FROM rsvps').all()) {
    statusMap.set(row.code.toUpperCase(), row.status);
  }

  return guests
    .filter((guest) => guest.code)
    .map((guest) => ({
      code: String(guest.code),
      name: guest.name || guest.code,
      group: guest.group || '',
      maxPersons: Number(guest.maxPersons) || 2,
      status: statusMap.get(String(guest.code).toUpperCase()) || 'pending'
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function getCodeWords() {
  return [
    'sonne', 'mond', 'stern', 'wolke', 'licht', 'morgen', 'abend', 'sommer', 'winter', 'herbst',
    'rose', 'tulpe', 'lilie', 'garten', 'wiese', 'wald', 'see', 'berg', 'tal', 'fluss',
    'insel', 'strand', 'hafen', 'steg', 'weg', 'haus', 'hof', 'dorf', 'tisch', 'bank',
    'kerze', 'laterne', 'glocke', 'band', 'schleife', 'feder', 'segel', 'herz', 'freude', 'lachen',
    'tanz', 'musik', 'lied', 'fest', 'feier', 'wunsch', 'traum', 'ruhe', 'kraft', 'zeit',
    'kaffee', 'kuchen', 'honig', 'apfel', 'kirsche', 'zitrone', 'minze', 'lavendel', 'zimt', 'brot',
    'wein', 'salz', 'perle', 'gold', 'silber', 'samt', 'seide', 'boot', 'reise', 'ufer',
    'quelle', 'brunnen', 'biene', 'vogel', 'schwan', 'fuchs', 'reh', 'kirche', 'kapelle', 'kranz',
    'brief', 'karte', 'wort', 'meer', 'bucht', 'welle', 'feuer', 'funke', 'glanz', 'zauber',
    'wunder', 'picknick'
  ];
}

function generateReadableCode(existingCodes) {
  const words = getCodeWords();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const picked = [];
    while (picked.length < 3) {
      const word = words[crypto.randomInt(0, words.length)];
      if (!picked.includes(word)) picked.push(word);
    }
    const code = picked.join('-');
    if (!existingCodes.has(code.toUpperCase())) return code;
  }
  throw new Error('Es konnte kein freier Gästecode erzeugt werden.');
}

function saveGuests(guests) {
  const file = path.join(DATA_DIR, 'guests.json');
  let backup = null;
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backup = path.join(DATA_DIR, `guests.backup-${stamp}.json`);
    fs.copyFileSync(file, backup);
    fs.chmodSync(backup, 0o600);
  }

  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(guests, null, 2)}\n`, { mode: 0o644 });
  fs.renameSync(temp, file);
  return backup;
}

function getGroups() {
  const parties = getParties();
  const people = getPeopleData().people;
  const byCode = new Map();
  for (const person of people) {
    const code = person.rsvpCode || '';
    if (!code) continue;
    const list = byCode.get(code) || [];
    list.push(person);
    byCode.set(code, list);
  }

  const groups = parties.map((party) => {
    const members = byCode.get(party.code) || [];
    return {
      ...party,
      persons: members,
      personCount: members.length,
      childCount: members.filter((person) => person.child).length
    };
  });

  return { groups };
}

function getSeatingState() {
  const row = db.prepare('SELECT state_json, revision, updated_at FROM seating_state WHERE id = 1').get();
  if (!row) {
    return { revision: 0, updatedAt: null, plan: { tables: [], settings: {} } };
  }
  let plan = {};
  try {
    plan = JSON.parse(row.state_json);
  } catch (e) {
    plan = {};
  }
  if (!plan || typeof plan !== 'object') plan = {};
  if (!Array.isArray(plan.tables)) plan.tables = [];
  if (!plan.settings || typeof plan.settings !== 'object') plan.settings = {};
  return { revision: row.revision, updatedAt: row.updated_at, plan };
}

function validSeatingPlan(plan) {
  if (!plan || typeof plan !== 'object') return false;
  if (!Array.isArray(plan.tables) || plan.tables.length > 200) return false;
  if (plan.settings && typeof plan.settings !== 'object') return false;
  for (const table of plan.tables) {
    if (!table || typeof table !== 'object') return false;
    if (table.seats && (!Array.isArray(table.seats) || table.seats.length > 100)) return false;
  }
  return true;
}

function saveSeatingState(plan, expectedRevision) {
  if (!validSeatingPlan(plan)) {
    throw new Error('Ungültiger Tischplan');
  }
  const cleanPlan = {
    version: 1,
    tables: plan.tables,
    settings: plan.settings && typeof plan.settings === 'object' ? plan.settings : {}
  };
  const json = JSON.stringify(cleanPlan);
  if (Buffer.byteLength(json, 'utf8') > 2 * 1024 * 1024) {
    throw new Error('Tischplan ist zu groß');
  }

  const write = db.transaction(() => {
    const row = db.prepare('SELECT revision FROM seating_state WHERE id = 1').get();
    const currentRevision = row ? row.revision : 0;
    if (expectedRevision !== null && Number(expectedRevision) !== currentRevision) {
      return { conflict: true, revision: currentRevision };
    }
    const nextRevision = currentRevision + 1;
    if (row) {
      db.prepare("UPDATE seating_state SET state_json = ?, revision = ?, updated_at = datetime('now') WHERE id = 1")
        .run(json, nextRevision);
    } else {
      db.prepare("INSERT INTO seating_state (id, state_json, revision, updated_at) VALUES (1, ?, ?, datetime('now'))")
        .run(json, nextRevision);
    }
    return { conflict: false, revision: nextRevision };
  });

  return write();
}

function getPeopleData() {
  const parties = getParties();
  const partyMap = new Map(parties.map((party) => [party.code, party]));
  const statusMap = new Map(parties.map((party) => [party.code.toUpperCase(), party.status]));

  const menu = loadMenu();
  const dishMap = new Map();
  for (const dish of (menu.mains || [])) {
    if (!dish.id) continue;
    dishMap.set(dish.id, `${dish.name || dish.id}${dish.tag ? ` (${dish.tag})` : ''}`);
  }

  const seating = getSeatingState();
  const tableMap = new Map();
  for (const table of seating.plan.tables) {
    if (!Array.isArray(table.seats)) continue;
    table.seats.forEach((personKey, index) => {
      if (typeof personKey === 'string' && personKey) {
        tableMap.set(personKey, { number: table.number || '', seatIndex: index + 1 });
      }
    });
  }

  const rows = db.prepare('SELECT * FROM people ORDER BY sort_order ASC, name COLLATE NOCASE ASC').all();
  const people = rows.map((row) => {
    const code = row.rsvp_code || '';
    const party = partyMap.get(code);
    const dishId = row.dish_id || '';
    let status = code ? (statusMap.get(code.toUpperCase()) || 'pending') : 'pending';
    if (status === 'attending' && row.rsvp_listed === 0) {
      status = 'declined';
    }
    return {
      key: row.person_key,
      name: row.name,
      child: row.is_child === 1,
      status: status,
      rsvpCode: code,
      partyName: party ? party.name : '',
      group: party ? party.group : '',
      dishId,
      dishName: dishId ? (dishMap.get(dishId) || '') : '',
      dietaryNotes: row.dietary_notes || '',
      table: tableMap.get(row.person_key) || null
    };
  });

  return { people, parties };
}

function syncPeopleFromRsvp() {
  const rows = db.prepare(`
    SELECT a.rsvp_code, a.name, a.dish_id, a.dietary_notes
    FROM attendees a
    JOIN rsvps r ON UPPER(r.code) = UPPER(a.rsvp_code)
    WHERE r.status = 'attending'
    ORDER BY a.rsvp_code ASC, a.id ASC
  `).all();

  const existing = new Map();
  for (const person of db.prepare('SELECT * FROM people ORDER BY id ASC').all()) {
    const code = person.rsvp_code || '';
    const normalized = normalizePersonName(person.name);
    const mapKey = `${code}\u0000${normalized}`;
    const list = existing.get(mapKey) || [];
    list.push(person);
    existing.set(mapKey, list);
  }

  let maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM people').get().value;
  let added = 0;
  let updated = 0;

  const attendingCodes = new Set(rows.map((row) => row.rsvp_code || ''));

  const sync = db.transaction(() => {
    const resetListed = db.prepare('UPDATE people SET rsvp_listed = 0 WHERE rsvp_code = ? AND rsvp_listed = 1');
    for (const code of attendingCodes) {
      resetListed.run(code);
    }

    for (const row of rows) {
      const code = row.rsvp_code || '';
      const name = String(row.name || '').trim();
      if (!name) continue;
      const mapKey = `${code}\u0000${normalizePersonName(name)}`;
      const matches = existing.get(mapKey) || [];
      const match = matches.shift();

      if (match) {
        db.prepare("UPDATE people SET dish_id = ?, dietary_notes = ?, rsvp_listed = 1, updated_at = datetime('now') WHERE id = ?")
          .run(row.dish_id || null, row.dietary_notes || '', match.id);
        updated += 1;
      } else {
        maxOrder += 1;
        db.prepare(`
          INSERT INTO people (person_key, name, is_child, rsvp_code, dish_id, dietary_notes, sort_order, rsvp_listed)
          VALUES (?, ?, 0, ?, ?, ?, ?, 1)
        `).run(
          makePersonKey(),
          name.slice(0, 80),
          code || null,
          row.dish_id || null,
          row.dietary_notes || '',
          maxOrder
        );
        added += 1;
      }
    }
  });
  sync();

  return { added, updated };
}

function seedPeopleOnce() {
  const seeded = db.prepare("SELECT meta_value FROM app_meta WHERE meta_key = 'people_seeded'").get();
  if (seeded && seeded.meta_value === '1') return;
  const count = db.prepare('SELECT COUNT(*) AS value FROM people').get().value;
  if (count === 0) {
    syncPeopleFromRsvp();
  }
  db.prepare(`
    INSERT INTO app_meta (meta_key, meta_value) VALUES ('people_seeded', '1')
    ON CONFLICT(meta_key) DO UPDATE SET meta_value = '1'
  `).run();
}

function removePersonFromSeating(personKey) {
  const seating = getSeatingState();
  let changed = false;
  for (const table of seating.plan.tables) {
    if (!Array.isArray(table.seats)) continue;
    table.seats = table.seats.map((key) => {
      if (key === personKey) {
        changed = true;
        return null;
      }
      return key;
    });
  }
  if (changed) {
    saveSeatingState(seating.plan, seating.revision);
  }
}

try {
  seedPeopleOnce();
} catch (e) {
  console.error('People seeding failed:', e);
}

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'self'"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(COOKIE_SECRET));
app.use('/api/admin', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Admin Auth Middleware
function requireAdmin(req, res, next) {
  const sessionToken = req.signedCookies.admin_session;
  if (!sessionToken) {
    return res.status(401).json({ error: 'Nicht angemeldet' });
  }

  const session = db.prepare(`
    SELECT * FROM admin_sessions 
    WHERE token = ? AND expires_at > datetime('now')
  `).get(sessionToken);

  if (!session) {
    res.clearCookie('admin_session');
    return res.status(401).json({ error: 'Sitzung abgelaufen' });
  }

  next();
}

// ----------------------------------------------------
// Public APIs
// ----------------------------------------------------

// Get wedding config (dates, location, text)
app.get('/api/config', (req, res) => {
  const config = loadWeddingConfig();
  res.json(config);
});

// Get food menu
app.get('/api/menu', (req, res) => {
  const menu = loadMenu();
  res.json(menu);
});

// Check guest code and retrieve existing RSVP if present
app.get('/api/guest/:code', (req, res) => {
  const inputCode = (req.params.code || '').trim().toUpperCase();
  if (!inputCode) {
    return res.status(400).json({ error: 'Code ist erforderlich' });
  }

  const guests = loadGuests();
  const guest = guests.find(g => g.code.trim().toUpperCase() === inputCode);

  if (!guest) {
    return res.status(404).json({ error: 'Ungültiger Gästecode. Bitte überprüfe deine Einladung.' });
  }

  // Check if RSVP already exists
  const rsvp = db.prepare('SELECT * FROM rsvps WHERE UPPER(code) = ?').get(inputCode);
  let attendees = [];

  if (rsvp) {
    attendees = db.prepare('SELECT name, dish_id, dietary_notes FROM attendees WHERE rsvp_code = ?').all(rsvp.code);
  }

  const groupPeople = db.prepare(`
    SELECT name, is_child FROM people
    WHERE UPPER(rsvp_code) = ?
      AND (rsvp_listed IS NULL OR rsvp_listed <> 0)
    ORDER BY sort_order ASC, name COLLATE NOCASE ASC
  `).all(guest.code.toUpperCase()).map((person) => ({
    name: person.name,
    child: person.is_child === 1
  }));

  res.json({
    code: guest.code,
    name: guest.name,
    maxPersons: guest.maxPersons || 2,
    group: guest.group || '',
    people: groupPeople,
    rsvp: rsvp ? {
      status: rsvp.status,
      comment: rsvp.comment || '',
      submitted_at: rsvp.submitted_at,
      updated_at: rsvp.updated_at,
      attendees: attendees.map(a => ({
        name: a.name,
        dishId: a.dish_id,
        dietaryNotes: a.dietary_notes || ''
      }))
    } : null
  });
});

// Submit / update RSVP
app.post('/api/rsvp', (req, res) => {
  const { code, status, attendees, comment } = req.body;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Code fehlt' });
  }

  const normalizedCode = code.trim().toUpperCase();
  const guests = loadGuests();
  const guest = guests.find(g => g.code.trim().toUpperCase() === normalizedCode);

  if (!guest) {
    return res.status(404).json({ error: 'Ungültiger Gästecode' });
  }

  if (status !== 'attending' && status !== 'declined') {
    return res.status(400).json({ error: 'Ungültiger Status' });
  }

  // Validate attendees if attending
  let cleanAttendees = [];
  if (status === 'attending') {
    if (!Array.isArray(attendees) || attendees.length === 0) {
      return res.status(400).json({ error: 'Bitte gib mindestens eine teilnehmende Person an.' });
    }

    const menu = loadMenu();
    const validDishIds = new Set((menu.mains || []).map(m => m.id));

    for (let i = 0; i < attendees.length; i++) {
      const a = attendees[i];
      const personName = (a.name || '').trim();
      if (!personName) {
        return res.status(400).json({ error: `Bitte gib den Namen für Person ${i + 1} an.` });
      }
      if (personName.length > 100) {
        return res.status(400).json({ error: `Name für Person ${i + 1} ist zu lang.` });
      }

      let dishId = (a.dishId || '').trim();
      if (validDishIds.size > 0 && dishId && !validDishIds.has(dishId)) {
        dishId = null;
      }

      cleanAttendees.push({
        name: personName,
        dishId: dishId || null,
        dietaryNotes: typeof a.dietaryNotes === 'string' ? a.dietaryNotes.trim().slice(0, 300) : ''
      });
    }
  }

  const safeComment = typeof comment === 'string' ? comment.trim().slice(0, 1000) : '';

  // SQLite transaction
  const saveTransaction = db.transaction(() => {
    // Check if rsvp row exists
    const existing = db.prepare('SELECT code FROM rsvps WHERE UPPER(code) = ?').get(normalizedCode);
    const targetCode = existing ? existing.code : guest.code;

    if (existing) {
      db.prepare(`
        UPDATE rsvps 
        SET status = ?, comment = ?, updated_at = datetime('now')
        WHERE code = ?
      `).run(status, safeComment, targetCode);
    } else {
      db.prepare(`
        INSERT INTO rsvps (code, status, comment, submitted_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `).run(targetCode, status, safeComment);
    }

    // Replace attendees
    db.prepare('DELETE FROM attendees WHERE rsvp_code = ?').run(targetCode);

    if (status === 'attending') {
      const insertAttendee = db.prepare(`
        INSERT INTO attendees (rsvp_code, name, dish_id, dietary_notes)
        VALUES (?, ?, ?, ?)
      `);
      for (const att of cleanAttendees) {
        insertAttendee.run(targetCode, att.name, att.dishId, att.dietaryNotes);
      }
    }
  });

  try {
    saveTransaction();
    try {
      syncPeopleFromRsvp();
    } catch (syncError) {
      console.error('People sync after RSVP failed:', syncError);
    }
    res.json({
      success: true,
      message: status === 'attending'
        ? 'Vielen Dank! Wir haben deine Zusage erhalten und freuen uns riesig auf euch!'
        : 'Vielen Dank für deine Rückmeldung. Schade, dass ihr nicht dabei sein könnt!'
    });
  } catch (err) {
    console.error('Error saving RSVP:', err);
    res.status(500).json({ error: 'Fehler beim Speichern der Rückmeldung. Bitte versuche es erneut.' });
  }
});

// ----------------------------------------------------
// Admin APIs
// ----------------------------------------------------

// Admin Login
app.post('/api/admin/login', (req, res) => {
  if (!requireJsonSameOrigin(req, res)) return;

  const { password } = req.body || {};
  if (!password || !verifyAdminPassword(password)) {
    return res.status(401).json({ error: 'Falsches Passwort' });
  }

  // Create session
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO admin_sessions (token, expires_at)
    VALUES (?, ?)
  `).run(token, expiresAt);

  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('admin_session', token, {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  res.json({ success: true, message: 'Erfolgreich angemeldet' });
});

// Admin Check Auth
app.get('/api/admin/check', requireAdmin, (req, res) => {
  res.json({ authenticated: true });
});

// Admin Logout
app.post('/api/admin/logout', (req, res) => {
  const token = req.signedCookies.admin_session;
  if (token) {
    db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
  }
  res.clearCookie('admin_session');
  res.json({ success: true });
});

// Gemeinsame Personenliste / Tischplan
app.get('/api/admin/seating', requireAdmin, (req, res) => {
  const seating = getSeatingState();
  const data = getPeopleData();
  res.json({
    revision: seating.revision,
    updatedAt: seating.updatedAt,
    plan: seating.plan,
    people: data.people,
    parties: data.parties
  });
});

app.post('/api/admin/seating', requireAdmin, (req, res) => {
  if (!requireJsonSameOrigin(req, res)) return;
  const body = req.body || {};
  if (!body.plan || typeof body.plan !== 'object') {
    return res.status(400).json({ error: 'Tischplan fehlt' });
  }

  try {
    const expected = body.revision === undefined || body.revision === null ? null : Number(body.revision);
    const result = saveSeatingState(body.plan, expected);
    if (result.conflict) {
      return res.status(409).json({
        error: 'Der Tischplan wurde zwischenzeitlich geändert.',
        revision: result.revision,
        state: getSeatingState()
      });
    }
    res.json({ success: true, revision: result.revision });
  } catch (e) {
    res.status(422).json({ error: e.message || 'Tischplan konnte nicht gespeichert werden' });
  }
});

app.get('/api/admin/people', requireAdmin, (req, res) => {
  res.json(getPeopleData());
});

app.post('/api/admin/people', requireAdmin, (req, res) => {
  if (!requireJsonSameOrigin(req, res)) return;
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const child = body.child;
  const code = String(body.rsvpCode || '').trim();

  if (!name || name.length > 80) {
    return res.status(422).json({ error: 'Name fehlt oder ist zu lang (max. 80 Zeichen).' });
  }
  if (typeof child !== 'boolean') {
    return res.status(422).json({ error: 'child muss true oder false sein.' });
  }
  const validCodes = new Set(loadGuests().map((guest) => String(guest.code)));
  if (code && !validCodes.has(code)) {
    return res.status(422).json({ error: 'Unbekannter Einladungscode.' });
  }

  const key = makePersonKey();
  const order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM people').get().value + 1;
  db.prepare(`
    INSERT INTO people (person_key, name, is_child, rsvp_code, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `).run(key, name, child ? 1 : 0, code || null, order);

  res.json({ success: true, personKey: key });
});

app.post('/api/admin/people/sync-rsvp', requireAdmin, (req, res) => {
  if (!requireJsonSameOrigin(req, res)) return;
  try {
    const result = syncPeopleFromRsvp();
    res.json({ success: true, added: result.added, updated: result.updated });
  } catch (e) {
    res.status(500).json({ error: 'RSVP-Synchronisierung fehlgeschlagen' });
  }
});

app.patch('/api/admin/people/:key', requireAdmin, (req, res) => {
  if (!requireJsonSameOrigin(req, res)) return;
  const person = db.prepare('SELECT * FROM people WHERE person_key = ?').get(req.params.key);
  if (!person) return res.status(404).json({ error: 'Person nicht gefunden' });

  const body = req.body || {};
  const updates = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = String(body.name || '').trim();
    if (!name || name.length > 80) {
      return res.status(422).json({ error: 'Name fehlt oder ist zu lang (max. 80 Zeichen).' });
    }
    updates.push('name = ?');
    params.push(name);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'child')) {
    if (typeof body.child !== 'boolean') {
      return res.status(422).json({ error: 'child muss true oder false sein.' });
    }
    updates.push('is_child = ?');
    params.push(body.child ? 1 : 0);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'rsvpCode')) {
    const code = String(body.rsvpCode || '').trim();
    const validCodes = new Set(loadGuests().map((guest) => String(guest.code)));
    if (code && !validCodes.has(code)) {
      return res.status(422).json({ error: 'Unbekannter Einladungscode.' });
    }
    updates.push('rsvp_code = ?');
    params.push(code || null);
  }

  if (!updates.length) return res.status(400).json({ error: 'Keine Änderungen übergeben' });
  updates.push("updated_at = datetime('now')");
  params.push(person.id);
  db.prepare(`UPDATE people SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

app.delete('/api/admin/people/:key', requireAdmin, (req, res) => {
  if (!requireJsonSameOrigin(req, res)) return;
  const person = db.prepare('SELECT * FROM people WHERE person_key = ?').get(req.params.key);
  if (!person) return res.status(404).json({ error: 'Person nicht gefunden' });

  db.prepare('DELETE FROM people WHERE id = ?').run(person.id);
  removePersonFromSeating(person.person_key);
  res.json({ success: true });
});

// Gruppen / Einladungen mit lesbaren Codes
app.get('/api/admin/groups', requireAdmin, (req, res) => {
  res.json(getGroups());
});

app.post('/api/admin/groups', requireAdmin, (req, res) => {
  if (!requireJsonSameOrigin(req, res)) return;
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const groupName = String(body.group || '').trim();
  const maxPersons = Number(body.maxPersons || 2);

  if (!name || name.length > 100) {
    return res.status(422).json({ error: 'Name der Einladung fehlt oder ist zu lang (max. 100 Zeichen).' });
  }
  if (groupName.length > 80) {
    return res.status(422).json({ error: 'Gruppenname ist zu lang (max. 80 Zeichen).' });
  }
  if (!Number.isInteger(maxPersons) || maxPersons < 1 || maxPersons > 20) {
    return res.status(422).json({ error: 'Max. Personen muss zwischen 1 und 20 liegen.' });
  }

  try {
    const guests = loadGuests();
    const existingCodes = new Set(guests.map((guest) => String(guest.code || '').toUpperCase()));
    for (const row of db.prepare('SELECT code FROM rsvps').all()) {
      existingCodes.add(String(row.code).toUpperCase());
    }
    const code = generateReadableCode(existingCodes);
    guests.push({ code, name, maxPersons, group: groupName });
    saveGuests(guests);
    res.json({ success: true, code });
  } catch (e) {
    res.status(500).json({ error: 'Gruppe konnte nicht angelegt werden.' });
  }
});

app.post('/api/admin/groups/:code/generate-code', requireAdmin, (req, res) => {
  if (!requireJsonSameOrigin(req, res)) return;
  const oldCode = String(req.params.code || '').trim();
  const guests = loadGuests();
  const groupIndex = guests.findIndex((guest) => String(guest.code || '').toLowerCase() === oldCode.toLowerCase());
  if (groupIndex === -1) return res.status(404).json({ error: 'Gruppe nicht gefunden.' });

  const existingCodes = new Set(guests.map((guest) => String(guest.code || '').toUpperCase()));
  for (const row of db.prepare('SELECT code FROM rsvps').all()) {
    existingCodes.add(String(row.code).toUpperCase());
  }

  let newCode;
  try {
    newCode = generateReadableCode(existingCodes);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const oldGuests = guests.map((guest) => ({ ...guest }));
  guests[groupIndex] = { ...guests[groupIndex], code: newCode };
  let backup = null;

  try {
    backup = saveGuests(guests);

    const migrate = db.transaction(() => {
      const rsvp = db.prepare('SELECT * FROM rsvps WHERE UPPER(code) = ?').get(oldCode.toUpperCase());
      if (rsvp) {
        const collision = db.prepare('SELECT code FROM rsvps WHERE UPPER(code) = ?').get(newCode.toUpperCase());
        if (collision) throw new Error('Neuer Code kollidiert mit einer Rückmeldung.');
        db.prepare(`
          INSERT INTO rsvps (code, status, comment, submitted_at, updated_at)
          SELECT ?, status, comment, submitted_at, updated_at FROM rsvps WHERE UPPER(code) = ?
        `).run(newCode, oldCode.toUpperCase());
        db.prepare('UPDATE attendees SET rsvp_code = ? WHERE UPPER(rsvp_code) = ?')
          .run(newCode, oldCode.toUpperCase());
        db.prepare('UPDATE people SET rsvp_code = ? WHERE UPPER(rsvp_code) = ?')
          .run(newCode, oldCode.toUpperCase());
        db.prepare('DELETE FROM rsvps WHERE UPPER(code) = ?').run(oldCode.toUpperCase());
      } else {
        db.prepare('UPDATE people SET rsvp_code = ? WHERE UPPER(rsvp_code) = ?')
          .run(newCode, oldCode.toUpperCase());
      }
    });
    migrate();
    res.json({ success: true, code: newCode });
  } catch (e) {
    if (backup && fs.existsSync(backup)) {
      try { fs.copyFileSync(backup, path.join(DATA_DIR, 'guests.json')); } catch (restoreError) { /* ignorieren */ }
    } else {
      try { saveGuests(oldGuests); } catch (restoreError) { /* ignorieren */ }
    }
    console.error('Code generation failed:', e);
    res.status(500).json({ error: 'Neuer Code konnte nicht gespeichert werden.' });
  }
});

app.patch('/api/admin/groups/:code', requireAdmin, (req, res) => {
  if (!requireJsonSameOrigin(req, res)) return;
  const code = String(req.params.code || '').trim();
  const guests = loadGuests();
  const groupIndex = guests.findIndex((guest) => String(guest.code || '').toLowerCase() === code.toLowerCase());
  if (groupIndex === -1) return res.status(404).json({ error: 'Gruppe nicht gefunden.' });

  const body = req.body || {};
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = String(body.name || '').trim();
    if (!name || name.length > 100) {
      return res.status(422).json({ error: 'Name der Einladung fehlt oder ist zu lang.' });
    }
    guests[groupIndex].name = name;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'group')) {
    const groupName = String(body.group || '').trim();
    if (groupName.length > 80) {
      return res.status(422).json({ error: 'Gruppenname ist zu lang.' });
    }
    guests[groupIndex].group = groupName;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'maxPersons')) {
    const maxPersons = Number(body.maxPersons);
    if (!Number.isInteger(maxPersons) || maxPersons < 1 || maxPersons > 20) {
      return res.status(422).json({ error: 'Max. Personen muss zwischen 1 und 20 liegen.' });
    }
    guests[groupIndex].maxPersons = maxPersons;
  }

  try {
    saveGuests(guests);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Gruppe konnte nicht gespeichert werden.' });
  }
});

// Admin Overview
app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const guests = loadGuests();
  const menu = loadMenu();

  const rsvps = db.prepare('SELECT * FROM rsvps').all();
  const allAttendees = db.prepare('SELECT * FROM attendees').all();

  const rsvpMap = new Map();
  for (const r of rsvps) {
    rsvpMap.set(r.code.toUpperCase(), r);
  }

  const attendeeMap = new Map();
  for (const a of allAttendees) {
    const list = attendeeMap.get(a.rsvp_code.toUpperCase()) || [];
    list.push(a);
    attendeeMap.set(a.rsvp_code.toUpperCase(), list);
  }

  let confirmedParties = 0;
  let declinedParties = 0;
  let pendingParties = 0;
  let totalAttendingPersons = 0;

  const dishCounts = {};
  for (const m of (menu.mains || [])) {
    dishCounts[m.id] = { id: m.id, name: m.name, tag: m.tag, count: 0 };
  }
  dishCounts['none'] = { id: 'none', name: 'Keine Auswahl', tag: 'Ohne', count: 0 };

  const dietaryAlerts = [];

  const guestList = guests.map(g => {
    const rsvp = rsvpMap.get(g.code.toUpperCase());
    const attendees = attendeeMap.get(g.code.toUpperCase()) || [];

    let status = 'pending';
    if (rsvp) {
      status = rsvp.status;
      if (status === 'attending') {
        confirmedParties++;
        totalAttendingPersons += attendees.length;
        for (const att of attendees) {
          const dId = att.dish_id && dishCounts[att.dish_id] ? att.dish_id : 'none';
          dishCounts[dId].count++;

          if (att.dietary_notes && att.dietary_notes.trim()) {
            dietaryAlerts.push({
              guest: g.name,
              person: att.name,
              notes: att.dietary_notes
            });
          }
        }
      } else if (status === 'declined') {
        declinedParties++;
      }
    } else {
      pendingParties++;
    }

    return {
      code: g.code,
      name: g.name,
      group: g.group || '',
      maxPersons: g.maxPersons || 2,
      status: status,
      comment: rsvp ? rsvp.comment : '',
      submittedAt: rsvp ? rsvp.submitted_at : null,
      updatedAt: rsvp ? rsvp.updated_at : null,
      attendees: attendees.map(a => ({
        name: a.name,
        dishId: a.dish_id,
        dietaryNotes: a.dietary_notes
      }))
    };
  });

  res.json({
    metrics: {
      totalInvitedParties: guests.length,
      confirmedParties,
      declinedParties,
      pendingParties,
      totalAttendingPersons
    },
    dishBreakdown: Object.values(dishCounts),
    dietaryAlerts,
    guests: guestList
  });
});

// Admin Export CSV
app.get('/api/admin/export/csv', requireAdmin, (req, res) => {
  const guests = loadGuests();
  const menu = loadMenu();
  const rsvps = db.prepare('SELECT * FROM rsvps').all();
  const attendees = db.prepare('SELECT * FROM attendees').all();

  const menuDishMap = new Map();
  for (const m of (menu.mains || [])) {
    menuDishMap.set(m.id, `${m.name} (${m.tag})`);
  }

  const rsvpMap = new Map();
  for (const r of rsvps) {
    rsvpMap.set(r.code.toUpperCase(), r);
  }

  const attendeeMap = new Map();
  for (const a of attendees) {
    const list = attendeeMap.get(a.rsvp_code.toUpperCase()) || [];
    list.push(a);
    attendeeMap.set(a.rsvp_code.toUpperCase(), list);
  }

  // Create CSV with UTF-8 BOM for Excel compatibility
  let csv = '\uFEFF';
  csv += 'Code;Eingeladener Gast;Gruppe;Status;Person Name;Gericht;Allergien & Unverträglichkeiten;Kommentar;Datum\n';

  for (const g of guests) {
    const rsvp = rsvpMap.get(g.code.toUpperCase());
    const attList = attendeeMap.get(g.code.toUpperCase()) || [];

    const sanitize = (val) => `"${(val || '').toString().replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

    if (!rsvp) {
      csv += `${sanitize(g.code)};${sanitize(g.name)};${sanitize(g.group)};"Ausstehend";"";"";"";"";""\n`;
    } else if (rsvp.status === 'declined') {
      csv += `${sanitize(g.code)};${sanitize(g.name)};${sanitize(g.group)};"Abgesagt";"";"";"";${sanitize(rsvp.comment)};${sanitize(rsvp.updated_at || rsvp.submitted_at)}\n`;
    } else {
      if (attList.length === 0) {
        csv += `${sanitize(g.code)};${sanitize(g.name)};${sanitize(g.group)};"Zugesagt (ohne Personen)";"";"";"";${sanitize(rsvp.comment)};${sanitize(rsvp.updated_at || rsvp.submitted_at)}\n`;
      } else {
        for (const a of attList) {
          const dishName = menuDishMap.get(a.dish_id) || (a.dish_id ? a.dish_id : 'Keine Angabe');
          csv += `${sanitize(g.code)};${sanitize(g.name)};${sanitize(g.group)};"Zugesagt";${sanitize(a.name)};${sanitize(dishName)};${sanitize(a.dietary_notes)};${sanitize(rsvp.comment)};${sanitize(rsvp.updated_at || rsvp.submitted_at)}\n`;
        }
      }
    }
  }

  const filename = `Hochzeit_Bert_und_Bine_Gaeste_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// Admin QR Codes list for batch invitation printing
app.get('/api/admin/qrcodes', requireAdmin, async (req, res) => {
  const guests = loadGuests();
  const hostBaseUrl = process.env.BASE_URL || `http://${req.headers.host || 'hochzeit.bertundbine.de'}`;

  const qrList = [];
  for (const g of guests) {
    const guestUrl = `${hostBaseUrl}/?code=${encodeURIComponent(g.code)}`;
    try {
      const qrDataUrl = await QRCode.toDataURL(guestUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: '#2c2523',
          light: '#ffffff'
        }
      });
      qrList.push({
        code: g.code,
        name: g.name,
        group: g.group || '',
        url: guestUrl,
        qrDataUrl
      });
    } catch (err) {
      console.error('Error generating QR code for', g.code, err);
    }
  }

  res.json({ qrList });
});

// Fallback route for SPA
app.get('*', (req, res) => {
  if (req.path === '/admin' || req.path === '/admin.html') {
    return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server strictly on HOST (127.0.0.1 by default)
app.listen(PORT, HOST, () => {
  console.log(`Hochzeits-Webapp für Bert & Bine läuft auf http://${HOST}:${PORT}`);
  console.log(`Admin-Bereich: http://${HOST}:${PORT}/admin.html`);
});
