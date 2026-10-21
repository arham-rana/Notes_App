// Converts between the stored document text (this app's Markdown-like format)
// and the editor's document structure (ProseMirror JSON). Pure functions: no DOM.

/* Compact, text-safe encoding for structured blocks: base64url of JSON. */
export function enc(obj) {
  const json = JSON.stringify(obj);
  const b64 = typeof Buffer !== 'undefined' ? Buffer.from(json, 'utf8').toString('base64') : btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function dec(str) {
  try {
    const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64').toString('utf8') : new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    return JSON.parse(json);
  } catch { return null; }
}
const ATTR_PREFIX = /^\{:([a-z0-9.,]+)\}\s?/;
const TASK = /^\s*[-*] \[( |x|X)\] (.*)$/;
const BULLET = /^\s*[-*] (.*)$/;
const ORDERED = /^\s*(\d+)[.)] (.*)$/;
const LANGS = ['text', 'js', 'ts', 'python', 'html', 'css', 'json', 'sql', 'shell', 'java', 'c', 'go', 'rust', 'swift', 'php', 'ruby'];
const ALIASES = { plain: 'text', txt: 'text', plaintext: 'text', javascript: 'js', jsx: 'js', typescript: 'ts', tsx: 'ts', py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell', cpp: 'c', 'c++': 'c', rs: 'rust', rb: 'ruby', xml: 'html' };
const lang = (l) => { const k = String(l || '').toLowerCase(); const v = ALIASES[k] || k; return LANGS.includes(v) ? v : null; };

function parseAttrs(spec) {
  const a = {};
  for (const p of String(spec).split(',')) {
    if (['center', 'right', 'justify'].includes(p)) a.textAlign = p;
    else if (/^i[1-4]$/.test(p)) a.indent = Number(p.slice(1));
    else if (/^lh(1|1\.15|1\.5|2)$/.test(p)) a.lh = p.slice(2);
    else if (/^sa[0-3]$/.test(p)) a.sa = p.slice(2);
  }
  return a;
}
function attrPrefix(attrs = {}) {
  const parts = [];
  if (attrs.textAlign && attrs.textAlign !== 'left') parts.push(attrs.textAlign);
  if (attrs.indent) parts.push(`i${attrs.indent}`);
  if (attrs.lh) parts.push(`lh${attrs.lh}`);
  if (attrs.sa !== null && attrs.sa !== undefined && attrs.sa !== '') parts.push(`sa${attrs.sa}`);
  return parts.length ? `{:${parts.join(',')}} ` : '';
}

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

/* ---------------- Inline text -> nodes ---------------- */

const STYLE_KEYS = { font: ['serif', 'mono', 'hand'], hl: ['yellow', 'green', 'blue', 'pink', 'orange'], color: ['gray', 'red', 'orange', 'green', 'blue', 'purple', 'pink'] };
function styleMarks(spec) {
  const out = [];
  const ts = {};
  for (const part of spec.split(',')) {
    const [k, v] = part.split(':');
    if (k === 'font' && STYLE_KEYS.font.includes(v)) ts.font = v;
    if (k === 'size' && /^\d{1,3}$/.test(v) && +v >= 6 && +v <= 128) ts.size = +v;
    if (k === 'color' && STYLE_KEYS.color.includes(v)) ts.color = v;
    if (k === 'color' && /^x[0-9a-f]{6}$/.test(v)) ts.color = `#${v.slice(1)}`;
    if (k === 'hl' && STYLE_KEYS.hl.includes(v)) out.push({ type: 'highlight', attrs: { color: v } });
  }
  if (Object.keys(ts).length) out.push({ type: 'textStyle', attrs: { font: null, size: null, color: null, ...ts } });
  return out;
}
const PAIRS = [['***', ['bold', 'italic']], ['**', ['bold']], ['++', ['underline']], ['~~', ['strike']], ['^^', ['superscript']], [',,', ['subscript']], ['*', ['italic']]];

function addMarks(marks, extra) {
  const out = marks.filter((m) => !extra.some((e) => e.type === m.type));
  return [...out, ...extra];
}

/** Find the end of a {{spec| ... }} token, allowing nesting. */
function styleEnd(s, from) {
  let depth = 1;
  for (let i = from; i < s.length - 1; i++) {
    if (s[i] === '{' && s[i + 1] === '{') { depth++; i++; }
    else if (s[i] === '}' && s[i + 1] === '}') { depth--; if (!depth) return i; i++; }
  }
  return -1;
}

export function parseInline(s, marks = []) {
  const out = [];
  let text = '';
  const flush = () => { if (text) { out.push(marks.length ? { type: 'text', text, marks } : { type: 'text', text }); text = ''; } };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m;
    if (rest.startsWith('{{') && (m = rest.match(/^\{\{([a-z0-9:,]+)\|/))) {
      const end = styleEnd(s, i + m[0].length);
      if (end > 0) { flush(); out.push(...parseInline(s.slice(i + m[0].length, end), addMarks(marks, styleMarks(m[1])))); i = end + 2; continue; }
    }
    if ((m = rest.match(/^\[\[dd:([A-Za-z0-9_-]+)\]\]/))) {
      const d = dec(m[1]);
      flush(); if (d) out.push({ type: 'dropdown', attrs: { data: JSON.stringify(d) } }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^!\[([^\]]*)\]\((\/api\/files\/[0-9a-f-]{36}|https:\/\/[^\s)]+)\)(?:\{w=(\d{1,3})\})?(?:\{d=([A-Za-z0-9_-]+)\})?/))) {
      const shapes = m[4] ? dec(m[4]) : null;
      flush(); out.push({ type: 'image', attrs: { src: m[2], alt: m[1] || 'image', width: m[3] && +m[3] < 100 ? Math.max(10, +m[3]) : null, shapes: shapes ? JSON.stringify(shapes) : null } }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^\[([^\]]+)\]\((\/api\/files\/[0-9a-f-]{36})\)/))) {
      flush(); out.push({ type: 'fileChip', attrs: { href: m[2], name: m[1] } }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+|#\/documents\/[0-9a-f-]{36})\)/))) {
      flush(); out.push(...parseInline(m[1], addMarks(marks, [{ type: 'link', attrs: { href: m[2], target: null, rel: 'noopener noreferrer', class: null } }]))); i += m[0].length; continue;
    }
    if ((m = rest.match(/^`([^`]+)`/))) {
      flush(); out.push({ type: 'text', text: m[1], marks: addMarks(marks.filter((x) => x.type !== 'link' || true), [{ type: 'code' }]) }); i += m[0].length; continue;
    }
    if (rest[0] === '$' && rest[1] !== '$' && (m = rest.match(/^\$(?=\S)([^$\n]*?\S)\$(?!\d)/))) {
      flush(); out.push({ type: 'mathInline', attrs: { latex: m[1] } }); i += m[0].length; continue;
    }
    if (rest[0] === '@' && (i === 0 || /[\s(]/.test(s[i - 1])) && (m = rest.match(/^@([a-z0-9._-]{3,30}[a-z0-9_-])/i))) {
      flush(); out.push({ type: 'mention', attrs: { id: m[1].toLowerCase(), label: m[1].toLowerCase() } }); i += m[0].length; continue;
    }
    let paired = false;
    for (const [d, types] of PAIRS) {
      if (!rest.startsWith(d) || /\s/.test(rest[d.length] || ' ')) continue;
      const close = rest.indexOf(d, d.length);
      if (close <= d.length - 1 || /\s/.test(rest[close - 1])) continue;
      if (d === '*' && rest[1] === '*') continue;
      flush();
      out.push(...parseInline(rest.slice(d.length, close), addMarks(marks, types.map((t) => ({ type: t })))));
      i += close + d.length;
      paired = true;
      break;
    }
    if (paired) continue;
    text += s[i];
    i++;
  }
  flush();
  return out;
}

const inlineLines = (lines) => {
  const out = [];
  lines.forEach((l, i) => { if (i) out.push({ type: 'hardBreak' }); out.push(...parseInline(l)); });
  return out;
};
const para = (content, attrs) => (content.length ? { type: 'paragraph', attrs: attrs || undefined, content } : { type: 'paragraph', attrs: attrs || undefined });

/* ---------------- Stored text -> document ---------------- */

export function markdownToDoc(source) {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const content = [];
  let list = null, p = null, callout = null, code = null, table = null, math = null;
  const close = () => { list = null; p = null; callout = null; table = null; };

  lines.forEach((raw) => {
    if (code) { if (/^\s*```\s*$/.test(raw)) code = null; else code.lines.push(raw); return; }
    if (math) { if (/^\s*\$\$\s*$/.test(raw)) { content.push({ type: 'mathBlock', attrs: { latex: math.join('\n').trim() } }); math = null; } else math.push(raw); return; }
    const fence = raw.match(/^\s*```([\w+#.-]*)\s*$/);
    if (fence) { close(); code = { lines: [], language: lang(fence[1]) }; content.push(code); return; }
    let line = raw.replace(/\s+$/, '');
    if (!line.trim()) { close(); return; }
    if (/^\s*\$\$\s*$/.test(line)) { close(); math = []; return; }
    let mm;
    if ((mm = line.match(/^\s*\$\$(.+)\$\$\s*$/))) { close(); content.push({ type: 'mathBlock', attrs: { latex: mm[1].trim() } }); return; }
    let attrs = null;
    if ((mm = line.match(ATTR_PREFIX))) { attrs = parseAttrs(mm[1]); line = line.slice(mm[0].length); }
    if (line.trim() === '[[toc]]') { close(); content.push({ type: 'toc' }); return; }
    if (line.trim() === '[[pagebreak]]') { close(); content.push({ type: 'pageBreak' }); return; }
    if ((mm = line.trim().match(/^\[\[chart:([A-Za-z0-9_-]+)\]\]$/))) { close(); const spec = dec(mm[1]); if (spec) content.push({ type: 'chart', attrs: { spec: JSON.stringify(spec) } }); return; }
    if ((mm = line.trim().match(/^\[\[embed:([A-Za-z0-9_-]+)\]\]$/))) { close(); const d = dec(mm[1]); if (d) content.push({ type: 'embed', attrs: { data: JSON.stringify(d) } }); return; }
    if ((mm = line.trim().match(/^\[\[signature:([0-9a-f-]{36})\]\]$/))) { close(); content.push({ type: 'signature', attrs: { id: mm[1] } }); return; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes('-')) return;
      if (!table) { close(); table = { rows: [] }; content.push(table); }
      table.rows.push(splitRow(line));
      return;
    }
    if ((mm = line.match(/^(#{1,3}) (.*)$/))) { close(); content.push({ type: 'heading', attrs: { level: mm[1].length === 3 ? 3 : 2, ...attrs }, content: parseInline(mm[2]) }); return; }
    if (/^---+$/.test(line.trim())) { close(); content.push({ type: 'horizontalRule' }); return; }
    if ((mm = line.match(/^>\s?(.*)$/))) {
      if (!callout) { close(); callout = { type: 'callout', attrs: attrs || {}, lines: [] }; content.push(callout); }
      callout.lines.push(mm[1].replace(/^💡\s*/, ''));
      return;
    }
    if ((mm = line.match(TASK))) {
      if (list?.type !== 'taskList') { close(); list = { type: 'taskList', content: [] }; content.push(list); }
      list.content.push({ type: 'taskItem', attrs: { checked: mm[1] !== ' ', ...attrs }, content: [para(parseInline(mm[2]))] });
      return;
    }
    if ((mm = line.match(BULLET)) || (mm = line.match(ORDERED))) {
      const kind = BULLET.test(line) && !ORDERED.test(line) ? 'bulletList' : 'orderedList';
      const text = kind === 'bulletList' ? line.match(BULLET)[1] : line.match(ORDERED)[2];
      if (list?.type !== kind) { close(); list = { type: kind, content: [] }; content.push(list); }
      list.content.push({ type: 'listItem', attrs: attrs || undefined, lines: [text] });
      return;
    }
    if (list && list.type !== 'taskList' && /^\s+\S/.test(line)) { list.content[list.content.length - 1].lines.push(line.trim()); return; }
    if (!p || attrs) { close(); p = { type: 'paragraph', attrs: attrs || undefined, lines: [] }; content.push(p); }
    p.lines.push(line.trim());
  });
  if (math) content.push({ type: 'mathBlock', attrs: { latex: math.join('\n').trim() } });

  const doc = content.map((b) => {
    if (b.lines && b.type === 'paragraph') return para(inlineLines(b.lines), b.attrs);
    if (b.type === 'callout') { const c = inlineLines(b.lines); return c.length ? { type: 'callout', attrs: b.attrs, content: c } : { type: 'callout', attrs: b.attrs }; }
    if (b.language !== undefined && b.lines) return { type: 'codeBlock', attrs: { language: b.language }, content: b.lines.join('\n') ? [{ type: 'text', text: b.lines.join('\n') }] : undefined };
    if (b.rows) {
      const width = Math.max(...b.rows.map((r) => r.length));
      return { type: 'table', content: b.rows.map((r, ri) => ({ type: 'tableRow', content: Array.from({ length: width }, (_, ci) => ({ type: ri === 0 ? 'tableHeader' : 'tableCell', content: [para(parseInline(r[ci] || ''))] })) })) };
    }
    if (b.type === 'bulletList' || b.type === 'orderedList') return { type: b.type, content: b.content.map((it) => ({ type: 'listItem', attrs: it.attrs, content: [para(inlineLines(it.lines))] })) };
    return b;
  }).map(stripUndefined);
  return { type: 'doc', content: doc.length ? doc : [{ type: 'paragraph' }] };
}
function stripUndefined(n) {
  if (n && typeof n === 'object') {
    for (const k of Object.keys(n)) { if (n[k] === undefined) delete n[k]; else if (typeof n[k] === 'object') stripUndefined(n[k]); }
  }
  return n;
}

/* ---------------- Document -> stored text ---------------- */

const MARK_ORDER = ['subscript', 'superscript', 'strike', 'underline', 'italic', 'bold'];
const DELIM = { subscript: ',,', superscript: '^^', strike: '~~', underline: '++', italic: '*', bold: '**' };
const sameMarks = (a = [], b = []) => JSON.stringify(a) === JSON.stringify(b);

function wrapText(text, marks = []) {
  if (!text) return '';
  const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0];
  let t = text.trim();
  if (!t) return text;
  const has = (type) => marks.find((m) => m.type === type);
  if (has('code')) t = `\`${t.replace(/`/g, '')}\``;
  for (const type of MARK_ORDER) if (has(type)) t = `${DELIM[type]}${t}${DELIM[type]}`;
  const link = has('link');
  if (link) t = `[${t.replace(/[[\]]/g, '')}](${link.attrs.href})`;
  const ts = has('textStyle'), hl = has('highlight');
  const col = ts?.attrs.color ? (ts.attrs.color.startsWith('#') ? `x${ts.attrs.color.slice(1).toLowerCase()}` : ts.attrs.color) : null;
  const spec = [ts?.attrs.font && `font:${ts.attrs.font}`, ts?.attrs.size && `size:${ts.attrs.size}`, hl && `hl:${hl.attrs.color || 'yellow'}`, col && `color:${col}`].filter(Boolean).join(',');
  if (spec) t = `{{${spec}|${t}}}`;
  return lead + t + trail;
}

/** Inline content -> lines (hard breaks split lines). */
export function inlineToLines(nodes = []) {
  const lines = [''];
  // Merge neighbouring text nodes that carry the same marks.
  const merged = [];
  for (const n of nodes) {
    const last = merged[merged.length - 1];
    if (n.type === 'text' && last?.type === 'text' && sameMarks(last.marks, n.marks)) last.text += n.text;
    else merged.push({ ...n });
  }
  for (const n of merged) {
    if (n.type === 'hardBreak') { lines.push(''); continue; }
    let s = '';
    if (n.type === 'text') s = wrapText(n.text, n.marks);
    else if (n.type === 'image') { let sh = null; try { sh = n.attrs.shapes ? JSON.parse(n.attrs.shapes) : null; } catch { sh = null; } s = `![${(n.attrs.alt || 'image').replace(/[[\]]/g, '')}](${n.attrs.src})${n.attrs.width && n.attrs.width < 100 ? `{w=${n.attrs.width}}` : ''}${sh ? `{d=${enc(sh)}}` : ''}`; }
    else if (n.type === 'dropdown') { let d = null; try { d = JSON.parse(n.attrs.data); } catch { d = null; } if (d) s = `[[dd:${enc(d)}]]`; }
    else if (n.type === 'fileChip') s = `[${(n.attrs.name || 'file').replace(/[[\]]/g, '')}](${n.attrs.href})`;
    else if (n.type === 'mention') s = `@${n.attrs.label || n.attrs.id}`;
    else if (n.type === 'mathInline') s = `$${n.attrs.latex}$`;
    lines[lines.length - 1] += s;
  }
  return lines;
}
const inlineToText = (nodes) => inlineToLines(nodes).join(' ').trim();
const firstPara = (item) => item.content?.find((c) => c.type === 'paragraph');

function listToLines(list, out, depth = 0) {
  let n = 0;
  for (const item of list.content || []) {
    n++;
    const p = firstPara(item);
    const [first = '', ...rest] = inlineToLines(p?.content);
    const pre = attrPrefix({ ...(item.attrs || {}), indent: (item.attrs?.indent || 0) + depth || undefined });
    if (list.type === 'taskList') out.push(`${pre}- [${item.attrs?.checked ? 'x' : ' '}] ${[first, ...rest].join(' ').trim()}`);
    else {
      out.push(`${pre}${list.type === 'orderedList' ? `${n}.` : '-'} ${first.trim()}`);
      rest.filter((l) => l.trim()).forEach((l) => out.push(`  ${l.trim()}`));
    }
    for (const child of item.content || []) {
      if (['bulletList', 'orderedList', 'taskList'].includes(child.type)) listToLines(child, out, depth + 1);
      else if (child !== p && child.type === 'paragraph') { const t = inlineToText(child.content); if (t) out.push(`  ${t}`); }
    }
  }
}

export function docToMarkdown(doc) {
  const blocks = [];
  for (const b of doc?.content || []) {
    const pre = attrPrefix(b.attrs || {});
    switch (b.type) {
      case 'heading': { const t = inlineToText(b.content); if (t) blocks.push(`${pre}${b.attrs?.level === 3 ? '###' : '##'} ${t}`); break; }
      case 'paragraph': {
        const ls = inlineToLines(b.content).map((l) => l.replace(/\s+$/, ''));
        while (ls.length && !ls[ls.length - 1].trim()) ls.pop();
        while (ls.length && !ls[0].trim()) ls.shift();
        if (ls.length) { ls[0] = pre + ls[0]; blocks.push(ls.join('\n')); }
        break;
      }
      case 'callout': { const ls = inlineToLines(b.content).filter((l) => l.trim()); if (ls.length) blocks.push(ls.map((l, i) => `${i ? '' : pre}> ${l.trim()}`).join('\n')); break; }
      case 'bulletList': case 'orderedList': case 'taskList': { const out = []; listToLines(b, out); if (out.length) blocks.push(out.join('\n')); break; }
      case 'codeBlock': {
        const text = (b.content || []).map((t) => t.text || '').join('').replace(/\n+$/, '').replace(/^```/gm, ' ```');
        blocks.push(`\`\`\`${b.attrs?.language || ''}\n${text}\n\`\`\``);
        break;
      }
      case 'table': {
        const rows = (b.content || []).map((r) => (r.content || []).map((c) => (c.content || []).map((pp) => inlineToText(pp.content)).join(' ').replace(/\|/g, '\\|')));
        if (!rows.length) break;
        const width = Math.max(...rows.map((r) => r.length));
        const line = (r) => `| ${Array.from({ length: width }, (_, i) => r[i] || ' ').join(' | ')} |`;
        blocks.push([line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n'));
        break;
      }
      case 'horizontalRule': blocks.push('---'); break;
      case 'toc': blocks.push('[[toc]]'); break;
      case 'pageBreak': blocks.push('[[pagebreak]]'); break;
      case 'chart': { let sp = null; try { sp = JSON.parse(b.attrs?.spec || '{}'); } catch { sp = null; } if (sp) blocks.push(`[[chart:${enc(sp)}]]`); break; }
      case 'signature': if (b.attrs?.id) blocks.push(`[[signature:${b.attrs.id}]]`); break;
      case 'embed': { let d = null; try { d = JSON.parse(b.attrs?.data || '{}'); } catch { d = null; } if (d?.u) blocks.push(`[[embed:${enc(d)}]]`); break; }
      case 'mathBlock': { const l = (b.attrs?.latex || '').trim(); if (l) blocks.push(l.includes('\n') ? `$$\n${l}\n$$` : `$$${l}$$`); break; }
      default: break;
    }
  }
  return blocks.join('\n\n');
}
