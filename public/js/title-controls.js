// Title box + Details button shown in the top bar of a document (main page, pop-out and
// floating windows). The title saves as you type; Details changes apply on Save.
import { esc, debounce } from './util.js';
import { icon, NOTE_ICONS, COLORS } from './icons.js';
import { store, state } from './store.js';
import { toast } from './ui.js';
import { canEdit } from './note-view.js';

export function titleControlsHtml(note) {
  if (!canEdit(note) || state.user?.guest) return `<b class="bar-title-text" title="${esc(note.title || 'Untitled')}">${esc(note.title || 'Untitled')}</b>`;
  return `<span class="title-controls" data-id="${note.id}">
    <input class="bar-title" value="${esc(note.title || '')}" placeholder="Untitled" maxlength="200" aria-label="Document title" spellcheck="true">
    <button type="button" class="btn btn-plain btn-sm details-btn" data-details="${note.id}" aria-haspopup="dialog" aria-expanded="false" title="Description, icon, colour and tag">${icon('settings', { size: 16 })}<span>Details</span></button>
  </span>`;
}

/** True while someone is typing in a title box (so bars aren't redrawn under them). */
export const editingTitle = (root = document) => !!root.querySelector?.('.bar-title:focus') || !!detailsPanel;

/** Keep title boxes up to date with changes from elsewhere (without disturbing someone typing). */
export function syncTitleBoxes(note) {
  document.querySelectorAll(`.title-controls[data-id="${note.id}"] .bar-title`).forEach((input) => {
    if (document.activeElement !== input && input.value !== (note.title || '')) { input.value = note.title || ''; fitTitle(input); }
  });
}

/* ----- The title box fits its text, so Details sits right beside it ----- */
let measureCtx = null;
export function fitTitle(input) {
  measureCtx ||= document.createElement('canvas').getContext('2d');
  const cs = getComputedStyle(input);
  measureCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const w = measureCtx.measureText(input.value || input.placeholder || 'Untitled').width;
  input.style.width = `${Math.ceil(Math.min(520, Math.max(80, w + 26)))}px`;
}
const fitAll = (root) => root.querySelectorAll?.('.bar-title').forEach(fitTitle);
new MutationObserver((records) => { for (const r of records) r.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches?.('.bar-title')) fitTitle(n); else fitAll(n); } }); })
  .observe(document.documentElement, { childList: true, subtree: true });
document.fonts?.ready.then(() => fitAll(document));

/* ----- Saving the title as you type ----- */
const savers = new Map();
function saverFor(id) {
  if (!savers.has(id)) {
    savers.set(id, debounce((value) => {
      const title = value.trim() || 'Untitled';
      const n = store.find('notes', id);
      if (n && n.title !== title) store.update('notes', id, { title }, { quiet: true }).catch(() => toast('Couldn’t save the title', { tone: 'error' }));
    }, 450));
  }
  return savers.get(id);
}
document.addEventListener('input', (e) => {
  const input = e.target.closest?.('.bar-title');
  if (!input) return;
  fitTitle(input);
  saverFor(input.closest('.title-controls').dataset.id)(input.value);
});
document.addEventListener('keydown', (e) => {
  const input = e.target.closest?.('.bar-title');
  if (!input) return;
  if (e.key === 'Enter') { e.preventDefault(); saverFor(input.closest('.title-controls').dataset.id).flush(input.value); input.blur(); }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const n = store.find('notes', input.closest('.title-controls').dataset.id); input.value = n?.title || ''; fitTitle(input); input.blur(); }
}, true);
document.addEventListener('focusout', (e) => {
  const input = e.target.closest?.('.bar-title');
  if (input) saverFor(input.closest('.title-controls').dataset.id).flush(input.value);
});

/* ----- Details panel (Save / Cancel) ----- */
let detailsPanel = null;
let detailsBtn = null;
function closeDetails() {
  detailsPanel?.remove();
  detailsPanel = null;
  detailsBtn?.setAttribute('aria-expanded', 'false');
  detailsBtn = null;
  document.removeEventListener('mousedown', onOutside, true);
}
function onOutside(e) {
  if (detailsPanel && !detailsPanel.contains(e.target) && !detailsBtn?.contains(e.target)) closeDetails(); // outside = Cancel
}
function openDetails(btn) {
  if (detailsPanel && detailsBtn === btn) { closeDetails(); return; } // second click closes
  closeDetails();
  const id = btn.dataset.details;
  const note = store.find('notes', id);
  if (!note) return;
  detailsBtn = btn;
  btn.setAttribute('aria-expanded', 'true');
  const p = document.createElement('form');
  p.className = 'details-panel';
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-label', 'Document details');
  p.noValidate = true;
  p.innerHTML = `
    <label class="field"><span>Short description</span><input name="summary" value="${esc(note.summary || '')}" placeholder="Shown under the title in lists" maxlength="300"></label>
    <fieldset class="prop"><legend>Icon</legend>
      <div class="icon-choices">${NOTE_ICONS.map((ic) => `<label class="choice" title="${ic}"><input type="radio" name="icon" value="${ic}" ${note.icon === ic ? 'checked' : ''}><span class="tile tile-sm c-${note.color}">${icon(ic, { size: 16 })}</span></label>`).join('')}</div>
    </fieldset>
    <fieldset class="prop"><legend>Colour</legend>
      <div class="swatches">${COLORS.map((c) => `<label class="swatch c-${c}" title="${c}"><input type="radio" name="color" value="${c}" ${note.color === c ? 'checked' : ''}><span></span></label>`).join('')}</div>
    </fieldset>
    <label class="field"><span>Tag</span><input name="tag" value="${esc(note.tag || '')}" placeholder="e.g. Travel" maxlength="40"></label>
    <div class="details-actions"><button type="button" class="btn btn-ghost btn-sm" data-cancel>Cancel</button><button type="submit" class="btn btn-primary btn-sm">Save</button></div>`;
  document.body.appendChild(p);
  detailsPanel = p;
  const r = btn.getBoundingClientRect();
  p.style.top = `${Math.min(r.bottom + 8, window.innerHeight - p.offsetHeight - 8)}px`;
  p.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - p.offsetWidth - 8))}px`;
  // Preview the colour on the icon choices while picking.
  p.addEventListener('change', (e) => {
    if (e.target.name === 'color') p.querySelectorAll('.icon-choices .tile').forEach((t) => { t.className = `tile tile-sm c-${e.target.value}`; });
  });
  p.querySelector('[data-cancel]').addEventListener('click', () => { closeDetails(); btn.focus(); });
  p.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDetails(); btn.focus(); } });
  p.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = p.elements;
    const patch = { summary: f.summary.value.trim(), icon: f.icon.value || note.icon, color: f.color.value || note.color, tag: f.tag.value.trim() };
    const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => (note[k] || '') !== v));
    closeDetails();
    btn.focus();
    if (Object.keys(changed).length) store.update('notes', id, changed).then(() => toast('Details saved')).catch(() => toast('Couldn’t save the details', { tone: 'error' }));
  });
  setTimeout(() => document.addEventListener('mousedown', onOutside, true));
  p.elements.summary.focus();
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('.details-btn');
  if (btn) { e.preventDefault(); e.stopPropagation(); openDetails(btn); }
}, true);
window.addEventListener('resize', closeDetails);
window.addEventListener('hashchange', closeDetails);
