import { esc } from './util.js';
import { request, state } from './store.js';

/* People who can open a document (fetched once per document). */
const cache = new Map();
export async function peopleFor(noteId) {
  if (!cache.has(noteId)) cache.set(noteId, request('GET', `/api/notes/${noteId}/people`).catch(() => []));
  return cache.get(noteId);
}

const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

/** A small list of people under the caret. The caller decides when to show, filter and pick. */
export class PeopleMenu {
  constructor(onPick) {
    this.onPick = onPick;
    this.el = document.createElement('div');
    this.el.className = 'slash-menu people-menu';
    this.el.setAttribute('role', 'listbox');
    this.el.setAttribute('aria-label', 'Mention someone');
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) this.onPick(this.items[Number(b.dataset.i)]); });
    this.items = [];
    this.active = 0;
    this.people = [];
  }
  get open() { return this.el.isConnected; }
  show(rect, people) {
    this.people = people.filter((p) => p.id !== state.user?.id);
    document.body.appendChild(this.el);
    this.filter('');
    const h = this.el.offsetHeight;
    this.el.style.left = `${Math.min(rect.left, window.innerWidth - this.el.offsetWidth - 8)}px`;
    this.el.style.top = `${rect.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 6) : rect.bottom + 6}px`;
  }
  filter(q) {
    const t = q.toLowerCase();
    this.items = this.people.filter((p) => !t || p.username.includes(t) || p.name.toLowerCase().includes(t));
    this.active = Math.min(this.active, Math.max(0, this.items.length - 1));
    this.el.innerHTML = this.items.length
      ? this.items.map((p, i) => `<button type="button" role="option" class="slash-item ${i === this.active ? 'active' : ''}" data-i="${i}" aria-selected="${i === this.active}"><span class="avatar avatar-sm">${esc(initials(p.name))}</span><span><b>${esc(p.name)}</b><small>@${esc(p.username)}</small></span></button>`).join('')
      : `<p class="slash-empty">${this.people.length ? 'No one by that name has access.' : 'Share this document to mention people.'}</p>`;
    return this.items.length;
  }
  move(d) {
    if (!this.items.length) return;
    this.active = (this.active + d + this.items.length) % this.items.length;
    this.filter(this.lastQuery || '');
  }
  close() { this.el.remove(); this.active = 0; }
  current() { return this.items[this.active]; }
}

/** @mentions in a comment box (textarea). */
export function attachMentionsToTextarea(textarea, noteId) {
  if (textarea.dataset.mentions) return;
  textarea.dataset.mentions = '1';
  let at = -1;
  const menu = new PeopleMenu((p) => insert(p));
  function insert(p) {
    if (!p) return;
    const v = textarea.value;
    const end = textarea.selectionStart;
    textarea.value = `${v.slice(0, at)}@${p.username} ${v.slice(end)}`;
    const pos = at + p.username.length + 2;
    textarea.setSelectionRange(pos, pos);
    at = -1;
    menu.close();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  }
  textarea.addEventListener('input', async (e) => {
    const pos = textarea.selectionStart;
    const v = textarea.value;
    if (at >= 0) {
      const q = v.slice(at + 1, pos);
      if (pos <= at || /\s/.test(q) || q.length > 30) { at = -1; menu.close(); return; }
      menu.lastQuery = q;
      menu.filter(q);
      return;
    }
    if (e.data === '@' && (pos === 1 || /\s/.test(v[pos - 2]))) {
      at = pos - 1;
      const r = textarea.getBoundingClientRect();
      menu.lastQuery = '';
      menu.show({ left: r.left + 8, top: r.top, bottom: r.bottom }, await peopleFor(noteId));
    }
  });
  textarea.addEventListener('keydown', (e) => {
    if (!menu.open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); menu.move(e.key === 'ArrowDown' ? 1 : -1); }
    else if ((e.key === 'Enter' || e.key === 'Tab') && menu.items.length) { e.preventDefault(); e.stopPropagation(); insert(menu.current()); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); at = -1; menu.close(); }
  });
  textarea.addEventListener('blur', () => setTimeout(() => { at = -1; menu.close(); }, 150));
}

/** Highlight @mentions in plain text (already escaped). */
export const markMentions = (escaped) => escaped.replace(/(^|[\s(])@([a-z0-9._-]{3,30}[a-z0-9_-])/gi, '$1<span class="mention">@$2</span>');
