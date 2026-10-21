import { toast } from './ui.js';

export const state = { user: null, notifications: [], folders: [], notes: [], reminders: [], events: [], settings: {}, loaded: false, offline: false };

const listeners = new Set();

// Windows of the app on the same computer (main window and pop-outs) tell each
// other about changes so they update straight away instead of on the next refresh.
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('notes-app-sync') : null;
let syncTimer = null;
const announce = () => channel?.postMessage('changed');
channel?.addEventListener('message', () => {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => store.refresh(), 250);
});
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = (change) => listeners.forEach((fn) => fn(change));

export async function request(method, url, body) {
  const headers = { 'X-Requested-With': 'notes-app' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { message = (await res.json()).error || message; } catch { /* not JSON */ }
    const err = new Error(message);
    err.status = res.status;
    // Session ended (signed out elsewhere, password changed, or expired).
    if (res.status === 401 && !url.startsWith('/api/auth/') && state.loaded) window.dispatchEvent(new Event('auth:expired'));
    throw err;
  }
  return res.json();
}

const sorters = {
  notes: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  reminders: (a, b) => a.dueAt.localeCompare(b.dueAt),
  events: (a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime),
};
const sortKind = (kind) => state[kind].sort(sorters[kind]);

let lastSnapshot = '';
function applyBootstrap(data) {
  const snapshot = JSON.stringify(data);
  if (snapshot === lastSnapshot) return false;
  lastSnapshot = snapshot;
  Object.assign(state, data, { loaded: true });
  return true;
}

function setOffline(offline) {
  if (state.offline === offline) return;
  state.offline = offline;
  emit({ type: 'connection' });
}

export const store = {
  async load() {
    applyBootstrap(await request('GET', '/api/bootstrap'));
    emit({ type: 'load' });
  },

  /** Pull the latest data (e.g. edits made on another device). */
  async refresh() {
    try {
      const data = await request('GET', '/api/bootstrap');
      setOffline(false);
      if (applyBootstrap(data)) emit({ type: 'refresh' });
    } catch (err) {
      if (err.status !== 401) setOffline(true);
    }
  },

  find: (kind, id) => state[kind].find((x) => x.id === id),

  async create(kind, data) {
    try {
      const item = await request('POST', `/api/${kind}`, data);
      state[kind].push(item);
      sortKind(kind);
      lastSnapshot = '';
      announce();
      emit({ type: 'create', kind, id: item.id });
      return item;
    } catch (err) {
      toast(err.message, { tone: 'error' });
      throw err;
    }
  },

  async update(kind, id, patch, { quiet = false } = {}) {
    const index = state[kind].findIndex((x) => x.id === id);
    if (index < 0) return null;
    const before = state[kind][index];
    const optimistic = { ...before, ...patch };
    if (kind === 'notes' && !Object.keys(patch).every((k) => k === 'favourite')) optimistic.updatedAt = new Date().toISOString();
    state[kind][index] = optimistic;
    sortKind(kind);
    emit({ type: 'update', kind, id, quiet });
    try {
      const saved = await request('PUT', `/api/${kind}/${id}`, patch);
      const i = state[kind].findIndex((x) => x.id === id);
      if (i >= 0) state[kind][i] = { ...saved };
      sortKind(kind);
      lastSnapshot = '';
      setOffline(false);
      announce();
      emit({ type: 'saved', kind, id, quiet: true });
      return saved;
    } catch (err) {
      const i = state[kind].findIndex((x) => x.id === id);
      if (i >= 0) state[kind][i] = before;
      sortKind(kind);
      emit({ type: 'update', kind, id });
      toast(`Couldn't save: ${err.message}`, { tone: 'error' });
      throw err;
    }
  },

  async remove(kind, id) {
    const index = state[kind].findIndex((x) => x.id === id);
    if (index < 0) return;
    const [removed] = state[kind].splice(index, 1);
    emit({ type: 'remove', kind, id });
    try {
      await request('DELETE', `/api/${kind}/${id}`);
      lastSnapshot = '';
      announce();
    } catch (err) {
      state[kind].push(removed);
      sortKind(kind);
      emit({ type: 'create', kind, id });
      toast(`Couldn't delete: ${err.message}`, { tone: 'error' });
    }
  },

  async updateSettings(patch) {
    const before = state.settings;
    state.settings = { ...before, ...patch };
    emit({ type: 'settings' });
    try {
      state.settings = await request('PUT', '/api/settings', patch);
      lastSnapshot = '';
      announce();
    } catch (err) {
      state.settings = before;
      emit({ type: 'settings' });
      toast(`Couldn't save settings: ${err.message}`, { tone: 'error' });
    }
  },

  /* ----- Sharing ----- */
  listShares: (id) => request('GET', `/api/notes/${id}/shares`),
  async addShare(id, username, permission) {
    const shares = await request('POST', `/api/notes/${id}/shares`, { username, permission });
    store.refresh();
    return shares;
  },
  async updateShare(id, userId, permission) {
    const shares = await request('PUT', `/api/notes/${id}/shares/${userId}`, { permission });
    store.refresh();
    return shares;
  },
  async removeShare(id, userId) {
    const shares = await request('DELETE', `/api/notes/${id}/shares/${userId}`);
    if (userId === state.user?.id) {
      const i = state.notes.findIndex((n) => n.id === id);
      if (i >= 0) state.notes.splice(i, 1);
      emit({ type: 'remove', kind: 'notes', id });
    }
    store.refresh();
    return shares;
  },

  /* ----- Files ----- */
  async uploadFile(blob, { noteId = null, purpose = 'document', name } = {}) {
    const headers = {
      'X-Requested-With': 'notes-app',
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(name || blob.name || 'file'),
      'X-File-Type': blob.type || 'application/octet-stream',
      'X-File-Purpose': purpose,
    };
    if (noteId) headers['X-Note-Id'] = noteId;
    const res = await fetch('/api/files', { method: 'POST', headers, body: blob, credentials: 'same-origin' });
    if (!res.ok) {
      let message = `Upload failed (${res.status})`;
      try { message = (await res.json()).error || message; } catch { /* not JSON */ }
      throw new Error(message);
    }
    return res.json();
  },
  listFiles: () => request('GET', '/api/files'),
  deleteFile: (id) => request('DELETE', `/api/files/${id}`),

  /* ----- Folders (personal, nested) ----- */
  async createFolder(name, parentId = null) {
    const r = await request('POST', '/api/folders', { name, parentId });
    state.folders = r.folders; emit({ type: 'folders' }); announce();
    return r.id;
  },
  async updateFolder(id, patch) {
    try { state.folders = await request('PUT', `/api/folders/${id}`, patch); emit({ type: 'folders' }); announce(); }
    catch (err) { toast(err.message, { tone: 'error' }); throw err; }
  },
  async deleteFolder(id) {
    state.folders = await request('DELETE', `/api/folders/${id}`);
    await store.refresh();
    emit({ type: 'folders' });
  },
  async setNoteFolder(noteId, folderId) {
    const note = state.notes.find((n) => n.id === noteId);
    if (!note) return;
    const before = note.folderId;
    note.folderId = folderId || null;
    emit({ type: 'update', kind: 'notes', id: noteId });
    try { await request('PUT', `/api/notes/${noteId}/folder`, { folderId: folderId || null }); lastSnapshot = ''; announce(); }
    catch (err) { note.folderId = before; emit({ type: 'update', kind: 'notes', id: noteId }); toast(err.message, { tone: 'error' }); }
  },

  /* ----- Pins ----- */
  async setPinned(id, pinned) {
    const note = state.notes.find((n) => n.id === id);
    if (!note) return;
    const before = note.pinned;
    note.pinned = pinned;
    emit({ type: 'update', kind: 'notes', id });
    try {
      await request('PUT', `/api/notes/${id}/pin`, { pinned });
      lastSnapshot = '';
      announce();
    } catch (err) {
      note.pinned = before;
      emit({ type: 'update', kind: 'notes', id });
      toast(`Couldn't ${pinned ? 'pin' : 'unpin'}: ${err.message}`, { tone: 'error' });
    }
  },

  /* ----- Notifications (comments) ----- */
  async markNotificationsRead(ids) {
    const all = ids === 'all';
    state.notifications = (state.notifications || []).filter((n) => !(all || ids.includes(n.id) || ids.includes(n.noteId)));
    emit({ type: 'notifications' });
    try { await request('POST', '/api/notifications/read', { ids }); lastSnapshot = ''; announce(); } catch { /* next refresh catches up */ }
  },

  /* ----- Account ----- */
  async updateAccount(patch) {
    const { user } = await request('PUT', '/api/account', patch);
    state.user = user;
    emit({ type: 'account' });
    return user;
  },
  async changeUsername(username, password) {
    const { user } = await request('PUT', '/api/account/username', { username, password });
    state.user = user;
    emit({ type: 'account' });
    return user;
  },
  changePassword: (currentPassword, newPassword) => request('PUT', '/api/account/password', { currentPassword, newPassword }),
  deleteAccount: (password) => request('DELETE', '/api/account', { password }),
  logout: () => request('POST', '/api/auth/logout', {}),

  async importBackup(payload) {
    const result = await request('POST', '/api/import', payload);
    await store.load();
    return result;
  },
};
