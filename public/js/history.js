import { esc, timeAgo } from './util.js';
import { icon, tile } from './icons.js';
import { renderNote } from './markdown.js';
import { request, store } from './store.js';
import { openModal, confirmDialog, toast } from './ui.js';

const when = (iso) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
const dayLabel = (iso) => new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(iso));

/* ---------- Trash ---------- */

export function openTrash() {
  openModal({
    title: 'Deleted documents',
    size: 'lg',
    body: '<p class="muted small trash-intro">Deleted documents stay here for 30 days, then they and their files are removed for good.</p><div class="trash-list"><p class="muted small">Loading…</p></div>',
    footer: '<button class="btn btn-ghost-danger" data-empty hidden>Delete all permanently</button><span class="spacer"></span><button class="btn btn-primary" data-close>Done</button>',
    onMount: async (el) => {
      const box = el.querySelector('.trash-list');
      const emptyBtn = el.querySelector('[data-empty]');
      async function draw() {
        let items = [];
        try { items = await request('GET', '/api/trash'); } catch (err) { box.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; return; }
        emptyBtn.hidden = !items.length;
        box.innerHTML = items.length ? items.map((n) => {
          const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - Date.parse(n.deletedAt)) / 86400000));
          return `<div class="trash-row">
            ${tile(n.icon || 'file', n.color || 'blue', 'sm')}
            <span class="trash-info"><b>${esc(n.title || 'Untitled')}</b><span>Deleted ${timeAgo(n.deletedAt)} · removed ${daysLeft === 0 ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}</span></span>
            <button class="btn btn-outline btn-sm" data-restore="${n.id}">${icon('restore', { size: 15 })}Restore</button>
            <button class="icon-btn" data-forever="${n.id}" data-title="${esc(n.title || 'Untitled')}" aria-label="Delete forever" title="Delete forever">${icon('trash', { size: 17 })}</button>
          </div>`;
        }).join('') : `<div class="cp-empty">${icon('trash', { size: 22 })}<p>The Trash is empty.</p></div>`;
      }
      box.addEventListener('click', async (e) => {
        const r = e.target.closest('[data-restore]');
        const f = e.target.closest('[data-forever]');
        try {
          if (r) { await request('POST', `/api/trash/${r.dataset.restore}/restore`); await store.refresh(); toast('Restored to your documents'); draw(); }
          if (f && await confirmDialog({ title: 'Delete forever?', message: `“${f.dataset.title}” and its files will be permanently deleted. This can’t be undone.`, confirmLabel: 'Delete forever' })) {
            await request('DELETE', `/api/trash/${f.dataset.forever}`); toast('Deleted forever'); draw();
          }
        } catch (err) { toast(err.message, { tone: 'error' }); }
      });
      emptyBtn.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Permanently delete everything in Deleted?', message: 'Everything in Deleted, and its files, will be permanently deleted. This can’t be undone.', confirmLabel: 'Delete all permanently' }))) return;
        try { const r = await request('DELETE', '/api/trash'); toast(`Deleted ${r.deleted} document${r.deleted === 1 ? '' : 's'} forever`); draw(); } catch (err) { toast(err.message, { tone: 'error' }); }
      });
      draw();
    },
  });
}

/* ---------- Version history ---------- */

export function openVersionHistory(noteId) {
  const note = store.find('notes', noteId);
  if (!note) return;
  openModal({
    title: 'Version history',
    size: 'xl',
    body: `<div class="vh"><div class="vh-list" role="listbox" aria-label="Versions"><p class="muted small">Loading…</p></div><div class="vh-view"><div class="vh-bar"></div><div class="vh-doc prose"></div></div></div>`,
    footer: '<span class="muted small vh-note">Restoring keeps the current version in the history, so you can always go back.</span><span class="spacer"></span><button class="btn btn-ghost" data-close>Close</button><button class="btn btn-primary" data-restore-version hidden>' + icon('restore', { size: 16 }) + 'Restore this version</button>',
    onMount: async (el, close) => {
      const list = el.querySelector('.vh-list'), view = el.querySelector('.vh-doc'), bar = el.querySelector('.vh-bar'), restoreBtn = el.querySelector('[data-restore-version]');
      let data;
      try { data = await request('GET', `/api/notes/${noteId}/versions`); } catch (err) { list.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; return; }
      let selected = 'current';
      const items = [{ id: 'current', createdAt: data.current.updatedAt, author: data.current.author, current: true }, ...data.versions];
      let lastDay = '';
      list.innerHTML = items.map((v) => {
        const day = dayLabel(v.createdAt);
        const head = day !== lastDay ? `<div class="vh-day">${esc(day)}</div>` : '';
        lastDay = day;
        return `${head}<button type="button" role="option" class="vh-item ${v.current ? 'active' : ''}" data-version="${v.id}" aria-selected="${!!v.current}">
          <b>${v.current ? 'Current version' : esc(new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(v.createdAt)))}</b>
          <span>${esc(v.author)}${v.current ? ` · ${timeAgo(v.createdAt)}` : ''}</span></button>`;
      }).join('') + (data.versions.length ? '' : '<p class="muted small vh-none">No earlier versions yet. Versions are saved as the document is edited.</p>');
      async function show(id) {
        selected = id;
        list.querySelectorAll('.vh-item').forEach((b) => { const on = b.dataset.version === id; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
        restoreBtn.hidden = id === 'current' || !data.canRestore;
        if (id === 'current') {
          const n = store.find('notes', noteId);
          bar.innerHTML = `<b>${esc(n?.title || '')}</b><span class="muted small">Current version</span>`;
          view.innerHTML = renderNote(n?.content || '', { readOnly: true });
          return;
        }
        view.innerHTML = '<p class="muted small">Loading…</p>';
        try {
          const v = await request('GET', `/api/notes/${noteId}/versions/${id}`);
          if (selected !== id) return;
          bar.innerHTML = `<b>${esc(v.title)}</b><span class="muted small">${esc(when(v.createdAt))}</span>`;
          view.innerHTML = renderNote(v.content, { readOnly: true }) || '<p class="muted">This version was empty.</p>';
        } catch (err) { view.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; }
      }
      list.addEventListener('click', (e) => { const b = e.target.closest('[data-version]'); if (b) show(b.dataset.version); });
      list.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const btns = [...list.querySelectorAll('.vh-item')];
        const i = btns.findIndex((b) => b.dataset.version === selected);
        const next = btns[Math.min(btns.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        next.focus(); show(next.dataset.version);
      });
      restoreBtn.addEventListener('click', async () => {
        try {
          await request('POST', `/api/notes/${noteId}/versions/${selected}/restore`);
          await store.refresh();
          close();
          toast('Version restored. The version you replaced is in the history.');
        } catch (err) { toast(err.message, { tone: 'error' }); }
      });
      show('current');
    },
  });
}
