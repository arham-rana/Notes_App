'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { openDatabase } = require('./src/db');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const COOKIE = 'notes_session';
const MAX_UPLOAD_MB = 50; // largest file that can be attached to a document
const FILES_DIR = path.join(DATA_DIR, 'files');
// Only these types are shown in the browser; everything else downloads, so uploaded files can't run scripts.
const INLINE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];

fs.mkdirSync(FILES_DIR, { recursive: true });
const db = openDatabase(path.join(DATA_DIR, 'app.db'));
db.pruneSessions();
db.pruneGuests();
setInterval(() => { db.pruneSessions(); db.pruneGuests(); }, 6 * 3600 * 1000).unref();

const app = express();
app.disable('x-powered-by');
// Trust a reverse proxy on the local network so HTTPS is detected for secure cookies.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
app.use(express.json({ limit: '5mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

/* ---------- Helpers ---------- */

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function setSessionCookie(req, res, token, maxAge) {
  const parts = [`${COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge) parts.push(`Max-Age=${maxAge}`);
  if (req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

const wrap = (fn) => (req, res) => {
  try {
    const result = fn(req, res);
    if (result === undefined) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  }
};

// Simple in-memory limiter for sign-in and sign-up attempts.
const attempts = new Map();
function rateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.reset < now) attempts.set(key, { count: 1, reset: now + 15 * 60000 });
  else if (++entry.count > 20) {
    res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
    return res.status(429).json({ error: 'Too many attempts. Wait 15 minutes and try again.' });
  }
  next();
}
setInterval(() => { const now = Date.now(); for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k); }, 600000).unref();

// Changes must come from this app's own pages (blocks cross-site form posts).
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'notes-app') return res.status(403).json({ error: 'Request blocked' });
  next();
});

/* ---------- Auth routes (no session needed) ---------- */

const auth = express.Router();
// Anyone who can reach the app can create an account.
auth.get('/config', (req, res) => res.json({ allowSignup: true, hasUsers: db.userCount() > 0 }));
auth.post('/signup', rateLimit, wrap((req, res) => {
  const user = db.createUser(req.body || {});
  const { token, maxAge } = db.createSession(user.id);
  setSessionCookie(req, res, token, maxAge);
  res.status(201);
  return { user };
}));
auth.post('/login', rateLimit, wrap((req, res) => {
  const { username, password } = req.body || {};
  const user = db.authenticate(username, password);
  if (!user) { const e = new Error('That username and password don’t match an account'); e.status = 401; throw e; }
  const { token, maxAge } = db.createSession(user.id);
  setSessionCookie(req, res, token, maxAge);
  return { user };
}));
auth.post('/logout', (req, res) => {
  db.endSession(readCookie(req, COOKIE));
  clearSessionCookie(res);
  res.json({ ok: true });
});
app.use('/api/auth', auth);

/* ---------- Share links: opening a document without an account ---------- */
const share = express.Router();
share.get('/:token', wrap((req) => {
  const info = db.linkInfo(req.params.token);
  // Already signed in (as a member) and allowed in? Go straight to the document.
  const me = db.userForSession(readCookie(req, COOKIE));
  const row = db.linkRowByToken?.(req.params.token);
  if (me && row && db.get('notes', row.note_id, me.id)) return { ...info, openAs: me.guest ? 'guest' : 'member', noteId: row.note_id, name: me.name };
  return { ...info, signedInAs: me && !me.guest ? me.name : null };
}));
share.post('/:token/join', rateLimit, wrap((req, res) => {
  const me = db.userForSession(readCookie(req, COOKIE));
  if (me && !me.guest) { const e = new Error(`You’re signed in as ${me.name}. Sign out first to open this as a guest, or ask the owner to share it with your account.`); e.status = 409; throw e; }
  if (me?.guest) db.endSession(readCookie(req, COOKIE));
  const { token, maxAge, noteId, user } = db.joinLink(req.params.token, req.body || {});
  setSessionCookie(req, res, token, maxAge);
  return { noteId, user };
}));
app.use('/api/share', share);
// The page people open from a share link.
app.get('/s/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'share.html')));

/* ---------- Everything below needs a signed-in user ---------- */

app.use('/api', (req, res, next) => {
  const user = db.userForSession(readCookie(req, COOKIE));
  if (!user) return res.status(401).json({ error: 'Please sign in' });
  req.user = user;
  next();
});

// Guests (people using a share link) can only reach their one document, and only what the link allows.
const GUEST_ROUTES = [
  ['GET', /^\/me$/], ['GET', /^\/bootstrap$/], ['POST', /^\/notifications\/read$/],
  ['GET', /^\/notes\/([\w-]+)$/], ['PUT', /^\/notes\/([\w-]+)$/, 'edit'],
  ['GET', /^\/notes\/([\w-]+)\/comments$/], ['POST', /^\/notes\/([\w-]+)\/comments$/],
  ['GET', /^\/notes\/([\w-]+)\/people$/], ['GET', /^\/notes\/([\w-]+)\/signatures$/], ['GET', /^\/notes\/([\w-]+)\/export\.docx$/],
  ['GET', /^\/files\/[\w-]+$/], ['POST', /^\/files$/, 'edit'],
  ['POST', /^\/check$/], ['GET', /^\/check\/status$/], ['GET', /^\/dictionary$/], ['POST', /^\/dictionary$/], ['DELETE', /^\/dictionary\/.+$/],
];
app.use('/api', (req, res, next) => {
  if (!req.user?.guest) return next();
  const p = req.path;
  const rule = GUEST_ROUTES.find(([m, re]) => m === req.method && re.test(p));
  if (!rule) return res.status(403).json({ error: 'That isn’t available when using a share link' });
  const noteId = (p.match(rule[1]) || [])[1];
  if (noteId && noteId !== req.user.guestNoteId) return res.status(404).json({ error: 'Document not found' });
  if (rule[2] === 'edit' && db.get('notes', req.user.guestNoteId, req.user.id)?.access !== 'edit') return res.status(403).json({ error: 'This link lets you view, not edit' });
  // Guests can change the document's text, nothing else about it.
  if (req.method === 'PUT' && noteId) req.body = { content: req.body?.content };
  next();
});

const api = express.Router();
api.get('/me', (req, res) => res.json({ user: req.user }));
api.get('/bootstrap', wrap((req) => {
  if (req.user.guest) { // only their one document
    const note = db.get('notes', req.user.guestNoteId, req.user.id);
    return { user: req.user, notes: note ? [note] : [], reminders: [], events: [], folders: [], notifications: [], settings: {} };
  }
  return { user: req.user, ...db.bootstrap(req.user.id) };
}));
/* ----- Share link settings (owner) ----- */
api.get('/notes/:id/link', wrap((req) => db.getLink(req.params.id, req.user.id)));
api.put('/notes/:id/link', wrap((req) => db.setLink(req.params.id, req.user.id, req.body || {})));
api.post('/notes/:id/link/reset', wrap((req) => db.resetLink(req.params.id, req.user.id)));

// Deleting a document moves it to the Trash (files are kept until it's removed for good).
api.delete('/notes/:id', wrap((req) => (db.remove('notes', req.params.id, req.user.id) ? { ok: true, trashed: true } : undefined)));

/* ----- Trash ----- */
api.get('/trash', wrap((req) => db.listTrash(req.user.id)));
api.post('/trash/:id/restore', wrap((req) => db.restoreFromTrash(req.params.id, req.user.id)));
api.delete('/trash/:id', wrap((req) => { const r = db.deleteForever(req.params.id, req.user.id); removeFiles(r.fileIds); return { ok: true, deleted: r.count }; }));
api.delete('/trash', wrap((req) => { const r = db.emptyTrash(req.user.id); removeFiles(r.fileIds); return { ok: true, deleted: r.count }; }));

/* ----- Version history ----- */
api.get('/notes/:id/versions', wrap((req) => db.listVersions(req.params.id, req.user.id)));
api.get('/notes/:id/versions/:vid', wrap((req) => db.getVersion(req.params.id, req.params.vid, req.user.id)));
api.post('/notes/:id/versions/:vid/restore', wrap((req) => db.restoreVersion(req.params.id, req.params.vid, req.user.id)));

for (const kind of ['notes', 'reminders', 'events']) {
  api.get(`/${kind}`, wrap((req) => db.list(kind, req.user.id)));
  api.post(`/${kind}`, wrap((req, res) => { res.status(201); return db.create(kind, req.body, req.user.id); }));
  api.get(`/${kind}/:id`, wrap((req) => db.get(kind, req.params.id, req.user.id)));
  api.put(`/${kind}/:id`, wrap((req) => db.update(kind, req.params.id, req.body, req.user.id)));
  api.delete(`/${kind}/:id`, wrap((req) => (db.remove(kind, req.params.id, req.user.id) ? { ok: true } : undefined)));
}

api.get('/notes/:id/shares', wrap((req) => db.listShares(req.params.id, req.user.id)));
api.post('/notes/:id/shares', wrap((req) => db.addShare(req.params.id, req.user.id, req.body || {})));
api.put('/notes/:id/shares/:userId', wrap((req) => db.updateShare(req.params.id, req.user.id, req.params.userId, req.body?.permission)));
api.delete('/notes/:id/shares/:userId', wrap((req) => db.removeShare(req.params.id, req.user.id, req.params.userId)));

/* ----- Files ----- */
const filePath = (id) => path.join(FILES_DIR, id.replace(/[^0-9a-f-]/gi, ''));
const removeFiles = (ids) => ids.forEach((id) => fs.rm(filePath(id), { force: true }, () => {}));

api.post('/files', express.raw({ type: () => true, limit: `${MAX_UPLOAD_MB}mb` }), (req, res) => {
  try {
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: 'The file is empty' });
    const name = decodeURIComponent(req.get('X-File-Name') || 'file').replace(/[\\/\r\n]/g, '_');
    const mime = (req.get('X-File-Type') || 'application/octet-stream').toLowerCase().slice(0, 100);
    const purpose = req.get('X-File-Purpose') || 'document';
    if (purpose === 'header' && !INLINE_TYPES.includes(mime)) return res.status(400).json({ error: 'Choose a PNG, JPEG, GIF or WebP image' });
    const noteId = purpose === 'document' ? req.get('X-Note-Id') || null : null;
    const info = db.createFile(req.user.id, { noteId, name, mime, size: body.length });
    fs.writeFileSync(filePath(info.id), body);
    res.status(201).json(info);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Couldn’t save the file' });
  }
});
const purgeTrash = () => { try { const r = db.purgeExpiredTrash(30); removeFiles(r.fileIds); if (r.count) console.log(`Removed ${r.count} document(s) from the Trash after 30 days.`); } catch (err) { console.error(err); } };
purgeTrash();
setInterval(purgeTrash, 6 * 3600 * 1000).unref();

api.get('/files', wrap((req) => ({ files: db.listFiles(req.user.id), used: db.storageUsed(req.user.id), maxUploadMb: MAX_UPLOAD_MB })));
api.get('/files/:id', (req, res) => {
  const f = db.fileForUser(req.params.id, req.user.id);
  if (!f || !fs.existsSync(filePath(f.id))) return res.status(404).json({ error: 'File not found' });
  const inline = INLINE_TYPES.includes(f.mime) && req.query.download === undefined;
  res.setHeader('Content-Type', inline ? f.mime : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  fs.createReadStream(filePath(f.id)).pipe(res);
});
api.delete('/files/:id', wrap((req) => {
  const id = db.deleteFile(req.params.id, req.user.id);
  if (!id) return undefined;
  removeFiles([id]);
  return { ok: true };
}));

/* ----- Comments & notifications ----- */
// Word export (built on the server so attached images can be embedded).
api.get('/notes/:id/export.docx', async (req, res, next) => {
  try {
    const note = db.get('notes', req.params.id, req.user.id);
    if (!note) return res.status(404).json({ error: 'Document not found' });
    const { buildDocx } = await import('./src/export-docx.mjs');
    const sigIds = [...(note.content || '').matchAll(/\[\[signature:([0-9a-f-]{36})\]\]/g)].map((m) => m[1]);
    const buf = await buildDocx({ note, filePath, origin: `${req.protocol}://${req.get('host')}`, pageSize: note.pageSize, signatures: db.signaturesByIds(sigIds) });
    const name = (note.title || 'Document').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Document';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}.docx"; filename*=UTF-8''${encodeURIComponent(name)}.docx`);
    res.send(buf);
  } catch (err) { next(err); }
});
/* ----- Folders ----- */
api.get('/folders', wrap((req) => db.listFolders(req.user.id)));
api.post('/folders', wrap((req, res) => { res.status(201); return db.createFolder(req.user.id, req.body || {}); }));
api.put('/folders/:id', wrap((req) => db.updateFolder(req.user.id, req.params.id, req.body || {})));
api.delete('/folders/:id', wrap((req) => db.deleteFolder(req.user.id, req.params.id)));
api.put('/notes/:id/folder', wrap((req) => db.setNoteFolder(req.user.id, req.params.id, req.body?.folderId || null)));
/* ----- Signatures ----- */
api.get('/notes/:id/signatures', wrap((req) => db.listSignatures(req.params.id, req.user.id)));
api.post('/notes/:id/signatures', wrap((req, res) => { res.status(201); return db.requestSignature(req.params.id, req.user.id, req.body || {}); }));
api.post('/signatures/:id/sign', wrap((req) => db.signSignature(req.params.id, req.user.id, req.body || {})));
/* ----- Spelling and grammar (LanguageTool, self-hosted) ----- */
const LANGUAGETOOL_URL = (process.env.LANGUAGETOOL_URL || '').replace(/\/+$/, '');
api.get('/check/status', async (req, res) => {
  if (!LANGUAGETOOL_URL) return res.json({ available: false, reason: 'not-configured' });
  try {
    const r = await fetch(`${LANGUAGETOOL_URL}/v2/languages`, { signal: AbortSignal.timeout(3000) });
    res.json({ available: r.ok, reason: r.ok ? null : 'unavailable' });
  } catch { res.json({ available: false, reason: 'starting' }); }
});
api.post('/check', async (req, res, next) => {
  try {
    if (!LANGUAGETOOL_URL) return res.status(503).json({ error: 'Spelling and grammar checks aren’t set up on this server' });
    const text = String(req.body?.text || '');
    if (!text.trim()) return res.json({ matches: [] });
    if (text.length > 60000) return res.status(413).json({ error: 'That’s too much text to check at once' });
    // The browser's language (e.g. en-CA, fr-FR); fall back to automatic detection.
    const lang = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(req.body?.language || '') ? req.body.language : 'auto';
    const ask = async (language) => {
      const body = new URLSearchParams({ text, language, level: 'default' });
      if (language === 'auto') body.set('preferredVariants', 'en-CA,de-DE,pt-PT,ca-ES');
      return fetch(`${LANGUAGETOOL_URL}/v2/check`, { method: 'POST', body, signal: AbortSignal.timeout(20000) });
    };
    let r = await ask(lang);
    if (r.status === 400 && lang !== 'auto') r = await ask(lang.split('-')[0]); // e.g. a region LanguageTool doesn't know
    if (r.status === 400) r = await ask('auto');
    if (!r.ok) return res.status(502).json({ error: 'The spelling and grammar checker didn’t respond' });
    const data = await r.json();
    const words = new Set(db.listWords(req.user.id).map((w) => w.toLowerCase()));
    const matches = (data.matches || [])
      .map((m) => ({
        offset: m.offset, length: m.length, message: m.shortMessage || m.message, detail: m.message,
        replacements: (m.replacements || []).slice(0, 5).map((x) => x.value),
        type: m.rule?.issueType === 'misspelling' || /SPELL|MORFOLOGIK|HUNSPELL/i.test(m.rule?.id || '') ? 'spelling' : 'grammar',
        rule: m.rule?.id || '',
      }))
      // Words in your dictionary aren't spelling mistakes.
      .filter((m) => !(m.type === 'spelling' && words.has(text.substr(m.offset, m.length).toLowerCase())));
    res.json({ matches, language: data.language?.code || lang });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.cause?.code === 'ECONNREFUSED') return res.status(503).json({ error: 'The spelling and grammar checker is starting. Try again in a moment.' });
    next(err);
  }
});
api.get('/dictionary', wrap((req) => db.listWords(req.user.id)));
api.post('/dictionary', wrap((req) => db.addWord(req.user.id, req.body?.word)));
api.delete('/dictionary/:word', wrap((req) => db.removeWord(req.user.id, req.params.word)));

api.get('/notes/:id/people', wrap((req) => db.peopleFor(req.params.id, req.user.id)));
api.get('/templates', wrap((req) => db.listTemplates(req.user.id)));
api.post('/templates', wrap((req, res) => { res.status(201); return db.saveTemplate(req.user.id, req.body || {}); }));
api.delete('/templates/:id', wrap((req) => db.deleteTemplate(req.user.id, req.params.id)));
api.put('/notes/:id/pin', wrap((req) => db.setPinned(req.params.id, req.user.id, !!req.body?.pinned)));
api.get('/notes/:id/comments', wrap((req) => db.listComments(req.params.id, req.user.id)));
api.post('/notes/:id/comments', wrap((req, res) => { res.status(201); return db.addComment(req.params.id, req.user.id, req.body || {}); }));
api.put('/comments/:id', wrap((req) => db.updateComment(req.params.id, req.user.id, req.body || {})));
api.delete('/comments/:id', wrap((req) => db.deleteComment(req.params.id, req.user.id)));
api.post('/notifications/read', wrap((req) => db.markNotificationsRead(req.user.id, req.body?.ids)));

api.get('/settings', wrap((req) => db.getSettings(req.user.id)));
api.put('/settings', wrap((req) => db.updateSettings(req.user.id, req.body)));

api.put('/account', wrap((req) => ({ user: db.updateUser(req.user.id, req.body || {}) })));
api.put('/account/username', rateLimit, wrap((req) => ({ user: db.changeUsername(req.user.id, req.body?.username, req.body?.password) })));
api.put('/account/password', wrap((req) => {
  const { currentPassword, newPassword } = req.body || {};
  db.changePassword(req.user.id, currentPassword, newPassword, readCookie(req, COOKIE));
  return { ok: true };
}));
api.delete('/account', wrap((req, res) => {
  const fileIds = db.fileIdsForUser(req.user.id);
  db.deleteUser(req.user.id, req.body?.password);
  removeFiles(fileIds);
  clearSessionCookie(res);
  return { ok: true };
}));

api.get('/export', (req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="notes-backup-${stamp}.json"`);
  res.json(db.exportAll(req.user.id));
});
api.post('/import', wrap((req) => db.importAll(req.user.id, req.body)));

api.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/api', api);
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: `That file is too big. The limit is ${MAX_UPLOAD_MB} MB.` });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  next(err);
});

app.use(require('compression')()); // smaller downloads (the editor bundle shrinks by about 75%)
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: 'index.html' }));
// Page setup definitions are shared with the browser.
app.get('/shared/pages.mjs', (req, res) => res.type('text/javascript').sendFile(path.join(__dirname, 'shared', 'pages.mjs')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = app.listen(PORT, () => {
  console.log(`Notes app listening on http://0.0.0.0:${PORT} (data: ${DATA_DIR})`);
});

/* ----- Live co-editing over WebSockets (/collab) ----- */
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ noServer: true, maxPayload: 20 * 1024 * 1024 });
let collab = null;
import('./src/collab.mjs').then(({ createCollab }) => {
  collab = createCollab({ db, userForRequest: (req) => db.userForSession(readCookie(req, COOKIE)) });
  db.onGuestsRevoked = (noteId) => collab.closeDocument(noteId); // link turned off: disconnect its guests now
  db.onContentChange = (id, content) => collab.replaceContent(id, content);
}).catch((err) => console.error('Live editing is unavailable:', err));
server.on('upgrade', (req, socket, head) => {
  const host = req.headers.host;
  const origin = req.headers.origin;
  // Only this app's own pages may connect (blocks other websites from opening a live connection).
  if (!req.url.startsWith('/collab') || !collab || (origin && new URL(origin).host !== host)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => collab.handleConnection(ws, req));
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
