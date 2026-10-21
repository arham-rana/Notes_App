import { esc } from './util.js';
import { icon } from './icons.js';

/* ---------- Toasts ---------- */
export function toast(message, { tone = 'info', action, duration = 4200 } = {}) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button class="btn-link">${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').addEventListener('click', () => { action.run(); dismiss(); });
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const dismiss = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  setTimeout(dismiss, duration);
}

/* ---------- Modal ---------- */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function openModal({ title, body, footer = '', size = 'md', onMount, onClose }) {
  const previous = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal modal-${size}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header class="modal-head">
        <h2 id="modal-title">${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
      </header>
      <div class="modal-body">${body}</div>
      ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
    </div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('has-modal');
  const modal = wrap.querySelector('.modal');

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    wrap.classList.remove('show');
    setTimeout(() => wrap.remove(), 180);
    if (!document.querySelector('.modal-backdrop.show')) document.body.classList.remove('has-modal');
    onClose?.();
    previous?.focus?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') {
      const items = [...modal.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  requestAnimationFrame(() => wrap.classList.add('show'));
  onMount?.(modal, close);
  (modal.querySelector('[autofocus]') || modal.querySelector('.modal-body ' + FOCUSABLE) || modal)?.focus();
  return { el: modal, close };
}

export function confirmDialog({ title, message, confirmLabel = 'Delete', tone = 'danger' }) {
  return new Promise((resolve) => {
    let answered = false;
    openModal({
      title,
      size: 'sm',
      body: `<p class="muted">${esc(message)}</p>`,
      footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-${tone}" data-confirm>${esc(confirmLabel)}</button>`,
      onMount: (el, close) => {
        const btn = el.querySelector('[data-confirm]');
        btn.addEventListener('click', () => { answered = true; resolve(true); close(); });
        setTimeout(() => btn.focus(), 30);
      },
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

/* ---------- Popover menu ---------- */
let openMenuEl = null;
let openMenuAnchor = null;
let menuOpenedAt = 0;
export function closeMenu() {
  if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
  openMenuAnchor = null;
}
const isAnchor = (a, target) => a && a.nodeType === 1 && (a === target || a.contains(target));

/** items: [{ label, icon, run, danger }] or 'divider' */
export function openMenu(anchor, items, { align = 'end' } = {}) {
  // Clicking the button that opened this menu closes it.
  if (openMenuEl && isAnchor(openMenuAnchor, anchor)) { closeMenu(); return null; }
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items.map((it, i) => it === 'divider'
    ? '<div class="menu-divider"></div>'
    : `<button role="menuitem" class="menu-item ${it.danger ? 'danger' : ''}" data-i="${i}">${it.icon ? icon(it.icon, { size: 17 }) : ''}<span>${esc(it.label)}</span>${it.submenu ? '<span class="menu-sub" aria-hidden="true"></span>' : ''}</button>`).join('');
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = align === 'end' ? r.right - mw : r.left;
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
  left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-i]');
    if (!btn) return;
    closeMenu();
    items[Number(btn.dataset.i)].run();
  });
  menu.addEventListener('keydown', (e) => {
    const buttons = [...menu.querySelectorAll('.menu-item')];
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
    // Esc closes just the menu (not the document or dialog behind it).
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); anchor.focus(); }
  });
  openMenuEl = menu;
  openMenuAnchor = anchor;
  menuOpenedAt = Date.now();
  menu.querySelector('.menu-item')?.focus({ preventScroll: true });
  return menu;
}

document.addEventListener('mousedown', (e) => {
  if (openMenuEl && !openMenuEl.contains(e.target) && !isAnchor(openMenuAnchor, e.target)) closeMenu();
});
window.addEventListener('resize', closeMenu);
document.addEventListener('scroll', (e) => {
  if (!openMenuEl || openMenuEl.contains(e.target) || Date.now() - menuOpenedAt < 250) return;
  closeMenu();
}, true);

/* ---------- Form helpers ---------- */
export function formData(form) {
  const data = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
    else if (el.type === 'checkbox') data[el.name] = el.checked;
    else data[el.name] = el.value;
  }
  return data;
}

export function showFormError(form, message) {
  let el = form.querySelector('.form-error');
  if (!el) {
    el = document.createElement('p');
    el.className = 'form-error';
    el.setAttribute('role', 'alert');
    form.appendChild(el);
  }
  el.textContent = message;
}
