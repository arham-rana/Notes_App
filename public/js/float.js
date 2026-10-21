import { titleControlsHtml, syncTitleBoxes, editingTitle } from './title-controls.js';
import { esc, debounce, $ } from './util.js';
import { icon, tile } from './icons.js';
import { store, subscribe } from './store.js';
import { noteBodyHtml, canEdit } from './note-view.js';
import { editorHtml, mountEditor } from './editor.js';
import { openPopout } from './popout.js';
import { openLayoutMenu } from './layout-menu.js';

// Floating windows live outside the page view, so they stay open while you
// move between Notes, Reminders and Calendar.
const wins = new Map(); // noteId -> { el, editing, editor }
let topZ = 40;
const GEOM_KEY = 'floatGeometry.v2';
const isSmall = () => window.matchMedia('(max-width: 860px)').matches;

function loadGeom() {
  try { return JSON.parse(localStorage.getItem(GEOM_KEY)) || {}; } catch { return {}; }
}
function saveGeom(el) {
  if (isSmall()) return;
  const r = el.getBoundingClientRect();
  try { localStorage.setItem(GEOM_KEY, JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) })); } catch { /* ignore */ }
}
function clamp(el) {
  const r = el.getBoundingClientRect();
  const x = Math.min(Math.max(8 - r.width + 120, r.left), window.innerWidth - 120);
  const y = Math.min(Math.max(8, r.top), window.innerHeight - 56);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}
function bringToFront(el) {
  el.style.zIndex = String(++topZ);
  const entry = wins.get(el.dataset.id);
  if (entry) entry.lastFocus = Date.now();
  document.querySelectorAll('.float-win').forEach((w) => w.classList.toggle('front', w === el));
}

function headHtml(note, editing) {
  return `
  <header class="float-head">
    ${tile(note.icon, note.color, 'sm')}
    <span class="float-title">${titleControlsHtml(note)}</span>
    <div class="float-actions">
      ${editing
        ? `<button class="btn btn-primary btn-xs" data-float="done">${icon('check', { size: 15 })}Done</button>`
        : canEdit(note) ? `<button class="icon-btn" data-float="edit" aria-label="Edit note" title="Edit">${icon('edit', { size: 18 })}</button>` : ''}
      <button class="icon-btn" data-float="layout" aria-label="Window options" aria-haspopup="menu" title="Window: open as full page, floating window or new browser window, and layout">${icon('layout', { size: 18 })}</button>
      <button class="icon-btn" data-float="close" aria-label="Close floating window" title="Close">${icon('x', { size: 18 })}</button>
    </div>
  </header>`;
}

function render(win) {
  const id = win.el.dataset.id;
  const note = store.find('notes', id);
  if (!note) { closeFloat(id); return; }
  const scroll = $('.float-body', win.el)?.scrollTop || 0;
  win.editor?.destroy();
  win.editor = null;
  win.el.setAttribute('aria-label', `Document: ${note.title}`);
  win.el.innerHTML = `${headHtml(note, win.editing)}
    <div class="float-body">${win.editing ? editorHtml(note) : noteBodyHtml(note, { editAction: 'float' })}</div>`;
  if (win.editing) win.editor = mountEditor($('.note-editor', win.el));
  else $('.float-body', win.el).scrollTop = scroll;
}

function wire(win) {
  const { el } = win;
  const id = el.dataset.id;
  el.addEventListener('pointerdown', () => bringToFront(el), true);

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-float]');
    if (!btn) return;
    e.stopPropagation();
    switch (btn.dataset.float) {
      case 'edit': if (canEdit(store.find('notes', id) || {})) { win.editing = true; render(win); } break;
      case 'done': win.editor?.flush(); win.editing = false; render(win); break;
      case 'full':
        win.editor?.flush();
        closeFloat(id);
        location.hash = `#/documents/${id}`;
        break;
      case 'open':
        win.editor?.flush();
        closeFloat(id);
        location.hash = `#/documents/${id}`;
        break;
      case 'popout': win.editor?.flush(); closeFloat(id); openPopout(id); break;
      case 'layout': win.editor?.flush(); openLayoutMenu(btn, { id, from: 'float' }); break;
      case 'close': closeFloat(id); break;
    }
  });

  // Drag by the title bar.
  el.addEventListener('pointerdown', (e) => {
    const head = e.target.closest('.float-head');
    if (!head || e.target.closest('button, input, .title-controls') || isSmall() || e.button !== 0) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    el.classList.remove('snapped');
    const move = (ev) => {
      el.style.left = `${ev.clientX - dx}px`;
      el.style.top = `${ev.clientY - dy}px`;
    };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      clamp(el);
      saveGeom(el);
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  });

  // Remember the size after the user resizes from the corner.
  const remember = debounce(() => saveGeom(el), 300);
  win.observer = new ResizeObserver(() => {
    if (el.classList.contains('snapping')) return; // our own snap, not a hand resize
    if (el.classList.contains('snapped')) { el.classList.remove('snapped'); return; }
    remember();
  });
  win.observer.observe(el);
}

export function openFloat(id) {
  const existing = wins.get(id);
  if (existing) { bringToFront(existing.el); return; }
  if (!store.find('notes', id)) return;

  const g = loadGeom();
  const offset = wins.size * 28;
  // Landscape by default: wider than it is tall.
  const w = Math.min(g.w || 760, window.innerWidth - 32);
  const h = Math.min(g.h || 480, window.innerHeight - 32);
  const x = (g.x ?? window.innerWidth - w - 36) - offset;
  const y = (g.y ?? 110) + offset;

  const el = document.createElement('section');
  el.className = 'float-win';
  el.dataset.id = id;
  el.setAttribute('role', 'dialog');
  el.style.cssText = `width:${w}px;height:${h}px;left:${x}px;top:${y}px`;
  document.body.appendChild(el);

  const win = { el, editing: false, editor: null };
  wins.set(id, win);
  render(win);
  wire(win);
  clamp(el);
  bringToFront(el);
  requestAnimationFrame(() => el.classList.add('show'));
  $('.float-head button', el)?.focus({ preventScroll: true });
}

export function closeFloat(id) {
  const win = wins.get(id);
  if (!win) return;
  win.editor?.destroy();
  win.observer?.disconnect();
  win.el.remove();
  wins.delete(id);
}


subscribe((change) => {
  if (change.kind && change.kind !== 'notes') return;
  for (const [id, win] of wins) {
    const note = store.find('notes', id);
    if (!note) { closeFloat(id); continue; }
    if (win.editing) {
      // Keep typing uninterrupted; just refresh the title bar.
      syncTitleBoxes(note);
      const t = $('.float-head .tile', win.el);
      if (t) t.className = `tile tile-sm c-${note.color}`;
    } else if (editingTitle(win.el)) {
      syncTitleBoxes(note); // someone is typing the title: don't redraw the window under them
    } else if (change.type !== 'saved') {
      render(win);
    }
  }
});

window.addEventListener('resize', () => wins.forEach((w) => clamp(w.el)));

/** Floating windows that are open, most recently used first. */
export function openFloatIds() {
  return [...wins.entries()].sort((a, b) => (b[1].lastFocus || 0) - (a[1].lastFocus || 0)).map(([id]) => id);
}

/** Open (if needed) and place a floating window in a rectangle of the browser window. */
export function snapFloat(id, rect) {
  if (!wins.has(id)) openFloat(id);
  const win = wins.get(id);
  if (!win) return;
  const { el } = win;
  el.classList.add('snapped', 'snapping');
  Object.assign(el.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
  setTimeout(() => el.classList.remove('snapping'), 450);
  bringToFront(el);
}
