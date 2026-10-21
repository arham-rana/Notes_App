// Export (Markdown, Word), print / PDF, and page setup for a document.
import { esc } from './util.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { openModal, toast } from './ui.js';
import { noteBodyHtml } from './note-view.js';
import { headingsOf, decData } from './markdown.js';
import { setupOf, normalizeSetup, pageMetrics, paginateDom, splitIntoSheets } from './paginate.js';
import { signatureSync, signatureFor } from './signatures.js';

const fileName = (note, ext) => `${(note.title || 'Document').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Document'}.${ext}`;
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** This app's format -> standard Markdown that other apps understand. */
export function toStandardMarkdown(note) {
  const origin = location.origin;
  const heads = headingsOf(note.content);
  const out = [];
  let style = String(note.content || '');
  // Styled text keeps its words (fonts and colours aren't part of Markdown).
  for (let i = 0; i < 6 && /\{\{[a-z0-9:,]+\|/.test(style); i++) style = style.replace(/\{\{[a-z0-9:,]+\|((?:(?!\{\{)[\s\S])*?)\}\}/g, '$1');
  style = style
    .replace(/^\{:[a-z0-9.,]+\}\s?/gm, '')
    .replace(/\+\+(?=\S)([^+\n]*?\S)\+\+/g, '<u>$1</u>')
    .replace(/\^\^(?=\S)([^^\n]*?\S)\^\^/g, '<sup>$1</sup>')
    .replace(/,,(?=\S)([^,\n]*?\S),,/g, '<sub>$1</sub>')
    .replace(/\]\((\/api\/files\/[0-9a-f-]{36})\)(\{w=\d+\})?/g, `](${origin}$1)`)
    .replace(/\]\((#\/documents\/[0-9a-f-]{36})\)/g, `](${origin}/$1)`)
    .replace(/^\[\[pagebreak\]\]$/gm, '<div style="page-break-after: always"></div>')
    .replace(/^\[\[embed:([A-Za-z0-9_-]+)\]\]$/gm, (m, t) => { const d = decData(t); return d?.u ? `[${d.t || 'Embedded app'}](${d.u})` : ''; })
    // Dropdowns become their chosen value, charts a short note, signatures who signed.
    .replace(/\[\[dd:([A-Za-z0-9_-]+)\]\]/g, (m, t) => { const d = decData(t); return d?.v ? `**${d.v}**` : ''; })
    .replace(/^\[\[chart:([A-Za-z0-9_-]+)\]\]$/gm, (m, t) => { const c = decData(t); return c ? `*Chart: ${c.title || 'untitled'}*${c.labels?.length && c.series?.length ? `\n\n| | ${c.series.map((x) => x.n).join(' | ')} |\n| --- | ${c.series.map(() => '---').join(' | ')} |\n${c.labels.map((l, j) => `| ${l} | ${c.series.map((x) => x.v?.[j] ?? '').join(' | ')} |`).join('\n')}` : ''}` : ''; })
    .replace(/^\[\[signature:([0-9a-f-]{36})\]\]$/gm, (m, id) => { const sg = signatureFor(note.id, id); return sg?.status === 'signed' ? `*Signed by ${sg.signedName} on ${new Date(sg.signedAt).toLocaleDateString()}*` : '*Signature needed*'; })
    .replace(/(\{w=\d{1,3}\})?\{d=[A-Za-z0-9_-]+\}/g, '')
    .replace(/^\[\[toc\]\]$/gm, () => `**Contents**\n\n${heads.map((h) => `${h.level === 3 ? '  ' : ''}- ${h.text}`).join('\n')}`)
    .replace(/^(#{1,3}) /gm, (m, h) => `${h.length === 3 ? '###' : '##'} `)
    .replace(/^\$\$(.+)\$\$$/gm, '$$$$\n$1\n$$$$')
    .replace(/^> 💡\s?/gm, '> ');
  out.push(style);
  return `${out.join('\n')}\n`;
}

export function downloadMarkdown(note) {
  download(new Blob([toStandardMarkdown(note)], { type: 'text/markdown;charset=utf-8' }), fileName(note, 'md'));
  toast('Markdown file downloaded');
}

export async function downloadWord(note) {
  toast('Preparing the Word document…');
  try {
    const res = await fetch(`/api/notes/${note.id}/export.docx`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Couldn’t create the Word document');
    download(await res.blob(), fileName(note, 'docx'));
    toast('Word document downloaded');
  } catch (err) { toast(err.message, { tone: 'error' }); }
}

/** Print (or save as PDF): a clean copy of the document, without the app around it. */
export function printDoc(note, { pdf = false } = {}) {
  document.getElementById('print-root')?.remove();
  document.getElementById('print-page-style')?.remove();
  // Every printout is real pages with the margins built in (no room for the browser's own
  // date, title and web address), and only the document's content.
  const setup = note.layout === 'pages' ? setupOf(note) : normalizeSetup({}, note.pageSize);
  const m = pageMetrics(setup);
  const root = document.createElement('div');
  root.id = 'print-root';
  root.className = 'measuring';
  document.body.append(root);
  const build = () => {
    root.innerHTML = `<article class="note-detail doc-sheet print-pages">${noteBodyHtml(note)}</article>`;
    root.querySelector('.doc-head')?.remove(); // no title, "Last edited" or word count
    root.querySelectorAll('.task-remind, .code-copy, [data-action="filter-tag"]').forEach((el) => el.remove());
    signatureSync(root, note.id);
    root.querySelectorAll('.sig-sign').forEach((b) => b.replaceWith(Object.assign(document.createElement('span'), { className: 'sig-wait', textContent: 'Signature needed' })));
    const prose = root.querySelector('.prose');
    paginateDom(prose, setup, { title: note.title || 'Untitled' }); // work out the page breaks
    const sheets = splitIntoSheets(prose, setup, { title: note.title || 'Untitled' }); // one box per sheet
    root.querySelector('.print-pages').replaceChildren(sheets);
  };
  const style = document.createElement('style');
  style.id = 'print-page-style';
  style.textContent = `@page { size: ${m.wIn}in ${m.hIn}in; margin: 0; }`;
  document.head.append(style);
  const done = () => { document.body.classList.remove('printing'); root.remove(); style.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  if (pdf) toast('In the print window, choose “Save as PDF”.', { duration: 7000 });
  // Lay out once images have loaded (they change the page breaks).
  root.innerHTML = `<article class="note-detail doc-sheet print-pages">${noteBodyHtml(note)}</article>`;
  const imgs = [...root.querySelectorAll('img')].filter((i) => !i.complete);
  Promise.race([Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))), new Promise((r) => setTimeout(r, 2500))])
    .then(() => { build(); document.body.classList.add('printing'); setTimeout(() => window.print(), 50); });
}

const PAPERS = { letter: 'Letter (8.5 × 11 in)', legal: 'Legal (8.5 × 14 in)', tabloid: 'Tabloid (11 × 17 in)', a4: 'A4 (210 × 297 mm)', a5: 'A5 (148 × 210 mm)' };
const PAGE_COLORS = { '#ffffff': 'White', '#fbf6e9': 'Cream', '#f3f4f6': 'Light grey', '#eef4fb': 'Light blue', '#eef7f0': 'Light green' };

/** Page setup, modelled on Google Docs (File → Page setup). */
export function pageSetup(note) {
  const s = setupOf(note);
  const num = (name, v, min, max) => `<input type="number" name="${name}" value="${v}" min="${min}" max="${max}" step="0.05" inputmode="decimal">`;
  openModal({
    title: 'Page setup',
    body: `<form class="form page-setup" id="page-form" novalidate>
      <div class="page-choice">
        <label class="page-opt"><input type="radio" name="layout" value="pages" ${note.layout === 'pages' ? 'checked' : ''}><span>${icon('pages', { size: 22 })}<b>Pages</b><small>Separate pages with margins, headers and footers</small></span></label>
        <label class="page-opt"><input type="radio" name="layout" value="pageless" ${note.layout !== 'pages' ? 'checked' : ''}><span>${icon('file', { size: 22 })}<b>Pageless</b><small>One continuous page that fits the window</small></span></label>
      </div>
      <div class="ps-grid">
        <fieldset class="ps-group"><legend>Orientation</legend>
          <div class="segmented"><label><input type="radio" name="orientation" value="portrait" ${s.orientation === 'portrait' ? 'checked' : ''}><span>Portrait</span></label><label><input type="radio" name="orientation" value="landscape" ${s.orientation === 'landscape' ? 'checked' : ''}><span>Landscape</span></label></div>
        </fieldset>
        <label class="field"><span>Paper size</span><select name="size">${Object.entries(PAPERS).map(([k, l]) => `<option value="${k}" ${s.size === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <fieldset class="ps-group"><legend>Margins (inches)</legend>
        <div class="ps-margins">
          <label>Top ${num('top', s.margins.top, 0.25, 3)}</label><label>Bottom ${num('bottom', s.margins.bottom, 0.25, 3)}</label>
          <label>Left ${num('left', s.margins.left, 0.25, 3)}</label><label>Right ${num('right', s.margins.right, 0.25, 3)}</label>
        </div>
      </fieldset>
      <fieldset class="ps-group"><legend>Header and footer</legend>
        <div class="ps-margins">
          <label>Header from top ${num('headerMargin', s.headerMargin, 0.2, 2)}</label><label>Footer from bottom ${num('footerMargin', s.footerMargin, 0.2, 2)}</label>
        </div>
        <label class="check-line"><input type="checkbox" name="differentFirst" ${s.differentFirst ? 'checked' : ''}> Different first page (no header or footer on page 1)</label>
        <p class="muted small">Click a page’s header or footer area to write in it.</p>
      </fieldset>
      <fieldset class="ps-group"><legend>Page numbers</legend>
        <div class="ps-row">
          <select name="pnPlace" aria-label="Where"><option value="none" ${s.pageNumbers.place === 'none' ? 'selected' : ''}>None</option><option value="header" ${s.pageNumbers.place === 'header' ? 'selected' : ''}>In the header</option><option value="footer" ${s.pageNumbers.place === 'footer' ? 'selected' : ''}>In the footer</option></select>
          <select name="pnAlign" aria-label="Alignment"><option value="left" ${s.pageNumbers.align === 'left' ? 'selected' : ''}>Left</option><option value="center" ${s.pageNumbers.align === 'center' ? 'selected' : ''}>Centre</option><option value="right" ${s.pageNumbers.align === 'right' ? 'selected' : ''}>Right</option></select>
          <select name="pnFormat" aria-label="Format"><option value="n" ${s.pageNumbers.format === 'n' ? 'selected' : ''}>3</option><option value="n-of-m" ${s.pageNumbers.format === 'n-of-m' ? 'selected' : ''}>Page 3 of 10</option></select>
        </div>
      </fieldset>
      <p class="muted small">Applies to everyone who opens this document, and to printing, PDF and Word.</p>
    </form>`,
    footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="page-form">Apply</button>',
    onMount: (el, close) => {
      el.querySelector('#page-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const f = e.target.elements;
        const next = normalizeSetup({
          ...s, size: f.size.value, orientation: f.orientation.value,
          margins: { top: f.top.value, bottom: f.bottom.value, left: f.left.value, right: f.right.value },
          headerMargin: f.headerMargin.value, footerMargin: f.footerMargin.value, differentFirst: f.differentFirst.checked,
          pageNumbers: { place: f.pnPlace.value, align: f.pnAlign.value, format: f.pnFormat.value },
        });
        close();
        store.update('notes', note.id, { layout: f.layout.value, pageSize: next.size, pageSetup: JSON.stringify(next) }).catch(() => {});
      });
    },
  });
}

/** Edit a header or footer in place (opened by clicking it on a page). */
let hfPop = null;
export function closeHeaderFooter() { hfPop?.remove(); hfPop = null; }
export function editHeaderFooter(note, kind, anchor) {
  closeHeaderFooter();
  const s = setupOf(note);
  const c = s[kind];
  const pop = document.createElement('form');
  pop.className = 'hf-editor';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', kind === 'header' ? 'Edit header' : 'Edit footer');
  pop.noValidate = true;
  pop.innerHTML = `
    <div class="hf-ed-title">${kind === 'header' ? 'Header' : 'Footer'}</div>
    <input name="text" class="hf-ed-input" value="${esc(c.text)}" maxlength="300" placeholder="${kind === 'header' ? 'e.g. Project brief' : 'e.g. Confidential'}" aria-label="${kind} text">
    <div class="hf-ed-tools">
      <label class="hf-tog" title="Bold"><input type="checkbox" name="bold" ${c.bold ? 'checked' : ''}><b>B</b></label>
      <label class="hf-tog" title="Italic"><input type="checkbox" name="italic" ${c.italic ? 'checked' : ''}><i>I</i></label>
      <select name="size" aria-label="Size">${[8, 9, 10, 11, 12, 14, 16].map((n) => `<option value="${n}" ${c.size === n ? 'selected' : ''}>${n} pt</option>`).join('')}</select>
      <div class="segmented hf-align">${[['left', 'alignLeft'], ['center', 'alignCenter'], ['right', 'alignRight']].map(([a, ic]) => `<label title="${a}"><input type="radio" name="align" value="${a}" ${c.align === a ? 'checked' : ''}><span>${icon(ic, { size: 15 })}</span></label>`).join('')}</div>
    </div>
    <div class="hf-ed-insert"><span class="muted small">Insert:</span>${[['{page}', 'Page number'], ['{pages}', 'Page count'], ['{title}', 'Title'], ['{date}', 'Date']].map(([t, l]) => `<button type="button" class="chip-btn" data-token="${t}">${l}</button>`).join('')}</div>
    <div class="hf-ed-actions">${c.text ? '<button type="button" class="btn btn-ghost-danger btn-sm" data-clear>Remove</button>' : ''}<span class="spacer"></span><button type="button" class="btn btn-ghost btn-sm" data-cancel>Cancel</button><button type="submit" class="btn btn-primary btn-sm">Save</button></div>`;
  document.body.appendChild(pop);
  hfPop = pop;
  const r = anchor.getBoundingClientRect();
  const top = kind === 'header' ? r.bottom + 6 : r.top - pop.offsetHeight - 6;
  pop.style.top = `${Math.max(8, Math.min(top, window.innerHeight - pop.offsetHeight - 8))}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - pop.offsetWidth / 2, window.innerWidth - pop.offsetWidth - 8))}px`;
  const input = pop.elements.text;
  input.focus();
  pop.addEventListener('mousedown', (e) => { if (e.target.closest('[data-token]')) e.preventDefault(); });
  pop.addEventListener('click', (e) => {
    const t = e.target.closest('[data-token]');
    if (t) { const a = input.selectionStart ?? input.value.length; input.setRangeText(t.dataset.token, a, input.selectionEnd ?? a, 'end'); input.focus(); }
    if (e.target.closest('[data-cancel]')) closeHeaderFooter();
    if (e.target.closest('[data-clear]')) { input.value = ''; pop.requestSubmit(); }
  });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeHeaderFooter(); } });
  pop.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = pop.elements;
    const next = normalizeSetup({ ...s, [kind]: { text: f.text.value, bold: f.bold.checked, italic: f.italic.checked, size: f.size.value, align: f.align.value } });
    closeHeaderFooter();
    store.update('notes', note.id, { pageSetup: JSON.stringify(next) }).then(() => toast(`${kind === 'header' ? 'Header' : 'Footer'} saved`)).catch(() => {});
  });
  setTimeout(() => document.addEventListener('mousedown', function outside(ev) {
    if (!hfPop || hfPop.contains(ev.target)) return;
    closeHeaderFooter(); document.removeEventListener('mousedown', outside, true);
  }, true));
}
