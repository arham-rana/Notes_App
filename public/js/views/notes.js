import { esc, timeAgo, $ , kbd } from '../util.js';
import { icon, tile } from '../icons.js';
import { toggleTaskLine, previewText, plainText, renderNote, headingsOf } from '../markdown.js';
import { openTrash, openVersionHistory } from '../history.js';
import { downloadMarkdown, downloadWord, printDoc, pageSetup, editHeaderFooter } from '../export.js';
import { setupOf, paginateDom, unstylePage } from '../paginate.js';
import { hydrateSignatures, signatureSync } from '../signatures.js';
import { openDropdownPicker } from '../dropdowns.js';
import { decData, encData } from '../markdown.js';
import { reminderForm } from './reminders.js';
import { todayKey, addDays, toDateKey } from '../util.js';
import { noteBodyHtml, sharedBadge, sharingPill, canEdit, isOwner } from '../note-view.js';
import { titleControlsHtml, editingTitle, syncTitleBoxes } from '../title-controls.js';
import { openShareDialog } from '../share.js';
import { editorHtml, mountEditor } from '../editor.js';
import { openFloat } from '../float.js';
import { openPopout, showInMainWindow } from '../popout.js';
import { openLayoutMenu } from '../layout-menu.js';
import { attachComments } from '../comments.js';
import { state, store, request } from '../store.js';
import { openModal, openMenu, confirmDialog, toast } from '../ui.js';
import { hero, emptyState } from './common.js';

const ui = { favouritesOnly: false, query: '', sort: 'newest', editing: false, commentsOpen: false, focusComment: null, tag: null, folder: null };
let docEditor = null;
let docComments = null;
let docWatch = null;
const SORTS = {
  newest: { label: 'Recently edited', fn: (a, b) => b.updatedAt.localeCompare(a.updatedAt) },
  oldest: { label: 'Oldest first', fn: (a, b) => a.updatedAt.localeCompare(b.updatedAt) },
  created: { label: 'Recently created', fn: (a, b) => b.createdAt.localeCompare(a.createdAt) },
  title: { label: 'Title A–Z', fn: (a, b) => a.title.localeCompare(b.title) },
};

const TEMPLATES = [
  { id: 'blank', name: 'Blank document', icon: 'file', color: 'blue', text: 'Start from an empty page.', note: { title: 'Untitled', content: '' } },
  { id: 'meeting', name: 'Meeting notes', icon: 'users', color: 'green', text: 'Agenda, decisions and follow-ups.', note: { title: 'Meeting notes', icon: 'briefcase', color: 'green', tag: 'Meeting', content: '## Agenda\n- \n\n## Decisions\n- \n\n## Follow-ups\n- [ ] ' } },
  { id: 'trip', name: 'Trip plan', icon: 'plane', color: 'amber', text: 'Stops, bookings and a packing list.', note: { title: 'New trip', icon: 'plane', color: 'amber', tag: 'Travel', content: '## Itinerary\n- **City – days**\n  Places to see\n\n## Bookings\n- [ ] Flights\n- [ ] Accommodation\n\n## Packing\n- [ ] Passport\n- [ ] Chargers' } },
  { id: 'week', name: 'Weekly plan', icon: 'calendar', color: 'purple', text: 'Priorities for the week ahead.', note: { title: 'This week', icon: 'star', color: 'purple', content: '## Top three\n1. \n2. \n3. \n\n## Tasks\n- [ ] \n\n## Notes\n' } },
  { id: 'reading', name: 'Reading list', icon: 'book', color: 'purple', text: 'Books to read and what you thought.', note: { title: 'Reading list', icon: 'book', color: 'purple', tag: 'Books', content: '## Reading now\n- **Title** by Author\n  Thoughts so far\n\n## Up next\n- [ ] ' } },
  { id: 'project', name: 'Project brief', icon: 'briefcase', color: 'teal', text: 'Goal, milestones and open questions.', note: { title: 'New project', icon: 'briefcase', color: 'teal', kind: 'project', content: '## Goal\nWhat does done look like?\n\n## Milestones\n- [ ] \n\n## Open questions\n- ' } },
];

const docUrl = (id) => `#/documents/${id}`;
const isPopout = () => location.hash.startsWith('#/popout/');
const currentUrl = (id) => (isPopout() ? `#/popout/${id}` : docUrl(id));
const stripShare = ({ id, createdAt, updatedAt, access, ownerId, ownerName, shareCount, ...rest }) => rest;

/* ================= Documents list ================= */

function docRow(note) {
  return `
  <div class="row doc-row" data-doc="${note.id}" tabindex="0" role="button" draggable="true"
       aria-label="${esc(note.title || 'Untitled')}. Press Space to preview, Enter to open.">
    ${tile(note.icon, note.color)}
    <div class="row-text">
      <span class="row-title">${note.pinned ? `<span class="pin-dot" title="Pinned to the top">${icon('pinTop', { size: 14 })}</span>` : ''}${esc(note.title || 'Untitled')}${note.favourite ? `<span class="fav-dot" title="Favourite">${icon('star', { size: 13 })}</span>` : ''}${sharedBadge(note)}${note.commentCount ? `<span class="shared-badge cmt-badge" title="${note.commentCount} open comment${note.commentCount === 1 ? '' : 's'}">${icon('comment', { size: 13 })}${note.commentCount}</span>` : ''}</span>
      <span class="row-sub">${esc(previewText(note))}</span>
    </div>
    <span class="row-meta">${timeAgo(note.updatedAt)}</span>
  </div>`;
}

function filteredDocs() {
  const q = ui.query.trim().toLowerCase();
  return state.notes
    .filter((n) => !ui.folder || n.folderId === ui.folder)
    .filter((n) => !ui.favouritesOnly || n.favourite)
    .filter((n) => !ui.tag || (n.tag || '').toLowerCase() === ui.tag.toLowerCase())
    .filter((n) => !q || `${n.title} ${n.summary} ${n.tag} ${plainText(n.content)}`.toLowerCase().includes(q))
    .sort((a, b) => (b.pinned === true) - (a.pinned === true) || SORTS[ui.sort].fn(a, b));
}

function listHtml() {
  const docs = filteredDocs();
  if (docs.length) return docs.map(docRow).join('');
  if (ui.query) return emptyState({ iconName: 'search', title: 'No matching documents', text: `Nothing matches “${ui.query}”. Try a different word.` });
  if (ui.favouritesOnly) return emptyState({ iconName: 'star', title: 'No favourites yet', text: 'Star a document to keep it here.' });
  if (ui.tag) return emptyState({ iconName: 'tag', title: `Nothing tagged “${ui.tag}”`, text: 'Choose another tag, or All.' });
  if (ui.folder) return emptyState({ iconName: 'dirFolder', title: 'This folder is empty', text: 'Drag documents onto a folder, or use Move to folder in a document’s preview.' });
  return emptyState({ iconName: 'file', title: 'No documents yet', text: 'Create your first document to get started.', action: '<button class="btn btn-primary" data-action="new-note">New Document</button>' });
}

/* ================= Folders ================= */
const folderById = (id) => state.folders.find((f) => f.id === id);
function folderPath(id) {
  const path = [];
  for (let f = folderById(id); f && path.length < 50; f = folderById(f.parentId)) path.unshift(f);
  return path;
}
function folderAreaHtml() {
  if (ui.folder && !folderById(ui.folder)) ui.folder = null;
  const children = state.folders.filter((f) => (f.parentId || null) === ui.folder);
  const docsIn = (id) => state.notes.filter((n) => n.folderId === id).length;
  const subsIn = (id) => state.folders.filter((f) => f.parentId === id).length;
  const crumbs = ui.folder ? `<nav class="folder-crumbs" aria-label="Folder path">
      <button type="button" class="crumb" data-action="open-folder" data-folder="" data-drop-folder="">${icon('file', { size: 15 })}All documents</button>
      ${folderPath(ui.folder).map((f, i, all) => `<span class="crumb-sep" aria-hidden="true">›</span><button type="button" class="crumb ${i === all.length - 1 ? 'current' : ''}" data-action="open-folder" data-folder="${f.id}" data-drop-folder="${f.id}" ${i === all.length - 1 ? 'aria-current="page"' : ''}>${esc(f.name)}</button>`).join('')}
    </nav>` : '';
  if (!children.length && !ui.folder) return '';
  return `${crumbs}
    ${children.length ? `<div class="folder-grid">${children.map((f) => {
      const d = docsIn(f.id), sub = subsIn(f.id);
      const count = [sub && `${sub} folder${sub === 1 ? '' : 's'}`, `${d} document${d === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
      return `<div class="folder-card" data-action="open-folder" data-folder="${f.id}" data-drop-folder="${f.id}" draggable="true" tabindex="0" role="button" aria-label="Open folder ${esc(f.name)}, ${count}">
        <span class="folder-ic">${icon('dirFolder', { size: 22 })}</span>
        <span class="folder-info"><b>${esc(f.name)}</b><small>${count}</small></span>
        <button type="button" class="icon-btn folder-more" data-action="folder-menu" data-folder="${f.id}" aria-label="Folder options for ${esc(f.name)}" title="Rename, move or delete">${icon('more', { size: 17 })}</button>
      </div>`;
    }).join('')}</div>` : ''}`;
}
function askFolderName({ title, value = '', confirm }) {
  return new Promise((resolve) => {
    let result = null;
    openModal({
      title, size: 'sm',
      body: `<form class="form" id="folder-form" novalidate><label class="field"><span>Folder name</span><input name="name" maxlength="60" value="${esc(value)}" autofocus placeholder="e.g. Work"></label></form>`,
      footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="folder-form">${confirm}</button>`,
      onMount: (el, close) => {
        const f = el.querySelector('#folder-form');
        setTimeout(() => f.elements.name.select(), 30);
        f.addEventListener('submit', (e) => { e.preventDefault(); const v = f.elements.name.value.trim(); if (!v) return; result = v; close(); });
      },
      onClose: () => resolve(result),
    });
  });
}
async function newFolder(parentId = ui.folder) {
  const name = await askFolderName({ title: parentId ? `New folder in “${folderById(parentId)?.name}”` : 'New folder', confirm: 'Create folder' });
  if (!name) return null;
  try { return await store.createFolder(name, parentId); } catch (err) { toast(err.message, { tone: 'error' }); return null; }
}
/** Choose a folder (shown as an indented tree). Resolves to a folder id, '' for none, or null if cancelled. */
function pickFolder({ title, current = null, exclude = null }) {
  return new Promise((resolve) => {
    let result = null;
    const blocked = new Set();
    if (exclude) { blocked.add(exclude); let grew = true; while (grew) { grew = false; for (const f of state.folders) if (f.parentId && blocked.has(f.parentId) && !blocked.has(f.id)) { blocked.add(f.id); grew = true; } } }
    const tree = (parent, depth) => state.folders.filter((f) => (f.parentId || null) === parent && !blocked.has(f.id))
      .map((f) => `<button type="button" class="folder-pick ${current === f.id ? 'active' : ''}" data-pick-folder="${f.id}" style="padding-left:${12 + depth * 20}px">${icon('dirFolder', { size: 16 })}<span>${esc(f.name)}</span></button>${tree(f.id, depth + 1)}`).join('');
    const draw = () => `<button type="button" class="folder-pick ${!current ? 'active' : ''}" data-pick-folder="">${icon('file', { size: 16 })}<span>No folder (All documents)</span></button>${tree(null, 0)}`;
    openModal({
      title, size: 'sm',
      body: `<div class="folder-picker" role="listbox">${draw()}</div>`,
      footer: `<button class="btn btn-plain" data-new-folder>${icon('folderPlus', { size: 16 })}New folder</button><span class="spacer"></span><button class="btn btn-ghost" data-close>Cancel</button>`,
      onMount: (el, close) => {
        const box = el.querySelector('.folder-picker');
        box.addEventListener('click', (e) => { const b = e.target.closest('[data-pick-folder]'); if (b) { result = b.dataset.pickFolder; close(); } });
        el.querySelector('[data-new-folder]').addEventListener('click', async () => {
          const name = await askFolderName({ title: 'New folder', confirm: 'Create folder' });
          if (!name) return;
          try { const id = await store.createFolder(name, null); result = id; close(); } catch (err) { toast(err.message, { tone: 'error' }); }
        });
      },
      onClose: () => resolve(result),
    });
  });
}
async function moveNoteToFolder(noteId) {
  const note = store.find('notes', noteId);
  const id = await pickFolder({ title: 'Move to folder', current: note?.folderId || null });
  if (id === null) return;
  await store.setNoteFolder(noteId, id || null);
  toast(id ? `Moved to “${folderById(id)?.name}”` : 'Removed from its folder');
}
function folderMenu(el) {
  const f = folderById(el.dataset.folder);
  if (!f) return;
  openMenu(el, [
    { label: 'Open', icon: 'folder', run: () => { ui.folder = f.id; window.dispatchEvent(new Event('app:rerender')); } },
    { label: 'Rename…', icon: 'edit', run: async () => { const name = await askFolderName({ title: 'Rename folder', value: f.name, confirm: 'Rename' }); if (name) store.updateFolder(f.id, { name }).catch(() => {}); } },
    { label: 'New folder inside…', icon: 'folderPlus', run: () => newFolder(f.id) },
    { label: 'Move to…', icon: 'folder', run: async () => { const to = await pickFolder({ title: `Move “${f.name}” to`, current: f.parentId, exclude: f.id }); if (to !== null) store.updateFolder(f.id, { parentId: to || null }).catch(() => {}); } },
    'divider',
    { label: 'Delete folder…', icon: 'trash', danger: true, run: async () => {
      if (!(await confirmDialog({ title: `Delete “${f.name}”?`, message: `Its documents and folders move up ${f.parentId ? `to “${folderById(f.parentId)?.name}”` : 'to All documents'}. No documents are deleted.`, confirmLabel: 'Delete folder' }))) return;
      try { await store.deleteFolder(f.id); toast('Folder deleted'); } catch (err) { toast(err.message, { tone: 'error' }); }
    } },
  ], { align: 'end' });
}

/** Chips for every tag in use; clicking one filters the list. */
function tagChipsHtml() {
  const counts = new Map();
  for (const n of state.notes) if (n.tag) { const k = n.tag.trim(); counts.set(k, (counts.get(k) || 0) + 1); }
  if (!counts.size) return '';
  if (ui.tag && ![...counts.keys()].some((k) => k.toLowerCase() === ui.tag.toLowerCase())) ui.tag = null;
  const tags = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return `<span class="tag-filter-label">${icon('tag', { size: 14 })}Tags</span>
    <button type="button" class="chip-btn ${!ui.tag ? 'active' : ''}" data-action="filter-tag" data-tag="" aria-pressed="${!ui.tag}">All</button>
    ${tags.map(([t, c]) => `<button type="button" class="chip-btn ${ui.tag && ui.tag.toLowerCase() === t.toLowerCase() ? 'active' : ''}" data-action="filter-tag" data-tag="${esc(t)}" aria-pressed="${!!ui.tag && ui.tag.toLowerCase() === t.toLowerCase()}">${esc(t)} <span class="chip-count">${c}</span></button>`).join('')}`;
}

function renderHome() {
  return `
  ${hero({ iconName: 'file', title: 'Documents', subtitle: 'Capture your thoughts, organize your ideas, and make progress.' })}
  <div class="page">
    <div class="quick-actions">
      <button class="quick" data-action="new-note"><span class="quick-icon">${icon('file')}</span>New Document</button>
      <button class="quick" data-action="new-template"><span class="quick-icon">${icon('sparkles')}</span>New Template</button>
    </div>
    <section class="section">
      <div class="docs-head docs-toolbar">
        <div class="docs-tools-left">
          <button class="icon-btn ${ui.favouritesOnly ? 'is-fav' : ''}" data-action="toggle-fav-filter" aria-pressed="${ui.favouritesOnly}" aria-label="Show favourites only" title="Favourites only">${icon('star')}</button>
          <button class="btn btn-plain btn-sm" data-action="new-folder">${icon('folderPlus', { size: 17 })}New folder</button>
        </div>
        <div class="docs-tools">
          <label class="search-field compact">${icon('search', { size: 17 })}<span class="sr-only">Search documents</span><input id="docs-search" type="search" placeholder="Search documents…" value="${esc(ui.query)}"></label>
          <button class="icon-btn" data-action="open-trash" aria-label="Deleted documents" title="Deleted documents">${icon('trash')}</button>
          <button class="btn btn-plain btn-sm" data-action="sort-menu" aria-label="Sort: ${SORTS[ui.sort].label}">${icon('sort', { size: 18 })}<span class="sort-label">${SORTS[ui.sort].label}</span>${icon('chevronDown', { size: 16 })}</button>
        </div>
      </div>
      <div class="folder-area" id="folder-area">${folderAreaHtml()}</div>
      <div class="tag-filter" id="tag-filter">${tagChipsHtml()}</div>
      <div class="rows" id="doc-list">${listHtml()}</div>
    </section>
  </div>`;
}

/* ================= Preview card ================= */

const preview = { el: null, id: null, pinned: false, anchor: null };

function previewHtml(note) {
  const edit = canEdit(note);
  return `
    <div class="preview-head">
      ${tile(note.icon, note.color, 'sm')}
      <div class="preview-title"><b>${esc(note.title || 'Untitled')}</b><span>Edited ${timeAgo(note.updatedAt)}</span></div>
      <div class="preview-tools">
        ${canEdit(note) ? `<button class="icon-btn" data-preview="rename" aria-label="Rename" title="Rename">${icon('edit', { size: 18 })}</button>` : ''}
        <button class="icon-btn" data-preview="move" aria-label="Move to folder" title="Move to folder${note.folderId && folderById(note.folderId) ? ` (now in “${esc(folderById(note.folderId).name)}”)` : ''}">${icon('dirFolder', { size: 18 })}</button>
        ${isOwner(note) ? `<button class="icon-btn ${note.favourite ? 'is-fav' : ''}" data-preview="fav" aria-pressed="${!!note.favourite}" aria-label="${note.favourite ? 'Remove from favourites' : 'Add to favourites'}" title="${note.favourite ? 'Remove from favourites' : 'Add to favourites'}">${icon('star', { size: 18 })}</button>` : ''}
        <button class="icon-btn ${note.pinned ? 'is-pinned' : ''}" data-preview="pin" aria-pressed="${!!note.pinned}" aria-label="${note.pinned ? 'Unpin' : 'Pin to the top of the list'}" title="${note.pinned ? 'Unpin' : 'Pin to the top of the list'}">${icon('pinTop', { size: 18 })}</button>
        <button class="icon-btn" data-preview="dup" aria-label="${isOwner(note) ? 'Duplicate' : 'Make my own copy'}" title="${isOwner(note) ? 'Duplicate' : 'Make my own copy'}">${icon('copy', { size: 18 })}</button>
        ${preview.pinned ? `<button class="icon-btn" data-preview="close" aria-label="Close preview" title="Close">${icon('x', { size: 18 })}</button>` : ''}
      </div>
    </div>
    ${note.tag || note.shareCount || !isOwner(note) ? `<div class="note-meta preview-meta">${note.tag ? `<button type="button" class="pill pill-tag c-${note.color}" data-action="filter-tag" data-tag="${esc(note.tag)}" title="Show documents tagged ${esc(note.tag)}">${icon('tag', { size: 13 })}${esc(note.tag)}</button>` : ''}${sharingPill(note)}</div>` : ''}
    <div class="preview-body">
      <div class="prose">${note.content.trim() ? renderNote(note.content, { readOnly: true }) : ''}</div>
    </div>
    <div class="preview-foot">
      <button class="btn btn-primary btn-sm" data-preview="open">${icon('open', { size: 16 })}Open</button>
      ${edit ? `<button class="btn btn-outline btn-sm" data-preview="edit">${icon('edit', { size: 16 })}Edit</button>` : ''}
      ${isOwner(note) ? `<button class="btn btn-outline btn-sm" data-preview="share">${icon('share', { size: 16 })}Share</button>` : ''}
      <button class="btn btn-outline btn-sm" data-preview="layout" aria-haspopup="menu">${icon('layout', { size: 16 })}Window<span class="tb-caret" aria-hidden="true"></span></button>
      ${isOwner(note)
        ? `<button class="btn btn-outline btn-sm preview-danger" data-preview="delete" title="Delete document">${icon('trash', { size: 16 })}Delete</button>`
        : `<button class="btn btn-outline btn-sm preview-danger" data-preview="remove" title="Remove from my documents (the owner keeps it)">${icon('x', { size: 16 })}Remove</button>`}
    </div>`;
}

/**
 * Put the card below the row, or above it, shrinking it to fit the window.
 * The header and buttons always stay visible; only the middle scrolls.
 */
function placePreview() {
  const { el, anchor } = preview;
  if (!el || !anchor?.isConnected) return;
  const r = anchor.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight, gap = 6, edge = 12;
  el.style.maxHeight = '';
  el.style.height = '';
  const natural = Math.min(el.scrollHeight, 540, vh - edge * 2);
  const below = vh - r.bottom - gap - edge;
  const above = r.top - gap - edge;
  let top, h;
  if (natural <= below) { h = natural; top = r.bottom + gap; }
  else if (natural <= above) { h = natural; top = r.top - gap - h; }
  else if (below >= above) { h = Math.max(Math.min(natural, 240), below); top = r.bottom + gap; }
  else { h = Math.max(Math.min(natural, 240), above); top = r.top - gap - h; }
  // Never let any part of the card fall outside the window.
  h = Math.min(h, vh - edge * 2);
  top = Math.min(Math.max(edge, top), vh - edge - h);
  el.style.maxHeight = `${h}px`;
  const w = el.offsetWidth;
  el.style.left = `${Math.min(Math.max(edge, r.left + 76), vw - w - edge)}px`;
  el.style.top = `${top}px`;
}

function showPreview(row, { pinned = false } = {}) {
  const note = store.find('notes', row.dataset.doc);
  if (!note) return;
  if (!preview.el) {
    preview.el = document.createElement('div');
    preview.el.className = 'doc-preview';
    preview.el.setAttribute('role', 'dialog');
    document.body.appendChild(preview.el);
    preview.el.addEventListener('click', onPreviewClick);
    preview.el.addEventListener('dblclick', () => { if (preview.id) openDoc(preview.id); });
  }
  document.querySelectorAll('.doc-row.previewing').forEach((r) => r.classList.remove('previewing'));
  row.classList.add('previewing');
  preview.id = note.id;
  preview.pinned = pinned;
  preview.anchor = row;
  preview.el.setAttribute('aria-label', `Preview of ${note.title}`);
  preview.el.innerHTML = previewHtml(note);
  preview.el.classList.toggle('pinned', pinned);
  preview.el.querySelectorAll('img').forEach((img) => { if (!img.complete) img.addEventListener('load', placePreview, { once: true }); });
  placePreview();
  requestAnimationFrame(() => preview.el?.classList.add('show'));
}

export function hidePreview() {
  document.querySelectorAll('.doc-row.previewing').forEach((r) => r.classList.remove('previewing'));
  preview.el?.remove();
  Object.assign(preview, { el: null, id: null, pinned: false, anchor: null });
}
function onPreviewClick(e) {
  const btn = e.target.closest('[data-preview]');
  if (!btn) { if (e.detail >= 2 && preview.id) openDoc(preview.id); return; }
  const id = preview.id;
  const what = btn.dataset.preview;
  if (what === 'layout') { const r = btn.getBoundingClientRect(); hidePreview(); openLayoutMenu(r, { id, from: 'list' }); return; }
  const note = store.find('notes', id);
  if (what === 'rename' && note) { startRename(btn, note); return; }
  if (what === 'move' && note) { hidePreview(); moveNoteToFolder(id); return; }
  // Favourite and pin update in place, leaving the preview open.
  if (what === 'fav' && note) { preview.pinned = true; store.update('notes', id, { favourite: !note.favourite }); return; }
  if (what === 'pin' && note) {
    preview.pinned = true;
    const pinning = !note.pinned; // decide before the change (the store flips it straight away)
    store.setPinned(id, pinning);
    toast(pinning ? 'Pinned to the top of your list' : 'Unpinned');
    return;
  }
  hidePreview();
  if (what === 'dup' && note) {
    createDoc({ ...stripShare(note), title: `${note.title} (copy)`, favourite: false }, { open: false }).then(() => toast(isOwner(note) ? 'Duplicate created' : 'Your own copy was created')).catch(() => {});
    return;
  }
  if (what === 'share') openShareDialog(id);
  if (what === 'delete') deleteDoc(id);
  if (what === 'remove') leaveDoc(id);
  if (what === 'open') openDoc(id);
  if (what === 'edit') openDoc(id, { edit: true });
  if (what === 'float') openFloat(id);
  if (what === 'popout') openPopout(id);
}

/** Rename in place: the preview's title becomes a text field. */
function startRename(btn, note) {
  preview.pinned = true;
  const titleEl = preview.el?.querySelector('.preview-title b');
  if (!titleEl) return;
  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = note.title || '';
  input.maxLength = 200;
  input.setAttribute('aria-label', 'Document title');
  titleEl.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (save && v && v !== note.title) store.update('notes', note.id, { title: v }).then(() => toast('Renamed')).catch(() => {});
    else { const b = document.createElement('b'); b.textContent = note.title || 'Untitled'; input.replaceWith(b); }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

function mountList(root) {
  const list = $('#doc-list', root);
  const search = $('#docs-search', root);
  search?.addEventListener('input', () => { ui.query = search.value; hidePreview(); list.innerHTML = listHtml(); });

  // Drag documents (or folders) onto a folder card or the folder path to move them.
  // What's being dragged is remembered here (drags stay within this page), with plain
  // text attached too, so it works the same in every browser.
  let dragging = null; // { kind: 'doc' | 'folder', id }
  root.addEventListener('dragstart', (e) => {
    const row = e.target.closest?.('.doc-row');
    const card = e.target.closest?.('.folder-card');
    if (!row && !card) return;
    dragging = row ? { kind: 'doc', id: row.dataset.doc } : { kind: 'folder', id: card.dataset.folder };
    if (row) hidePreview();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row ? (store.find('notes', dragging.id)?.title || 'Document') : (folderById(dragging.id)?.name || 'Folder'));
  });
  const dropTarget = (e) => e.target.closest?.('[data-drop-folder]');
  root.addEventListener('dragover', (e) => {
    const t = dropTarget(e);
    if (!t || !dragging || (dragging.kind === 'folder' && dragging.id === t.dataset.dropFolder)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    root.querySelectorAll('.drop-over').forEach((x) => x !== t && x.classList.remove('drop-over'));
    t.classList.add('drop-over');
  });
  root.addEventListener('dragleave', (e) => { const t = dropTarget(e); if (t && !t.contains(e.relatedTarget)) t.classList.remove('drop-over'); });
  root.addEventListener('drop', (e) => {
    const t = dropTarget(e);
    if (!t || !dragging) return;
    e.preventDefault();
    t.classList.remove('drop-over');
    const target = t.dataset.dropFolder || null;
    const d = dragging;
    dragging = null;
    if (d.kind === 'doc') { store.setNoteFolder(d.id, target); toast(target ? `Moved to “${folderById(target)?.name}”` : 'Removed from its folder'); }
    else if (d.id !== target) store.updateFolder(d.id, { parentId: target }).catch(() => {});
  });
  root.addEventListener('dragend', () => { dragging = null; root.querySelectorAll('.drop-over').forEach((x) => x.classList.remove('drop-over')); });

  // One click pins the preview; a double-click opens the document.
  // Double-clicks are detected from the clicks themselves (click count or timing),
  // so they work even in browsers that skip the dblclick event when the page changes.
  let last = { id: null, at: 0 };
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.doc-row');
    if (!row) return;
    const id = row.dataset.doc;
    const now = Date.now();
    if (e.detail >= 2 || (last.id === id && now - last.at < 500)) {
      last = { id: null, at: 0 };
      window.getSelection()?.removeAllRanges();
      openDoc(id);
      return;
    }
    last = { id, at: now };
    if (preview.pinned && preview.id === id) hidePreview();
    else showPreview(row, { pinned: true });
  });
  list.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.doc-row');
    if (!row || location.hash.startsWith('#/documents/')) return;
    openDoc(row.dataset.doc);
  });
  root.addEventListener('keydown', (e) => {
    const card = e.target.closest?.('.folder-card');
    if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); card.click(); }
  });
  list.addEventListener('keydown', (e) => {
    const row = e.target.closest('.doc-row');
    if (!row || e.target !== row) return;
    if (e.key === 'Enter') { e.preventDefault(); openDoc(row.dataset.doc); }
    if (e.key === ' ') {
      e.preventDefault();
      if (preview.id === row.dataset.doc) hidePreview(); else showPreview(row, { pinned: true });
    }
  });
}

document.addEventListener('mousedown', (e) => {
  if (!preview.el || preview.el.contains(e.target) || e.target.closest('.doc-row') || e.target.closest('.menu') || e.target.closest('.layout-pop')) return;
  hidePreview();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && preview.el) { hidePreview(); e.stopPropagation(); } }, true);
window.addEventListener('resize', placePreview);
document.addEventListener('scroll', (e) => { if (preview.el && !preview.el.contains(e.target)) placePreview(); }, true);

/* ================= Full-page document ================= */

const historyBtn = (note) => `<button class="icon-btn" data-action="doc-history" data-id="${note.id}" aria-label="Version history" title="Version history">${icon('history')}</button>`;
const commentsBtn = (note) => `<button class="icon-btn cmt-btn ${ui.commentsOpen ? 'active' : ''}" data-action="doc-comments" data-id="${note.id}" aria-pressed="${ui.commentsOpen}" aria-label="Comments${note.commentCount ? ` (${note.commentCount} open)` : ''}" title="Comments">${icon('comment')}${note.commentCount ? `<span class="cmt-count">${note.commentCount}</span>` : ''}</button>`;

function docBarHtml(note) {
  const editing = ui.editing && canEdit(note);
  const full = !!document.fullscreenElement;
  if (isPopout()) return popoutBarHtml(note, editing);
  // Favourite, share, window layout and pop out live in the ⋯ menu.
  return `
    <div class="doc-crumbs">
      ${state.user?.guest ? `<button type="button" class="guest-chip" data-action="account-menu" title="You’re using a share link">${icon('users', { size: 15 })}<span>${esc(state.user.name)}</span><small>Guest</small></button>` : ''}
      <button class="doc-back" data-action="doc-close">${icon('arrowLeft', { size: 18 })}<span>Documents</span></button>
      <span class="doc-bar-title"><span class="doc-bar-sep" aria-hidden="true">|</span>${titleControlsHtml(note)}</span>
    </div>
    <div class="doc-actions">
      ${historyBtn(note)}
      ${commentsBtn(note)}
      <button class="icon-btn" id="doc-fs-btn" data-action="doc-fullscreen" aria-label="${full ? 'Exit full screen' : 'Full screen'}" title="${full ? 'Exit full screen' : 'Full screen (hides the browser too)'}">${icon(full ? 'minimize' : 'maximize')}</button>
      ${!editing && headingsOf(note.content).length ? `<button class="icon-btn" data-action="doc-contents" data-id="${note.id}" aria-label="Contents" aria-haspopup="menu" title="Contents: jump to a heading">${icon('listTree')}</button>` : ''}
      ${editing
        ? `<button type="button" class="btn btn-primary btn-sm" data-action="done-editing">${icon('check', { size: 16 })}Done</button>`
        : canEdit(note) ? `<button class="btn btn-outline btn-sm" data-action="edit-note" data-id="${note.id}">${icon('edit', { size: 16 })}Edit</button>` : ''}
      <button class="icon-btn" data-action="note-menu" data-id="${note.id}" aria-label="More options" title="More">${icon('more')}</button>
    </div>`;
}

/** The pop-out window: the document's name on the left, a few actions on the right. */
function popoutBarHtml(note, editing) {
  return `
    <div class="popout-title">${tile(note.icon, note.color, 'sm')}${titleControlsHtml(note)}</div>
    <div class="doc-actions">
      ${historyBtn(note)}
      ${commentsBtn(note)}
      ${editing ? '' : `
        ${isOwner(note) ? `<button class="icon-btn ${note.favourite ? 'is-fav' : ''}" data-action="toggle-fav" data-id="${note.id}" aria-pressed="${note.favourite}" aria-label="${note.favourite ? 'Remove from favourites' : 'Add to favourites'}" title="Favourite">${icon('star')}</button>` : ''}
        <button class="icon-btn" data-action="popout-main" data-id="${note.id}" aria-label="Show in the main window" title="Show in main window">${icon('open')}</button>`}
      <button class="icon-btn" data-action="layout-menu" data-id="${note.id}" aria-label="Move or resize this window" aria-haspopup="menu" title="Move or resize this window">${icon('layout')}</button>
      ${editing
        ? `<button type="button" class="btn btn-primary btn-sm" data-action="done-editing">${icon('check', { size: 16 })}Done</button>`
        : canEdit(note) ? `<button class="btn btn-outline btn-sm" data-action="edit-note" data-id="${note.id}">${icon('edit', { size: 16 })}Edit</button>` : ''}
    </div>`;
}

function renderDoc(id) {
  const note = store.find('notes', id);
  if (!note) {
    return `<div class="doc-page"><header class="doc-bar">${isPopout() ? '<span></span>' : `<button class="doc-back" data-action="doc-close">${icon('arrowLeft', { size: 18 })}<span>Documents</span></button>`}</header>
      <div class="doc-sheet">${emptyState({ iconName: 'file', title: 'This document isn’t available', text: 'It may have been deleted, or it’s no longer shared with you.', action: `<button class="btn btn-primary" data-action="doc-close">${isPopout() ? 'Close window' : 'Back to documents'}</button>` })}</div></div>`;
  }
  const editing = ui.editing && canEdit(note);
  return `
  <div class="doc-page ${editing ? 'is-editing' : ''} ${ui.commentsOpen ? 'comments-open' : ''} ${note.layout === 'pages' ? 'layout-pages' : ''}">
    <header class="doc-bar" id="doc-bar">${docBarHtml(note)}</header>
    <div class="doc-body">
      <div class="doc-scroll"><article class="doc-sheet note-detail" id="doc-sheet">${editing ? editorHtml(note) : noteBodyHtml(note, { remindable: true })}</article></div>
      <aside class="comments-panel" aria-label="Comments"></aside>
    </div>
  </div>`;
}

function mountDoc(root) {
  docEditor?.destroy();
  docEditor = null;
  const form = $('.note-editor', root);
  if (form) {
    docEditor = mountEditor(form);
    // Keep the title in the top bar in step with renaming.
    $('.title-input', form)?.addEventListener('input', (e) => {
      const b = root.querySelector('.doc-bar-title b');
      if (b) b.textContent = e.target.value.trim() || 'Untitled';
    });
  }
  mountComments(root);
  watchLive(root);
  paginateReading(root);
}

/** Page view while reading: split the rendered document into pages. */
function paginateReading(root) {
  const prose = root.querySelector('#doc-sheet .prose');
  const id = (location.hash.match(/#\/(?:documents|popout)\/([^/]+)/) || [])[1];
  const note = id && store.find('notes', id);
  if (!prose || !note) return;
  // Fill signature boxes (from the server), then lay out pages once they're the right size.
  if (prose.querySelector('[data-sig]') && !signatureSync(prose, id)) { hydrateSignatures(prose, id).then(() => paginateReading(root)); }
  if (note.layout !== 'pages' || ui.editing) { if (prose.classList.contains('paged')) { prose.querySelectorAll('[data-page-gap], [data-page-end], [data-page-head]').forEach((e) => e.remove()); unstylePage(prose); } return; }
  paginateDom(prose, setupOf(note), { title: note.title || 'Untitled', editable: canEdit(note) });
  // Images change the layout when they finish loading.
  prose.querySelectorAll('img').forEach((img) => { if (!img.complete) img.addEventListener('load', () => paginateReading(root), { once: true }); });
}
let pageResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(pageResizeTimer);
  pageResizeTimer = setTimeout(() => { const r = document.querySelector('.doc-page.layout-pages')?.parentElement; if (r && !ui.editing) paginateReading(r); }, 200);
});
// Dropdown chips while reading: people who can edit can change the choice.
document.addEventListener('click', (e) => {
  const chip = e.target.closest?.('.prose .dd-chip[data-dd]');
  if (!chip || chip.closest('.ProseMirror')) return;
  const id = (location.hash.match(/#\/(?:documents|popout)\/([^/]+)/) || [])[1];
  const note = id && store.find('notes', id);
  const data = decData(chip.dataset.dd);
  if (!note || !data) return;
  e.preventDefault();
  openDropdownPicker(chip, data, {
    editable: canEdit(note),
    onPick: (v) => {
      if (!canEdit(note) || v === data.v) return;
      const token = `[[dd:${chip.dataset.dd}]]`;
      if (!note.content.includes(token)) return;
      store.update('notes', note.id, { content: note.content.replace(token, `[[dd:${encData({ ...data, v })}]]`) }).catch(() => {});
    },
  });
});

// Clicking a page's header or footer edits it (people who can edit the document).
document.addEventListener('click', (e) => {
  const hf = e.target.closest?.('.hf[data-hf]');
  if (!hf || !hf.hasAttribute('tabindex')) return;
  const id = (location.hash.match(/#\/(?:documents|popout)\/([^/]+)/) || [])[1];
  const note = id && store.find('notes', id);
  if (!note || !canEdit(note)) return;
  e.preventDefault();
  e.stopPropagation();
  editHeaderFooter(note, hf.dataset.hf, hf);
}, true);
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('.hf[data-hf][tabindex]')) { e.preventDefault(); e.target.click(); }
});

/** While reading, follow the live document so other people's typing appears as it happens. */
function watchLive(root) {
  docWatch?.destroy();
  docWatch = null;
  if (ui.editing) return;
  const id = (location.hash.match(/#\/(?:documents|popout)\/([^/]+)/) || [])[1];
  if (!id || !store.find('notes', id)) return;
  import('/js/vendor/collab.js').then(({ watchDocument }) => {
    if (ui.editing || docWatch || !root.isConnected) return;
    docWatch = watchDocument({
      noteId: id,
      onChange: (markdown) => {
        const n = store.find('notes', id);
        if (!n || n.content === markdown || ui.editing) return;
        n.content = markdown;
        const sheet = root.querySelector('#doc-sheet');
        // Don't redraw under someone who is selecting text (e.g. to comment).
        if (!sheet || !window.getSelection().isCollapsed) return;
        sheet.innerHTML = noteBodyHtml(n, { remindable: true });
        paginateReading(root);
        docComments?.refreshHighlights();
      },
    });
  }).catch(() => { /* live reading is a bonus; the page still refreshes normally */ });
}

function mountComments(root) {
  docComments?.destroy();
  docComments = null;
  const page = root.querySelector('.doc-page');
  const id = (location.hash.match(/#\/(?:documents|popout)\/([^/]+)/) || [])[1];
  if (!page || !id || !store.find('notes', id)) return;
  docComments = attachComments(page, id, {
    container: () => page.querySelector('#doc-sheet .rich') || page.querySelector('#doc-sheet .prose'),
    isOpen: () => ui.commentsOpen,
    setOpen: (open) => setCommentsOpen(page, open),
    focusId: ui.focusComment,
  });
  ui.focusComment = null;
}

function setCommentsOpen(page, open) {
  ui.commentsOpen = open;
  page.classList.toggle('comments-open', open);
  const btn = page.querySelector('.cmt-btn');
  if (btn) { btn.classList.toggle('active', open); btn.setAttribute('aria-pressed', String(open)); }
  if (open) {
    docComments?.render();
    const id = (location.hash.match(/#\/(?:documents|popout)\/([^/]+)/) || [])[1];
    if (id && state.notifications?.some((n) => n.noteId === id)) store.markNotificationsRead([id]);
  }
}

document.addEventListener('fullscreenchange', () => {
  const btn = document.getElementById('doc-fs-btn');
  if (!btn) return;
  const full = !!document.fullscreenElement;
  btn.innerHTML = icon(full ? 'minimize' : 'maximize');
  btn.setAttribute('aria-label', full ? 'Exit full screen' : 'Full screen');
  btn.title = full ? 'Exit full screen' : 'Full screen (hides the browser too)';
});

// Esc leaves a document (when not typing in it).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !location.hash.startsWith('#/documents/') || document.fullscreenElement) return;
  if (ui.editing || document.body.classList.contains('has-modal') || document.querySelector('.menu')) return;
  closeDoc();
});

export function openDoc(id, { edit = false } = {}) {
  hidePreview();
  ui.editing = edit;
  if (location.hash === currentUrl(id)) window.dispatchEvent(new Event('app:rerender'));
  else if (isPopout()) showInMainWindow(id);
  else location.hash = docUrl(id);
}
function closeDoc() {
  docEditor?.destroy();
  docEditor = null;
  if (isPopout()) { window.close(); return; }
  ui.editing = false;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  location.hash = '#/documents';
}

// From the bell: open the document with its comments showing that comment.
window.addEventListener('doc:open-comments', (e) => {
  const { noteId, commentId } = e.detail;
  ui.commentsOpen = true;
  ui.focusComment = commentId;
  if (isPopout()) { showInMainWindow(noteId); return; }
  openDoc(noteId);
});

// Links to other documents: in a pop-out, open them in the main window.
document.addEventListener('click', (e) => {
  const a = e.target.closest('.prose a.doc-link');
  if (!a || a.closest('.rich') || !isPopout()) return;
  e.preventDefault();
  showInMainWindow(a.dataset.doclink);
});

// Bell on a checklist item: turn it into a reminder linked to the document.
document.addEventListener('click', (e) => {
  const b = e.target.closest('.task-remind');
  if (!b) return;
  e.preventDefault();
  const noteId = b.closest('.prose')?.dataset.note;
  reminderForm(null, { title: b.dataset.remind, noteId, date: todayKey(), category: 'task' });
});

// Copy buttons on code blocks.
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copy-code]');
  if (!b) return;
  const code = b.closest('.code-wrap')?.querySelector('pre')?.innerText || '';
  try { await navigator.clipboard.writeText(code); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); }
  catch { toast(kbd('Couldn’t copy. Select the code and press Cmd+C instead.'), { tone: 'error' }); }
});

// Contents links jump to their heading within the same document.
document.addEventListener('click', (e) => {
  const link = e.target.closest('.prose .toc-link');
  if (!link || link.closest('.rich')) return;
  e.preventDefault();
  const prose = link.closest('.prose');
  prose.querySelectorAll('h2, h3')[Number(link.dataset.h)]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Tick checklist items while reading, wherever the document is shown.
document.addEventListener('change', (e) => {
  const box = e.target.closest('.prose input[type=checkbox][data-line]');
  if (!box) return;
  const id = box.closest('.prose').dataset.note;
  const note = store.find('notes', id);
  if (!note || !canEdit(note)) return;
  store.update('notes', id, { content: toggleTaskLine(note.content, Number(box.dataset.line)) });
});

/* ================= Actions ================= */

async function createDoc(data, { open = true, edit = true } = {}) {
  const note = await store.create('notes', data);
  if (open) openDoc(note.id, { edit });
  return note;
}

function chooseTemplate() {
  const card = (t, mine) => `
      <div class="template-cell">
        <button class="template" data-template="${t.id}" data-mine="${mine ? '1' : ''}">
          ${tile(t.icon, t.color)}
          <span class="template-name">${esc(t.name)}</span>
          <span class="template-text">${esc(mine ? (t.description || `From “${t.title}”`) : t.text)}</span>
        </button>
        ${mine ? `<button type="button" class="icon-btn template-del" data-del-template="${t.id}" data-name="${esc(t.name)}" aria-label="Delete template ${esc(t.name)}" title="Delete template">${icon('trash', { size: 15 })}</button>` : ''}
      </div>`;
  openModal({
    title: 'Start from a template',
    size: 'lg',
    body: `<div class="mine-templates"></div><h3 class="template-heading">Built-in</h3><div class="template-grid">${TEMPLATES.map((t) => card(t, false)).join('')}</div>`,
    onMount: async (el, close) => {
      let mine = [];
      const box = el.querySelector('.mine-templates');
      const drawMine = () => {
        box.innerHTML = mine.length
          ? `<h3 class="template-heading">Your templates</h3><div class="template-grid">${mine.map((t) => card(t, true)).join('')}</div>`
          : '<p class="muted small template-tip">Tip: open any document and choose ⋯ → <b>Save as template</b> to add your own layouts here.</p>';
      };
      try { mine = await request('GET', '/api/templates'); } catch { mine = []; }
      drawMine();
      el.addEventListener('click', async (e) => {
        const del = e.target.closest('[data-del-template]');
        if (del) {
          if (!(await confirmDialog({ title: 'Delete this template?', message: `“${del.dataset.name}” will be removed from your templates. Documents made from it aren’t affected.`, confirmLabel: 'Delete template' }))) return;
          try { mine = await request('DELETE', `/api/templates/${del.dataset.delTemplate}`); drawMine(); } catch (err) { toast(err.message, { tone: 'error' }); }
          return;
        }
        const btn = e.target.closest('[data-template]');
        if (!btn) return;
        close();
        if (btn.dataset.mine) {
          const t = mine.find((x) => x.id === btn.dataset.template);
          if (t) createDoc({ title: t.title, content: t.content, icon: t.icon, color: t.color, tag: t.tag });
        } else createDoc(TEMPLATES.find((t) => t.id === btn.dataset.template).note);
      });
    },
  });
}

function saveAsTemplate(note) {
  openModal({
    title: 'Save as template',
    size: 'sm',
    body: `<form class="form" id="tpl-form" novalidate>
      <label class="field"><span>Template name</span><input name="name" maxlength="80" value="${esc(note.title || '')}" autofocus></label>
      <label class="field"><span>Description <em>(optional)</em></span><input name="description" maxlength="160" placeholder="What it’s for"></label>
      <p class="muted small">New Template will offer this layout, with the current title, text, icon, colour and tag.</p>
    </form>`,
    footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="tpl-form">Save template</button>',
    onMount: (el, close) => {
      const form = el.querySelector('#tpl-form');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await request('POST', '/api/templates', { noteId: note.id, name: form.elements.name.value, description: form.elements.description.value });
          close();
          toast('Saved. Find it under New Template.');
        } catch (err) {
          let p = form.querySelector('.form-error'); if (!p) { p = document.createElement('p'); p.className = 'form-error'; form.append(p); }
          p.textContent = err.message;
        }
      });
    },
  });
}

async function deleteDoc(id) {
  const note = store.find('notes', id);
  if (!note) return;
  const ok = await confirmDialog({ title: 'Delete this document?', message: `“${note.title}” moves to Deleted${note.shareCount ? ' and disappears for the people you shared it with' : ''}. You can restore it from Deleted for 30 days.`, confirmLabel: 'Delete' });
  if (!ok) return;
  const inPopout = isPopout();
  if (location.hash === docUrl(id)) closeDoc();
  hidePreview();
  await store.remove('notes', id);
  if (inPopout) { window.close(); return; }
  toast('Moved to Deleted', { action: { label: 'Undo', run: async () => {
    try { await request('POST', `/api/trash/${id}/restore`); await store.refresh(); toast('Restored'); } catch (err) { toast(err.message, { tone: 'error' }); }
  } } });
}

async function leaveDoc(id) {
  const note = store.find('notes', id);
  if (!note) return;
  const ok = await confirmDialog({ title: 'Remove this document?', message: `“${note.title}” will disappear from your documents. ${note.ownerName} keeps it, and can share it with you again.`, confirmLabel: 'Remove' });
  if (!ok) return;
  if (location.hash === docUrl(id)) closeDoc();
  hidePreview();
  try { await store.removeShare(id, state.user.id); toast('Removed from your documents'); } catch (err) { toast(err.message, { tone: 'error' }); }
  if (isPopout()) window.close();
}

export const actions = {
  'new-note': () => createDoc({ title: 'Untitled' }),
  'new-template': chooseTemplate,
  'doc-close': closeDoc,
  'doc-history': (el) => {
    // Finish editing first, so a restored version shows straight away.
    if (ui.editing) { docEditor?.destroy(); docEditor = null; ui.editing = false; window.dispatchEvent(new Event('app:rerender')); }
    openVersionHistory(el.dataset.id);
  },
  'open-trash': () => { hidePreview(); openTrash(); },
  'open-folder': (el, e) => {
    if (e?.target?.closest?.('.folder-more')) return;
    hidePreview();
    ui.folder = el.dataset.folder || null;
    if (location.hash !== '#/documents') location.hash = '#/documents'; else window.dispatchEvent(new Event('app:rerender'));
  },
  'new-folder': () => { hidePreview(); newFolder(); },
  'folder-menu': (el, e) => { e?.stopPropagation?.(); folderMenu(el); },
  'filter-tag': (el) => {
    hidePreview();
    const tag = el.dataset.tag || null;
    ui.tag = ui.tag && tag && ui.tag.toLowerCase() === tag.toLowerCase() && el.closest('.tag-filter') ? null : tag;
    if (location.hash !== '#/documents') { location.hash = '#/documents'; } else window.dispatchEvent(new Event('app:rerender'));
  },
  'doc-comments': (el) => setCommentsOpen(el.closest('.doc-page'), !ui.commentsOpen),
  'doc-fullscreen': () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => toast('This browser doesn’t support full screen here'));
  },
  'edit-note': (el) => {
    const note = store.find('notes', el.dataset.id);
    if (note && !canEdit(note)) { toast('You can view this document but not change it'); return; }
    openDoc(el.dataset.id, { edit: true });
  },
  'done-editing': () => {
    docEditor?.destroy();
    docEditor = null;
    ui.editing = false;
    window.dispatchEvent(new Event('app:rerender'));
  },
  'toggle-fav': (el) => {
    const note = store.find('notes', el.dataset.id);
    if (note) store.update('notes', note.id, { favourite: !note.favourite });
  },
  'share-note': (el) => openShareDialog(el.dataset.id),
  'note-float': (el) => {
    const id = el.dataset.id;
    if (location.hash === docUrl(id)) closeDoc();
    openFloat(id);
  },
  'note-popout': (el) => {
    const id = el.dataset.id;
    if (location.hash === docUrl(id)) closeDoc();
    openPopout(id);
  },
  'popout-main': (el) => showInMainWindow(el.dataset.id),
  'doc-contents': (el) => {
    const note = store.find('notes', el.dataset.id);
    const heads = [...document.querySelectorAll('#doc-sheet .prose h2, #doc-sheet .prose h3')];
    if (!note || !heads.length) return;
    openMenu(el, heads.map((h) => ({
      label: `${h.tagName === 'H3' ? '\u2003' : ''}${h.textContent}`,
      run: () => h.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    })));
  },
  'layout-menu': (el) => openLayoutMenu(el, { id: el.dataset.id, self: isPopout(), from: location.hash === docUrl(el.dataset.id) ? 'page' : 'list' }),
  'toggle-fav-filter': () => { ui.favouritesOnly = !ui.favouritesOnly; window.dispatchEvent(new Event('app:rerender')); },
  'sort-menu': (el) => openMenu(el, Object.entries(SORTS).map(([key, s]) => ({
    label: s.label, icon: ui.sort === key ? 'check' : undefined,
    run: () => { ui.sort = key; window.dispatchEvent(new Event('app:rerender')); },
  })), { align: 'end' }),
  'note-menu': (el) => {
    const note = store.find('notes', el.dataset.id);
    if (!note) return;
    hidePreview();
    const owner = isOwner(note);
    const onPage = location.hash === currentUrl(note.id);
    if (state.user?.guest) { // share-link guests: print and download only
      openMenu(el, [
        { label: 'Print…', icon: 'printer', run: () => printDoc(note) },
        { label: 'Download', icon: 'fileDown', submenu: true, run: () => openMenu(el, [
          { label: 'PDF (.pdf)', icon: 'fileDown', run: () => printDoc(note, { pdf: true }) },
          { label: 'Word (.docx)', icon: 'fileDown', run: () => downloadWord(note) },
          { label: 'Markdown (.md)', icon: 'fileDown', run: () => downloadMarkdown(note) },
        ]) },
      ]);
      return;
    }
    const items = [
      // Open / edit (only outside the open document)
      ...(onPage ? [] : [{ label: 'Open', icon: 'open', run: () => openDoc(note.id) }]),
      ...(canEdit(note) && !onPage ? [{ label: 'Edit', icon: 'edit', run: () => openDoc(note.id, { edit: true }) }] : []),
      'divider',
      // Share & view
      ...(owner ? [{ label: 'Share…', icon: 'share', run: () => openShareDialog(note.id) }] : []),
      ...(isPopout() ? [] : [{ label: 'Window…', icon: 'layout', run: () => openLayoutMenu(el, { id: note.id, from: onPage ? 'page' : 'list' }) }]),
      'divider',
      // Organise
      ...(owner ? [{ label: note.favourite ? 'Remove from favourites' : 'Add to favourites', icon: 'star', run: () => store.update('notes', note.id, { favourite: !note.favourite }) }] : []),
      { label: note.pinned ? 'Unpin' : 'Pin to top of list', icon: 'pinTop', run: () => store.setPinned(note.id, !note.pinned) },
      { label: 'Move to folder…', icon: 'dirFolder', run: () => moveNoteToFolder(note.id) },
      { label: 'Remind me about this…', icon: 'bellPlus', run: () => {
        const t = addDays(new Date(), 1);
        reminderForm(null, { title: `Look at “${note.title || 'Untitled'}”`, noteId: note.id, date: toDateKey(t), time: '09:00', category: 'note' });
      } },
      'divider',
      // Page & output
      ...(onPage ? [{ label: 'Page setup…', icon: 'pages', run: () => pageSetup(note) }] : []),
      { label: 'Print…', icon: 'printer', run: () => printDoc(note) },
      { label: 'Download', icon: 'fileDown', submenu: true, run: () => openMenu(el, [
        { label: 'PDF (.pdf)', icon: 'fileDown', run: () => printDoc(note, { pdf: true }) },
        { label: 'Word (.docx)', icon: 'fileDown', run: () => downloadWord(note) },
        { label: 'Markdown (.md)', icon: 'fileDown', run: () => downloadMarkdown(note) },
      ]) },
      'divider',
      // Copy
      { label: 'Save as template…', icon: 'sparkles', run: () => saveAsTemplate(note) },
      { label: owner ? 'Duplicate' : 'Make my own copy', icon: 'copy', run: () => createDoc({ ...stripShare(note), title: `${note.title} (copy)`, favourite: false }, { open: false }) },
      'divider',
      owner
        ? { label: 'Delete', icon: 'trash', danger: true, run: () => deleteDoc(note.id) }
        : { label: 'Remove from my documents', icon: 'x', danger: true, run: () => leaveDoc(note.id) },
    ];
    // Tidy separators (none at the start, end, or twice in a row).
    const tidy = items.filter((it, i, all) => it !== 'divider' || (i > 0 && all[i - 1] !== 'divider' && i < all.length - 1));
    while (tidy[0] === 'divider') tidy.shift();
    openMenu(el, tidy);
  },
};

/* ================= View contract ================= */

export const notesView = {
  render(route) {
    if (route.sub === 'doc') return renderDoc(route.id);
    ui.editing = false;
    return renderHome();
  },
  mount(root, route) {
    if (route.sub === 'doc') mountDoc(root);
    else mountList(root);
  },
  onChange(change, route, root) {
    if (change.kind && change.kind !== 'notes' && change.type !== 'refresh') return true;
    if (change.type === 'saved') return true;
    if (route.sub === 'doc') {
      const note = store.find('notes', route.id);
      if (!note) {
        if (change.type === 'refresh' || change.type === 'remove') {
          toast('This document is no longer available');
          if (isPopout()) window.dispatchEvent(new Event('app:rerender')); else closeDoc();
        }
        return true;
      }
      if (change.type === 'refresh') docComments?.reload();
      const pageEl = root.querySelector('.doc-page');
      const layoutKey = `${note.layout}|${note.pageSize}|${note.pageSetup}|${note.title}`;
      if (pageEl) {
        pageEl.classList.toggle('layout-pages', note.layout === 'pages');
        if (pageEl.dataset.layoutKey !== layoutKey) { pageEl.dataset.layoutKey = layoutKey; docEditor?.refreshPages?.(); }
      }
      syncTitleBoxes(note);
      if (ui.editing) { const bar = $('#doc-bar', root); const cb = bar?.querySelector('.cmt-btn'); if (cb) cb.outerHTML = commentsBtn(note); return true; } // never interrupt typing
      const bar = $('#doc-bar', root), sheet = $('#doc-sheet', root);
      if (bar && !editingTitle(bar)) bar.innerHTML = docBarHtml(note);
      if (sheet) sheet.innerHTML = noteBodyHtml(note, { remindable: true });
      paginateReading(root);
      docComments?.refreshHighlights();
      return true;
    }
    const list = $('#doc-list', root);
    if (!list) return false;
    const chips = $('#tag-filter', root);
    if (chips) chips.innerHTML = tagChipsHtml();
    const folders = $('#folder-area', root);
    if (folders) folders.innerHTML = folderAreaHtml();
    list.innerHTML = listHtml();
    if (preview.el) {
      const row = list.querySelector(`[data-doc="${preview.id}"]`);
      const note = store.find('notes', preview.id);
      if (row && note) { preview.anchor = row; row.classList.add('previewing'); preview.el.innerHTML = previewHtml(note); placePreview(); } else hidePreview();
    }
    return true;
  },
  leave() {
    hidePreview();
    docWatch?.destroy();
    docWatch = null;
    docComments?.destroy();
    docComments = null;
    docEditor?.destroy();
    docEditor = null;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  },
};
