// Page view: splits a document into real pages (like Google Docs), with margins,
// headers, footers and page numbers. Works on the reading view, the print view
// and (through decorations) the live editor.
import { normalizeSetup, pageMetrics, fillTokens } from '/shared/pages.mjs';
import { esc } from './util.js';

export { normalizeSetup, pageMetrics };
export const setupOf = (note) => normalizeSetup(note?.pageSetup, note?.pageSize);

const GAP_STRIP = 18; // grey space between sheets
const ATOMIC = 'table, pre, .code-wrap, .math-block, .toc, .toc-block, hr, figure, .page-break';
const SKIP = '[data-page-gap], [data-page-end], [data-page-head], .collaboration-cursor__caret, .ProseMirror-gapcursor, .ProseMirror-widget:not([data-page-gap])';
const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'TABLE', 'PRE', 'BLOCKQUOTE', 'HR', 'FIGURE', 'LABEL']);

/** Leaf blocks in reading order: text blocks (can split by line) and atomic blocks (move whole). */
function candidates(root) {
  const out = [];
  const walk = (el) => {
    for (const c of el.children) {
      if (c.matches(SKIP)) continue;
      if (c.matches(ATOMIC)) { out.push({ el: c, atomic: true }); continue; }
      // A paragraph that's only an image moves as a whole too.
      if (c.tagName === 'P' && c.querySelector('img') && !c.textContent.trim()) { out.push({ el: c, atomic: true }); continue; }
      const hasBlocks = [...c.children].some((k) => BLOCK_TAGS.has(k.tagName) && !k.matches(SKIP));
      if (hasBlocks) walk(c); else out.push({ el: c, atomic: false });
    }
  };
  walk(root);
  return out;
}

/* Characters of a text block in reading order (skipping equations and other non-text parts). */
function charsOf(el) {
  const nodes = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest(`${SKIP}, .katex, .math-inline, [contenteditable="false"]`) && n.parentElement !== el ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let n, total = 0;
  while ((n = w.nextNode())) { if (n.nodeValue.length) { nodes.push([n, total]); total += n.nodeValue.length; } }
  return { nodes, total };
}
function rectAt(chars, i) {
  // Find the text node holding character i, then measure that one character.
  let lo = 0, hi = chars.nodes.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (chars.nodes[mid][1] <= i) lo = mid; else hi = mid - 1; }
  const [node, base] = chars.nodes[lo];
  const r = document.createRange();
  r.setStart(node, i - base);
  r.setEnd(node, i - base + 1);
  const rects = r.getClientRects();
  const rect = rects[rects.length - 1];
  return rect && rect.height ? { rect, node, offset: i - base } : null;
}
// The nearest measurable character at or after i (collapsed spaces have no size).
function rectNear(chars, i, dir = 1) {
  for (let k = 0; k < 64 && i >= 0 && i < chars.total; k++, i += dir) { const r = rectAt(chars, i); if (r) return { ...r, i }; }
  return null;
}
/** The first line of el whose bottom passes `limit`: its top and where it starts. */
function lineCrossing(el, limit) {
  const chars = charsOf(el);
  if (!chars.total) return null;
  // First character whose bottom passes the limit.
  let lo = 0, hi = chars.total - 1, hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = rectNear(chars, mid);
    if (!m) { hi = mid - 1; continue; }
    if (m.rect.bottom > limit + 0.5) { hit = m.i; hi = mid - 1; } else lo = m.i + 1;
  }
  if (hit < 0) return null;
  const lineTop = rectNear(chars, hit).rect.top;
  // First character on that same line.
  lo = 0; hi = hit;
  let start = hit;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = rectNear(chars, mid);
    if (!m || m.i > hit) { hi = mid - 1; continue; }
    if (m.rect.top >= lineTop - 1) { start = m.i; hi = mid - 1; } else lo = m.i + 1;
  }
  const at = rectNear(chars, start);
  return at ? { node: at.node, offset: at.offset, top: lineTop } : null;
}


/** Break before a block; for the first block of a list item, break before the whole item (keeps the bullet with its text). */
function before(el, r) {
  let target = el;
  while (target.parentElement?.tagName === 'LI' && [...target.parentElement.children].find((k) => !k.matches(SKIP)) === target) target = target.parentElement;
  return { kind: 'before', el: target, y: target === el ? r.top : target.getBoundingClientRect().top };
}

/**
 * Where must the next page start? Coordinates are viewport pixels.
 * Returns { kind: 'before' | 'after' | 'text', el?, node?, offset?, y } or null when everything fits.
 */
export function findBreak(root, pageTop, limit) {
  for (const { el, atomic } of candidates(root)) {
    const r = el.getBoundingClientRect();
    if (r.height === 0 && !el.matches('.page-break')) continue;
    if (r.bottom <= pageTop + 0.5) continue; // on an earlier page
    if (el.matches('.page-break')) return { kind: 'after', el, y: r.bottom };
    if (r.bottom <= limit + 0.5) continue; // fits
    const startsAtTop = r.top <= pageTop + 1;
    if (r.top >= limit - 0.5 || atomic) return startsAtTop ? { kind: 'after', el, y: r.bottom } : before(el, r);
    // A text block crossing the bottom margin: start the next page at the line that crosses it.
    // (Measured from the text itself, so it works off screen and on hidden copies.)
    const line = lineCrossing(el, limit);
    if (!line || line.top <= r.top + 2) return startsAtTop ? { kind: 'after', el, y: r.bottom } : before(el, r);
    if (line.top <= pageTop + 1) return { kind: 'after', el, y: r.bottom }; // a single line taller than a page
    return { kind: 'text', node: line.node, offset: line.offset, y: line.top };
  }
  return null;
}

/* ---------- Header / footer lines ---------- */
export function hfLine(kind, setup, vals, editable) {
  const conf = setup[kind];
  const slots = { left: [], center: [], right: [] };
  if (conf.text) slots[conf.align].push(`<span class="hf-text" style="font-size:${conf.size}pt;${conf.bold ? 'font-weight:700;' : ''}${conf.italic ? 'font-style:italic;' : ''}">${esc(fillTokens(conf.text, vals))}</span>`);
  if (setup.pageNumbers.place === kind) slots[setup.pageNumbers.align].push(`<span class="hf-num" style="font-size:${conf.size}pt">${setup.pageNumbers.format === 'n-of-m' ? `Page ${vals.page} of ${vals.pages}` : vals.page}</span>`);
  const empty = !slots.left.length && !slots.center.length && !slots.right.length;
  return `<div class="hf hf-${kind} ${empty ? 'hf-empty' : ''}" data-hf="${kind}" ${editable ? `title="Click to edit the ${kind}" role="button" tabindex="0"` : ''}>
    ${['left', 'center', 'right'].map((a) => `<span class="hf-slot hf-${a}">${slots[a].join(' · ')}</span>`).join('')}
    ${empty && editable ? `<span class="hf-placeholder">Click to add a ${kind}</span>` : ''}
  </div>`;
}
export const showHF = (setup, page) => !(setup.differentFirst && page === 1);

/** The space between two pages: rest of page k + its footer, the grey strip, page k+1's top margin + header. */
export function gapHtml({ setup, m, rest, page, vals, editable }) {
  return `<span class="pg-bottom" style="height:${Math.max(0, rest) + m.bottom}px">
      <span class="pg-foot" style="bottom:${m.footerAt}px">${showHF(setup, page) ? hfLine('footer', setup, { ...vals, page }, editable) : ''}</span>
    </span>
    <span class="pg-strip" style="height:${GAP_STRIP}px"></span>
    <span class="pg-top" style="height:${m.top}px">
      <span class="pg-head" style="top:${m.headerAt}px">${hfLine('header', setup, { ...vals, page: page + 1 }, editable)}</span>
    </span>`;
}
export const gapHeight = (m, rest) => Math.max(0, rest) + m.bottom + GAP_STRIP + m.top;
export function headHtml({ setup, m, vals, editable }) {
  return `<span class="pg-head" style="top:${m.headerAt}px">${showHF(setup, 1) ? hfLine('header', setup, { ...vals, page: 1 }, editable) : ''}</span>`;
}
export function endHtml({ setup, m, rest, page, vals, editable }) {
  return `<span class="pg-bottom pg-last" style="height:${Math.max(0, rest) + m.bottom}px">
    <span class="pg-foot" style="bottom:${m.footerAt}px">${showHF(setup, page) ? hfLine('footer', setup, { ...vals, page }, editable) : ''}</span>
  </span>`;
}

/** Style a container as a page (width, margins, paper colour). */
export function stylePage(el, setup, m) {
  el.classList.add('paged');
  el.style.setProperty('--pg-width', `${m.width}px`);
  el.style.setProperty('--pg-top', `${m.top}px`);
  el.style.setProperty('--pg-left', `${m.left}px`);
  el.style.setProperty('--pg-right', `${m.right}px`);
  el.style.setProperty('--pg-color', setup.color);
}
export function unstylePage(el) {
  el.classList.remove('paged');
  ['--pg-width', '--pg-top', '--pg-left', '--pg-right', '--pg-color'].forEach((p) => el.style.removeProperty(p));
}

const make = (tag, cls, attr, html, height) => {
  const e = document.createElement(tag);
  e.className = cls;
  e.setAttribute(attr, '1');
  e.contentEditable = 'false';
  if (height !== undefined) e.style.height = `${height}px`;
  e.innerHTML = html;
  return e;
};

/** Paginate a static (reading / print) view in place. Returns the number of pages. */
export function paginateDom(root, setup, { title = '', editable = false } = {}) {
  root.querySelectorAll('[data-page-gap], [data-page-end], [data-page-head]').forEach((e) => {
    const parent = e.parentNode; e.remove(); parent?.normalize?.();
  });
  const m = pageMetrics(setup);
  stylePage(root, setup, m);
  const vals = { title, date: new Date().toLocaleDateString(), pages: '…' };
  const head = make('div', 'page-head', 'data-page-head', '', m.top);
  root.prepend(head);
  const gaps = [];
  let pageTop = head.getBoundingClientRect().bottom;
  for (let guard = 0; guard < 400; guard++) {
    const b = findBreak(root, pageTop, pageTop + m.body);
    if (!b) break;
    const rest = pageTop + m.body - b.y;
    const gap = make(b.kind === 'text' ? 'span' : 'div', 'page-gap', 'data-page-gap', '', gapHeight(m, rest));
    gap.dataset.rest = String(rest);
    if (b.kind === 'text') {
      const after = b.node.splitText(b.offset);
      after.parentNode.insertBefore(gap, after);
    } else if (b.kind === 'before') b.el.before(gap);
    else b.el.after(gap);
    const realRest = pageTop + m.body - gap.getBoundingClientRect().top;
    gap.dataset.rest = String(realRest);
    gap.style.height = `${gapHeight(m, realRest)}px`;
    gaps.push(gap);
    pageTop = gap.getBoundingClientRect().bottom;
  }
  // Fill the last page down to its bottom edge.
  const contentBottom = Math.max(pageTop, ...[...root.children].filter((c) => !c.matches('[data-page-end]')).map((c) => c.getBoundingClientRect().bottom));
  const pages = gaps.length + 1;
  vals.pages = pages;
  head.innerHTML = headHtml({ setup, m, vals, editable });
  gaps.forEach((g, i) => { g.innerHTML = gapHtml({ setup, m, rest: Number(g.dataset.rest), page: i + 1, vals, editable }); });
  root.append(make('div', 'page-end', 'data-page-end', endHtml({ setup, m, rest: pageTop + m.body - contentBottom, page: pages, vals, editable })));
  return pages;
}

/* ---------- Editor support: measure on an off-screen copy, report break positions ---------- */
const skipNode = (n) => n.nodeType === 1 && n.matches(SKIP);
const kids = (el) => [...el.childNodes].filter((n) => !skipNode(n) && (n.nodeType === 1 || n.nodeType === 3));
function pathOf(root, node) {
  const path = [];
  for (let n = node; n && n !== root; n = n.parentNode) path.unshift(kids(n.parentNode).indexOf(n));
  return path;
}
export function nodeAtPath(root, path) {
  let n = root;
  for (const i of path) { n = n && kids(n)[i]; }
  return n || null;
}

/**
 * Work out where pages break for a live editor without touching it: paginate an off-screen
 * copy and describe each break as a path into the editor's DOM (plus a text offset).
 */
export function computeBreaks(root, setup) {
  const m = pageMetrics(setup);
  const clone = root.cloneNode(true);
  clone.querySelectorAll(SKIP).forEach((e) => e.remove());
  clone.removeAttribute('contenteditable');
  clone.setAttribute('aria-hidden', 'true');
  Object.assign(clone.style, { position: 'absolute', left: '-30000px', top: '0', visibility: 'hidden', pointerEvents: 'none' });
  root.parentNode.appendChild(clone);
  stylePage(clone, setup, m);
  // Remember every node's original path and text offset (splitting text changes the tree).
  const info = new Map();
  const walk = (el) => { for (const n of kids(el)) { info.set(n, { path: pathOf(clone, n), base: 0 }); if (n.nodeType === 1) walk(n); } };
  walk(clone);
  const head = make('div', 'page-head', 'data-page-head', '', m.top);
  clone.prepend(head);
  const breaks = [];
  let pageTop = head.getBoundingClientRect().bottom;
  for (let guard = 0; guard < 400; guard++) {
    const b = findBreak(clone, pageTop, pageTop + m.body);
    if (!b) break;
    const rest = pageTop + m.body - b.y;
    const gap = make(b.kind === 'text' ? 'span' : 'div', 'page-gap', 'data-page-gap', '', gapHeight(m, rest));
    if (b.kind === 'text') {
      const meta = info.get(b.node) || { path: pathOf(clone, b.node), base: 0 };
      breaks.push({ kind: 'text', path: meta.path, offset: meta.base + b.offset, rest });
      const after = b.node.splitText(b.offset);
      info.set(after, { path: meta.path, base: meta.base + b.offset });
      after.parentNode.insertBefore(gap, after);
    } else {
      const meta = info.get(b.el) || { path: pathOf(clone, b.el) };
      breaks.push({ kind: b.kind, path: meta.path, rest });
      if (b.kind === 'before') b.el.before(gap); else b.el.after(gap);
    }
    // Measure where this gap really starts (paragraph spacing can move it) so pages are exact.
    const realRest = pageTop + m.body - gap.getBoundingClientRect().top;
    breaks[breaks.length - 1].rest = realRest;
    gap.style.height = `${gapHeight(m, realRest)}px`;
    pageTop = gap.getBoundingClientRect().bottom;
  }
  const last = [...clone.children].filter((c) => !c.matches('[data-page-gap], [data-page-head]')).pop();
  const endRest = pageTop + m.body - (last ? Math.max(last.getBoundingClientRect().bottom, pageTop) : pageTop);
  clone.remove();
  return { breaks, pages: breaks.length + 1, endRest, m };
}


/**
 * Printing: turn a paginated view into separate sheets. Each page becomes its own box exactly
 * one sheet of paper in size (with its text area, header and footer), so small differences
 * between screen and print layout can't make text drift or spill onto the next page.
 */
export function splitIntoSheets(prose, setup, { title = '' } = {}) {
  const m = pageMetrics(setup);
  const mg = setup.margins;
  prose.querySelector('[data-page-head]')?.remove();
  prose.querySelector('[data-page-end]')?.remove();
  const fragments = [];
  for (const gap of [...prose.querySelectorAll('[data-page-gap]')]) {
    const r = document.createRange();
    r.setStart(prose, 0);
    r.setEndBefore(gap);
    fragments.push(r.extractContents()); // splits paragraphs that continue onto the next page
    gap.remove();
  }
  const rest = document.createRange();
  rest.selectNodeContents(prose);
  fragments.push(rest.extractContents());
  const pages = fragments.length;
  const vals = { title, date: new Date().toLocaleDateString(), pages };
  const sheets = document.createElement('div');
  sheets.className = 'print-sheets';
  fragments.forEach((frag, i) => {
    const page = i + 1;
    const sheet = document.createElement('section');
    sheet.className = 'print-sheet-page';
    sheet.style.cssText = `width:${m.wIn}in;height:${m.hIn}in;`;
    const body = document.createElement('div');
    body.className = `${prose.className.replace(/\bpaged\b/, '')} print-body`;
    body.style.cssText = `top:${mg.top}in;left:${mg.left}in;width:${m.wIn - mg.left - mg.right}in;height:${m.hIn - mg.top - mg.bottom}in;`;
    body.appendChild(frag);
    // Spacing that belonged to the previous page shouldn't push the first line down.
    const first = body.firstElementChild;
    if (first) first.style.marginTop = '0';
    sheet.appendChild(body);
    const hfVals = { ...vals, page };
    if (showHF(setup, page)) {
      sheet.insertAdjacentHTML('beforeend', `<div class="print-hf print-head" style="top:${setup.headerMargin}in;left:${mg.left}in;right:${mg.right}in">${hfLine('header', setup, hfVals, false)}</div>`);
      sheet.insertAdjacentHTML('beforeend', `<div class="print-hf print-foot" style="bottom:${setup.footerMargin}in;left:${mg.left}in;right:${mg.right}in">${hfLine('footer', setup, hfVals, false)}</div>`);
    }
    sheets.appendChild(sheet);
  });
  return sheets;
}
