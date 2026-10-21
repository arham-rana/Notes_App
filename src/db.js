'use strict';

const crypto = require('crypto');
const Database = require('better-sqlite3');

const COLORS = ['blue', 'green', 'purple', 'red', 'amber', 'teal', 'pink', 'slate'];
const NOTE_ICONS = ['file', 'book', 'dumbbell', 'lightbulb', 'plane', 'heart', 'briefcase', 'cart', 'star', 'sparkles'];
const REMINDER_CATEGORIES = ['task', 'note', 'meeting', 'travel', 'health', 'reading', 'shopping'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const USERNAME = /^[a-z0-9._-]{3,30}$/;

// Field specs drive validation, column mapping and defaults for each table.
const TABLES = {
  notes: {
    title: { type: 'text', max: 200, default: 'Untitled' },
    summary: { type: 'text', max: 300, default: '' },
    content: { type: 'text', max: 500000, default: '' },
    icon: { type: 'text', oneOf: NOTE_ICONS, default: 'file' },
    color: { type: 'text', oneOf: COLORS, default: 'blue' },
    tag: { type: 'text', max: 40, default: '' },
    kind: { type: 'text', oneOf: ['note', 'project'], default: 'note' },
    favourite: { type: 'bool', default: false },
    layout: { type: 'text', oneOf: ['pageless', 'pages'], default: 'pageless' },
    pageSize: { type: 'text', oneOf: ['letter', 'legal', 'tabloid', 'a4', 'a5'], default: 'letter' },
    pageSetup: { type: 'text', max: 4000, default: '' }, // JSON: margins, orientation, header/footer, page numbers
  },
  reminders: {
    title: { type: 'text', max: 200, required: true },
    dueAt: { type: 'text', pattern: DATETIME, required: true },
    category: { type: 'text', oneOf: REMINDER_CATEGORIES, default: 'task' },
    completed: { type: 'bool', default: false },
    dismissed: { type: 'bool', default: false },
    noteId: { type: 'text', pattern: /^([0-9a-f-]{36})?$/, default: '' },
  },
  events: {
    title: { type: 'text', max: 200, required: true },
    date: { type: 'text', pattern: DATE, required: true },
    startTime: { type: 'text', pattern: TIME, default: '09:00' },
    endTime: { type: 'text', pattern: TIME, default: '10:00' },
    color: { type: 'text', oneOf: COLORS, default: 'blue' },
    location: { type: 'text', max: 200, default: '' },
    description: { type: 'text', max: 5000, default: '' },
  },
};

const UUID = /^[0-9a-f-]{36}$/;
const SETTINGS_DEFAULTS = {
  theme: 'system',
  headerImage: null,
  headerPosition: 'center',
  eventAlertMinutes: 15,
  weekStartsOn: 0,
  dismissedAlerts: [],
};
const SETTING_RULES = {
  theme: (v) => ['system', 'light', 'dark'].includes(v),
  headerImage: (v) => v === null || (typeof v === 'string' && UUID.test(v)),
  headerPosition: (v) => ['top', 'center', 'bottom'].includes(v),
  eventAlertMinutes: (v) => Number.isInteger(v) && v >= 0 && v <= 1440,
  weekStartsOn: (v) => v === 0 || v === 1,
  dismissedAlerts: (v) => Array.isArray(v) && v.length <= 2000 && v.every((x) => typeof x === 'string'),
};

const toSnake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
const badRequest = (m) => httpError(400, m);

function validate(kind, input, { partial }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('Expected a JSON object');
  const spec = TABLES[kind];
  const out = {};
  for (const [field, rule] of Object.entries(spec)) {
    if (!(field in input)) {
      if (partial) continue;
      if (rule.required) throw badRequest(`"${field}" is required`);
      out[field] = rule.default;
      continue;
    }
    let value = input[field];
    if (rule.type === 'bool') {
      value = Boolean(value);
    } else {
      if (typeof value !== 'string') throw badRequest(`"${field}" must be text`);
      value = field === 'content' || field === 'description' ? value : value.trim();
      if (rule.required && !value) throw badRequest(`"${field}" can't be empty`);
      if (rule.max && value.length > rule.max) throw badRequest(`"${field}" is longer than ${rule.max} characters`);
      if (rule.oneOf && !rule.oneOf.includes(value)) throw badRequest(`"${field}" must be one of: ${rule.oneOf.join(', ')}`);
      if (rule.pattern && !rule.pattern.test(value)) throw badRequest(`"${field}" has an invalid format`);
    }
    out[field] = value;
  }
  if (kind === 'events') {
    const start = out.startTime ?? input.startTime;
    const end = out.endTime ?? input.endTime;
    if (start && end && end <= start) throw badRequest('End time must be after start time');
  }
  return out;
}

/* ---------- Passwords ---------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}
// Used to spend the same time on unknown usernames, so attackers can't probe which accounts exist.
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 8) throw badRequest('Password must be at least 8 characters');
  if (password.length > 200) throw badRequest('Password is too long');
}
function cleanUsername(u) {
  const v = cleanUsernameRaw(u);
  if (/^guest-/.test(v)) throw badRequest('Usernames can’t start with “guest-”');
  return v;
}
function cleanUsernameRaw(username) {
  const u = String(username || '').trim().replace(/^@/, '').toLowerCase();
  if (!USERNAME.test(u)) throw badRequest('Usernames are 3–30 characters: letters, numbers, dots, dashes or underscores');
  return u;
}
function cleanName(name) {
  const n = String(name || '').trim();
  if (!n) throw badRequest('Enter your name');
  if (n.length > 60) throw badRequest('Name must be 60 characters or fewer');
  return n;
}

const SESSION_DAYS = 30;
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

function openDatabase(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL, color TEXT NOT NULL,
      tag TEXT NOT NULL DEFAULT '', cover TEXT NOT NULL DEFAULT 'none', kind TEXT NOT NULL DEFAULT 'note',
      favourite INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, due_at TEXT NOT NULL, category TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0, dismissed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL, start_time TEXT NOT NULL,
      end_time TEXT NOT NULL, color TEXT NOT NULL, location TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    );
    CREATE TABLE IF NOT EXISTS note_shares (
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL CHECK (permission IN ('view', 'edit')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (note_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note_id TEXT, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS note_versions (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      user_id TEXT,
      title TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL,
      taken_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_versions_note ON note_versions(note_id, created_at);
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
      name TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);
    CREATE TABLE IF NOT EXISTS note_folders (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, note_id)
    );
    CREATE TABLE IF NOT EXISTS user_words (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      word TEXT NOT NULL,
      PRIMARY KEY (user_id, word)
    );
    CREATE TABLE IF NOT EXISTS signatures (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      signer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      label TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
      signed_by TEXT, signed_name TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '',
      signed_at TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_signatures_note ON signatures(note_id);
    CREATE TABLE IF NOT EXISTS note_ydocs (
      note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
      state BLOB NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_alerts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, snippet TEXT NOT NULL DEFAULT '', read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_alerts ON user_alerts(user_id, read);
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL, color TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
      tag TEXT NOT NULL DEFAULT '', cover TEXT NOT NULL DEFAULT 'none', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS note_pins (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      pinned_at TEXT NOT NULL,
      PRIMARY KEY (user_id, note_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
      quote TEXT NOT NULL DEFAULT '', prefix TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_note ON comments(note_id);
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
    CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
    CREATE INDEX IF NOT EXISTS idx_files_note ON files(note_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(due_at);
    CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
    CREATE INDEX IF NOT EXISTS idx_shares_user ON note_shares(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `);

  // Share links ("Anyone with the link") and the guests who use them.
  db.exec(`
    CREATE TABLE IF NOT EXISTS share_links (
      note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE, permission TEXT NOT NULL DEFAULT 'view', enabled INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT, expires_at TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
  `);
  // Accounts used to sign in with an email; they now use a username.
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('kind')) {
    db.exec("ALTER TABLE users ADD COLUMN kind TEXT NOT NULL DEFAULT 'member'"); // 'member' or 'guest' (someone using a share link)
    db.exec('ALTER TABLE users ADD COLUMN guest_note_id TEXT');
    db.exec('ALTER TABLE users ADD COLUMN guest_link_version INTEGER');
  }
  if (!userCols.includes('username')) {
    db.exec('ALTER TABLE users ADD COLUMN username TEXT');
    const taken = new Set();
    for (const u of db.prepare('SELECT id, email FROM users ORDER BY created_at').all()) {
      let base = String(u.email).split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 26);
      if (base.length < 3) base = `user${base}`;
      let name = base, n = 2;
      while (taken.has(name)) name = `${base}${n++}`;
      taken.add(name);
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(name, u.id);
    }
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)');

  // Trash (soft delete) and who last edited each document (for version history).
  const noteCols = db.prepare('PRAGMA table_info(notes)').all().map((c) => c.name);
  if (!noteCols.includes('deleted_at')) db.exec('ALTER TABLE notes ADD COLUMN deleted_at TEXT');
  if (!noteCols.includes('last_edited_by')) db.exec('ALTER TABLE notes ADD COLUMN last_edited_by TEXT');
  if (!noteCols.includes('layout')) db.exec("ALTER TABLE notes ADD COLUMN layout TEXT NOT NULL DEFAULT 'pageless'");
  if (!noteCols.includes('page_size')) db.exec("ALTER TABLE notes ADD COLUMN page_size TEXT NOT NULL DEFAULT 'letter'");
  if (!noteCols.includes('page_setup')) db.exec("ALTER TABLE notes ADD COLUMN page_setup TEXT NOT NULL DEFAULT ''");

  // Covers were removed: clear any that were set.
  db.exec("UPDATE notes SET cover = 'none' WHERE cover IS NOT NULL AND cover != 'none'");
  // Reminders can link to a document.
  const remCols = db.prepare('PRAGMA table_info(reminders)').all().map((c) => c.name);
  if (!remCols.includes('note_id')) db.exec("ALTER TABLE reminders ADD COLUMN note_id TEXT NOT NULL DEFAULT ''");
  // Comment notifications moved to user_alerts (which also holds @mentions in documents).
  db.exec(`INSERT OR IGNORE INTO user_alerts (id, user_id, note_id, comment_id, actor_id, kind, snippet, read, created_at)
           SELECT id, user_id, note_id, comment_id, actor_id, kind, '', read, created_at FROM notifications`);

  // Migrate single-user databases: give every item an owner column.
  for (const kind of Object.keys(TABLES)) {
    const cols = db.prepare(`PRAGMA table_info(${kind})`).all().map((c) => c.name);
    if (!cols.includes('user_id')) db.exec(`ALTER TABLE ${kind} ADD COLUMN user_id TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${kind}_user ON ${kind}(user_id)`);
  }

  // Indexes for less common lookups (guest clean-up, account deletion, Trash clean-up).
  // Created after every column upgrade above, so they also work on brand-new databases.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id);
    CREATE INDEX IF NOT EXISTS idx_versions_user ON note_versions(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_guest ON users(guest_note_id) WHERE kind = 'guest';
    CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes(deleted_at) WHERE deleted_at IS NOT NULL;
  `);


  const rowToObject = (kind, row) => {
    if (!row) return undefined;
    const obj = {};
    for (const [col, val] of Object.entries(row)) {
      if (col === 'user_id' || col === 'deleted_at' || col === 'last_edited_by' || col === 'cover') continue; // cover: removed feature (column kept for old databases)
      const key = toCamel(col);
      obj[key] = TABLES[kind][key]?.type === 'bool' ? Boolean(val) : val;
    }
    // Favourites are the owner's own; people a note is shared with don't see them.
    if (kind === 'notes' && obj.access && obj.access !== 'owner') obj.favourite = false;
    if (kind === 'notes' && 'pinned' in obj) obj.pinned = !!obj.pinned;
    if (kind === 'notes' && 'folderId' in obj) obj.folderId = obj.folderId || null;
    return obj;
  };
  const toColumns = (kind, data) => {
    const cols = {};
    for (const [key, val] of Object.entries(data)) {
      cols[toSnake(key)] = TABLES[kind][key]?.type === 'bool' ? (val ? 1 : 0) : val;
    }
    return cols;
  };
  const orderBy = { notes: 'updated_at DESC', reminders: 'due_at ASC', events: 'date ASC, start_time ASC' };

  // Notes you own plus notes shared with you, with your level of access.
  const NOTE_SELECT = `
    SELECT n.*, n.user_id AS owner_id, u.name AS owner_name, u.username AS owner_username, 'owner' AS access,
           (SELECT COUNT(*) FROM note_shares s WHERE s.note_id = n.id) AS share_count,
           (SELECT COUNT(*) FROM comments c WHERE c.note_id = n.id AND c.parent_id IS NULL AND c.resolved = 0) AS comment_count,
           EXISTS(SELECT 1 FROM note_pins p WHERE p.note_id = n.id AND p.user_id = @uid) AS pinned,
           (SELECT nf.folder_id FROM note_folders nf WHERE nf.note_id = n.id AND nf.user_id = @uid) AS folder_id
      FROM notes n JOIN users u ON u.id = n.user_id
     WHERE n.user_id = @uid AND n.deleted_at IS NULL %EXTRA%
    UNION ALL
    SELECT n.*, n.user_id AS owner_id, u.name AS owner_name, u.username AS owner_username, s.permission AS access, 0 AS share_count,
           (SELECT COUNT(*) FROM comments c WHERE c.note_id = n.id AND c.parent_id IS NULL AND c.resolved = 0) AS comment_count,
           EXISTS(SELECT 1 FROM note_pins p WHERE p.note_id = n.id AND p.user_id = @uid) AS pinned,
           (SELECT nf.folder_id FROM note_folders nf WHERE nf.note_id = n.id AND nf.user_id = @uid) AS folder_id
      FROM notes n JOIN note_shares s ON s.note_id = n.id JOIN users u ON u.id = n.user_id
     WHERE s.user_id = @uid AND n.deleted_at IS NULL %EXTRA%`;
  const noteQuery = (extra = '') => NOTE_SELECT.replace(/%EXTRA%/g, extra);

  const api = {
    /* ----- Items ----- */
    list(kind, uid) {
      if (kind === 'notes') {
        return db.prepare(`${noteQuery()} ORDER BY updated_at DESC`).all({ uid }).map((r) => rowToObject(kind, r));
      }
      return db.prepare(`SELECT * FROM ${kind} WHERE user_id = ? ORDER BY ${orderBy[kind]}`).all(uid).map((r) => rowToObject(kind, r));
    },
    get(kind, id, uid) {
      if (kind === 'notes') return rowToObject(kind, db.prepare(noteQuery('AND n.id = @id')).get({ uid, id }));
      return rowToObject(kind, db.prepare(`SELECT * FROM ${kind} WHERE id = ? AND user_id = ?`).get(id, uid));
    },
    create(kind, input, uid, { keepIdentity = false } = {}) {
      const data = validate(kind, input, { partial: false });
      const now = new Date().toISOString();
      const cols = toColumns(kind, data);
      cols.id = keepIdentity && typeof input.id === 'string' && !db.prepare(`SELECT 1 FROM ${kind} WHERE id = ?`).get(input.id) ? input.id : crypto.randomUUID();
      cols.created_at = keepIdentity && input.createdAt ? String(input.createdAt) : now;
      cols.updated_at = keepIdentity && input.updatedAt ? String(input.updatedAt) : now;
      cols.user_id = uid;
      const names = Object.keys(cols);
      db.prepare(`INSERT INTO ${kind} (${names.join(',')}) VALUES (${names.map((n) => '@' + n).join(',')})`).run(cols);
      return api.get(kind, cols.id, uid);
    },
    update(kind, id, input, uid, { fromCollab = false } = {}) {
      if (kind === 'notes' && input && typeof input.pageSetup === 'string' && input.pageSetup) {
        let ok = false;
        try { const v = JSON.parse(input.pageSetup); ok = v && typeof v === 'object' && !Array.isArray(v); } catch { ok = false; }
        if (!ok) throw badRequest('Page setup is not valid');
      }
      const existing = api.get(kind, id, uid);
      if (!existing) return undefined;
      if (kind === 'notes' && existing.access === 'view') throw httpError(403, 'You can view this note but not change it');
      const data = validate(kind, input, { partial: true });
      // Favourite and type belong to the owner's own organisation.
      if (kind === 'notes' && existing.access !== 'owner') { delete data.favourite; delete data.kind; }
      if (kind === 'reminders' && 'dueAt' in data && !('dismissed' in data)) data.dismissed = false;
      if (kind === 'events') {
        const merged = { ...existing, ...data };
        if (merged.endTime <= merged.startTime) throw badRequest('End time must be after start time');
      }
      if (kind === 'notes' && (('content' in data && data.content !== existing.content) || ('title' in data && data.title !== existing.title))) {
        api.snapshot(id, uid);
      }
      if (kind === 'notes' && 'content' in data && data.content !== existing.content && data.content.includes('@')) {
        api.notifyDocMentions(id, uid, existing.content, data.content);
      }
      const cols = toColumns(kind, data);
      if (kind === 'notes' && ('content' in data || 'title' in data)) cols.last_edited_by = uid;
      const touch = !(kind === 'notes' && Object.keys(data).every((k) => k === 'favourite'));
      if (touch && Object.keys(cols).length) cols.updated_at = new Date().toISOString();
      const names = Object.keys(cols);
      if (names.length) {
        db.prepare(`UPDATE ${kind} SET ${names.map((n) => `${n} = @${n}`).join(', ')} WHERE id = @id`).run({ ...cols, id });
      }
      if (kind === 'notes' && !fromCollab && 'content' in data && data.content !== existing.content) api.onContentChange?.(id, data.content);
      return api.get(kind, id, uid);
    },
    remove(kind, id, uid) {
      const owned = db.prepare(`SELECT 1 FROM ${kind} WHERE id = ? AND user_id = ?`).get(id, uid);
      if (!owned) {
        if (kind === 'notes' && api.get(kind, id, uid)) throw httpError(403, 'Only the owner can delete this note. You can remove it from your notes instead.');
        return false;
      }
      // Documents go to the Trash first; they're removed for good after 30 days.
      if (kind === 'notes') return db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(new Date().toISOString(), id).changes > 0;
      return db.prepare(`DELETE FROM ${kind} WHERE id = ?`).run(id).changes > 0;
    },

    /* ----- Sharing ----- */
    listShares(noteId, uid) {
      const note = db.prepare('SELECT user_id FROM notes WHERE id = ?').get(noteId);
      if (!note || note.user_id !== uid) throw httpError(404, 'Note not found');
      return db.prepare(`SELECT u.id AS userId, u.name, u.username, s.permission FROM note_shares s JOIN users u ON u.id = s.user_id
                          WHERE s.note_id = ? AND u.kind != 'guest' ORDER BY u.name`).all(noteId);
    },
    addShare(noteId, uid, { username, permission }) {
      const note = db.prepare('SELECT user_id FROM notes WHERE id = ?').get(noteId);
      if (!note || note.user_id !== uid) throw httpError(404, 'Note not found');
      if (!['view', 'edit'].includes(permission)) throw badRequest('Choose "Can view" or "Can edit"');
      const target = db.prepare("SELECT id FROM users WHERE username = ? AND kind != 'guest'").get(cleanUsername(username));
      if (!target) throw httpError(404, 'No one has that username. Check the spelling, or ask them to sign up first.');
      if (target.id === uid) throw badRequest("That's your own account");
      db.prepare(`INSERT INTO note_shares (note_id, user_id, permission, created_at) VALUES (?, ?, ?, ?)
                  ON CONFLICT(note_id, user_id) DO UPDATE SET permission = excluded.permission`).run(noteId, target.id, permission, new Date().toISOString());
      return api.listShares(noteId, uid);
    },
    updateShare(noteId, uid, targetId, permission) {
      if (!['view', 'edit'].includes(permission)) throw badRequest('Choose "Can view" or "Can edit"');
      const shares = api.listShares(noteId, uid);
      if (!shares.some((s) => s.userId === targetId)) throw httpError(404, 'That person no longer has access');
      db.prepare('UPDATE note_shares SET permission = ? WHERE note_id = ? AND user_id = ?').run(permission, noteId, targetId);
      return api.listShares(noteId, uid);
    },
    /** The owner can remove anyone; anyone can remove themselves. */
    removeShare(noteId, uid, targetId) {
      const note = db.prepare('SELECT user_id FROM notes WHERE id = ?').get(noteId);
      if (!note || (note.user_id !== uid && targetId !== uid)) throw httpError(404, 'Note not found');
      db.prepare('DELETE FROM note_shares WHERE note_id = ? AND user_id = ?').run(noteId, targetId);
      db.prepare('DELETE FROM note_pins WHERE note_id = ? AND user_id = ?').run(noteId, targetId);
      return note.user_id === uid ? api.listShares(noteId, uid) : [];
    },

    /* ----- Live documents (co-editing) ----- */
    onContentChange: null,
    loadYState(noteId) { return db.prepare('SELECT state FROM note_ydocs WHERE note_id = ?').get(noteId)?.state || null; },
    saveYState(noteId, state) {
      if (!db.prepare('SELECT 1 FROM notes WHERE id = ?').get(noteId)) return;
      db.prepare('INSERT INTO note_ydocs (note_id, state, updated_at) VALUES (?, ?, ?) ON CONFLICT(note_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at').run(noteId, state, new Date().toISOString());
    },
    clearYState(noteId) { db.prepare('DELETE FROM note_ydocs WHERE note_id = ?').run(noteId); },
    noteContent(noteId) { return db.prepare('SELECT content FROM notes WHERE id = ?').get(noteId)?.content || ''; },
    /** Text saved from the live editor (doesn't push back into the live document). */
    saveContentFromCollab(noteId, markdown, uid) {
      const note = api.get('notes', noteId, uid);
      if (!note || note.access === 'view' || note.content === markdown) return;
      api.update('notes', noteId, { content: markdown }, uid, { fromCollab: true });
    },

    /* ----- Personal dictionary (words spelling checks should accept) ----- */
    listWords(uid) { return db.prepare('SELECT word FROM user_words WHERE user_id = ? ORDER BY word COLLATE NOCASE').all(uid).map((r) => r.word); },
    addWord(uid, word) {
      const w = String(word || '').trim();
      if (!w || w.length > 60 || /\s/.test(w)) throw badRequest('Add one word at a time');
      if (db.prepare('SELECT COUNT(*) AS c FROM user_words WHERE user_id = ?').get(uid).c >= 5000) throw badRequest('Your dictionary is full (5,000 words)');
      db.prepare('INSERT OR IGNORE INTO user_words (user_id, word) VALUES (?, ?)').run(uid, w);
      return api.listWords(uid);
    },
    removeWord(uid, word) { db.prepare('DELETE FROM user_words WHERE user_id = ? AND word = ?').run(uid, String(word)); return api.listWords(uid); },

    /* ----- Signatures: requested in a document, signed once, then locked ----- */
    sigRow(r) {
      if (!r) return null;
      const name = (id) => (id ? db.prepare('SELECT name, username FROM users WHERE id = ?').get(id) : null);
      const signer = name(r.signer_id), req = name(r.requested_by), by = name(r.signed_by);
      return {
        id: r.id, noteId: r.note_id, label: r.label, status: r.status,
        signer: signer ? { id: r.signer_id, name: signer.name, username: signer.username } : null,
        requestedBy: req ? { id: r.requested_by, name: req.name, username: req.username } : null,
        signedBy: by ? { id: r.signed_by, name: by.name, username: by.username } : null,
        signedName: r.signed_name, image: r.image, signedAt: r.signed_at, createdAt: r.created_at,
      };
    },
    listSignatures(noteId, uid) {
      if (!api.get('notes', noteId, uid)) throw httpError(404, 'Document not found');
      return db.prepare('SELECT * FROM signatures WHERE note_id = ? ORDER BY created_at').all(noteId).map((r) => api.sigRow(r));
    },
    requestSignature(noteId, uid, { signer = '', label = '' }) {
      const note = api.get('notes', noteId, uid);
      if (!note) throw httpError(404, 'Document not found');
      if (note.access === 'view') throw httpError(403, 'You can view this document but not change it');
      let signerId = null;
      if (signer) {
        const u = db.prepare('SELECT id FROM users WHERE username = ?').get(String(signer).replace(/^@/, '').toLowerCase());
        if (!u || !api.get('notes', noteId, u.id)) throw badRequest('That person can’t open this document. Share it with them first.');
        signerId = u.id;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare('INSERT INTO signatures (id, note_id, requested_by, signer_id, label, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, noteId, uid, signerId, String(label).trim().slice(0, 80), 'pending', now);
      if (signerId && signerId !== uid) {
        db.prepare('INSERT INTO user_alerts (id, user_id, note_id, comment_id, actor_id, kind, snippet, read, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, 0, ?)')
          .run(crypto.randomUUID(), signerId, noteId, uid, 'signature', String(label).trim().slice(0, 80), now);
      }
      return api.sigRow(db.prepare('SELECT * FROM signatures WHERE id = ?').get(id));
    },
    signSignature(sigId, uid, { name, image }) {
      const r = db.prepare('SELECT * FROM signatures WHERE id = ?').get(sigId);
      if (!r || !api.get('notes', r.note_id, uid)) throw httpError(404, 'Signature box not found');
      if (r.status !== 'pending') throw httpError(409, 'This has already been signed and is locked');
      if (r.signer_id && r.signer_id !== uid) throw httpError(403, 'This signature was requested from someone else');
      const n = String(name || '').trim();
      if (!n) throw badRequest('Type your full name');
      const m = String(image || '').match(/^\/api\/files\/([0-9a-f-]{36})$/);
      if (!m || !db.prepare('SELECT 1 FROM files WHERE id = ? AND user_id = ?').get(m[1], uid)) throw badRequest('Add your signature first');
      const now = new Date().toISOString();
      const done = db.prepare("UPDATE signatures SET status = 'signed', signed_by = ?, signed_name = ?, image = ?, signed_at = ? WHERE id = ? AND status = 'pending'").run(uid, n.slice(0, 80), image, now, sigId);
      if (!done.changes) throw httpError(409, 'This has already been signed and is locked');
      if (r.requested_by !== uid) {
        db.prepare('INSERT INTO user_alerts (id, user_id, note_id, comment_id, actor_id, kind, snippet, read, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, 0, ?)')
          .run(crypto.randomUUID(), r.requested_by, r.note_id, uid, 'signed', r.label || '', now);
      }
      return api.sigRow(db.prepare('SELECT * FROM signatures WHERE id = ?').get(sigId));
    },
    signaturesByIds(ids) {
      if (!ids.length) return new Map();
      return new Map(db.prepare(`SELECT * FROM signatures WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((r) => [r.id, api.sigRow(r)]));
    },

    /* ----- Version history ----- */
    /**
     * Save the document as it is now, before a change. Edits are grouped: a new
     * version starts after 10 minutes, or when a different person starts editing.
     */
    snapshot(noteId, uid, { force = false } = {}) {
      const note = db.prepare('SELECT title, content, user_id, last_edited_by, updated_at FROM notes WHERE id = ?').get(noteId);
      if (!note) return;
      // created_at = when that content was saved (shown to people); taken_at = when we captured it.
      const last = db.prepare('SELECT taken_at FROM note_versions WHERE note_id = ? ORDER BY taken_at DESC LIMIT 1').get(noteId);
      const editor = note.last_edited_by || note.user_id;
      const stale = !last || editor !== uid || Date.now() - Date.parse(last.taken_at) > 10 * 60000;
      if (!force && !stale) return;
      const lastVersion = db.prepare('SELECT title, content FROM note_versions WHERE note_id = ? ORDER BY created_at DESC LIMIT 1').get(noteId);
      if (lastVersion && lastVersion.title === note.title && lastVersion.content === note.content) return;
      const now = new Date().toISOString();
      db.prepare('INSERT INTO note_versions (id, note_id, user_id, title, content, created_at, taken_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), noteId, editor, note.title, note.content, note.updated_at || now, now);
      db.prepare(`DELETE FROM note_versions WHERE note_id = ? AND id NOT IN
                  (SELECT id FROM note_versions WHERE note_id = ? ORDER BY created_at DESC LIMIT 100)`).run(noteId, noteId);
    },
    listVersions(noteId, uid) {
      const note = api.get('notes', noteId, uid);
      if (!note) throw httpError(404, 'Document not found');
      const cur = db.prepare('SELECT n.updated_at, u.name FROM notes n LEFT JOIN users u ON u.id = COALESCE(n.last_edited_by, n.user_id) WHERE n.id = ?').get(noteId);
      const rows = db.prepare(`SELECT v.id, v.title, length(v.content) AS size, v.created_at, CASE WHEN u.kind = 'guest' THEN u.name || ' (guest)' ELSE u.name END AS author FROM note_versions v
                                LEFT JOIN users u ON u.id = v.user_id WHERE v.note_id = ? ORDER BY v.created_at DESC`).all(noteId);
      return {
        current: { updatedAt: cur.updated_at, author: cur.name || 'Someone' },
        canRestore: note.access !== 'view',
        versions: rows.map((r) => ({ id: r.id, title: r.title, size: r.size, createdAt: r.created_at, author: r.author || 'Someone' })),
      };
    },
    getVersion(noteId, versionId, uid) {
      if (!api.get('notes', noteId, uid)) throw httpError(404, 'Document not found');
      const v = db.prepare('SELECT id, title, content, created_at FROM note_versions WHERE id = ? AND note_id = ?').get(versionId, noteId);
      if (!v) throw httpError(404, 'That version no longer exists');
      return { id: v.id, title: v.title, content: v.content, createdAt: v.created_at };
    },
    restoreVersion(noteId, versionId, uid) {
      const note = api.get('notes', noteId, uid);
      if (!note) throw httpError(404, 'Document not found');
      if (note.access === 'view') throw httpError(403, 'You can view this document but not change it');
      const v = api.getVersion(noteId, versionId, uid);
      api.snapshot(noteId, uid, { force: true }); // keep what's there now, so restoring can be undone
      return api.update('notes', noteId, { title: v.title, content: v.content }, uid);
    },

    /* ----- Trash ----- */
    listTrash(uid) {
      return db.prepare(`SELECT id, title, icon, color, summary, deleted_at FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all(uid)
        .map((n) => ({ id: n.id, title: n.title, icon: n.icon, color: n.color, summary: n.summary, deletedAt: n.deleted_at }));
    },
    restoreFromTrash(noteId, uid) {
      const r = db.prepare('UPDATE notes SET deleted_at = NULL WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL').run(noteId, uid);
      if (!r.changes) throw httpError(404, 'That document isn’t in Deleted');
      return api.get('notes', noteId, uid);
    },
    /** Remove documents for good; returns their file ids so the files can be deleted too. */
    purgeNotes(where, ...params) {
      const ids = db.prepare(`SELECT id FROM notes WHERE deleted_at IS NOT NULL AND ${where}`).all(...params).map((r) => r.id);
      const fileIds = [];
      db.transaction(() => {
        for (const id of ids) {
          fileIds.push(...api.fileIdsForNote(id));
          db.prepare('DELETE FROM files WHERE note_id = ?').run(id);
          db.prepare('DELETE FROM notes WHERE id = ?').run(id);
        }
      })();
      return { count: ids.length, fileIds };
    },
    deleteForever(noteId, uid) { return api.purgeNotes('id = ? AND user_id = ?', noteId, uid); },
    emptyTrash(uid) { return api.purgeNotes('user_id = ?', uid); },
    purgeExpiredTrash(days = 30) { return api.purgeNotes('deleted_at < ?', new Date(Date.now() - days * 86400000).toISOString()); },

    /* ----- Folders (each person's own, can be nested) ----- */
    listFolders(uid) {
      return db.prepare('SELECT id, parent_id, name, created_at FROM folders WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(uid)
        .map((f) => ({ id: f.id, parentId: f.parent_id || null, name: f.name, createdAt: f.created_at }));
    },
    folderOwned(id, uid) { return db.prepare('SELECT * FROM folders WHERE id = ? AND user_id = ?').get(id, uid); },
    cleanFolderName(name) {
      const n = String(name || '').trim().replace(/\s+/g, ' ');
      if (!n) throw badRequest('Give the folder a name');
      if (n.length > 60) throw badRequest('Folder names can be up to 60 characters');
      return n;
    },
    createFolder(uid, { name, parentId = null }) {
      if (parentId && !api.folderOwned(parentId, uid)) throw httpError(404, 'That folder no longer exists');
      if (db.prepare('SELECT COUNT(*) AS c FROM folders WHERE user_id = ?').get(uid).c >= 500) throw badRequest('You can have up to 500 folders');
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO folders (id, user_id, parent_id, name, created_at) VALUES (?, ?, ?, ?, ?)').run(id, uid, parentId || null, api.cleanFolderName(name), new Date().toISOString());
      return { id, folders: api.listFolders(uid) };
    },
    updateFolder(uid, id, { name, parentId }) {
      const f = api.folderOwned(id, uid);
      if (!f) throw httpError(404, 'That folder no longer exists');
      if (name !== undefined) db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(api.cleanFolderName(name), id);
      if (parentId !== undefined) {
        const target = parentId || null;
        if (target) {
          if (!api.folderOwned(target, uid)) throw httpError(404, 'That folder no longer exists');
          // A folder can't go inside itself or one of its own subfolders.
          for (let cur = target; cur; cur = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(cur)?.parent_id) {
            if (cur === id) throw badRequest('A folder can’t go inside itself');
          }
        }
        db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(target, id);
      }
      return api.listFolders(uid);
    },
    /** Deleting a folder moves its documents and subfolders up one level; nothing else is deleted. */
    deleteFolder(uid, id) {
      const f = api.folderOwned(id, uid);
      if (!f) throw httpError(404, 'That folder no longer exists');
      db.transaction(() => {
        db.prepare('UPDATE folders SET parent_id = ? WHERE parent_id = ? AND user_id = ?').run(f.parent_id || null, id, uid);
        if (f.parent_id) db.prepare('UPDATE note_folders SET folder_id = ? WHERE folder_id = ? AND user_id = ?').run(f.parent_id, id, uid);
        else db.prepare('DELETE FROM note_folders WHERE folder_id = ? AND user_id = ?').run(id, uid);
        db.prepare('DELETE FROM folders WHERE id = ?').run(id);
      })();
      return api.listFolders(uid);
    },
    setNoteFolder(uid, noteId, folderId) {
      if (!api.get('notes', noteId, uid)) throw httpError(404, 'Document not found');
      if (folderId) {
        if (!api.folderOwned(folderId, uid)) throw httpError(404, 'That folder no longer exists');
        db.prepare('INSERT INTO note_folders (user_id, note_id, folder_id) VALUES (?, ?, ?) ON CONFLICT(user_id, note_id) DO UPDATE SET folder_id = excluded.folder_id').run(uid, noteId, folderId);
      } else db.prepare('DELETE FROM note_folders WHERE user_id = ? AND note_id = ?').run(uid, noteId);
      return api.get('notes', noteId, uid);
    },

    /* ----- Pins (each person's own; keeps a document at the top of their list) ----- */
    setPinned(noteId, uid, pinned) {
      if (!api.get('notes', noteId, uid)) throw httpError(404, 'Document not found');
      if (pinned) db.prepare('INSERT OR IGNORE INTO note_pins (user_id, note_id, pinned_at) VALUES (?, ?, ?)').run(uid, noteId, new Date().toISOString());
      else db.prepare('DELETE FROM note_pins WHERE user_id = ? AND note_id = ?').run(uid, noteId);
      return api.get('notes', noteId, uid);
    },

    /* ----- Comments ----- */
    listComments(noteId, uid) {
      if (!api.get('notes', noteId, uid)) throw httpError(404, 'Document not found');
      const owner = db.prepare('SELECT user_id FROM notes WHERE id = ?').get(noteId).user_id;
      return db.prepare(`SELECT c.*, u.name AS author_name, u.username AS author_username FROM comments c JOIN users u ON u.id = c.user_id
                          WHERE c.note_id = ? ORDER BY c.created_at`).all(noteId).map((c) => ({
        id: c.id, parentId: c.parent_id, quote: c.quote, prefix: c.prefix, body: c.body, resolved: !!c.resolved,
        createdAt: c.created_at, updatedAt: c.updated_at,
        author: { id: c.user_id, name: c.author_name, username: c.author_username },
        canDelete: c.user_id === uid || owner === uid,
      }));
    },
    /** Anyone who can open a document can comment on it, including view-only. */
    addComment(noteId, uid, { body, quote = '', prefix = '', parentId = null }) {
      const note = api.get('notes', noteId, uid);
      if (!note) throw httpError(404, 'Document not found');
      const text = String(body || '').trim();
      if (!text) throw badRequest('Write a comment first');
      if (text.length > 5000) throw badRequest('Comments can be up to 5,000 characters');
      let root = null;
      if (parentId) {
        root = db.prepare('SELECT * FROM comments WHERE id = ? AND note_id = ?').get(parentId, noteId);
        if (!root) throw httpError(404, 'That comment no longer exists');
        if (root.parent_id) root = db.prepare('SELECT * FROM comments WHERE id = ?').get(root.parent_id);
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare(`INSERT INTO comments (id, note_id, user_id, parent_id, quote, prefix, body, resolved, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
          .run(id, noteId, uid, root ? root.id : null, root ? '' : String(quote).slice(0, 500), root ? '' : String(prefix).slice(-60), text, now, now);
        // Notify the owner, plus everyone already in the conversation (for replies).
        const ownerId = db.prepare('SELECT user_id FROM notes WHERE id = ?').get(noteId).user_id;
        const people = new Set([ownerId]);
        if (root) {
          people.add(root.user_id);
          for (const r of db.prepare('SELECT user_id FROM comments WHERE parent_id = ?').all(root.id)) people.add(r.user_id);
          if (root.resolved) db.prepare('UPDATE comments SET resolved = 0 WHERE id = ?').run(root.id); // a reply reopens it
        }
        // People @mentioned in the comment get a "mentioned you" notification instead.
        const mentioned = new Set(api.mentionedUserIds(text, noteId));
        mentioned.delete(uid);
        people.delete(uid);
        const ins = db.prepare('INSERT INTO user_alerts (id, user_id, note_id, comment_id, actor_id, kind, snippet, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)');
        for (const person of new Set([...people, ...mentioned])) {
          // Only people who can still open the document.
          if (api.get('notes', noteId, person)) ins.run(crypto.randomUUID(), person, noteId, id, uid, mentioned.has(person) ? 'mention' : root ? 'reply' : 'comment', text.slice(0, 160), now);
        }
      })();
      return api.listComments(noteId, uid);
    },
    updateComment(commentId, uid, { resolved, body }) {
      const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
      if (!c || !api.get('notes', c.note_id, uid)) throw httpError(404, 'Comment not found');
      if (body !== undefined) {
        if (c.user_id !== uid) throw httpError(403, 'You can only edit your own comments');
        const text = String(body).trim();
        if (!text) throw badRequest('A comment can’t be empty');
        db.prepare('UPDATE comments SET body = ?, updated_at = ? WHERE id = ?').run(text.slice(0, 5000), new Date().toISOString(), commentId);
      }
      if (resolved !== undefined) db.prepare('UPDATE comments SET resolved = ? WHERE id = ?').run(resolved ? 1 : 0, c.parent_id || commentId);
      return api.listComments(c.note_id, uid);
    },
    deleteComment(commentId, uid) {
      const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
      if (!c || !api.get('notes', c.note_id, uid)) throw httpError(404, 'Comment not found');
      const owner = db.prepare('SELECT user_id FROM notes WHERE id = ?').get(c.note_id).user_id;
      if (c.user_id !== uid && owner !== uid) throw httpError(403, 'Only the person who wrote it, or the document’s owner, can delete a comment');
      db.prepare('DELETE FROM comments WHERE id = ?').run(commentId); // replies go with it
      return api.listComments(c.note_id, uid);
    },

    /* ----- Notifications ----- */
    listNotifications(uid) {
      return db.prepare(`SELECT n.id, n.note_id, n.comment_id, n.kind, n.snippet, n.created_at, a.name AS actor_name, d.title AS note_title, c.body
                           FROM user_alerts n JOIN users a ON a.id = n.actor_id JOIN notes d ON d.id = n.note_id LEFT JOIN comments c ON c.id = n.comment_id
                          WHERE n.user_id = ? AND n.read = 0 AND d.deleted_at IS NULL ORDER BY n.created_at DESC LIMIT 50`).all(uid)
        .map((n) => ({ id: n.id, noteId: n.note_id, commentId: n.comment_id, kind: n.kind, createdAt: n.created_at, actorName: n.actor_name, noteTitle: n.note_title, body: (n.body || n.snippet || '').slice(0, 160) }));
    },

    /* ----- @mentions ----- */
    /** People who can open a document (owner + people it's shared with), for the @ picker. */
    peopleFor(noteId, uid) {
      if (!api.get('notes', noteId, uid)) throw httpError(404, 'Document not found');
      return db.prepare(`SELECT u.id, u.name, u.username FROM users u WHERE u.id = (SELECT user_id FROM notes WHERE id = ?)
                         UNION SELECT u.id, u.name, u.username FROM note_shares s JOIN users u ON u.id = s.user_id WHERE s.note_id = ? AND u.kind != 'guest'
                         ORDER BY name`).all(noteId, noteId);
    },
    mentionedUserIds(text, noteId) {
      const names = new Set();
      for (const m of String(text).matchAll(/(?:^|[^\w@.])@([a-z0-9._-]{3,30})/gi)) names.add(m[1].replace(/\.+$/, '').toLowerCase());
      if (!names.size) return [];
      const people = api.peopleFor(noteId, db.prepare('SELECT user_id FROM notes WHERE id = ?').get(noteId).user_id);
      return people.filter((p) => names.has(p.username)).map((p) => p.id);
    },
    /** Notify people newly @mentioned in a document's text. */
    notifyDocMentions(noteId, uid, before, after) {
      const had = new Set(api.mentionedUserIds(before, noteId));
      const ins = db.prepare('INSERT INTO user_alerts (id, user_id, note_id, comment_id, actor_id, kind, snippet, read, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, 0, ?)');
      for (const person of api.mentionedUserIds(after, noteId)) {
        if (person === uid || had.has(person)) continue;
        const user = db.prepare('SELECT username FROM users WHERE id = ?').get(person);
        const line = String(after).split('\n').find((l) => l.toLowerCase().includes(`@${user.username}`)) || '';
        const snippet = line.replace(/\{\{[a-z0-9:,]+\||\}\}|\{:[a-z0-9.,]+\}|[#>*`~^]|\[[ x]\]/gi, '').replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim().slice(0, 160);
        ins.run(crypto.randomUUID(), person, noteId, uid, 'mention-doc', snippet, new Date().toISOString());
      }
    },

    /* ----- Your templates ----- */
    listTemplates(uid) {
      return db.prepare('SELECT * FROM templates WHERE user_id = ? ORDER BY created_at DESC').all(uid)
        .map((t) => ({ id: t.id, name: t.name, description: t.description, icon: t.icon, color: t.color, title: t.title, content: t.content, tag: t.tag, createdAt: t.created_at }));
    },
    saveTemplate(uid, { noteId, name, description = '' }) {
      const note = api.get('notes', noteId, uid);
      if (!note) throw httpError(404, 'Document not found');
      const n = String(name || '').trim();
      if (!n) throw badRequest('Give the template a name');
      if (n.length > 80) throw badRequest('Template names can be up to 80 characters');
      if (db.prepare('SELECT COUNT(*) AS c FROM templates WHERE user_id = ?').get(uid).c >= 100) throw badRequest('You can keep up to 100 templates');
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO templates (id, user_id, name, description, icon, color, title, content, tag, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, uid, n, String(description).slice(0, 160), note.icon, note.color, note.title, note.content, note.tag, new Date().toISOString());
      return api.listTemplates(uid);
    },
    deleteTemplate(uid, id) {
      db.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').run(id, uid);
      return api.listTemplates(uid);
    },

    markNotificationsRead(uid, ids) {
      if (ids === 'all') db.prepare('UPDATE user_alerts SET read = 1 WHERE user_id = ?').run(uid);
      else if (Array.isArray(ids)) {
        const st = db.prepare('UPDATE user_alerts SET read = 1 WHERE user_id = ? AND (id = ? OR note_id = ?)');
        for (const id of ids.slice(0, 200)) st.run(uid, String(id), String(id));
      }
      return { ok: true };
    },

    /* ----- Files ----- */
    createFile(uid, { noteId = null, name, mime, size }) {
      if (noteId) {
        const note = api.get('notes', noteId, uid);
        if (!note) throw httpError(404, 'Document not found');
        if (note.access === 'view') throw httpError(403, 'You can view this document but not add files to it');
      }
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO files (id, user_id, note_id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, uid, noteId, String(name).slice(0, 200) || 'file', mime, size, new Date().toISOString());
      return api.fileInfo(id);
    },
    fileInfo(id) {
      const f = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
      return f && { id: f.id, name: f.name, mime: f.mime, size: f.size, noteId: f.note_id, createdAt: f.created_at, url: `/api/files/${f.id}` };
    },
    /** Owners can open their files; anyone who can open a document can open its files. */
    fileForUser(id, uid) {
      const f = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
      if (!f) return null;
      if (f.user_id === uid) return f;
      if (f.note_id && api.get('notes', f.note_id, uid)) return f;
      return null;
    },
    listFiles(uid) {
      return db.prepare(`SELECT f.*, n.title AS note_title FROM files f LEFT JOIN notes n ON n.id = f.note_id
                          WHERE f.user_id = ? ORDER BY f.created_at DESC`).all(uid)
        .map((f) => ({ ...api.fileInfo(f.id), noteTitle: f.note_title }));
    },
    deleteFile(id, uid) {
      const f = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
      if (!f) return null;
      const noteOwner = f.note_id ? db.prepare('SELECT user_id FROM notes WHERE id = ?').get(f.note_id)?.user_id : null;
      if (f.user_id !== uid && noteOwner !== uid) throw httpError(403, 'You can only delete your own files');
      db.prepare('DELETE FROM files WHERE id = ?').run(id);
      return f.id;
    },
    fileIdsForNote(noteId) { return db.prepare('SELECT id FROM files WHERE note_id = ?').all(noteId).map((r) => r.id); },
    fileIdsForUser(uid) {
      return db.prepare(`SELECT id FROM files WHERE user_id = ? OR note_id IN (SELECT id FROM notes WHERE user_id = ?)`).all(uid, uid).map((r) => r.id);
    },
    storageUsed(uid) { return db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM files WHERE user_id = ?').get(uid).n; },

    /* ----- Settings ----- */
    getSettings(uid) {
      const out = { ...SETTINGS_DEFAULTS };
      for (const { key, value } of db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(uid)) {
        if (key in SETTINGS_DEFAULTS) { try { out[key] = JSON.parse(value); } catch { /* keep default */ } }
      }
      return out;
    },
    updateSettings(uid, input) {
      if (!input || typeof input !== 'object') throw badRequest('Expected a JSON object');
      const upsert = db.prepare(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
                                 ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`);
      db.transaction(() => {
        for (const [key, value] of Object.entries(input)) {
          if (!SETTING_RULES[key]) continue;
          if (!SETTING_RULES[key](value)) throw badRequest(`Invalid value for setting "${key}"`);
          upsert.run(uid, key, JSON.stringify(key === 'dismissedAlerts' ? value.slice(-500) : value));
        }
      })();
      return api.getSettings(uid);
    },

    /* ----- Accounts ----- */
    publicUser(row) { return row && { id: row.id, name: row.name, username: row.username, createdAt: row.created_at, ...(row.kind === 'guest' ? { guest: true, guestNoteId: row.guest_note_id } : {}) }; },
    userById(id) { return api.publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)); },
    userCount() { return db.prepare("SELECT COUNT(*) AS n FROM users WHERE kind != 'guest'").get().n; },

    createUser({ name, username, password }) {
      const cleanN = cleanName(name);
      const cleanU = cleanUsername(username);
      checkPassword(password);
      if (db.prepare('SELECT 1 FROM users WHERE username = ? OR email = ?').get(cleanU, cleanU)) throw httpError(409, 'That username is taken. Try another one.');
      const id = crypto.randomUUID();
      const first = api.userCount() === 0;
      db.transaction(() => {
        // The old email column is still required by the table, so it simply mirrors the username.
        db.prepare('INSERT INTO users (id, email, username, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, cleanU, cleanU, cleanN, hashPassword(password), new Date().toISOString());
        if (first) {
          // The first account takes over everything created before accounts existed.
          for (const kind of Object.keys(TABLES)) db.prepare(`UPDATE ${kind} SET user_id = ? WHERE user_id IS NULL`).run(id);
          for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
            if (key in SETTINGS_DEFAULTS) db.prepare('INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)').run(id, key, value);
          }
          db.prepare('DELETE FROM settings').run();
        }
      })();
      return api.userById(id);
    },
    authenticate(username, password) {
      let row;
      try { row = db.prepare("SELECT * FROM users WHERE username = ? AND kind != 'guest'").get(cleanUsername(username)); } catch { row = null; }
      const ok = verifyPassword(String(password || ''), row ? row.password_hash : DUMMY_HASH);
      return ok && row ? api.publicUser(row) : null;
    },
    /** Change the sign-in username (needs the current password). Shares follow the account, not the name. */
    changeUsername(uid, username, password) {
      const row = db.prepare('SELECT username, password_hash FROM users WHERE id = ?').get(uid);
      if (!row || !verifyPassword(String(password || ''), row.password_hash)) throw badRequest('Your password is incorrect');
      const next = cleanUsername(username);
      if (next === row.username) throw badRequest('That’s already your username');
      const taken = db.prepare('SELECT 1 FROM users WHERE (username = ? OR email = ?) AND id != ?').get(next, next, uid);
      if (taken) throw httpError(409, 'That username is taken. Try another one.');
      db.prepare('UPDATE users SET username = ?, email = ? WHERE id = ?').run(next, next, uid);
      return api.userById(uid);
    },
    updateUser(uid, { name }) {
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(cleanName(name), uid);
      return api.userById(uid);
    },
    changePassword(uid, current, next, keepToken) {
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(uid);
      if (!row || !verifyPassword(String(current || ''), row.password_hash)) throw badRequest('Your current password is incorrect');
      checkPassword(next);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), uid);
      // Sign out every other device.
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(uid, keepToken ? tokenHash(keepToken) : '');
    },
    deleteUser(uid, password) {
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(uid);
      if (!row || !verifyPassword(String(password || ''), row.password_hash)) throw badRequest('Your password is incorrect');
      db.transaction(() => {
        db.prepare('DELETE FROM files WHERE user_id = ? OR note_id IN (SELECT id FROM notes WHERE user_id = ?)').run(uid, uid);
        for (const kind of Object.keys(TABLES)) db.prepare(`DELETE FROM ${kind} WHERE user_id = ?`).run(uid);
        db.prepare('DELETE FROM users WHERE id = ?').run(uid);
      })();
    },

    /* ----- Sessions ----- */
    /** Sign-ins last 30 days on that device (until signing out). */
    createSession(uid) {
      const token = crypto.randomBytes(32).toString('base64url');
      const now = new Date();
      const days = SESSION_DAYS;
      const expires = new Date(now.getTime() + days * 86400000);
      db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash(token), uid, now.toISOString(), expires.toISOString());
      return { token, maxAge: SESSION_DAYS * 86400 };
    },
    userForSession(token) {
      if (!token) return null;
      const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(tokenHash(token));
      if (!row) return null;
      if (row.expires_at < new Date().toISOString()) { api.endSession(token); return null; }
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
      // A guest only stays in while their link is on, unexpired and unchanged.
      if (u?.kind === 'guest' && !api.guestLinkValid(u)) { api.endSession(token); return null; }
      return api.publicUser(u);
    },

    /* ----- Share links: "Anyone with the link" ----- */
    linkRow(noteId) { return db.prepare('SELECT * FROM share_links WHERE note_id = ?').get(noteId); },
    linkRowByToken(token) { return db.prepare('SELECT * FROM share_links WHERE token = ?').get(String(token || '')); },
    linkExpired(l) { return !!(l.expires_at && l.expires_at < new Date().toISOString()); },
    guestLinkValid(u) {
      const l = api.linkRow(u.guest_note_id);
      return !!(l && l.enabled && !api.linkExpired(l) && l.version === u.guest_link_version);
    },
    linkOut(l) {
      if (!l) return { enabled: false, permission: 'view', token: null, hasPassword: false, expiresAt: null };
      return { enabled: !!l.enabled, permission: l.permission, token: l.token, hasPassword: !!l.password_hash, expiresAt: l.expires_at, expired: api.linkExpired(l) };
    },
    getLink(noteId, uid) {
      const note = db.prepare('SELECT user_id FROM notes WHERE id = ? AND deleted_at IS NULL').get(noteId);
      if (!note || note.user_id !== uid) throw httpError(404, 'Document not found');
      return api.linkOut(api.linkRow(noteId));
    },
    /** Cut off everyone using the link (their comments and edits stay, with their names). */
    revokeGuests(noteId) {
      const ids = db.prepare("SELECT id FROM users WHERE kind = 'guest' AND guest_note_id = ?").all(noteId).map((r) => r.id);
      for (const gid of ids) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(gid);
        db.prepare('DELETE FROM note_shares WHERE user_id = ?').run(gid);
      }
    },
    setLink(noteId, uid, { enabled, permission, expiresAt, password } = {}) {
      api.getLink(noteId, uid);
      let l = api.linkRow(noteId);
      if (!l) {
        db.prepare('INSERT INTO share_links (note_id, token, permission, enabled, created_at) VALUES (?, ?, ?, 0, ?)').run(noteId, crypto.randomBytes(24).toString('base64url'), 'view', new Date().toISOString());
        l = api.linkRow(noteId);
      }
      const next = { ...l };
      let revoke = false;
      if (enabled !== undefined) { next.enabled = enabled ? 1 : 0; if (!enabled) revoke = true; }
      if (permission !== undefined) {
        if (!['view', 'edit'].includes(permission)) throw badRequest('Choose "Can view" or "Can edit"');
        next.permission = permission;
      }
      if (expiresAt !== undefined) {
        if (expiresAt && Number.isNaN(Date.parse(expiresAt))) throw badRequest('Choose a valid date');
        if (expiresAt && Date.parse(expiresAt) < Date.now()) throw badRequest('Choose a date in the future');
        next.expires_at = expiresAt ? new Date(expiresAt).toISOString() : null;
      }
      if (password !== undefined) {
        if (password && String(password).length < 4) throw badRequest('Use at least 4 characters for the link password');
        next.password_hash = password ? hashPassword(String(password)) : null;
        revoke = true; // new or removed password: people must open the link again
      }
      if (revoke) next.version = l.version + 1;
      db.prepare('UPDATE share_links SET enabled = ?, permission = ?, expires_at = ?, password_hash = ?, version = ? WHERE note_id = ?')
        .run(next.enabled, next.permission, next.expires_at, next.password_hash, next.version, noteId);
      if (revoke) { api.revokeGuests(noteId); api.onGuestsRevoked?.(noteId); }
      // Guests follow the link's permission straight away.
      db.prepare("UPDATE note_shares SET permission = ? WHERE note_id = ? AND user_id IN (SELECT id FROM users WHERE kind = 'guest' AND guest_note_id = ?)").run(next.permission, noteId, noteId);
      return api.linkOut(api.linkRow(noteId));
    },
    resetLink(noteId, uid) {
      api.getLink(noteId, uid);
      const l = api.linkRow(noteId);
      if (!l) return api.setLink(noteId, uid, {});
      db.prepare('UPDATE share_links SET token = ?, version = version + 1 WHERE note_id = ?').run(crypto.randomBytes(24).toString('base64url'), noteId);
      api.revokeGuests(noteId);
      api.onGuestsRevoked?.(noteId);
      return api.linkOut(api.linkRow(noteId));
    },
    /** What someone opening a link may see before joining. */
    linkInfo(token) {
      const l = db.prepare('SELECT s.*, n.title, n.deleted_at, u.name AS owner FROM share_links s JOIN notes n ON n.id = s.note_id JOIN users u ON u.id = n.user_id WHERE s.token = ?').get(String(token || ''));
      if (!l || !l.enabled || l.deleted_at) throw httpError(404, 'This link isn’t available. It may have been turned off or reset.');
      if (api.linkExpired(l)) throw httpError(410, 'This link has expired.');
      return { needsPassword: !!l.password_hash, permission: l.permission, title: l.password_hash ? null : (l.title || 'Untitled'), owner: l.password_hash ? null : l.owner };
    },
    /** Join through a link: a guest identity limited to this one document. */
    joinLink(token, { name, password } = {}) {
      const l = db.prepare('SELECT s.*, n.deleted_at FROM share_links s JOIN notes n ON n.id = s.note_id WHERE s.token = ?').get(String(token || ''));
      if (!l || !l.enabled || l.deleted_at) throw httpError(404, 'This link isn’t available. It may have been turned off or reset.');
      if (api.linkExpired(l)) throw httpError(410, 'This link has expired.');
      if (l.password_hash && !verifyPassword(String(password || ''), l.password_hash)) { const e = httpError(401, 'That password isn’t right'); throw e; }
      const n = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      if (!n) throw badRequest('Type your name so others know who you are');
      const id = crypto.randomUUID();
      const username = `guest-${crypto.randomBytes(5).toString('hex')}`;
      const now = new Date().toISOString();
      db.prepare("INSERT INTO users (id, email, username, name, password_hash, created_at, kind, guest_note_id, guest_link_version) VALUES (?, ?, ?, ?, ?, ?, 'guest', ?, ?)")
        .run(id, `${username}@guest.invalid`, username, n, hashPassword(crypto.randomBytes(24).toString('hex')), now, l.note_id, l.version);
      db.prepare('INSERT INTO note_shares (note_id, user_id, permission, created_at) VALUES (?, ?, ?, ?)').run(l.note_id, id, l.permission, now);
      const session = api.createSession(id);
      // A guest's sign-in ends when the link expires (if sooner than usual).
      if (l.expires_at) db.prepare('UPDATE sessions SET expires_at = MIN(expires_at, ?) WHERE user_id = ?').run(l.expires_at, id);
      return { ...session, noteId: l.note_id, user: api.userById(id) };
    },
    /** Guests who never wrote anything and can no longer get in are removed after 30 days. */
    pruneGuests() {
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
      db.prepare(`DELETE FROM users WHERE kind = 'guest' AND created_at < ?
        AND id NOT IN (SELECT user_id FROM sessions) AND id NOT IN (SELECT user_id FROM comments)
        AND id NOT IN (SELECT user_id FROM note_versions)`).run(cutoff);
    },
    endSession(token) { if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token)); },
    pruneSessions() { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString()); },

    /* ----- Whole-account data ----- */
    bootstrap(uid) {
      return {
        notes: api.list('notes', uid),
        reminders: api.list('reminders', uid),
        events: api.list('events', uid),
        settings: api.getSettings(uid),
        notifications: api.listNotifications(uid),
        folders: api.listFolders(uid),
      };
    },
    exportAll(uid) {
      const own = (kind) => db.prepare(`SELECT * FROM ${kind} WHERE user_id = ? ${kind === 'notes' ? 'AND deleted_at IS NULL' : ''} ORDER BY ${orderBy[kind]}`).all(uid).map((r) => rowToObject(kind, r));
      return {
        app: 'notes', version: 3, exportedAt: new Date().toISOString(), notes: own('notes'), reminders: own('reminders'), events: own('events'), settings: api.getSettings(uid),
        folders: api.listFolders(uid),
        noteFolders: db.prepare('SELECT nf.note_id AS noteId, nf.folder_id AS folderId FROM note_folders nf JOIN notes n ON n.id = nf.note_id WHERE nf.user_id = ? AND n.user_id = ?').all(uid, uid),
      };
    },
    importAll(uid, payload) {
      if (!payload || typeof payload !== 'object') throw badRequest('Backup file is not valid JSON');
      const counts = {};
      db.transaction(() => {
        for (const kind of Object.keys(TABLES)) {
          if (!Array.isArray(payload[kind])) throw badRequest(`Backup is missing the "${kind}" list`);
          db.prepare(`DELETE FROM ${kind} WHERE user_id = ?`).run(uid);
          for (const item of payload[kind]) api.create(kind, item, uid, { keepIdentity: true });
          counts[kind] = payload[kind].length;
        }
        if (payload.settings) {
          const { dismissedAlerts, headerImage, ...rest } = payload.settings;
          api.updateSettings(uid, rest);
        }
        // Folders (backups from version 3 on): recreate them, then put documents back in.
        if (Array.isArray(payload.folders)) {
          db.prepare('DELETE FROM folders WHERE user_id = ?').run(uid);
          const ids = new Set();
          const ins = db.prepare('INSERT OR IGNORE INTO folders (id, user_id, parent_id, name, created_at) VALUES (?, ?, NULL, ?, ?)');
          for (const f of payload.folders) if (/^[0-9a-f-]{36}$/.test(f.id || '')) { ins.run(f.id, uid, String(f.name || 'Folder').slice(0, 60), f.createdAt || new Date().toISOString()); ids.add(f.id); }
          for (const f of payload.folders) if (ids.has(f.id) && ids.has(f.parentId)) db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(f.parentId, f.id);
          for (const nf of payload.noteFolders || []) {
            if (ids.has(nf.folderId) && db.prepare('SELECT 1 FROM notes WHERE id = ? AND user_id = ?').get(nf.noteId, uid)) {
              db.prepare('INSERT OR REPLACE INTO note_folders (user_id, note_id, folder_id) VALUES (?, ?, ?)').run(uid, nf.noteId, nf.folderId);
            }
          }
        }
      })();
      return { ok: true, imported: counts };
    },
    close() { db.close(); },
  };

  return api;
}

module.exports = { openDatabase };
