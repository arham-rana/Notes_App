import { esc, $, $$, nowLocal, todayKey, toMinutes, formatTime, debounce } from './util.js';
import { icon, REMINDER_CATEGORIES, tile } from './icons.js';
import { previewText, plainText } from './markdown.js';
import { state, store, subscribe, request } from './store.js';
import { closeMenu, openMenu, toast } from './ui.js';
import { showAuth } from './auth.js';
import { notesView, actions as noteActions } from './views/notes.js';
import { remindersView, actions as reminderActions, reminderForm, dueLabel } from './views/reminders.js';
import { calendarView, actions as calendarActions, eventForm } from './views/calendar.js';
import { settingsView, actions as settingsActions } from './views/settings.js';

const views = { notes: notesView, reminders: remindersView, calendar: calendarView, settings: settingsView };
const TITLES = { notes: 'Documents', reminders: 'Reminders', calendar: 'Calendar', settings: 'Settings' };
const actions = {
  ...noteActions, ...reminderActions, ...calendarActions, ...settingsActions,
  'toggle-sidebar': toggleSidebar,
  'open-alerts': toggleAlerts,
  'account-menu': (el) => state.user?.guest ? openMenu(el, [
    { label: `${state.user.name} (guest)`, icon: 'users', run: () => {} },
    'divider',
    { label: 'Leave this document', icon: 'logOut', danger: true, run: async () => {
      await request('POST', '/api/auth/logout').catch(() => {});
      try { localStorage.removeItem('guestSession'); } catch { /* */ }
      document.body.innerHTML = '<div class="guest-ended"><h1>You’ve left the document</h1><p>Open the share link again to come back.</p></div>';
    } },
  ]) : openMenu(el, [
    { label: state.user?.name || 'Account', icon: 'users', run: () => { location.hash = '#/settings'; } },
    { label: 'Settings', icon: 'settings', run: () => { location.hash = '#/settings'; } },
    'divider',
    { label: 'Sign out', icon: 'logout', run: signOut },
  ]),
};

export async function signOut() {
  try { await store.logout(); } catch { /* signing out anyway */ }
  location.hash = '';
  location.reload();
}

export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

function updateAccountButton() {
  const btn = $('#account-btn');
  if (!btn || !state.user) return;
  btn.textContent = initials(state.user.name);
  btn.setAttribute('aria-label', `Account: ${state.user.name}`);
  btn.title = `${state.user.name} (@${state.user.username})`;
}

/* ---------- Routing ---------- */

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  // A pop-out window shows one document on its own: #/popout/<id>
  if (parts[0] === 'popout' && parts[1]) return { view: 'notes', sub: 'doc', id: parts[1], popout: true, key: `popout/${parts[1]}` };
  const first = parts[0] === 'documents' || parts[0] === 'notes' ? 'notes' : parts[0];
  const view = views[first] ? first : 'notes';
  if (view === 'notes') {
    if (!parts[1] || parts[1] === 'all') return { view, sub: 'home', key: 'documents' };
    return { view, sub: 'doc', id: parts[1], key: `documents/${parts[1]}` };
  }
  return { view, key: view };
}

const history = [];
let current = null;
let viewRoot = null;

function onRouteChange() {
  // Guests (share link) only ever see their one document.
  if (state.user?.guest && location.hash !== `#/documents/${state.user.guestNoteId}`) { location.replace(`#/documents/${state.user.guestNoteId}`); return; }
  const route = parseRoute();
  if (current && current.key !== route.key) views[current.view].leave?.(route);
  if (history[history.length - 2] === route.key) history.pop();
  else if (history[history.length - 1] !== route.key) history.push(route.key);
  if (history.length > 30) history.shift();
  const sameScreen = false;
  current = route;
  closeMenu();
  closeSidebarOnMobile();
  renderView(sameScreen);
}


function renderView(preserveScroll = false) {
  if (!state.loaded) return;
  const route = parseRoute();
  current = route;
  const scroller = $('#view');
  const top = scroller.scrollTop;
  const listScroll = $('.list-col', scroller)?.scrollTop;
  const inner = document.createElement('div');
  inner.className = `view-inner view-${route.view}`;
  inner.innerHTML = views[route.view].render(route);
  scroller.replaceChildren(inner);
  viewRoot = inner;
  views[route.view].mount?.(inner, route);
  scroller.scrollTop = preserveScroll ? top : 0;
  if (preserveScroll && listScroll !== undefined && $('.list-col', inner)) $('.list-col', inner).scrollTop = listScroll;

  $$('.nav-item').forEach((a) => {
    const active = a.dataset.view === route.view;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.body.classList.toggle('doc-open', route.view === 'notes' && route.sub === 'doc');
  updateTitle();
}

/* ---------- Sidebar ---------- */

function toggleSidebar() {
  if (window.matchMedia('(max-width: 860px)').matches) {
    document.body.classList.toggle('sidebar-open');
  } else {
    // Desktop: the slim rail either shows or disappears completely.
    const hidden = document.body.classList.toggle('sidebar-hidden');
    try { localStorage.setItem('sidebarHidden', hidden ? '1' : ''); } catch { /* ignore */ }
    (hidden ? $('.side-reopen') : $('.side-toggle'))?.focus({ preventScroll: true });
  }
}
function closeSidebarOnMobile() { document.body.classList.remove('sidebar-open'); }

/* ---------- Theme ---------- */

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
const effectiveTheme = () => (state.settings.theme === 'system' || !state.settings.theme ? (prefersDark.matches ? 'dark' : 'light') : state.settings.theme);

function applyTheme() {
  const theme = state.settings.theme || 'system';
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('theme', theme); } catch { /* ignore */ }
  const dark = effectiveTheme() === 'dark';
  const btn = $('#theme-btn');
  if (!btn) return;
  btn.innerHTML = icon(dark ? 'moon' : 'sun');
  btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
}
prefersDark.addEventListener('change', applyTheme);

/* ---------- In-app notifications ---------- */

function computeAlerts() {
  const now = nowLocal();
  const today = todayKey();
  const nowMin = toMinutes(now.slice(11));
  const lead = state.settings.eventAlertMinutes ?? 15;
  const dismissed = new Set(state.settings.dismissedAlerts || []);
  const alerts = [];
  for (const r of state.reminders) {
    if (!r.completed && !r.dismissed && r.dueAt <= now) {
      alerts.push({ key: `r:${r.id}:${r.dueAt}`, kind: 'reminder', id: r.id, title: r.title, sub: `Reminder · due ${dueLabel(r.dueAt)}`, sort: r.dueAt, category: r.category });
    }
  }
  for (const e of state.events) {
    if (e.date !== today) continue;
    const start = toMinutes(e.startTime), end = toMinutes(e.endTime);
    const key = `e:${e.id}@${e.date}T${e.startTime}`;
    if (nowMin >= start - lead && nowMin < end && !dismissed.has(key)) {
      const mins = start - nowMin;
      const when = mins > 0 ? `starts in ${mins} min` : `started at ${formatTime(e.startTime)}`;
      alerts.push({ key, kind: 'event', id: e.id, title: e.title, sub: `Event · ${when}`, sort: `${e.date}T${e.startTime}`, color: e.color });
    }
  }
  for (const n of state.notifications || []) {
    alerts.push({
      key: `n:${n.id}`, kind: 'comment', id: n.id, noteId: n.noteId, commentId: n.commentId,
      title: n.kind === 'signature' ? `${n.actorName} asked you to sign${n.body ? ` (${n.body})` : ''}`
        : n.kind === 'signed' ? `${n.actorName} signed${n.body ? ` (${n.body})` : ''}`
        : n.kind === 'mention' ? `${n.actorName} mentioned you: ${n.body}`
        : n.kind === 'mention-doc' ? `${n.actorName} mentioned you${n.body ? `: ${n.body}` : ''}`
        : `${n.actorName} ${n.kind === 'reply' ? 'replied' : 'commented'}: ${n.body}`,
      sub: `${['mention-doc', 'signature', 'signed'].includes(n.kind) ? 'In' : 'On'} “${n.noteTitle || 'Untitled'}”`, sort: n.createdAt,
    });
  }
  return alerts.sort((a, b) => b.sort.localeCompare(a.sort));
}

const seenAlerts = new Set();
let firstAlertPass = true;
function updateAlerts() {
  const alerts = computeAlerts();
  const badge = $('#alert-badge');
  badge.textContent = alerts.length > 9 ? '9+' : String(alerts.length);
  badge.hidden = alerts.length === 0;
  $('#alerts-btn').setAttribute('aria-label', alerts.length ? `Notifications, ${alerts.length} new` : 'Notifications');
  for (const a of alerts) {
    if (!seenAlerts.has(a.key) && !firstAlertPass && !IS_POPOUT) {
      toast(a.kind === 'comment' ? a.title : `${a.kind === 'reminder' ? 'Reminder' : 'Coming up'}: ${a.title}`, { duration: 7000, action: { label: 'View', run: () => openAlert(a) } });
    }
    seenAlerts.add(a.key);
  }
  firstAlertPass = false;
  if ($('#alerts-panel')) renderAlertsPanel();
  updateTitle(alerts.length);
}

function updateTitle(count = computeAlerts().length) {
  const doc = current?.sub === 'doc' ? store.find('notes', current.id) : null;
  const base = doc ? (doc.title || 'Untitled') : current ? TITLES[current.view] : 'Documents';
  document.title = count && !IS_POPOUT ? `(${count}) ${base}` : base;
}

function openAlert(a) {
  if (a.kind === 'comment') {
    closeAlerts();
    store.markNotificationsRead([a.id]);
    if (a.commentId) window.dispatchEvent(new CustomEvent('doc:open-comments', { detail: { noteId: a.noteId, commentId: a.commentId } }));
    else location.hash = `#/documents/${a.noteId}`;
    return;
  }
  closeAlerts();
  if (a.kind === 'reminder') reminderForm(store.find('reminders', a.id));
  else { const ev = store.find('events', a.id); if (ev) eventForm(ev); }
}

function dismissAlert(a) {
  if (a.kind === 'comment') { store.markNotificationsRead([a.id]); return; }
  if (a.kind === 'reminder') store.update('reminders', a.id, { dismissed: true }).catch(() => {});
  else store.updateSettings({ dismissedAlerts: [...(state.settings.dismissedAlerts || []), a.key] });
}

function renderAlertsPanel() {
  const panel = $('#alerts-panel');
  const alerts = computeAlerts();
  panel.innerHTML = `
    <div class="alerts-head"><h2>Notifications</h2>${alerts.length ? '<button class="btn-link" data-alert-clear>Clear all</button>' : ''}</div>
    ${alerts.length ? `<div class="alerts-list">${alerts.map((a, i) => {
      const t = a.kind === 'reminder' ? REMINDER_CATEGORIES[a.category] || REMINDER_CATEGORIES.task : a.kind === 'comment' ? { icon: 'comment', color: 'teal' } : { icon: 'calendar', color: a.color };
      return `<div class="alert-item">
        ${tile(t.icon, t.color, 'sm')}
        <button class="alert-main" data-alert-open="${i}"><b>${esc(a.title)}</b><span>${esc(a.sub)}</span></button>
        ${a.kind === 'reminder' ? `<button class="icon-btn" data-alert-done="${i}" aria-label="Mark ${esc(a.title)} as done">${icon('check', { size: 18 })}</button>` : ''}
        <button class="icon-btn" data-alert-dismiss="${i}" aria-label="Dismiss">${icon('x', { size: 18 })}</button>
      </div>`;
    }).join('')}</div>` : `<div class="alerts-empty">${icon('bell', { size: 22 })}<p>You're all caught up. Due reminders and upcoming events will appear here.</p></div>`}`;
  panel.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-alert-clear')) {
      const eventKeys = alerts.filter((a) => a.kind === 'event').map((a) => a.key);
      alerts.filter((a) => a.kind === 'reminder').forEach(dismissAlert);
      if (alerts.some((a) => a.kind === 'comment')) store.markNotificationsRead(alerts.filter((a) => a.kind === 'comment').map((a) => a.id));
      if (eventKeys.length) store.updateSettings({ dismissedAlerts: [...(state.settings.dismissedAlerts || []), ...eventKeys] });
      return;
    }
    const pick = (attr) => alerts[Number(b.getAttribute(attr))];
    if (b.dataset.alertOpen !== undefined) openAlert(pick('data-alert-open'));
    if (b.dataset.alertDismiss !== undefined) dismissAlert(pick('data-alert-dismiss'));
    if (b.dataset.alertDone !== undefined) {
      const a = pick('data-alert-done');
      store.update('reminders', a.id, { completed: true }).then(() => toast(`Done: ${a.title}`)).catch(() => {});
    }
  };
}

function toggleAlerts() {
  if ($('#alerts-panel')) return closeAlerts();
  closeMenu();
  const panel = document.createElement('div');
  panel.id = 'alerts-panel';
  panel.className = 'alerts-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Notifications');
  $('.topbar').appendChild(panel);
  $('#alerts-btn').setAttribute('aria-expanded', 'true');
  renderAlertsPanel();
}
function closeAlerts() {
  $('#alerts-panel')?.remove();
  $('#alerts-btn').setAttribute('aria-expanded', 'false');
}

/* ---------- Global search ---------- */

let searchResults = [];
let searchIndex = -1;

function runSearch(q) {
  const box = $('#search-results');
  q = q.trim().toLowerCase();
  if (!q) { box.hidden = true; searchResults = []; return; }
  const notes = state.notes.filter((n) => `${n.title} ${n.summary} ${n.tag} ${plainText(n.content)}`.toLowerCase().includes(q)).slice(0, 5)
    .map((n) => ({ group: 'Documents', title: n.title, sub: previewText(n), ic: n.icon, color: n.color, go: () => { location.hash = `#/documents/${n.id}`; } }));
  const reminders = state.reminders.filter((r) => r.title.toLowerCase().includes(q)).slice(0, 4)
    .map((r) => { const c = REMINDER_CATEGORIES[r.category] || REMINDER_CATEGORIES.task; return { group: 'Reminders', title: r.title, sub: dueLabel(r.dueAt), ic: c.icon, color: c.color, go: () => { location.hash = '#/reminders'; setTimeout(() => reminderForm(r), 50); } }; });
  const events = state.events.filter((e) => `${e.title} ${e.location} ${e.description}`.toLowerCase().includes(q)).slice(-4).reverse()
    .map((e) => ({ group: 'Events', title: e.title, sub: `${dueLabel(`${e.date}T${e.startTime}`)}`, ic: 'calendar', color: e.color, go: () => { location.hash = '#/calendar'; setTimeout(() => eventForm(e), 50); } }));
  searchResults = [...notes, ...reminders, ...events];
  searchIndex = searchResults.length ? 0 : -1;
  let lastGroup = '';
  box.innerHTML = searchResults.length
    ? searchResults.map((r, i) => {
      const head = r.group !== lastGroup ? `<div class="sr-group">${r.group}</div>` : '';
      lastGroup = r.group;
      return `${head}<button class="sr-item ${i === searchIndex ? 'active' : ''}" data-i="${i}" role="option" aria-selected="${i === searchIndex}">${tile(r.ic, r.color, 'sm')}<span><b>${esc(r.title)}</b><span>${esc(r.sub)}</span></span></button>`;
    }).join('')
    : `<p class="sr-empty">No documents, reminders or events match “${esc(q)}”.</p>`;
  box.hidden = false;
}

function pickResult(i) {
  const r = searchResults[i];
  if (!r) return;
  const input = $('#global-search');
  input.value = '';
  $('#search-results').hidden = true;
  input.blur();
  r.go();
}

function setupSearch() {
  const input = $('#global-search');
  const box = $('#search-results');
  const search = debounce(() => runSearch(input.value), 120);
  input.addEventListener('input', search);
  input.addEventListener('focus', () => input.value && runSearch(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; box.hidden = true; input.blur(); }
    if (!searchResults.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      searchIndex = (searchIndex + (e.key === 'ArrowDown' ? 1 : -1) + searchResults.length) % searchResults.length;
      $$('.sr-item', box).forEach((b) => { const on = Number(b.dataset.i) === searchIndex; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); if (on) b.scrollIntoView({ block: 'nearest' }); });
    }
    if (e.key === 'Enter') { e.preventDefault(); pickResult(searchIndex); }
  });
  box.addEventListener('mousedown', (e) => {
    const b = e.target.closest('.sr-item');
    if (b) { e.preventDefault(); pickResult(Number(b.dataset.i)); }
  });
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 120));
  document.addEventListener('keydown', (e) => {
    // Typing in a field or a document (contenteditable) shouldn't trigger the search shortcut.
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable || document.body.classList.contains('has-modal');
    if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      input.focus();
    }
  });
}

/* ---------- Connection banner ---------- */

function updateConnection() {
  $('#offline').hidden = !state.offline;
}

/* ---------- Boot ---------- */

document.addEventListener('click', (e) => {
  if ($('#alerts-panel') && !e.target.closest('#alerts-panel') && !e.target.closest('#alerts-btn')) closeAlerts();
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  e.stopPropagation();
  fn(el, e);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#alerts-panel')) closeAlerts(); });

window.addEventListener('hashchange', onRouteChange);
window.addEventListener('app:rerender', () => renderView(true));

window.addEventListener('auth:expired', () => {
  if (state.user?.guest) { // the share link was turned off, reset, changed or expired
    document.body.innerHTML = `<div class="guest-ended"><h1>This link is no longer available</h1><p>The owner turned it off, reset it, changed its password, or it expired. Ask them for a new link.</p></div>`;
    return;
  }
  toast('You’ve been signed out. Sign in again to continue.', { tone: 'error' });
  setTimeout(() => location.reload(), 1600);
});

subscribe((change) => {
  if (change.type === 'settings' || change.type === 'load' || change.type === 'refresh') applyTheme();
  if (change.type === 'load' || change.type === 'account' || change.type === 'refresh') updateAccountButton();
  if (change.type === 'connection') return updateConnection();
  updateAlerts();
  if (!state.loaded || !current || change.type === 'load') return;
  const handled = views[current.view].onChange?.(change, current, viewRoot);
  if (!handled) renderView(true);
});

const IS_POPOUT = location.hash.startsWith('#/popout/');

/** Remember where the pop-out window was so the next one opens in the same place. */
function rememberPopoutPlace() {
  try {
    localStorage.setItem('popoutGeometry', JSON.stringify({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight }));
  } catch { /* ignore */ }
}

async function boot() {
  if (IS_POPOUT) {
    document.body.classList.add('popout');
    window.addEventListener('beforeunload', rememberPopoutPlace);
    window.addEventListener('resize', debounce(rememberPopoutPlace, 400));
  }
  try { if (localStorage.getItem('sidebarHidden')) document.body.classList.add('sidebar-hidden'); } catch { /* ignore */ }
  setupSearch();
  try {
    await store.load();
  } catch (err) {
    if (err.status === 401) {
      // Someone who was using a share link on this device: the link no longer lets them in.
      let wasGuest = false;
      try { wasGuest = localStorage.getItem('guestSession') === '1'; localStorage.removeItem('guestSession'); } catch { /* */ }
      if (wasGuest) { document.body.innerHTML = `<div class="guest-ended"><h1>This link is no longer available</h1><p>The owner turned it off, reset it, changed its password, or it expired. Ask them for a new link.</p></div>`; return; }
      showAuth(); return;
    }
    $('#view').innerHTML = `<div class="boot-error"><h2>Can't load your documents</h2><p class="muted">The server didn't respond (${esc(err.message)}). Check that the container is running, then try again.</p><button class="btn btn-primary" onclick="location.reload()">Try again</button></div>`;
    return;
  }
  applyTheme();
  if (state.user?.guest) document.body.classList.add('guest-mode', 'sidebar-hidden');
  try { if (state.user?.guest) localStorage.setItem('guestSession', '1'); else localStorage.removeItem('guestSession'); } catch { /* */ }
  onRouteChange();
  updateAlerts();
  setInterval(updateAlerts, 30000);
  // Keep devices in sync: pull fresh data periodically and whenever the tab regains focus.
  const refresh = () => { if (!document.hidden && !document.body.classList.contains('has-modal')) store.refresh(); };
  setInterval(refresh, 30000);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('focus', refresh);
}

boot();
