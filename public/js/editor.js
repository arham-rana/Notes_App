// The document editor: a live, collaborative editor (Tiptap + Yjs) with the app's toolbar.
import { esc, debounce, $, $$ , kbd } from './util.js';
import { icon } from './icons.js';
import { state, store } from './store.js';
import { openModal, toast } from './ui.js';
import { FONTS, SIZES, HIGHLIGHTS, TEXT_COLORS } from './doc-styles.js';
import { PeopleMenu, peopleFor } from './mentions.js';
import { openDrawing } from './drawing.js';
import { openCropper } from './image-tools.js';
import { createLiveEditor, findKey, renderMath, colorFor, Extension, Plugin, PluginKey, Decoration, DecorationSet } from '/js/vendor/collab.js';
import { setupOf, pageMetrics, computeBreaks, nodeAtPath, gapHtml, gapHeight, headHtml, endHtml, stylePage, unstylePage } from './paginate.js';
import { canEdit } from './note-view.js';
import { chartSvg, chartPng, openChartDialog } from './charts.js';
import { dropdownDialog, openDropdownPicker } from './dropdowns.js';
import { requestSignatureDialog, signDialog, signatureHtml, loadSignatures } from './signatures.js';
import { openShapes } from './shapes.js';
import { dropdownChip } from './markdown.js';
import { embedHtml, embedDialog, detectEmbed, providerOf, EMBED_SIZES } from './embeds.js';
import { spellcheckExtension, attachChecker, openIssueCard, closeIssueCard, checkingEnabled } from './spellcheck.js';

/* Google Docs text colour palette */
const DOC_COLORS = [
  ['000000', '434343', '666666', '999999', 'b7b7b7', 'cccccc', 'd9d9d9', 'efefef', 'f3f3f3', 'ffffff'],
  ['980000', 'ff0000', 'ff9900', 'ffff00', '00ff00', '00ffff', '4a86e8', '0000ff', '9900ff', 'ff00ff'],
  ['e6b8af', 'f4cccc', 'fce5cd', 'fff2cc', 'd9ead3', 'd0e0e3', 'c9daf8', 'cfe2f3', 'd9d2e9', 'ead1dc'],
  ['dd7e6b', 'ea9999', 'f9cb9c', 'ffe599', 'b6d7a8', 'a2c4c9', 'a4c2f4', '9fc5e8', 'b4a7d6', 'd5a6bd'],
  ['cc4125', 'e06666', 'f6b26b', 'ffd966', '93c47d', '76a5af', '6d9eeb', '6fa8dc', '8e7cc3', 'c27ba0'],
  ['a61c00', 'cc0000', 'e69138', 'f1c232', '6aa84f', '45818e', '3c78d8', '3d85c6', '674ea7', 'a64d79'],
  ['85200c', '990000', 'b45f06', 'bf9000', '38761d', '134f5c', '1155cc', '0b5394', '351c75', '741b47'],
  ['5b0f00', '660000', '783f04', '7f6000', '274e13', '0c343d', '1c4587', '073763', '20124d', '4c1130'],
];
const recentColors = () => { try { return JSON.parse(localStorage.getItem('customColors') || '[]').filter((c) => /^[0-9a-f]{6}$/.test(c)).slice(0, 10); } catch { return []; } };
const rememberColor = (hex) => { try { localStorage.setItem('customColors', JSON.stringify([hex, ...recentColors().filter((c) => c !== hex)].slice(0, 10))); } catch { /* */ } };
/* Google Docs font sizes (points); stored in pixels */
const PT_SIZES = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96];
const ptToPx = (pt) => Math.round(pt * 4 / 3);
const pxToPt = (px) => Math.round(px * 0.75);

/* ---------- Page view in the editor: page gaps are decorations (never part of the text) ---------- */
function pagesExtension(noteId) {
  const key = new PluginKey('pages');
  const note = () => store.find('notes', noteId);
  function repaginate(view) {
    if (view.isDestroyed || !view.dom.isConnected) return;
    const n = note();
    const set = (decos) => view.dispatch(view.state.tr.setMeta(key, decos.length ? DecorationSet.create(view.state.doc, decos) : DecorationSet.empty).setMeta('addToHistory', false));
    if (!n || n.layout !== 'pages') { unstylePage(view.dom); if (key.getState(view.state) !== DecorationSet.empty) set([]); return; }
    const setup = setupOf(n);
    stylePage(view.dom, setup, pageMetrics(setup));
    // Measure on an off-screen copy, then draw every page gap in one update.
    const { breaks, pages, endRest, m } = computeBreaks(view.dom, setup);
    const editable = canEdit(n);
    const vals = { title: n.title || 'Untitled', date: new Date().toLocaleDateString(), pages };
    const sig = `${pages}-${JSON.stringify(setup).length}-${vals.title.length}`;
    const widget = (pos, cls, attr, html, height, k, side, inline) => Decoration.widget(pos, () => {
      const e = document.createElement(inline ? 'span' : 'div');
      e.className = cls; e.setAttribute(attr, '1'); e.contentEditable = 'false';
      if (height !== undefined) e.style.height = `${height}px`;
      e.innerHTML = html;
      return e;
    }, { side, key: k, ignoreSelection: true, stopEvent: () => true });
    const decos = [widget(0, 'page-head', 'data-page-head', headHtml({ setup, m, vals, editable }), m.top, `head-${sig}`, -1)];
    breaks.forEach((b, i) => {
      const node = nodeAtPath(view.dom, b.path);
      if (!node) return;
      let pos;
      try {
        if (b.kind === 'text') pos = view.posAtDOM(node, Math.min(b.offset, node.nodeValue?.length ?? 0));
        else { const parent = node.parentNode; const idx = [...parent.childNodes].indexOf(node); pos = view.posAtDOM(parent, b.kind === 'after' ? idx + 1 : idx); }
      } catch { return; }
      decos.push(widget(pos, 'page-gap', 'data-page-gap', gapHtml({ setup, m, rest: b.rest, page: i + 1, vals, editable }), gapHeight(m, b.rest), `gap-${i}-${Math.round(b.rest)}-${sig}`, -1, b.kind === 'text'));
    });
    decos.push(widget(view.state.doc.content.size, 'page-end', 'data-page-end', endHtml({ setup, m, rest: endRest, page: pages, vals, editable }), undefined, `end-${Math.round(endRest)}-${sig}`, 1));
    set(decos);
  }
  return Extension.create({
    name: 'pageView',
    addProseMirrorPlugins() {
      return [new Plugin({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) { const meta = tr.getMeta(key); return meta !== undefined ? meta : old.map(tr.mapping, tr.doc); },
        },
        props: { decorations: (st) => key.getState(st) },
        view: (view) => {
          let timer = null;
          let width = 0;
          const schedule = (ms = 150) => { clearTimeout(timer); timer = setTimeout(() => repaginate(view), ms); };
          view.dom.__repaginate = () => schedule(0);
          const ro = new ResizeObserver((entries) => { const w = Math.round(entries[0].contentRect.width); if (w !== width) { width = w; schedule(); } });
          if (view.dom.parentElement) ro.observe(view.dom.parentElement);
          document.fonts?.ready.then(() => schedule());
          schedule(60);
          return {
            update: (v, prev) => { if (v.state.doc !== prev.doc) schedule(); },
            destroy: () => { clearTimeout(timer); ro.disconnect(); },
          };
        },
      })];
    },
  });
}

const toastError = (m) => toast(m, { tone: 'error', duration: 6000 });

const TOOLS = [
  { cmd: 'undo', label: 'Undo', title: 'Undo (Cmd/Ctrl+Z)', ic: 'undo' },
  { cmd: 'redo', label: 'Redo', title: 'Redo (Cmd/Ctrl+Shift+Z)', ic: 'redo' },
  { cmd: 'find', label: 'Find and replace', title: 'Find and replace (Cmd/Ctrl+F)', ic: 'findReplace' },
  'sep',
  { cmd: 'style', label: 'Paragraph style', title: 'Paragraph style', text: 'Normal text', menu: true, wide: true },
  { cmd: 'font', label: 'Font', title: 'Font', text: 'Aa', menu: true },
  { cmd: 'size', special: 'size' },
  'sep',
  { cmd: 'bold', label: 'Bold', title: 'Bold (Cmd/Ctrl+B)', ic: 'bold' },
  { cmd: 'italic', label: 'Italic', title: 'Italic (Cmd/Ctrl+I)', ic: 'italic' },
  { cmd: 'underline', label: 'Underline', title: 'Underline (Cmd/Ctrl+U)', ic: 'underline' },
  { cmd: 'color', label: 'Text colour', title: 'Text colour', ic: 'textColor', menu: true },
  { cmd: 'hl', label: 'Highlight', title: 'Highlight colour', ic: 'highlighter', menu: true },
  { cmd: 'more', label: 'More formatting', title: 'Strikethrough, superscript, subscript, clear formatting', ic: 'more', menu: true },
  'sep',
  { cmd: 'link', label: 'Insert link', title: 'Link (Cmd/Ctrl+K)', ic: 'link' },
  { cmd: 'comment', label: 'Comment', title: 'Comment on the selected text', ic: 'commentPlus' },
  { cmd: 'insert', label: 'Insert', title: 'Insert: images, tables, charts, equations and more', ic: 'plusSquare', text: 'Insert', menu: true, wide: true },
  'sep',
  { cmd: 'align', label: 'Align', title: 'Align', ic: 'alignLeft', menu: true },
  { cmd: 'spacing', label: 'Line and paragraph spacing', title: 'Line and paragraph spacing', ic: 'spacing', menu: true },
  { cmd: 'tasks', label: 'Checklist', title: 'Checklist (type [] then space)', ic: 'checkSquare' },
  { cmd: 'ul', label: 'Bulleted list', title: 'Bulleted list (type - then space)', ic: 'list' },
  { cmd: 'ol', label: 'Numbered list', title: 'Numbered list (type 1. then space)', ic: 'listOrdered' },
  { cmd: 'outdent', label: 'Decrease indent', title: 'Decrease indent (Shift+Tab)', ic: 'outdent' },
  { cmd: 'indent', label: 'Increase indent', title: 'Increase indent (Tab)', ic: 'indent' },

];
TOOLS.forEach((t) => { if (t && t.title) t.title = kbd(t.title); }); // Ctrl or Cmd, to suit this computer
/* The Insert menu, in sections. */
const INSERT_MENU = [
  ['Media', [['attach', 'paperclip', 'Image or file'], ['draw', 'pen', 'Drawing (pen)'], ['shapes', 'shapes', 'Shapes']]],
  ['Blocks', [['table', 'table', 'Table'], ['chart', 'barChart', 'Chart'], ['code', 'code', 'Code block'], ['quote', 'lightbulb', 'Callout'], ['mathBlock', 'sigmaBlock', 'Equation'], ['mathInline', 'sigma', 'Inline equation']]],
  ['Smart', [['dropdown', 'dropdownChip', 'Dropdown'], ['signature', 'signature', 'Signature'], ['embed', 'embedApp', 'Embedded app']]],
  ['Layout', [['hr', 'minus', 'Divider'], ['pagebreak', 'pageBreak', 'Page break'], ['toc', 'listTree', 'Table of contents']]],
];

export function editorHtml(note) {
  const uid = `ed-${note.id.slice(0, 8)}-${Math.random().toString(36).slice(2, 6)}`;
  return `
  <form class="note-editor" data-id="${note.id}" autocomplete="off">
    <div class="rich-toolbar" role="toolbar" aria-label="Formatting">
      ${TOOLS.map((t) => t === 'sep' ? '<span class="tb-sep" aria-hidden="true"></span>'
        : t.special === 'size' ? `<span class="size-ctl" role="group" aria-label="Font size"><button type="button" class="tb-btn size-step" data-size-step="-1" title="Decrease font size" aria-label="Decrease font size">−</button><input class="size-input" value="13" inputmode="numeric" maxlength="3" aria-label="Font size (points)" title="Font size"><button type="button" class="tb-btn size-step" data-size-step="1" title="Increase font size" aria-label="Increase font size">+</button></span>`
        : `<button type="button" class="tb-btn ${t.text ? 'tb-text' : ''} ${t.wide ? 'tb-wide' : ''} ${t.menu ? 'tb-menu' : ''}" data-cmd="${t.cmd}" title="${t.title}" aria-label="${t.label}" ${t.menu ? 'aria-haspopup="menu"' : 'aria-pressed="false"'}>${t.ic ? icon(t.ic, { size: 18 }) : ''}${t.text && (t.wide || !t.ic) ? `<span class="tb-label">${t.text}</span>` : ''}${t.menu ? '<span class="tb-caret" aria-hidden="true"></span>' : ''}</button>`).join('')}
      <span class="tb-spacer"></span>
      <span class="presence" aria-label="People editing"></span>
      <button type="button" class="check-status" hidden aria-live="polite" title="Review spelling and grammar"></button>
      <span class="word-count" aria-live="polite"></span>
      <span class="save-state" aria-live="polite">Connecting…</span>
      <input type="file" class="attach-input" multiple hidden>
    </div>
    <div class="find-bar" hidden role="search" aria-label="Find and replace">
      <label class="sr-only" for="${uid}-find">Find</label>
      <input id="${uid}-find" class="find-input" placeholder="Find" autocomplete="off" spellcheck="false">
      <span class="find-count" aria-live="polite"></span>
      <button type="button" class="icon-btn" data-find="prev" aria-label="Previous match" title="Previous (Shift+Enter)">${icon('chevronLeft', { size: 16 })}</button>
      <button type="button" class="icon-btn" data-find="next" aria-label="Next match" title="Next (Enter)">${icon('chevronRight', { size: 16 })}</button>
      <label class="find-case" title="Match case"><input type="checkbox" class="find-case-box"><span>Aa</span></label>
      <label class="sr-only" for="${uid}-replace">Replace with</label>
      <input id="${uid}-replace" class="find-input" placeholder="Replace with" autocomplete="off" spellcheck="false">
      <button type="button" class="btn btn-outline btn-xs" data-find="replace">Replace</button>
      <button type="button" class="btn btn-outline btn-xs" data-find="all">Replace all</button>
      <button type="button" class="icon-btn" data-find="close" aria-label="Close find" title="Close (Esc)">${icon('x', { size: 16 })}</button>
    </div>
    <div class="rich-host"></div>
  </form>`;
}

/* ---------- Pickers (menus under toolbar buttons) ---------- */
let pickerEl = null;
let pickerAnchor = null;
function closePicker() { pickerEl?.remove(); pickerEl = null; pickerAnchor = null; document.removeEventListener('mousedown', onPickerOutside, true); }
function onPickerOutside(e) { if (pickerEl && !pickerEl.contains(e.target) && !e.target.closest('.tb-menu')) closePicker(); }
function openPicker(anchor, html, onPick) {
  // Clicking the same toolbar button again closes its menu.
  if (pickerEl && pickerAnchor === anchor) { closePicker(); return; }
  closePicker();
  pickerAnchor = anchor;
  pickerEl = document.createElement('div');
  pickerEl.className = 'pick-pop';
  pickerEl.setAttribute('role', 'menu');
  pickerEl.innerHTML = html;
  document.body.appendChild(pickerEl);
  const r = anchor.getBoundingClientRect();
  pickerEl.style.left = `${Math.min(r.left, window.innerWidth - pickerEl.offsetWidth - 8)}px`;
  pickerEl.style.top = `${r.bottom + 6}px`;
  pickerEl.addEventListener('mousedown', (e) => e.preventDefault());
  pickerEl.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) { closePicker(); onPick(b.dataset.pick); } });
  setTimeout(() => document.addEventListener('mousedown', onPickerOutside, true));
}
const PICKERS = {
  style: () => [['p', 'Normal text', 'font-size:15px'], ['h2', 'Heading 1', 'font-size:20px;font-weight:700'], ['h3', 'Heading 2', 'font-size:17px;font-weight:700']]
    .map(([k, l, st]) => `<button type="button" role="menuitem" data-pick="${k}" style="${st}">${l}</button>`).join(''),
  more: () => [['strike', 'strike', 'Strikethrough', kbd('Cmd+Shift+X')], ['sup', 'superscript', 'Superscript', ''], ['sub', 'subscript', 'Subscript', ''], ['clear', 'clearFormat', 'Clear formatting', '']]
    .map(([k, ic, l, kb]) => `<button type="button" role="menuitem" data-pick="${k}">${icon(ic, { size: 17 })}<span>${l}</span>${kb ? `<kbd>${kb}</kbd>` : ''}</button>`).join('')
    + `<div class="pick-label">Spelling &amp; grammar</div>
    <button type="button" role="menuitem" data-pick="review">${icon('spellcheck', { size: 17 })}<span>Review spelling &amp; grammar</span></button>
    <button type="button" role="menuitemcheckbox" aria-checked="${checkingEnabled()}" data-pick="checktoggle">${icon(checkingEnabled() ? 'check' : 'x', { size: 17 })}<span>Check as I type</span><kbd>${checkingEnabled() ? 'On' : 'Off'}</kbd></button>`,
  insert: () => INSERT_MENU.map(([sec, items]) => `<div class="pick-label">${sec}</div>${items.map(([k, ic, l]) => `<button type="button" role="menuitem" data-pick="${k}">${icon(ic, { size: 17 })}<span>${l}</span></button>`).join('')}`).join(''),
  font: () => Object.entries(FONTS).map(([k, f]) => `<button type="button" role="menuitem" data-pick="${k}" style="font-family:${f.stack || 'inherit'}">${f.label}</button>`).join(''),
  size: () => SIZES.map((s) => `<button type="button" role="menuitem" data-pick="${s.px}" style="font-size:${s.px ? Math.min(s.px, 24) : 15}px">${s.label}</button>`).join(''),
  color: () => `<button type="button" role="menuitem" class="pick-reset" data-pick="none">${icon('undo', { size: 15 })}Reset</button>
    <div class="doc-palette">${DOC_COLORS.map((row, r) => `<div class="pal-row ${r === 1 ? 'pal-gap' : ''}">${row.map((h) => `<button type="button" role="menuitem" data-pick="#${h}" class="pal-cell" style="background:#${h}" title="#${h}" aria-label="Colour #${h}"></button>`).join('')}</div>`).join('')}</div>
    <div class="pick-label">Custom</div>
    <div class="pal-row">${recentColors().map((h) => `<button type="button" role="menuitem" data-pick="#${h}" class="pal-cell" style="background:#${h}" title="#${h}" aria-label="Colour #${h}"></button>`).join('')}<label class="pal-cell pal-add" title="Choose a custom colour">+<input type="color" class="pal-custom" value="#4a86e8"></label></div>`,
  hl: () => `<div class="pick-swatches">${Object.entries(HIGHLIGHTS).map(([k, h]) => `<button type="button" role="menuitem" data-pick="${k}" class="pick-swatch" style="background:var(--hl-${k})" title="${h.label}" aria-label="${h.label} highlight"></button>`).join('')}</div>
    <button type="button" role="menuitem" data-pick="none">No highlight</button>`,
  align: () => [['left', 'alignLeft', 'Left'], ['center', 'alignCenter', 'Centre'], ['right', 'alignRight', 'Right'], ['justify', 'alignJustify', 'Justify']]
    .map(([k, ic, l]) => `<button type="button" role="menuitem" data-pick="${k}">${icon(ic, { size: 17 })}${l}</button>`).join(''),
  spacing: () => `<div class="pick-label">Line spacing</div>
    ${[['1', 'Single'], ['1.15', '1.15'], ['1.5', '1.5'], ['2', 'Double'], ['', 'Default']].map(([v, l]) => `<button type="button" role="menuitem" data-pick="lh:${v}">${l}</button>`).join('')}
    <div class="pick-label">Space after paragraph</div>
    ${[['0', 'None'], ['1', 'Small'], ['2', 'Medium'], ['3', 'Large'], ['', 'Default']].map(([v, l]) => `<button type="button" role="menuitem" data-pick="sa:${v}">${l}</button>`).join('')}`,
};
const BLOCK_TYPES = ['paragraph', 'heading', 'callout', 'listItem', 'taskItem'];

/* ---------- Floating bars ---------- */
function floatingBar(cls) {
  const el = document.createElement('div');
  el.className = `table-bar ${cls}`;
  el.hidden = true;
  el.addEventListener('mousedown', (e) => { if (!['SELECT', 'INPUT'].includes(e.target.tagName)) e.preventDefault(); });
  document.body.appendChild(el);
  return el;
}
function placeBar(bar, rect, { below = false } = {}) {
  if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) { bar.hidden = true; return; }
  bar.hidden = false;
  const top = !below && rect.top - bar.offsetHeight - 8 > 8 ? rect.top - bar.offsetHeight - 8 : rect.bottom + 8;
  bar.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - bar.offsetWidth - 8)}px`;
  bar.style.top = `${top}px`;
}

export function mountEditor(form, { autofocus = true } = {}) {
  const id = form.dataset.id;
  const note = store.find('notes', id);
  const host = $('.rich-host', form);
  const toolbar = $('.rich-toolbar', form);
  const stateEl = $('.save-state', form);
  const presenceEl = $('.presence', form);
  const picker = $('.attach-input', form);
  const setState = (t) => { stateEl.textContent = t; };
  const editable = note?.access !== 'view';
  const cleanups = [];
  const on = (target, ev, fn, opts) => { target.addEventListener(ev, fn, opts); cleanups.push(() => target.removeEventListener(ev, fn, opts)); };

  /* ----- Slash commands and @mentions (menus shown by the app) ----- */
  const SLASH = [
    ['p', 'Text', 'Plain paragraph', 'alignLeft', 'paragraph normal'],
    ['h2', 'Heading', 'Large section heading', 'textSize', 'h1 title'],
    ['h3', 'Subheading', 'Smaller heading', 'textSize', 'h2'],
    ['ul', 'Bulleted list', 'Simple list with bullets', 'list', 'bullet'],
    ['ol', 'Numbered list', 'List with numbers', 'listOrdered', 'number ordered'],
    ['tasks', 'Checklist', 'Tick boxes for tasks', 'checkSquare', 'todo task check'],
    ['quote', 'Callout', 'Highlighted note', 'lightbulb', 'quote note'],
    ['code', 'Code block', 'Code with colouring', 'code', 'snippet pre'],
    ['mathBlock', 'Equation', 'Maths on its own line', 'sigmaBlock', 'math latex formula block'],
    ['mathInline', 'Inline equation', 'Maths within a sentence', 'sigma', 'math latex formula inline'],
    ['table', 'Table', 'Rows and columns', 'table', 'grid'],
    ['toc', 'Table of contents', 'Links to your headings', 'listTree', 'contents toc'],
    ['hr', 'Divider', 'A line between sections', 'minus', 'line rule separator'],
    ['pagebreak', 'Page break', 'Start a new page', 'pageBreak', 'page new'],
    ['dropdown', 'Dropdown', 'A chip with options, like a status', 'dropdownChip', 'status select choice chip'],
    ['chart', 'Chart', 'Bar, column, line or pie chart', 'barChart', 'graph bar pie line'],
    ['shapes', 'Shapes', 'Shapes, arrows and text boxes', 'shapes', 'shape arrow box diagram'],
    ['signature', 'Signature', 'Sign, or ask someone to sign', 'signature', 'sign esign approve'],
    ['embed', 'Embed', 'YouTube, Outlook mail, Teams, VS Code, Claude', 'embedApp', 'video youtube outlook teams vscode claude app iframe'],
    ['draw', 'Drawing', 'Sketch with a pen', 'pen', 'sketch pen'],
    ['attach', 'Image or file', 'Upload from your computer', 'paperclip', 'picture photo upload attachment'],
    ['link', 'Link', 'Web page or document', 'link', 'url web'],
  ];
  const menuUi = (kind) => () => {
    let el = null, items = [], active = 0, command = null;
    const people = kind === 'mention' ? new PeopleMenu((p) => command?.({ id: p.username, label: p.username })) : null;
    const draw = () => {
      if (people) return;
      el.innerHTML = items.length ? items.map(([cmd, label, desc, ic], i) => `<button type="button" role="option" class="slash-item ${i === active ? 'active' : ''}" data-i="${i}" aria-selected="${i === active}"><span class="slash-ic">${icon(ic, { size: 17 })}</span><span><b>${label}</b><small>${desc}</small></span></button>`).join('') : '<p class="slash-empty">No matches</p>';
      el.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    };
    const place = (rect) => {
      if (!rect || !el) return;
      const h = el.offsetHeight;
      el.style.left = `${Math.min(rect.left, window.innerWidth - el.offsetWidth - 8)}px`;
      el.style.top = `${rect.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 6) : rect.bottom + 6}px`;
    };
    return {
      onStart: async (props) => {
        command = props.command;
        if (people) {
          const list = await peopleFor(id);
          people.lastQuery = props.query;
          people.show(props.clientRect(), list);
          people.filter(props.query);
          return;
        }
        el = document.createElement('div');
        el.className = 'slash-menu';
        el.setAttribute('role', 'listbox');
        el.addEventListener('mousedown', (e) => e.preventDefault());
        el.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) command({ cmd: items[+b.dataset.i][0] }); });
        document.body.appendChild(el);
        items = props.items; active = 0; draw(); place(props.clientRect());
      },
      onUpdate: (props) => {
        command = props.command;
        if (people) { people.lastQuery = props.query; people.filter(props.query); return; }
        items = props.items; active = Math.min(active, Math.max(0, items.length - 1)); draw(); place(props.clientRect());
      },
      onKeyDown: ({ event }) => {
        if (people) {
          if (!people.open) return false;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { people.move(event.key === 'ArrowDown' ? 1 : -1); return true; }
          if ((event.key === 'Enter' || event.key === 'Tab') && people.items.length) { const p = people.current(); command({ id: p.username, label: p.username }); return true; }
          if (event.key === 'Escape') { people.close(); return true; }
          return false;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { const n = items.length || 1; active = (active + (event.key === 'ArrowDown' ? 1 : -1) + n) % n; draw(); return true; }
        if ((event.key === 'Enter' || event.key === 'Tab') && items.length) { command({ cmd: items[active][0] }); return true; }
        if (event.key === 'Escape') { el?.remove(); el = null; return true; }
        return false;
      },
      onExit: () => { el?.remove(); el = null; people?.close(); },
    };
  };
  const hooks = {
    slash: {
      items: (q) => { const t = q.toLowerCase(); return SLASH.filter(([, label, , , kw]) => !t || label.toLowerCase().includes(t) || kw.includes(t)).slice(0, 20); },
      command: (ed, range, props) => { ed.chain().focus().deleteRange(range).run(); run(props.cmd); },
      render: menuUi('slash'),
    },
    mention: {
      items: () => [{}],
      command: ({ editor: ed, range, props }) => { ed.chain().focus().insertContentAt(range, [{ type: 'mention', attrs: props }, { type: 'text', text: ' ' }]).run(); },
      render: menuUi('mention'),
    },
    onFiles: (files, pos) => uploadAll(files, pos),
  };

  /* ----- How dropdowns, charts and signature boxes are drawn inside the editor ----- */
  window.__docRenderers = {
    dropdown: (data) => { try { return dropdownChip(JSON.parse(data)); } catch { return ''; } },
    embed: (data) => { try { return embedHtml(JSON.parse(data)); } catch { return ''; } },
    chart: (spec) => { try { return `<figure class="chart-block">${chartSvg(JSON.parse(spec))}</figure>`; } catch { return ''; } },
    signature: (dom, sigId) => {
      dom.innerHTML = '<div class="sig-loading">Signature</div>';
      loadSignatures(id).then((map) => (map.has(sigId) ? map : loadSignatures(id, { force: true }))).then((map) => { dom.innerHTML = signatureHtml(map.get(sigId)); });
    },
  };

  /* ----- The live editor ----- */
  const live = createLiveEditor({
    element: host,
    noteId: id,
    user: state.user,
    editable,
    hooks,
    onStatus: (s) => setState(s === 'connected' ? 'Live' : s === 'denied' ? 'No access' : s === 'connecting' ? 'Connecting…' : 'Reconnecting…'),
    onSynced: () => { setState('Live'); if (autofocus && editable) editor.commands.focus('end'); },
    onUpdate: () => { updateWords(); },
    extensions: [pagesExtension(id), spellcheckExtension({ onIssueClick: (issue, el) => checker && openIssueCard(issue, el, checker) })],
  });
  const { editor, provider } = live;
  // The live connection was refused (share link turned off, or signed out elsewhere): say so instead of
  // letting someone keep typing changes that can't be saved.
  provider?.on?.('authenticationFailed', () => window.dispatchEvent(new Event('auth:expired')));

  /* ----- Spelling and grammar ----- */
  const checkBtn = $('.check-status', form);
  let checker = null;
  const drawCheckStatus = () => {
    if (!checker) return;
    const st = checker.status;
    const n = checker.issues().length;
    const working = checkingEnabled() && st !== 'unavailable' && st !== 'error';
    // While the checker isn't available, fall back to the browser's own spellcheck.
    editor.view.dom.spellcheck = !working;
    checkBtn.hidden = !checkingEnabled() || st === 'idle';
    checkBtn.className = `check-status ${st === 'ready' ? (n ? 'has-issues' : 'clean') : st}`;
    checkBtn.innerHTML = st === 'checking' && !n ? 'Checking…'
      : st === 'unavailable' ? `${icon('spellcheck', { size: 14 })}Checker starting…`
      : st === 'error' ? `${icon('spellcheck', { size: 14 })}Check failed`
      : n ? `<span class="cs-dot"></span>${n} issue${n === 1 ? '' : 's'}` : `${icon('check', { size: 14 })}No issues`;
    if (reviewEl) drawReview();
  };
  if (editable) checker = attachChecker(editor, { onChange: drawCheckStatus });
  if (checker && !checkingEnabled()) editor.view.dom.spellcheck = true;
  on(checkBtn, 'click', () => openReview());

  // Review panel: step through issues one at a time.
  let reviewEl = null, reviewIndex = 0;
  function closeReview() { reviewEl?.remove(); reviewEl = null; }
  function openReview() {
    if (!checker) return;
    if (!checkingEnabled()) checker.setEnabled(true);
    if (reviewEl) { closeReview(); return; }
    reviewEl = document.createElement('div');
    reviewEl.className = 'review-panel';
    reviewEl.setAttribute('role', 'dialog');
    reviewEl.setAttribute('aria-label', 'Spelling and grammar');
    document.body.appendChild(reviewEl);
    reviewIndex = 0;
    reviewEl.addEventListener('mousedown', (e) => e.preventDefault());
    reviewEl.addEventListener('click', (e) => {
      const issues = checker.issues();
      const cur = issues[reviewIndex];
      const b = e.target.closest('[data-r]');
      if (!b) return;
      const act = b.dataset.r;
      if (act === 'close') { closeReview(); return; }
      if (act === 'prev') reviewIndex = Math.max(0, reviewIndex - 1);
      if (act === 'next') reviewIndex = Math.min(issues.length - 1, reviewIndex + 1);
      if (act === 'fix' && cur) checker.fix(cur, cur.replacements[Number(b.dataset.i)]);
      if (act === 'ignore' && cur) checker.ignore(cur);
      if (act === 'add' && cur) checker.addWord(cur);
      setTimeout(drawReview, 30);
    });
    drawReview();
  }
  function drawReview() {
    if (!reviewEl) return;
    const issues = checker.issues();
    reviewIndex = Math.min(reviewIndex, Math.max(0, issues.length - 1));
    const cur = issues[reviewIndex];
    const r = toolbar.getBoundingClientRect();
    reviewEl.style.top = `${r.bottom + 8}px`;
    reviewEl.style.left = `${Math.max(8, r.right - 360)}px`;
    if (!cur) {
      reviewEl.innerHTML = `<div class="rv-head"><b>Spelling &amp; grammar</b><button type="button" class="icon-btn" data-r="close" aria-label="Close">${icon('x', { size: 16 })}</button></div>
        <p class="rv-empty">${checker.status === 'checking' ? 'Checking…' : checker.status === 'unavailable' ? 'The checker is starting. Try again in a moment.' : `${icon('check', { size: 18 })} No issues found.`}</p>`;
      return;
    }
    // Show the issue in context and select it in the document.
    const ctxFrom = Math.max(cur.from - 40, editor.state.doc.resolve(cur.from).start());
    const ctxTo = Math.min(cur.to + 40, editor.state.doc.resolve(cur.to).end());
    const before = editor.state.doc.textBetween(ctxFrom, cur.from, ' ', ' ');
    const after = editor.state.doc.textBetween(cur.to, ctxTo, ' ', ' ');
    editor.commands.setTextSelection({ from: cur.from, to: cur.to });
    editor.view.domAtPos(cur.from).node?.parentElement?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    reviewEl.innerHTML = `<div class="rv-head"><b>Spelling &amp; grammar</b><span class="rv-count">${reviewIndex + 1} of ${issues.length}</span>
        <button type="button" class="icon-btn" data-r="prev" aria-label="Previous issue" ${reviewIndex === 0 ? 'disabled' : ''}>${icon('chevronLeft', { size: 16 })}</button>
        <button type="button" class="icon-btn" data-r="next" aria-label="Next issue" ${reviewIndex >= issues.length - 1 ? 'disabled' : ''}>${icon('chevronRight', { size: 16 })}</button>
        <button type="button" class="icon-btn" data-r="close" aria-label="Close">${icon('x', { size: 16 })}</button></div>
      <div class="issue-kind ${cur.type}"><span class="issue-dot"></span>${cur.type === 'spelling' ? 'Spelling' : 'Grammar'}</div>
      <p class="rv-context">${before.length >= 40 ? '…' : ''}${esc(before)}<mark class="${cur.type === 'spelling' ? 'sp-err' : 'gr-err'}">${esc(cur.text)}</mark>${esc(after)}${after.length >= 40 ? '…' : ''}</p>
      <p class="issue-msg">${esc(cur.message || cur.detail || '')}</p>
      ${cur.replacements.length ? `<div class="issue-fixes">${cur.replacements.map((x, i) => `<button type="button" class="issue-fix" data-r="fix" data-i="${i}">${esc(x) || '<em>(remove)</em>'}</button>`).join('')}</div>` : '<p class="issue-none">No suggestions</p>'}
      <div class="issue-actions"><button type="button" data-r="ignore">Ignore</button>${cur.type === 'spelling' ? '<button type="button" data-r="add">Add to dictionary</button>' : ''}</div>`;
  }
  form.classList.toggle('read-only', !editable);

  // Who else is here (from the live connection's presence information).
  const drawPresence = () => {
    const people = [...provider.awareness.getStates().entries()].filter(([cid]) => cid !== provider.awareness.clientID).map(([, s]) => s.user).filter(Boolean);
    const unique = [...new Map(people.map((p) => [p.name, p])).values()];
    presenceEl.innerHTML = unique.map((p) => `<span class="presence-dot" style="background:${p.color}" title="${esc(p.name)} is here">${esc(p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</span>`).join('');
  };
  provider.awareness.on('change', drawPresence);

  /* ----- Toolbar ----- */
  function updateToolbar() {
    const a = (n, attrs) => editor.isActive(n, attrs);
    const states = {
      bold: a('bold'), italic: a('italic'), underline: a('underline'), strike: a('strike'), sup: a('superscript'), sub: a('subscript'),
      h2: a('heading', { level: 2 }), h3: a('heading', { level: 3 }), p: a('paragraph') && !a('listItem') && !a('taskItem'),
      ul: a('bulletList'), ol: a('orderedList'), tasks: a('taskList'), quote: a('callout'), code: a('codeBlock'), link: a('link'),
    };
    $$('.tb-btn:not(.tb-menu)', form).forEach((b) => b.setAttribute('aria-pressed', String(!!states[b.dataset.cmd])));
    const u = $('[data-cmd="undo"]', form), r = $('[data-cmd="redo"]', form);
    if (u) u.disabled = !editor.can().undo();
    if (r) r.disabled = !editor.can().redo();
    const styleBtn = $('[data-cmd="style"] .tb-label', form);
    if (styleBtn) styleBtn.textContent = editor.isActive('heading', { level: 2 }) ? 'Heading 1' : editor.isActive('heading', { level: 3 }) ? 'Heading 2' : editor.isActive('codeBlock') ? 'Code' : editor.isActive('callout') ? 'Callout' : 'Normal text';
    // Show the colour/highlight that will be used (for the selection, or for what you type next).
    const col = editor.getAttributes('textStyle').color;
    $('[data-cmd="color"]', form)?.style.setProperty('--pending', col ? (col.startsWith('#') ? col : `var(--tc-${col})`) : 'currentColor');
    const hlc = editor.isActive('highlight') ? editor.getAttributes('highlight').color : null;
    $('[data-cmd="hl"]', form)?.style.setProperty('--pending', hlc ? `var(--hl-${hlc})` : 'transparent');
    const al = ['center', 'right', 'justify'].find((x) => editor.isActive({ textAlign: x })) || 'left';
    const alignBtn = $('[data-cmd="align"]', form);
    if (alignBtn && alignBtn.dataset.shown !== al) { alignBtn.dataset.shown = al; alignBtn.innerHTML = `${icon({ left: 'alignLeft', center: 'alignCenter', right: 'alignRight', justify: 'alignJustify' }[al], { size: 18 })}<span class="tb-caret" aria-hidden="true"></span>`; }
  }
  editor.on('selectionUpdate', () => { updateToolbar(); placeBars(); updateWords(); });
  // The undo history is updated just after each change, so check the buttons again a moment later.
  let historyTimer = null;
  editor.on('transaction', () => { updateToolbar(); placeBars(); clearTimeout(historyTimer); historyTimer = setTimeout(() => { if (!editor.isDestroyed) updateToolbar(); }, 40); });

  function setBlockAttr(key, value) {
    const { from, to } = editor.state.selection;
    const tr = editor.state.tr;
    editor.state.doc.nodesBetween(from, to, (node, pos) => {
      if (!BLOCK_TYPES.includes(node.type.name)) return;
      if (['listItem', 'taskItem'].includes(node.type.name) && key !== 'indent') return;
      let v = value;
      if (key === 'indent') v = Math.min(4, Math.max(0, (node.attrs.indent || 0) + value));
      tr.setNodeMarkup(pos, null, { ...node.attrs, [key]: v });
    });
    editor.view.dispatch(tr);
    editor.commands.focus();
  }

  function run(cmd) {
    const c = () => editor.chain().focus();
    switch (cmd) {
      case 'undo': editor.commands.undo(); break;
      case 'redo': editor.commands.redo(); break;
      case 'find': if (findBar.hidden) openFind(); else closeFind(); break;
      case 'p': c().setParagraph().run(); break;
      case 'h2': c().toggleHeading({ level: 2 }).run(); break;
      case 'h3': c().toggleHeading({ level: 3 }).run(); break;
      case 'ul': c().toggleBulletList().run(); break;
      case 'ol': c().toggleOrderedList().run(); break;
      case 'tasks': c().toggleTaskList().run(); break;
      case 'quote': editor.isActive('callout') ? c().setParagraph().run() : c().setNode('callout').run(); break;
      case 'code': c().toggleCodeBlock().run(); break;
      case 'bold': c().toggleBold().run(); break;
      case 'italic': c().toggleItalic().run(); break;
      case 'underline': c().toggleUnderline().run(); break;
      case 'strike': c().toggleStrike().run(); break;
      case 'sup': c().unsetSubscript().toggleSuperscript().run(); break;
      case 'sub': c().unsetSuperscript().toggleSubscript().run(); break;
      case 'clear': c().unsetAllMarks().run(); editor.view.dispatch(editor.state.tr.setStoredMarks([])); break;
      case 'review': openReview(); break;
      case 'checktoggle': if (checker) { const on2 = !checkingEnabled(); checker.setEnabled(on2); if (!on2) closeReview(); drawCheckStatus(); toast(on2 ? 'Spelling and grammar checks are on' : 'Spelling and grammar checks are off'); } break;
      case 'indent': case 'outdent': {
        const d = cmd === 'indent' ? 1 : -1;
        if (editor.isActive('listItem')) (d > 0 ? c().sinkListItem('listItem') : c().liftListItem('listItem')).run();
        else if (editor.isActive('taskItem')) (d > 0 ? c().sinkListItem('taskItem') : c().liftListItem('taskItem')).run();
        else setBlockAttr('indent', d);
        break;
      }
      case 'link': openLink(); break;
      case 'comment':
        if (editor.state.selection.empty) { toast('Select the text you want to comment on'); break; }
        document.dispatchEvent(new CustomEvent('doc:comment-request', { detail: { container: editor.view.dom } }));
        break;
      case 'mathInline': editMath({ display: false, insert: true, latex: editor.state.selection.empty ? '' : editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to) }); break;
      case 'mathBlock': editMath({ display: true, insert: true, latex: '' }); break;
      case 'table': c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break;
      case 'toc': c().insertContent({ type: 'toc' }).run(); break;
      case 'hr': c().setHorizontalRule().run(); break;
      case 'pagebreak': c().insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]).run(); break;
      case 'draw': drawNew(); break;
      case 'dropdown': dropdownDialog().then((d) => { if (d) editor.chain().focus().insertContent([{ type: 'dropdown', attrs: { data: JSON.stringify(d) } }, { type: 'text', text: ' ' }]).run(); }); break;
      case 'chart': insertChart(); break;
      case 'embed': embedDialog().then((d) => { if (d) editor.chain().focus().insertContent([{ type: 'embed', attrs: { data: JSON.stringify(d) } }, { type: 'paragraph' }]).run(); }); break;
      case 'shapes': editShapes(); break;
      case 'signature': requestSignatureDialog(id).then((r) => {
        if (!r) return;
        editor.chain().focus().insertContent([{ type: 'signature', attrs: { id: r.sig.id } }, { type: 'paragraph' }]).run();
        if (r.signNow) signDialog(r.sig, (signed) => document.querySelectorAll(`[data-sig="${r.sig.id}"]`).forEach((b) => { b.innerHTML = signatureHtml(signed); }));
      }); break;
      case 'attach': picker.click(); break;
      default: break;
    }
  }
  on(toolbar, 'mousedown', (e) => { if (e.target.closest('.tb-btn')) e.preventDefault(); });
  on(toolbar, 'click', (e) => {
    const btn = e.target.closest('[data-cmd]');
    if (!btn || !editable) return;
    const cmd = btn.dataset.cmd;
    if (PICKERS[cmd]) {
      // With nothing selected, the choice applies to what you type next (like Google Docs).
      setTimeout(() => {
        // Custom colour: the colour well applies its colour directly.
        document.querySelector('.pick-pop .pal-custom')?.addEventListener('change', (e) => {
          const hex = e.target.value.toLowerCase();
          rememberColor(hex.slice(1));
          closePicker();
          editor.chain().focus().setMark('textStyle', { color: hex }).run();
        });
      });
      openPicker(btn, PICKERS[cmd](), (v) => {
        if (cmd === 'style' || cmd === 'more' || cmd === 'insert') { run(v); return; }
        const c = editor.chain().focus();
        if (cmd === 'font') (v === 'default' ? c.setMark('textStyle', { font: null }) : c.setMark('textStyle', { font: v })).removeEmptyTextStyle().run();
        if (cmd === 'size') c.setMark('textStyle', { size: Number(v) || null }).removeEmptyTextStyle().run();
        if (cmd === 'color') c.setMark('textStyle', { color: v === 'none' ? null : v }).removeEmptyTextStyle().run();
        if (cmd === 'color' && v.startsWith('#') && !DOC_COLORS.flat().includes(v.slice(1))) rememberColor(v.slice(1));
        if (cmd === 'hl') (v === 'none' ? c.unsetMark('highlight') : c.setMark('highlight', { color: v })).run();
        if (cmd === 'align') c.setTextAlign(v).run();
        if (cmd === 'spacing') { const [k, val] = v.split(':'); setBlockAttr(k, val === '' ? null : val); }
      });
      return;
    }
    run(cmd);
  });
  on(form, 'keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && e.target.closest('.rich-host')) { e.preventDefault(); openLink(); }
  });

  /* ----- Word count ----- */
  const wordEl = $('.word-count', form);
  const countWords = (t) => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  const updateWords = debounce(() => {
    if (editor.isDestroyed) return;
    const total = countWords(editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ', ' '));
    const { from, to, empty } = editor.state.selection;
    const picked = empty ? 0 : countWords(editor.state.doc.textBetween(from, to, ' ', ' '));
    wordEl.textContent = picked ? `${picked.toLocaleString()} of ${total.toLocaleString()} words` : `${total.toLocaleString()} word${total === 1 ? '' : 's'}`;
  }, 200);

  /* ----- Find and replace ----- */
  const findBar = $('.find-bar', form);
  const [findInput, replaceInput] = findBar.querySelectorAll('.find-input');
  const caseBox = findBar.querySelector('.find-case-box');
  const findCount = findBar.querySelector('.find-count');
  const fstate = () => findKey.getState(editor.state);
  const setFind = (meta) => editor.view.dispatch(editor.state.tr.setMeta(findKey, meta));
  const paintCount = () => { const s = fstate(); findCount.textContent = findInput.value ? (s.matches.length ? `${s.current + 1} of ${s.matches.length}` : 'No matches') : ''; };
  const goTo = (i) => {
    const s = fstate();
    if (!s.matches.length) return;
    const cur = (i + s.matches.length) % s.matches.length;
    setFind({ current: cur });
    const m = s.matches[cur];
    editor.view.domAtPos(m.from).node?.parentElement?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    paintCount();
  };
  function openFind() {
    findBar.hidden = false;
    const { from, to, empty } = editor.state.selection;
    if (!empty && to - from < 80) findInput.value = editor.state.doc.textBetween(from, to);
    findInput.focus(); findInput.select();
    setFind({ query: findInput.value, matchCase: caseBox.checked, current: 0 }); paintCount();
  }
  function closeFind() { findBar.hidden = true; setFind({ query: '', current: 0 }); editor.commands.focus(); }
  on(findInput, 'input', () => { setFind({ query: findInput.value, current: 0 }); paintCount(); goTo(0); });
  on(caseBox, 'change', () => { setFind({ matchCase: caseBox.checked, current: 0 }); paintCount(); });
  on(findBar, 'keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
    if (e.key === 'Enter' && e.target === findInput) { e.preventDefault(); goTo(fstate().current + (e.shiftKey ? -1 : 1)); }
    if (e.key === 'Enter' && e.target === replaceInput) { e.preventDefault(); findBar.querySelector('[data-find="replace"]').click(); }
  });
  on(findBar, 'click', (e) => {
    const b = e.target.closest('[data-find]');
    if (!b) return;
    const s = fstate();
    switch (b.dataset.find) {
      case 'close': closeFind(); break;
      case 'next': goTo(s.current + 1); break;
      case 'prev': goTo(s.current - 1); break;
      case 'replace': {
        const m = s.matches[s.current];
        if (!m || !editable) break;
        const tr = editor.state.tr;
        if (replaceInput.value) tr.insertText(replaceInput.value, m.from, m.to); else tr.delete(m.from, m.to);
        editor.view.dispatch(tr);
        paintCount();
        break;
      }
      case 'all': {
        if (!s.matches.length || !editable) break;
        const n = s.matches.length;
        const tr = editor.state.tr;
        [...s.matches].reverse().forEach((m) => { if (replaceInput.value) tr.insertText(replaceInput.value, m.from, m.to); else tr.delete(m.from, m.to); });
        editor.view.dispatch(tr);
        paintCount();
        toast(`Replaced ${n} match${n === 1 ? '' : 'es'}`);
        break;
      }
      default: break;
    }
  });
  editor.on('update', () => { if (!findBar.hidden) paintCount(); });

  /* ----- Links ----- */
  const normaliseUrl = (raw) => {
    const v = raw.trim();
    if (!v) return null;
    if (/^#\/documents\/[0-9a-f-]{36}$/.test(v) || /^mailto:/i.test(v) || /^https?:\/\//i.test(v)) return v;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
    if (/^[^\s]+\.[^\s]{2,}/.test(v) && !/^[a-z]+:/i.test(v)) return `https://${v}`;
    return null;
  };
  function openLink() {
    if (!editable) return;
    const existing = editor.getAttributes('link').href || '';
    if (existing) editor.chain().extendMarkRange('link').run();
    const { from, to, empty } = editor.state.selection;
    const selected = empty ? '' : editor.state.doc.textBetween(from, to);
    const isDoc = /^#\/documents\//.test(existing);
    const docs = state.notes.filter((n) => n.id !== id);
    openModal({
      title: existing ? 'Edit link' : 'Insert link',
      body: `
        <div class="segmented link-kind" role="radiogroup">
          <label><input type="radio" name="kind" value="web" ${isDoc ? '' : 'checked'}><span>Web address</span></label>
          <label><input type="radio" name="kind" value="doc" ${isDoc ? 'checked' : ''}><span>Document</span></label>
        </div>
        <form class="form" id="link-form" novalidate>
          <label class="field"><span>Text to show</span><input name="text" value="${esc(selected)}" placeholder="e.g. Our trip notes" ${selected ? 'readonly' : ''}></label>
          <label class="field link-web"><span>Address</span><input name="url" value="${isDoc ? '' : esc(existing)}" placeholder="example.com or name@example.com" autocomplete="off" autofocus></label>
          <div class="field link-doc">
            <span>Document</span>
            <input name="docsearch" placeholder="Search your documents…" autocomplete="off">
            <div class="link-docs" role="listbox">${docs.length ? docs.map((n) => `<button type="button" class="link-doc-item ${existing === `#/documents/${n.id}` ? 'active' : ''}" data-doc="${n.id}" data-title="${esc(n.title || 'Untitled')}" role="option">${icon(n.icon || 'file', { size: 16 })}<span>${esc(n.title || 'Untitled')}</span></button>`).join('') : '<p class="muted small">No other documents yet.</p>'}</div>
          </div>
        </form>`,
      footer: `${existing ? `<button class="btn btn-ghost-danger" data-unlink>${icon('unlink', { size: 16 })}Remove link</button>` : ''}<span class="spacer"></span>
        <button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="link-form">${existing ? 'Save' : 'Insert link'}</button>`,
      onMount: (el, close) => {
        const f = el.querySelector('#link-form');
        let docId = isDoc ? existing.split('/').pop() : null;
        const kind = () => el.querySelector('[name=kind]:checked').value;
        const sync = () => el.classList.toggle('link-mode-doc', kind() === 'doc');
        sync();
        el.querySelector('.link-kind').addEventListener('change', sync);
        f.elements.docsearch.addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); el.querySelectorAll('.link-doc-item').forEach((b) => { b.hidden = !b.dataset.title.toLowerCase().includes(q); }); });
        el.querySelector('.link-docs').addEventListener('click', (e) => {
          const b = e.target.closest('[data-doc]'); if (!b) return;
          docId = b.dataset.doc;
          el.querySelectorAll('.link-doc-item').forEach((x) => x.classList.toggle('active', x === b));
          if (!f.elements.text.value.trim()) f.elements.text.value = b.dataset.title;
        });
        el.querySelector('[data-unlink]')?.addEventListener('click', () => { close(); editor.chain().focus().extendMarkRange('link').unsetLink().run(); });
        f.addEventListener('submit', (e) => {
          e.preventDefault();
          const url = kind() === 'doc' ? (docId ? `#/documents/${docId}` : null) : normaliseUrl(f.elements.url.value);
          if (!url) { let p = f.querySelector('.form-error'); if (!p) { p = document.createElement('p'); p.className = 'form-error'; f.append(p); } p.textContent = kind() === 'doc' ? 'Choose a document to link to.' : 'Enter a web address (like example.com) or an email address.'; return; }
          const text = f.elements.text.value.trim() || (kind() === 'doc' ? el.querySelector('.link-doc-item.active')?.dataset.title : f.elements.url.value.trim());
          close();
          // Link the text, then put the cursor just after it (so typing doesn't replace it).
          if (selected || existing) editor.chain().focus().setTextSelection({ from, to }).setLink({ href: url }).setTextSelection(to).run();
          else editor.chain().focus().insertContent([{ type: 'text', text, marks: [{ type: 'link', attrs: { href: url } }] }, { type: 'text', text: ' ' }]).run();
        });
      },
    });
  }

  /* ----- Bars: link, image, table, code ----- */
  const linkBar = floatingBar('link-bar-wrap link-bar');
  const imageBar = floatingBar('image-bar');
  const tableBar = floatingBar('tbl-bar');
  const embedBar = floatingBar('embed-bar');
  imageBar.innerHTML = `${[25, 50, 75, 100].map((w) => `<button type="button" data-img="w${w}">${w === 100 ? 'Full' : `${w}%`}</button>`).join('')}<span class="img-sep"></span>
    <button type="button" data-img="crop">${icon('crop', { size: 15 })}Crop</button><button type="button" data-img="draw">${icon('pen', { size: 15 })}Draw</button>
    <button type="button" data-img="remove" aria-label="Remove image" title="Remove image">${icon('trash', { size: 15 })}</button>`;
  tableBar.innerHTML = `<button type="button" data-t="rowAfter">${icon('plus', { size: 14 })}Row</button><button type="button" data-t="colAfter">${icon('plus', { size: 14 })}Column</button>
    <span class="img-sep"></span><button type="button" data-t="delRow">${icon('minus', { size: 14 })}Row</button><button type="button" data-t="delCol">${icon('minus', { size: 14 })}Column</button>
    <button type="button" data-t="delTable" aria-label="Delete table" title="Delete table">${icon('trash', { size: 15 })}</button>`;
  function placeBars() {
    if (editor.isDestroyed || !editable) return;
    const sel = editor.state.selection;
    const view = editor.view;
    const blockRect = (name) => {
      const { $from } = sel;
      for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === name) { const dom = view.nodeDOM($from.before(d)); return dom?.getBoundingClientRect?.(); }
      return null;
    };
    const img = sel.node?.type.name === 'image' ? view.nodeDOM(sel.from) : null;
    if (img) {
      const drawBtn = imageBar.querySelector('[data-img="draw"]');
      if (drawBtn) drawBtn.innerHTML = `${icon(sel.node.attrs.shapes ? 'shapes' : 'pen', { size: 15 })}${sel.node.attrs.shapes ? 'Edit shapes' : 'Draw'}`;
      placeBar(imageBar, img.getBoundingClientRect());
    } else imageBar.hidden = true;
    if (editor.isActive('table') && !img) placeBar(tableBar, blockRect('table')); else tableBar.hidden = true;
    if (sel.node?.type.name === 'embed') {
      let d = {}; try { d = JSON.parse(sel.node.attrs.data); } catch { /* */ }
      const p = providerOf(detectEmbed(d.u)?.k);
      embedBar.innerHTML = `${p?.live ? `<label class="sr-only" for="emb-h-${id}">Height</label><select class="select select-sm" id="emb-h-${id}" data-emb="h">${Object.entries(EMBED_SIZES).map(([v, l]) => `<option value="${v}" ${Number(d.h || 0) === Number(v) ? 'selected' : ''}>${l}</option>`).join('')}</select><span class="img-sep"></span>` : ''}
        <button type="button" data-emb="open">${icon('open', { size: 15 })}Open</button><button type="button" data-emb="change">${icon('edit', { size: 15 })}Change</button><button type="button" data-emb="remove" aria-label="Remove embed" title="Remove">${icon('trash', { size: 15 })}</button>`;
      embedBar.dataset.pos = String(sel.from);
      placeBar(embedBar, view.nodeDOM(sel.from)?.getBoundingClientRect());
    } else embedBar.hidden = true;
    const href = editor.isActive('link') && sel.empty ? editor.getAttributes('link').href : null;
    if (href) {
      const coords = view.coordsAtPos(sel.from);
      const docTitle = href.startsWith('#/documents/') ? state.notes.find((n) => n.id === href.split('/').pop())?.title || 'Document' : null;
      linkBar.innerHTML = `<span class="link-bar-url">${docTitle ? `${icon('file', { size: 14 })}${esc(docTitle)}` : esc(href.replace(/^mailto:/, ''))}</span>
        <button type="button" data-l="open">${icon('open', { size: 15 })}Open</button><button type="button" data-l="edit">${icon('edit', { size: 15 })}Edit</button><button type="button" data-l="remove">${icon('unlink', { size: 15 })}Remove</button>`;
      linkBar.dataset.href = href;
      placeBar(linkBar, { left: coords.left, top: coords.top, bottom: coords.bottom, right: coords.right }, { below: true });
    } else linkBar.hidden = true;
  }
  on(document, 'scroll', placeBars, true);
  on(linkBar, 'click', (e) => {
    const b = e.target.closest('[data-l]'); if (!b) return;
    const href = linkBar.dataset.href;
    if (b.dataset.l === 'open') { if (href.startsWith('#/')) location.hash = href.slice(1); else window.open(href, '_blank', 'noopener'); }
    if (b.dataset.l === 'edit') openLink();
    if (b.dataset.l === 'remove') editor.chain().focus().extendMarkRange('link').unsetLink().run();
  });
  on(tableBar, 'click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    const c = editor.chain().focus();
    ({ rowAfter: () => c.addRowAfter(), colAfter: () => c.addColumnAfter(), delRow: () => c.deleteRow(), delCol: () => c.deleteColumn(), delTable: () => c.deleteTable() })[b.dataset.t]().run();
  });
  const embedAt = () => { const pos = Number(embedBar.dataset.pos); const n = editor.state.doc.nodeAt(pos); let d = {}; try { d = JSON.parse(n?.attrs.data || '{}'); } catch { /* */ } return n?.type.name === 'embed' ? { pos, d } : null; };
  const writeEmbed = (pos, d) => editor.chain().focus().command(({ tr }) => { tr.setNodeMarkup(pos, null, { data: JSON.stringify(d) }); return true; }).setNodeSelection(pos).run();
  on(embedBar, 'change', (e) => { const x = embedAt(); if (x && e.target.dataset.emb === 'h') writeEmbed(x.pos, { ...x.d, h: Number(e.target.value) || 0 }); });
  on(embedBar, 'click', async (e) => {
    const b = e.target.closest('[data-emb]'); const x = embedAt();
    if (!b || !x || b.tagName === 'SELECT') return;
    if (b.dataset.emb === 'open') window.open(x.d.u, '_blank', 'noopener');
    if (b.dataset.emb === 'remove') editor.chain().focus().setNodeSelection(x.pos).deleteSelection().run();
    if (b.dataset.emb === 'change') { const d = await embedDialog(x.d); if (d) writeEmbed(x.pos, d); }
  });
  on(imageBar, 'click', async (e) => {
    const b = e.target.closest('[data-img]'); if (!b) return;
    const sel = editor.state.selection;
    if (sel.node?.type.name !== 'image') return;
    const pos = sel.from, attrs = sel.node.attrs;
    const what = b.dataset.img;
    if (what.startsWith('w')) { const w = Number(what.slice(1)); editor.chain().focus().command(({ tr }) => { tr.setNodeMarkup(pos, null, { ...attrs, width: w === 100 ? null : w }); return true; }).run(); }
    if (what === 'remove') editor.chain().focus().deleteSelection().run();
    if (what === 'draw' && attrs.shapes) { editShapes(pos, attrs.shapes); return; }
    if (what === 'crop' || what === 'draw') {
      const blob = what === 'crop' ? await openCropper(attrs.src) : await openDrawing({ base: attrs.src });
      if (!blob) return;
      try {
        const info = await store.uploadFile(blob, { noteId: id, name: `${what === 'crop' ? 'cropped' : 'drawing'}.png` });
        editor.chain().focus().command(({ tr }) => { const n = tr.doc.nodeAt(pos); if (n?.type.name === 'image') tr.setNodeMarkup(pos, null, { ...n.attrs, src: info.url }); return true; }).run();
      } catch (err) { toastError(err.message); }
    }
  });

  /* ----- Equations: edit with a live preview ----- */
  function editMath({ display, insert = false, latex = '', pos = null }) {
    if (!editable) return;
    const { from, to } = editor.state.selection;
    openModal({
      title: display ? 'Equation' : 'Inline equation',
      body: `<form class="form" id="math-form" novalidate>
        <label class="field"><span>LaTeX</span><textarea name="latex" rows="${display ? 4 : 2}" class="math-input" spellcheck="false" placeholder="${display ? 'e.g. \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}' : 'e.g. x^2 + y^2'}">${esc(latex)}</textarea></label>
        <div class="math-preview" aria-live="polite"></div>
        <p class="muted small">Examples: <code>x^2</code> · <code>\\frac{a}{b}</code> · <code>\\sqrt{x}</code> · <code>\\sum_{i=1}^{n} i</code> · <code>\\alpha \\beta \\pi</code></p>
      </form>`,
      footer: `${!insert ? `<button class="btn btn-ghost-danger" data-remove-math>${icon('trash', { size: 16 })}Remove</button>` : ''}<span class="spacer"></span><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="math-form">${insert ? 'Insert' : 'Save'}</button>`,
      onMount: (el, close) => {
        const f = el.querySelector('#math-form');
        const ta = f.elements.latex, pv = el.querySelector('.math-preview');
        const draw = () => { pv.innerHTML = ta.value.trim() ? renderMath(ta.value, display) : '<span class="muted small">The preview appears here.</span>'; };
        draw();
        ta.addEventListener('input', draw);
        setTimeout(() => { ta.focus(); ta.select(); }, 30);
        ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !display)) { e.preventDefault(); f.requestSubmit(); } });
        el.querySelector('[data-remove-math]')?.addEventListener('click', () => { close(); editor.chain().focus().command(({ tr }) => { tr.delete(pos, pos + 1); return true; }).run(); });
        f.addEventListener('submit', (e) => {
          e.preventDefault();
          const v = ta.value.trim();
          close();
          if (!v) return;
          const type = display ? 'mathBlock' : 'mathInline';
          if (insert) editor.chain().focus().insertContentAt({ from, to }, display ? [{ type, attrs: { latex: v } }, { type: 'paragraph' }] : { type, attrs: { latex: v } }).run();
          else {
            // Update it, then put the cursor just after the equation.
            editor.chain().focus().command(({ tr }) => { const n = tr.doc.nodeAt(pos); if (n) tr.setNodeMarkup(pos, null, { latex: v }); return true; }).run();
            const n = editor.state.doc.nodeAt(pos);
            if (n) editor.commands.setTextSelection(Math.min(editor.state.doc.content.size, pos + n.nodeSize));
          }
        });
      },
    });
  }
  on(host, 'math-edit', (e) => editMath({ display: e.detail.display, latex: e.detail.latex, pos: e.detail.pos }));
  on(host, 'math-new', () => {
    // Typed $$ then space: an empty equation was inserted; open it.
    const { $from } = editor.state.selection;
    let pos = null;
    editor.state.doc.nodesBetween(Math.max(0, $from.pos - 3), Math.min(editor.state.doc.content.size, $from.pos + 1), (n, p) => { if (n.type.name === 'mathBlock' && !n.attrs.latex) pos = p; });
    if (pos !== null) editMath({ display: true, latex: '', pos });
  });

  /* ----- Contents links jump to their heading ----- */
  on(host, 'click', (e) => {
    const a = e.target.closest('.toc-link');
    if (!a) return;
    e.preventDefault();
    const heads = host.querySelectorAll('.ProseMirror h2, .ProseMirror h3');
    heads[Number(a.dataset.h)]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /* ----- Font size (Google Docs style: − [size] +, type a size, or choose from the list) ----- */
  const sizeInput = $('.size-input', form);
  const currentPt = () => {
    const px = editor.getAttributes('textStyle').size;
    if (px) return pxToPt(px);
    const { $from } = editor.state.selection;
    const dom = editor.view.domAtPos($from.pos)?.node;
    const el = dom?.nodeType === 3 ? dom.parentElement : dom;
    return pxToPt(parseFloat(getComputedStyle(el || editor.view.dom).fontSize) || 17);
  };
  const applyPt = (pt) => {
    const v = Math.min(96, Math.max(6, Math.round(Number(pt) || 0)));
    if (!v) return;
    sizeInput.value = String(v);
    editor.chain().focus().setMark('textStyle', { size: ptToPx(v) }).run();
  };
  const showSize = () => { if (sizeInput && document.activeElement !== sizeInput) sizeInput.value = String(currentPt()); };
  editor.on('selectionUpdate', showSize);
  editor.on('transaction', showSize);
  let sizeList = null;
  const closeSizeList = () => { sizeList?.remove(); sizeList = null; };
  on(sizeInput, 'focus', () => {
    sizeInput.select();
    closeSizeList();
    sizeList = document.createElement('div');
    sizeList.className = 'pick-pop size-list';
    sizeList.setAttribute('role', 'listbox');
    sizeList.innerHTML = PT_SIZES.map((n) => `<button type="button" role="option" data-pt="${n}" ${String(n) === sizeInput.value ? 'aria-selected="true" class="active"' : ''}>${n}</button>`).join('');
    document.body.appendChild(sizeList);
    const r = sizeInput.getBoundingClientRect();
    sizeList.style.left = `${r.left}px`; sizeList.style.top = `${r.bottom + 4}px`;
    sizeList.addEventListener('mousedown', (e) => e.preventDefault());
    sizeList.addEventListener('click', (e) => { const b = e.target.closest('[data-pt]'); if (b) { closeSizeList(); applyPt(b.dataset.pt); } });
  });
  on(sizeInput, 'blur', () => setTimeout(closeSizeList, 120));
  on(sizeInput, 'keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); closeSizeList(); applyPt(sizeInput.value); }
    if (e.key === 'Escape') { e.preventDefault(); closeSizeList(); showSize(); editor.commands.focus(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); applyPt(currentPt() + (e.key === 'ArrowUp' ? 1 : -1)); }
  });
  on(toolbar, 'click', (e) => { const b = e.target.closest('[data-size-step]'); if (b) applyPt(currentPt() + Number(b.dataset.sizeStep)); });

  /* ----- Charts, shapes and dropdowns ----- */
  async function chartWithSnapshot(spec) {
    // A picture of the chart is kept for Word export.
    try { const blob = await chartPng(spec); if (blob) { const f = await store.uploadFile(blob, { noteId: id, name: 'chart.png' }); spec.snap = f.url; } } catch { /* the chart still works without it */ }
    return spec;
  }
  async function insertChart() {
    const spec = await openChartDialog();
    if (!spec) return;
    editor.chain().focus().insertContent([{ type: 'chart', attrs: { spec: JSON.stringify(await chartWithSnapshot(spec)) } }, { type: 'paragraph' }]).run();
  }
  on(host, 'chart-edit', async (e) => {
    if (!editable) return;
    const { pos, node } = e.detail;
    let old = {}; try { old = JSON.parse(node.attrs.spec); } catch { /* */ }
    const spec = await openChartDialog(old);
    if (!spec) return;
    const full = await chartWithSnapshot(spec);
    editor.chain().focus().command(({ tr }) => { const n = tr.doc.nodeAt(pos); if (n?.type.name === 'chart') tr.setNodeMarkup(pos, null, { spec: JSON.stringify(full) }); return true; }).run();
  });
  on(host, 'dd-click', (e) => {
    const { pos, node, dom } = e.detail;
    let data = { o: [], v: '' }; try { data = JSON.parse(node.attrs.data); } catch { /* */ }
    const write = (next) => editor.chain().command(({ tr }) => { const n = tr.doc.nodeAt(pos); if (n?.type.name === 'dropdown') tr.setNodeMarkup(pos, null, { data: JSON.stringify(next) }); return true; }).run();
    openDropdownPicker(dom, data, { editable, onPick: (v) => editable && write({ ...data, v }), onEdit: () => dropdownDialog(data).then((d) => d && write(d)) });
  });
  async function editShapes(pos = null, shapesJson = null) {
    let initial = [];
    try { initial = shapesJson ? JSON.parse(shapesJson) : []; } catch { initial = []; }
    const r = await openShapes(initial);
    if (!r?.blob) return;
    try {
      const f = await store.uploadFile(r.blob, { noteId: id, name: 'shapes.png' });
      const shapes = JSON.stringify(r.shapes);
      if (pos === null) editor.chain().focus().insertContent([{ type: 'image', attrs: { src: f.url, alt: 'shapes', shapes } }, { type: 'text', text: ' ' }]).run();
      else editor.chain().focus().command(({ tr }) => { const n = tr.doc.nodeAt(pos); if (n?.type.name === 'image') tr.setNodeMarkup(pos, null, { ...n.attrs, src: f.url, shapes }); return true; }).run();
    } catch (err) { toastError(err.message); }
  }

  /* ----- Embeds: select with a click on its title strip; a bar offers size, open, change and remove ----- */
  on(host, 'embed-click', (e) => {
    const { pos } = e.detail;
    editor.chain().setNodeSelection(pos).run();
  });
  // Pasting a supported link offers to embed it.
  on(host, 'paste', (e) => {
    const text = (e.clipboardData?.getData('text/plain') || '').trim();
    if (!editable || !/^\S+$/.test(text)) return;
    const d = detectEmbed(text);
    if (!d) return;
    const p = providerOf(d.k);
    setTimeout(() => toast(`${p.name} link pasted`, { duration: 8000, action: { label: p.live ? 'Embed instead' : 'Show as card', run: () => {
      // Remove the pasted link text, then add the embed below that paragraph.
      let found = null;
      editor.state.doc.descendants((n, pos) => { if (found || !n.isText) return; const i = n.text.indexOf(text); if (i >= 0) found = { from: pos + i, to: pos + i + text.length }; });
      const chain = editor.chain().focus();
      if (found) chain.deleteRange(found);
      chain.insertContent([{ type: 'embed', attrs: { data: JSON.stringify({ u: d.u, k: d.k, t: '', h: 0 }) } }, { type: 'paragraph' }]).run();
    } } }), 50);
  });

  /* ----- Files, images and drawings ----- */
  async function uploadAll(files, pos = null) {
    files = [...files].filter((f) => f.size > 0);
    if (!files.length || !editable) return;
    setState(`Uploading ${files.length === 1 ? files[0].name : `${files.length} files`}…`);
    let at = pos ?? editor.state.selection.from;
    for (const file of files) {
      try {
        const info = await store.uploadFile(file, { noteId: id });
        const isImage = /^image\/(png|jpe?g|gif|webp|avif)$/.test(info.mime);
        const node = isImage ? { type: 'image', attrs: { src: info.url, alt: info.name } } : { type: 'fileChip', attrs: { href: info.url, name: info.name } };
        editor.chain().focus().insertContentAt(at, [node, { type: 'text', text: ' ' }]).run();
        at = editor.state.selection.from;
      } catch (err) { toastError(`${file.name}: ${err.message}`); }
    }
    setState('Live');
  }
  on(picker, 'change', () => { uploadAll(picker.files); picker.value = ''; });
  async function drawNew() {
    const blob = await openDrawing();
    if (!blob) return;
    try {
      const info = await store.uploadFile(blob, { noteId: id, name: 'drawing.png' });
      editor.chain().focus().insertContent([{ type: 'image', attrs: { src: info.url, alt: 'drawing.png' } }, { type: 'text', text: ' ' }]).run();
    } catch (err) { toastError(err.message); }
  }

  updateToolbar();
  updateWords();
  return {
    editor,
    /** Page setup changed: lay the pages out again. */
    refreshPages: () => editor.view.dom.__repaginate?.(),
    toMarkdown: () => live.toMarkdown(),
    flush: () => {},
    destroy: () => {
      closePicker();
      closeSizeList();
      closeIssueCard();
      closeReview();
      checker?.destroy();
      cleanups.forEach((f) => f());
      [linkBar, imageBar, tableBar, embedBar].forEach((b) => b.remove());
      provider.awareness.off('change', drawPresence);
      live.destroy();
    },
  };
}
