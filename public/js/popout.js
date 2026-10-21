import { toast } from './ui.js';

/**
 * Open a document in its own browser window. It stays open when the main window
 * is minimized and can be moved anywhere on the desktop. Opening the same
 * document again brings its existing window to the front.
 */
// Pop-outs opened from this window, so they can be moved and arranged later.
const popouts = new Map(); // id -> { win, at }

/** The usable area of the screen this window is on (excludes the menu bar and Dock). */
export function screenArea() {
  const sc = window.screen;
  return { x: sc.availLeft ?? 0, y: sc.availTop ?? 0, w: sc.availWidth, h: sc.availHeight };
}

/** Pop-outs that are still open, most recently used first. */
export function openPopoutIds() {
  for (const [id, p] of popouts) if (!p.win || p.win.closed) popouts.delete(id);
  return [...popouts.entries()].sort((a, b) => b[1].at - a[1].at).map(([id]) => id);
}

/** Move and size an OS window (outer size, so it fills the region exactly). */
function placeWindow(win, r) {
  try { win.moveTo(Math.round(r.x), Math.round(r.y)); win.resizeTo(Math.round(r.w), Math.round(r.h)); } catch { /* browser refused */ }
}

/** Open (or reuse) a document's pop-out and put it in a rectangle of the screen. */
export function placePopout(id, rect) {
  const existing = popouts.get(id);
  if (existing?.win && !existing.win.closed) {
    placeWindow(existing.win, rect);
    existing.win.focus();
    existing.at = Date.now();
    return existing.win;
  }
  return openPopout(id, rect);
}

/** Inside a pop-out: move and size this window. */
export function placeSelf(rect) { placeWindow(window, rect); }

export function openPopout(id, rect = null) {
  const existing = popouts.get(id);
  if (existing?.win && !existing.win.closed && !rect) { existing.win.focus(); existing.at = Date.now(); return existing.win; }
  let g = {};
  try { g = JSON.parse(localStorage.getItem('popoutGeometry')) || {}; } catch { /* ignore */ }
  const availW = window.screen.availWidth, availH = window.screen.availHeight;
  const w = Math.min(g.w || 760, availW - 40);
  const h = Math.min(g.h || 620, availH - 40);
  const left = g.x ?? Math.max(0, window.screenX + window.outerWidth - w - 40);
  const top = g.y ?? Math.max(0, window.screenY + 90);
  const r = rect || { x: left, y: top, w, h };
  const features = `popup=yes,width=${Math.round(r.w)},height=${Math.round(r.h)},left=${Math.round(r.x)},top=${Math.round(r.y)}`;
  const win = window.open(`/#/popout/${encodeURIComponent(id)}`, `notes-doc-${id}`, features);
  if (!win) {
    toast('Your browser blocked the pop-up window. Allow pop-ups for this site, then try again.', { tone: 'error', duration: 7000 });
    return null;
  }
  popouts.set(id, { win, at: Date.now() });
  // Window size options set the page area; correct to the full window size once it opens.
  if (rect) setTimeout(() => { if (!win.closed) placeWindow(win, rect); }, 400);
  win.focus();
  return win;
}

/** From a pop-out: show a document in the main app window (opening one if needed). */
export function showInMainWindow(id) {
  const main = window.opener && !window.opener.closed ? window.opener : null;
  if (main) {
    main.location.hash = `#/documents/${id}`;
    main.focus();
  } else {
    window.open(`/#/documents/${id}`, 'notes-main');
  }
}
