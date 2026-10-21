import { esc } from './util.js';
import { icon } from './icons.js';
import { renderMath } from '/js/vendor/collab.js';
import { chartSvg } from './charts.js';
import { embedHtml } from './embeds.js';
import { highlightHtml, detectLang, LANG_NAMES } from './codehl.js';

/** base64url JSON (dropdowns, charts). */
export function decData(str) { try { const b = String(str).replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)))); } catch { return null; } }
export function encData(obj) { const bytes = new TextEncoder().encode(JSON.stringify(obj)); let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export const DD_COLORS = { gray: 'Grey', red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple', pink: 'Pink' };
export function dropdownChip(d, token = '') {
  const opt = (d.o || []).find((o) => o.l === d.v);
  return `<span class="dd-chip dd-${opt?.c || 'none'}" data-dd="${token}" role="button" tabindex="0" title="Choose an option">${esc(d.v || 'Choose…')}<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg></span>`;
}
import { parseSpec, styleSpanOpen } from './doc-styles.js';

// {{font:serif,size:20,hl:yellow|text}} styles a run of text; these can nest.
const STYLE_TOKEN = /\{\{([a-z0-9:,]+)\|((?:(?!\{\{)[\s\S])*?)\}\}/g;

function inline(text) {
  // Inline equations: typeset first, then keep them out of the way of other formatting.
  const maths = [];
  text = String(text).replace(/(^|[^\\$\w])\$(?=\S)([^$\n]*?\S)\$(?!\d)/g, (m, pre, tex) => { maths.push(tex); return `${pre}\u0001${maths.length - 1}\u0001`; });
  const html = inlineBase(text);
  return maths.length ? html.replace(/\u0001(\d+)\u0001/g, (m, i) => `<span class="math-inline" data-latex="${esc(maths[+i])}">${renderMath(maths[+i], false)}</span>`) : html;
}
function inlineBase(text) {
  let s = esc(text);
  // Images and attached files (stored on this server), before ordinary links.
  // An optional {w=60} after an image sets its width as a percentage of the text column.
  // Dropdown chips (data is base64url JSON; the token is kept so a change can be written back).
  s = s.replace(/\[\[dd:([A-Za-z0-9_-]+)\]\]/g, (m, tok) => { const d = decData(tok); return d ? dropdownChip(d, tok) : ''; });
  s = s.replace(/(\{w=\d{1,3}\})?\{d=[A-Za-z0-9_-]+\}/g, (m, w) => w || ''); // drawings: the editable shapes aren't shown
  s = s.replace(/!\[([^\]]*)\]\((\/api\/files\/[0-9a-f-]{36}|https:\/\/[^\s)]+)\)(?:\{w=(\d{1,3})\})?/g, (m, alt, src, w) =>
    `<img class="doc-img" src="${src}" alt="${alt}" loading="lazy"${w && +w < 100 ? ` style="width:${Math.max(10, +w)}%"` : ''}>`);
  s = s.replace(/\[([^\]]+)\]\((\/api\/files\/[0-9a-f-]{36})\)/g, '<a class="file-chip" href="$2?download" data-file="$2">$1</a>');
  let before;
  do {
    before = s;
    s = s.replace(STYLE_TOKEN, (m, spec, inner) => {
      const st = parseSpec(spec);
      return Object.keys(st).length ? `${styleSpanOpen(st)}${inner}</span>` : inner;
    });
  } while (s !== before);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/\+\+(?=\S)([^+\n]*?\S)\+\+/g, '<u>$1</u>'); // ++underline++ (not "C++ and C++")
  s = s.replace(/~~(?=\S)([^~\n]*?\S)~~/g, '<s>$1</s>'); // ~~strikethrough~~
  s = s.replace(/\^\^(?=\S)([^^\n]*?\S)\^\^/g, '<sup>$1</sup>'); // ^^superscript^^
  s = s.replace(/,,(?=\S)([^,\n]*?\S),,/g, '<sub>$1</sub>'); // ,,subscript,,
  // @mentions (not email addresses)
  s = s.replace(/(^|[\s(>])@([a-z0-9._-]{3,30}[a-z0-9_-])/gi, '$1<span class="mention">@$2</span>');
  s = s.replace(/\[([^\]]+)\]\(#\/documents\/([0-9a-f-]{36})\)/g, '<a class="doc-link" href="#/documents/$2" data-doclink="$2">$1</a>');
  s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

const TASK = /^\s*[-*] \[( |x|X)\] (.*)$/;
const BULLET = /^\s*[-*] (.*)$/;
const ORDERED = /^\s*(\d+)[.)] (.*)$/;

/* ---------- Code blocks ---------- */
export const CODE_LANGS = {
  text: 'Plain text', js: 'JavaScript', ts: 'TypeScript', python: 'Python', html: 'HTML', css: 'CSS', json: 'JSON',
  sql: 'SQL', shell: 'Shell', java: 'Java', c: 'C / C++', go: 'Go', rust: 'Rust', swift: 'Swift', php: 'PHP', ruby: 'Ruby',
};
const LANG_ALIASES = { plain: 'text', txt: 'text', plaintext: 'text', javascript: 'js', jsx: 'js', typescript: 'ts', tsx: 'ts', py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell', cpp: 'c', 'c++': 'c', rs: 'rust', rb: 'ruby', xml: 'html', yml: 'shell', yaml: 'shell' };
export const normaliseLang = (l) => { const k = String(l || '').toLowerCase(); const v = LANG_ALIASES[k] || k; return v in CODE_LANGS ? v : ''; };
const KEYWORDS = new Set(('abstract and as async await break case catch class const continue def default defer del do elif else enum export extends '
  + 'false fi final finally fn for from func function go if impl import in instanceof interface is lambda let match mod mut namespace new nil '
  + 'none None not null or package pass print private protected pub public raise return self static struct super switch then this throw '
  + 'true True False try type typeof undefined use var void when where while with yield echo done select from where insert into update '
  + 'delete create table join on group by order limit values set').split(' '));

/** Code colouring for reading mode (shared with the editor). */
const highlightCode = (code, lang) => highlightHtml(code, lang);

/* ---------- Paragraph settings: {:center,i2,lh1.5,sa2} at the start of a line ---------- */
const ATTR_PREFIX = /^\{:([a-z0-9.,]+)\}\s?/;
export const LINE_HEIGHTS = { '1': 1.2, '1.15': 1.4, '1.5': 1.8, '2': 2.4 };
export const SPACE_AFTER = { '0': 0, '1': 6, '2': 16, '3': 28 };

export function parseAttrs(spec) {
  const a = {};
  for (const part of String(spec).split(',')) {
    if (['left', 'center', 'right', 'justify'].includes(part)) { if (part !== 'left') a.align = part; }
    else if (/^i[1-4]$/.test(part)) a.indent = Number(part.slice(1));
    else if (/^lh(1|1\.15|1\.5|2)$/.test(part)) a.lh = part.slice(2);
    else if (/^sa[0-3]$/.test(part)) a.sa = part.slice(2);
  }
  return a;
}

/** style="" plus data-* so the editor can read the settings back. */
export function attrHtml(a, { list = false } = {}) {
  if (!a || !Object.keys(a).length) return '';
  const css = [];
  if (a.align) css.push(`text-align:${a.align}`);
  if (a.indent) css.push(`margin-left:${a.indent * (list ? 1.6 : 2)}em`);
  if (a.lh) css.push(`line-height:${LINE_HEIGHTS[a.lh]}`);
  if (a.sa !== undefined) css.push(`margin-bottom:${SPACE_AFTER[a.sa]}px`);
  const data = [a.align && `data-align="${a.align}"`, a.indent && `data-indent="${a.indent}"`, a.lh && `data-lh="${a.lh}"`, a.sa !== undefined && `data-sa="${a.sa}"`].filter(Boolean).join(' ');
  return ` ${data}${css.length ? ` style="${css.join(';')}"` : ''}`;
}
const stripAttrs = (line) => line.replace(ATTR_PREFIX, '');

/** "| a | b \\| c |" -> ["a", "b | c"] */
function splitRow(line) {
  const t = line.trim().slice(1, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && t[i + 1] === '|') { cur += '|'; i++; }
    else if (t[i] === '|') { cells.push(cur.trim()); cur = ''; }
    else cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
}

const stripStyles = (t) => t.replace(/\{\{[a-z0-9:,]+\|/g, '').replace(/\}\}/g, '').replace(/~~|\^\^|,,/g, '');
const plainHeading = (t) => stripStyles(t).replace(/[*`]/g, '');

function tocItems(blocks) {
  return blocks.filter((b) => b.type === 'h2' || b.type === 'h3')
    .map((b, i) => `<li class="toc-${b.type}"><a href="#" class="toc-link" data-h="${i}">${esc(plainHeading(b.text))}</a></li>`).join('');
}

function tableHtml(b, editable) {
  const width = Math.max(...b.rows.map((r) => r.length));
  const cells = (r, tag) => Array.from({ length: width }, (_, i) => `<${tag}>${inline(r[i] || '') || (editable ? '<br>' : '')}</${tag}>`).join('');
  const [head, ...body] = b.rows;
  const table = `<table class="doc-table"><thead><tr>${cells(head, 'th')}</tr></thead><tbody>${body.map((r) => `<tr>${cells(r, 'td')}</tr>`).join('')}</tbody></table>`;
  return editable ? table : `<div class="table-wrap">${table}</div>`;
}

/** Split note text into blocks shared by the reader and the editor. */
export function parseNote(source) {
  const lines = (source || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let list = null;
  let para = null;
  let callout = null;
  let code = null; // inside a ``` fenced code block
  let math = null; // inside a $$ ... $$ equation
  const close = () => { list = null; para = null; callout = null; };

  lines.forEach((raw, i) => {
    if (math) {
      if (/^\s*\$\$\s*$/.test(raw)) { blocks.push({ type: 'math', latex: math.join('\n').trim() }); math = null; } else math.push(raw);
      return;
    }
    if (/^\s*\$\$\s*$/.test(raw) && !code) { close(); math = []; return; }
    const oneLineMath = !code && raw.match(/^\s*\$\$(.+)\$\$\s*$/);
    if (oneLineMath) { close(); blocks.push({ type: 'math', latex: oneLineMath[1].trim() }); return; }
    if (!code && raw.trim() === '[[pagebreak]]') { close(); blocks.push({ type: 'pagebreak' }); return; }
    const chartM = !code && raw.trim().match(/^\[\[chart:([A-Za-z0-9_-]+)\]\]$/);
    if (chartM) { close(); blocks.push({ type: 'chart', spec: decData(chartM[1]) || {} }); return; }
    const embM = !code && raw.trim().match(/^\[\[embed:([A-Za-z0-9_-]+)\]\]$/);
    if (embM) { close(); blocks.push({ type: 'embed', data: decData(embM[1]) || {} }); return; }
    const sigM = !code && raw.trim().match(/^\[\[signature:([0-9a-f-]{36})\]\]$/);
    if (sigM) { close(); blocks.push({ type: 'signature', id: sigM[1] }); return; }
    if (code) {
      if (/^\s*```\s*$/.test(raw)) code = null; else code.lines.push(raw.replace(/\r$/, ''));
      return;
    }
    const fence = raw.match(/^\s*```([\w+#.-]*)\s*$/);
    if (fence) { close(); code = { type: 'code', lang: normaliseLang(fence[1]), lines: [] }; blocks.push(code); return; }
    let line = raw.replace(/\s+$/, '');
    if (!line.trim()) { close(); return; }
    let m;
    let attrs = null;
    if ((m = line.match(ATTR_PREFIX))) { attrs = parseAttrs(m[1]); line = line.slice(m[0].length); if (!line.trim()) line = ' '; }
    if (line.trim() === '[[toc]]') {
      close();
      blocks.push({ type: 'toc' });
    } else if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes('-')) return; // header separator row
      if (list?.type !== 'table') { close(); list = { type: 'table', rows: [] }; blocks.push(list); }
      list.rows.push(splitRow(line));
    } else if ((m = line.match(/^(#{1,3}) (.*)$/))) {
      close();
      blocks.push({ type: m[1].length === 3 ? 'h3' : 'h2', text: m[2], attrs });
    } else if (/^---+$/.test(line.trim())) {
      close();
      blocks.push({ type: 'hr' });
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      if (!callout) { close(); callout = { type: 'callout', lines: [], attrs }; blocks.push(callout); }
      callout.lines.push(m[1].replace(/^💡\s*/, ''));
    } else if ((m = line.match(TASK))) {
      if (list?.type !== 'tasks') { close(); list = { type: 'tasks', items: [] }; blocks.push(list); }
      list.items.push({ text: m[2], done: m[1] !== ' ', line: i, attrs });
    } else if ((m = line.match(BULLET))) {
      if (list?.type !== 'ul') { close(); list = { type: 'ul', items: [] }; blocks.push(list); }
      list.items.push({ text: m[1], sub: [], attrs });
    } else if ((m = line.match(ORDERED))) {
      if (list?.type !== 'ol') { close(); list = { type: 'ol', items: [] }; blocks.push(list); }
      list.items.push({ text: m[2], sub: [], attrs });
    } else if (list && list.type !== 'tasks' && /^\s+\S/.test(line)) {
      list.items[list.items.length - 1].sub.push(line.trim());
    } else {
      // A line with its own paragraph settings starts a new paragraph.
      if (!para || attrs) { close(); para = { type: 'p', lines: [], attrs }; blocks.push(para); }
      para.lines.push(line.trim());
    }
  });
  return blocks;
}

/** Read-only HTML. Checkbox inputs carry data-line for toggling. */
export function renderNote(source, { readOnly = false, remindable = false } = {}) {
  const blocks = parseNote(source);
  return blocks.map((b) => {
    switch (b.type) {
      case 'toc': {
        const items = tocItems(blocks);
        return `<nav class="toc" aria-label="Contents"><p class="toc-title">Contents</p>${items ? `<ol>${items}</ol>` : '<p class="toc-empty">Add headings to this document and they’ll be listed here.</p>'}</nav>`;
      }
      case 'table': return tableHtml(b, false);
      case 'math': return `<div class="math-block" data-latex="${esc(b.latex)}">${renderMath(b.latex, true)}</div>`;
      case 'pagebreak': return '<div class="page-break" aria-hidden="true"></div>';
      case 'chart': return `<figure class="chart-block">${chartSvg(b.spec)}</figure>`;
      case 'embed': return embedHtml(b.data);
      case 'signature': return `<div class="sig-block" data-sig="${b.id}"><div class="sig-loading">Signature</div></div>`;
      case 'code': return `<div class="code-wrap"><button type="button" class="code-copy" data-copy-code>Copy</button><span class="code-lang">${LANG_NAMES[b.lang || detectLang(b.lines.join('\n'))] || 'Code'}</span><pre class="code-block" data-lang="${b.lang}"><code>${highlightCode(b.lines.join('\n'), b.lang)}</code></pre></div>`;
      case 'h2': case 'h3': return `<${b.type}${attrHtml(b.attrs)}>${inline(b.text)}</${b.type}>`;
      case 'hr': return '<hr>';
      case 'p': return `<p${attrHtml(b.attrs)}>${b.lines.map(inline).join('<br>')}</p>`;
      case 'callout': return `<div class="callout"${attrHtml(b.attrs)}>${icon('lightbulb', { size: 18 })}<div>${b.lines.map(inline).join('<br>')}</div></div>`;
      case 'tasks': return `<ul class="tasks">${b.items.map((it) => `<li class="${it.done ? 'done' : ''}"${attrHtml(it.attrs, { list: true })}><label><input type="checkbox" data-line="${it.line}" ${it.done ? 'checked' : ''} ${readOnly ? 'disabled' : ''}><span>${inline(it.text)}</span></label>${remindable && !it.done ? `<button type="button" class="task-remind" data-remind="${esc(plainHeading(it.text).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\+\+/g, '').trim().slice(0, 200))}" title="Make this a reminder" aria-label="Make a reminder for this item">${icon('bellPlus', { size: 15 })}</button>` : ''}</li>`).join('')}</ul>`;
      default: return `<${b.type}>${b.items.map((it) => `<li${attrHtml(it.attrs, { list: true })}><div class="li-main">${inline(it.text)}</div>${it.sub.length ? `<div class="li-sub">${it.sub.map(inline).join('<br>')}</div>` : ''}</li>`).join('')}</${b.type}>`;
    }
  }).join('\n');
}

export function toggleTaskLine(source, lineIndex) {
  const lines = source.split('\n');
  const line = lines[lineIndex];
  if (line === undefined || !TASK.test(stripAttrs(line))) return source;
  lines[lineIndex] = line.replace(/\[( |x|X)\]/, (_, c) => (c === ' ' ? '[x]' : '[ ]'));
  return lines.join('\n');
}

export function taskProgress(source) {
  let total = 0, done = 0;
  for (const line of (source || '').split('\n')) {
    const m = stripAttrs(line).match(TASK);
    if (m) { total++; if (m[1] !== ' ') done++; }
  }
  return { total, done };
}

/** Plain-text preview: the note's summary, else its first line of body text. */
export function previewText(note) {
  if (note.summary) return note.summary;
  for (const raw of (note.content || '').split('\n')) {
    const line = stripAttrs(raw.trim()).trim();
    if (!line || line.startsWith('#') || /^---+$/.test(line)) continue;
    if (/^!\[/.test(line)) return 'Image';
    if (/^```/.test(line)) continue;
    if (line === '[[toc]]') continue;
    if (/^\|.*\|$/.test(line)) return stripStyles(splitRow(line).filter(Boolean).join(' · ')).slice(0, 140);
    return stripStyles(line).replace(/\+\+/g, '').replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1').replace(/^[-*] \[( |x|X)\] /, '').replace(/^[-*>] ?/, '').replace(/^\d+[.)] /, '').replace(/[*`]/g, '').slice(0, 140);
  }
  return 'Empty document';
}

export function plainText(source) {
  return stripStyles(source || '').replace(/\+\+/g, '').replace(/\{:[a-z0-9.,]+\}/g, ' ').replace(/[#>*`|\[\]]/g, ' ').replace(/\s+/g, ' ');
}


export const headingsOf = (source) => parseNote(source).filter((b) => b.type === 'h2' || b.type === 'h3').map((b) => ({ level: b.type, text: plainHeading(b.text) }));

/** Words in a document's text, for word counts and reading time. */
export function wordCount(source) {
  const text = plainText(String(source || '').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^```.*$/gm, ' '));
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}
