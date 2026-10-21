// Spelling and grammar checks for the editor, using the self-hosted LanguageTool service.
// Underlines are decorations (never part of the text). Unchanged paragraphs aren't re-checked.
import { esc } from './util.js';
import { request } from './store.js';
import { toast } from './ui.js';
import { Extension, Plugin, PluginKey, Decoration, DecorationSet } from '/js/vendor/collab.js';

export const checkKey = new PluginKey('spellcheck');
const ENABLED_KEY = 'spellcheckOn';
export const checkingEnabled = () => localStorage.getItem(ENABLED_KEY) !== 'off';
export const setCheckingEnabled = (on) => { try { localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off'); } catch { /* */ } };
const language = () => (navigator.languages?.[0] || navigator.language || 'auto');

const SKIP_MARKS = new Set(['code', 'link']);
const SKIP_BLOCKS = new Set(['codeBlock', 'mathBlock']);

/** Each paragraph's text, with a map from text offset to document position. Skipped parts become spaces. */
function paragraphsOf(doc) {
  const out = [];
  doc.descendants((node, pos) => {
    if (SKIP_BLOCKS.has(node.type.name)) return false;
    if (!node.isTextblock) return true;
    let text = '';
    const map = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) {
        const skip = child.marks.some((m) => SKIP_MARKS.has(m.type.name));
        const t = skip ? ' '.repeat(child.text.length) : child.text.replace(/https?:\/\/\S+/g, (u) => ' '.repeat(u.length));
        for (let i = 0; i < t.length; i++) map.push(start + i);
        text += t;
      } else { map.push(start); text += ' '; } // mentions, equations, images…
    });
    if (text.trim()) out.push({ text, map, pos });
    return false;
  });
  return out;
}

/** The editor extension: holds the issues and draws the underlines. */
export function spellcheckExtension(hooks = {}) {
  return Extension.create({
    name: 'spellcheck',
    addProseMirrorPlugins() {
      return [new Plugin({
        key: checkKey,
        state: {
          init: () => ({ issues: [], decos: DecorationSet.empty }),
          apply(tr, prev) {
            const meta = tr.getMeta(checkKey);
            if (meta) return meta;
            if (!tr.docChanged) return prev;
            // Keep underlines in place while typing; drop those whose text was edited.
            const issues = prev.issues.map((m) => {
              const a = tr.mapping.mapResult(m.from), b = tr.mapping.mapResult(m.to);
              return a.deleted || b.deleted ? null : { ...m, from: a.pos, to: b.pos };
            }).filter((m) => m && m.to > m.from && tr.doc.textBetween(m.from, m.to) === m.text);
            return { issues, decos: prev.decos.map(tr.mapping, tr.doc) };
          },
        },
        props: {
          decorations: (st) => checkKey.getState(st).decos,
          handleClick: (view, pos, event) => {
            const el = event.target.closest?.('.sp-err, .gr-err');
            if (!el) return false;
            const issue = checkKey.getState(view.state).issues.find((m) => pos >= m.from && pos <= m.to);
            if (issue) hooks.onIssueClick?.(issue, el);
            return false;
          },
        },
      })];
    },
  });
}

/** Runs checks for one editor, a moment after typing stops. */
export function attachChecker(editor, { onChange } = {}) {
  const cache = new Map(); // paragraph text -> matches (relative to that paragraph)
  const ignored = new Set(); // "rule|text" ignored in this session
  let timer = null, busy = false, again = false, destroyed = false, status = 'idle';
  const setStatus = (s) => { status = s; onChange?.(); };

  async function check() {
    if (destroyed || !checkingEnabled()) return;
    if (busy) { again = true; return; }
    busy = true;
    const paras = paragraphsOf(editor.state.doc);
    const todo = [...new Set(paras.map((p) => p.text).filter((t) => !cache.has(t)))];
    try {
      if (todo.length) {
        setStatus('checking');
        // Check new or changed paragraphs together, separated by blank lines.
        const joined = todo.join('\n\n');
        const res = await request('POST', '/api/check', { text: joined, language: language() });
        let offset = 0;
        const bounds = todo.map((t) => { const b = [offset, offset + t.length]; offset += t.length + 2; return b; });
        todo.forEach((t) => cache.set(t, []));
        for (const m of res.matches) {
          const i = bounds.findIndex(([a, b]) => m.offset >= a && m.offset < b);
          if (i < 0) continue;
          cache.get(todo[i]).push({ ...m, offset: m.offset - bounds[i][0] });
        }
      }
      apply(paras);
      setStatus('ready');
    } catch (err) {
      setStatus(err.status === 503 ? 'unavailable' : 'error');
    } finally {
      busy = false;
      if (again) { again = false; schedule(300); }
    }
  }

  function apply(paras = paragraphsOf(editor.state.doc)) {
    if (destroyed) return;
    const issues = [];
    for (const p of paras) {
      for (const m of cache.get(p.text) || []) {
        const from = p.map[m.offset], end = p.map[m.offset + m.length - 1];
        if (from === undefined || end === undefined) continue;
        const text = p.text.substr(m.offset, m.length);
        if (!text.trim() || ignored.has(`${m.rule}|${text}`)) continue;
        issues.push({ ...m, from, to: end + 1, text });
      }
    }
    issues.sort((a, b) => a.from - b.from);
    const decos = DecorationSet.create(editor.state.doc, issues.map((m) => Decoration.inline(m.from, m.to, { class: m.type === 'spelling' ? 'sp-err' : 'gr-err', nodeName: 'span' })));
    editor.view.dispatch(editor.state.tr.setMeta(checkKey, { issues, decos }).setMeta('addToHistory', false));
  }

  function clear() { editor.view.dispatch(editor.state.tr.setMeta(checkKey, { issues: [], decos: DecorationSet.empty }).setMeta('addToHistory', false)); }
  function schedule(ms = 1200) { clearTimeout(timer); timer = setTimeout(check, ms); }
  const onUpdate = ({ transaction }) => { if (transaction.docChanged) schedule(); };
  editor.on('update', onUpdate);
  schedule(600);

  return {
    get status() { return status; },
    issues: () => checkKey.getState(editor.state)?.issues || [],
    recheck: () => schedule(0),
    setEnabled(on) { setCheckingEnabled(on); if (on) schedule(0); else { clearTimeout(timer); clear(); setStatus('off'); } },
    fix(issue, replacement) {
      editor.chain().focus().command(({ tr }) => { tr.insertText(replacement, issue.from, issue.to); return true; }).run();
    },
    ignore(issue) { ignored.add(`${issue.rule}|${issue.text}`); apply(); onChange?.(); },
    async addWord(issue) {
      try {
        await request('POST', '/api/dictionary', { word: issue.text });
        ignored.add(`${issue.rule}|${issue.text}`);
        for (const [t, ms] of cache) cache.set(t, ms.filter((m) => !(m.type === 'spelling' && t.substr(m.offset, m.length).toLowerCase() === issue.text.toLowerCase())));
        apply(); onChange?.();
        toast(`“${issue.text}” added to your dictionary`);
      } catch (err) { toast(err.message, { tone: 'error' }); }
    },
    destroy() { destroyed = true; clearTimeout(timer); editor.off('update', onUpdate); },
  };
}

/* ---------- The suggestion card ---------- */
let card = null;
export function closeIssueCard() { card?.remove(); card = null; }
export function openIssueCard(issue, anchor, checker) {
  closeIssueCard();
  card = document.createElement('div');
  card.className = `issue-card ${issue.type}`;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', issue.type === 'spelling' ? 'Spelling suggestion' : 'Grammar suggestion');
  card.innerHTML = `
    <div class="issue-kind"><span class="issue-dot"></span>${issue.type === 'spelling' ? 'Spelling' : 'Grammar'}</div>
    <p class="issue-msg">${esc(issue.message || issue.detail || '')}</p>
    ${issue.replacements.length ? `<div class="issue-fixes">${issue.replacements.map((r, i) => `<button type="button" class="issue-fix" data-fix="${i}">${esc(r) || '<em>(remove)</em>'}</button>`).join('')}</div>` : '<p class="issue-none">No suggestions</p>'}
    <div class="issue-actions"><button type="button" data-act="ignore">Ignore</button>${issue.type === 'spelling' ? '<button type="button" data-act="add">Add to dictionary</button>' : ''}</div>`;
  document.body.appendChild(card);
  const r = anchor.getBoundingClientRect();
  const top = r.bottom + 6 + card.offsetHeight > window.innerHeight - 8 ? r.top - card.offsetHeight - 6 : r.bottom + 6;
  card.style.top = `${Math.max(8, top)}px`;
  card.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - card.offsetWidth - 8))}px`;
  card.addEventListener('mousedown', (e) => e.preventDefault());
  card.addEventListener('click', (e) => {
    const f = e.target.closest('[data-fix]');
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (f) { closeIssueCard(); checker.fix(issue, issue.replacements[Number(f.dataset.fix)]); }
    if (a === 'ignore') { closeIssueCard(); checker.ignore(issue); }
    if (a === 'add') { closeIssueCard(); checker.addWord(issue); }
  });
  setTimeout(() => document.addEventListener('mousedown', function out(ev) { if (card && !card.contains(ev.target)) { closeIssueCard(); document.removeEventListener('mousedown', out, true); } }, true));
}
