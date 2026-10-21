import { esc, timeAgo } from './util.js';
import { icon } from './icons.js';
import { state, request, store } from './store.js';
import { confirmDialog, toast } from './ui.js';
import { attachMentionsToTextarea, markMentions } from './mentions.js';

/*
 * Comments are stored with the text they quote (plus a little of the text before it),
 * so they don't change the document. Highlights are drawn with the browser's
 * highlight feature, which marks text without touching the page's content.
 */

const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const canHighlight = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';

/* ---------- Finding quoted text ---------- */

/** Map the container's text to characters (ignoring whitespace) so quotes match across lines. */
function textMap(container) {
  const chars = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('.toc, script, style, [data-page-gap], [data-page-end], [data-page-head]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let node;
  let text = '';
  while ((node = walker.nextNode())) {
    const v = node.nodeValue;
    for (let i = 0; i < v.length; i++) {
      if (/\s|\u200b/.test(v[i])) continue;
      chars.push([node, i]);
      text += v[i];
    }
  }
  return { chars, text };
}
const squash = (s) => String(s || '').replace(/[\s\u200b]+/g, '');

function findRange(container, quote, prefix, map = textMap(container)) {
  const q = squash(quote);
  if (!q) return null;
  const { text, chars } = map;
  const pre = squash(prefix).slice(-24);
  let best = -1;
  for (let at = text.indexOf(q); at !== -1; at = text.indexOf(q, at + 1)) {
    if (best === -1) best = at;
    if (pre && text.slice(Math.max(0, at - pre.length), at) === pre) { best = at; break; }
  }
  if (best === -1) return null;
  const [sn, so] = chars[best];
  const [en, eo] = chars[best + q.length - 1];
  const r = document.createRange();
  r.setStart(sn, so);
  r.setEnd(en, eo + 1);
  return r;
}

/* ---------- Panel ---------- */

/**
 * Attach comments to an open document page.
 * root: the page element; noteId; container(): the element holding the document text.
 */
export function attachComments(root, noteId, { container, isOpen, setOpen, focusId = null }) {
  let comments = [];
  let showResolved = false;
  let pending = null; // { quote, prefix } for a new comment
  let activeId = focusId;
  let ranges = new Map();
  const panel = root.querySelector('.comments-panel');
  let bubble = null;

  async function load() {
    try {
      comments = await request('GET', `/api/notes/${noteId}/comments`);
    } catch (err) {
      comments = [];
      if (err.status !== 404) toast(err.message, { tone: 'error' });
    }
    render();
  }

  function threads() {
    const tops = comments.filter((c) => !c.parentId);
    const byPos = (a, b) => {
      const ra = ranges.get(a.id), rb = ranges.get(b.id);
      if (ra && rb) return ra.compareBoundaryPoints(Range.START_TO_START, rb);
      if (ra) return -1;
      if (rb) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    };
    return tops.sort(byPos).map((t) => ({ ...t, replies: comments.filter((c) => c.parentId === t.id) }));
  }

  function refreshHighlights() {
    const el = container();
    ranges = new Map();
    if (el) {
      const map = textMap(el);
      for (const c of comments) {
        if (c.parentId || c.resolved) continue;
        const r = findRange(el, c.quote, c.prefix, map);
        if (r) ranges.set(c.id, r);
      }
    }
    if (!canHighlight) return;
    CSS.highlights.set('doc-comments', new Highlight(...ranges.values()));
    const act = activeId && ranges.get(activeId);
    if (act) CSS.highlights.set('doc-comment-active', new Highlight(act)); else CSS.highlights.delete('doc-comment-active');
  }

  const person = (a) => `<span class="avatar avatar-sm" aria-hidden="true">${esc(initials(a.name))}</span><span class="cp-who"><b>${a.id === state.user?.id ? 'You' : esc(a.name)}</b><small>${/^guest-/.test(a.username || '') ? 'Guest' : `@${esc(a.username || '')}`}</small></span>`;

  function render() {
    refreshHighlights();
    const all = threads();
    const open = all.filter((t) => !t.resolved);
    const resolved = all.filter((t) => t.resolved);
    const list = showResolved ? all : open;
    panel.innerHTML = `
      <header class="cp-head">
        <h2>Comments${open.length ? ` <span class="cp-count">${open.length}</span>` : ''}</h2>
        <button type="button" class="icon-btn" data-cp="close" aria-label="Close comments">${icon('x', { size: 18 })}</button>
      </header>
      <div class="cp-body">
        ${pending ? `
          <form class="cp-new" data-cp-form="new">
            <blockquote class="cp-quote">${esc(pending.quote.slice(0, 220))}</blockquote>
            <label class="sr-only" for="cp-new-text">Your comment</label>
            <textarea id="cp-new-text" name="body" rows="3" placeholder="Add a comment…" maxlength="5000"></textarea>
            <div class="cp-actions"><button type="button" class="btn btn-ghost btn-sm" data-cp="cancel-new">Cancel</button><button class="btn btn-primary btn-sm" type="submit">${icon('send', { size: 15 })}Comment</button></div>
          </form>` : ''}
        ${list.length ? list.map((t) => `
          <article class="cp-thread ${t.resolved ? 'resolved' : ''} ${t.id === activeId ? 'active' : ''}" data-thread="${t.id}">
            <div class="cp-meta">${person(t.author)}<span class="cp-time">${timeAgo(t.createdAt)}</span>
              <span class="cp-tools">
                <button type="button" class="icon-btn" data-cp="${t.resolved ? 'reopen' : 'resolve'}" data-id="${t.id}" title="${t.resolved ? 'Reopen' : 'Resolve'}" aria-label="${t.resolved ? 'Reopen comment' : 'Resolve comment'}">${icon(t.resolved ? 'undo' : 'check', { size: 16 })}</button>
                ${t.canDelete ? `<button type="button" class="icon-btn" data-cp="delete" data-id="${t.id}" title="Delete" aria-label="Delete comment">${icon('trash', { size: 16 })}</button>` : ''}
              </span>
            </div>
            ${t.quote ? `<button type="button" class="cp-quote cp-goto" data-cp="goto" data-id="${t.id}">${esc(t.quote.slice(0, 160))}${ranges.has(t.id) || t.resolved ? '' : '<span class="cp-orphan">Text no longer in document</span>'}</button>` : ''}
            <p class="cp-text">${markMentions(esc(t.body))}</p>
            ${t.replies.map((r) => `
              <div class="cp-reply">
                <div class="cp-meta">${person(r.author)}<span class="cp-time">${timeAgo(r.createdAt)}</span>
                  ${r.canDelete ? `<span class="cp-tools"><button type="button" class="icon-btn" data-cp="delete" data-id="${r.id}" title="Delete reply" aria-label="Delete reply">${icon('trash', { size: 15 })}</button></span>` : ''}
                </div>
                <p class="cp-text">${markMentions(esc(r.body))}</p>
              </div>`).join('')}
            ${t.resolved ? '' : `
            <form class="cp-reply-form" data-cp-form="reply" data-id="${t.id}">
              <label class="sr-only" for="reply-${t.id}">Reply</label>
              <textarea id="reply-${t.id}" name="body" rows="1" placeholder="Reply…" maxlength="5000"></textarea>
              <button class="icon-btn icon-btn-solid" type="submit" aria-label="Send reply">${icon('send', { size: 15 })}</button>
            </form>`}
          </article>`).join('') : (pending ? '' : `<div class="cp-empty">${icon('comment', { size: 22 })}<p>No comments yet. Select some text, then choose <b>Comment</b>.</p></div>`)}
        ${resolved.length ? `<button type="button" class="btn-link cp-toggle" data-cp="toggle-resolved">${showResolved ? 'Hide resolved' : `Show resolved (${resolved.length})`}</button>` : ''}
      </div>`;
    if (pending) panel.querySelector('#cp-new-text')?.focus();
    const act = panel.querySelector('.cp-thread.active');
    if (act && focusId) { act.scrollIntoView({ block: 'nearest' }); focusId = null; }
  }

  function focusThread(id, { scrollDoc = true } = {}) {
    activeId = id;
    render();
    const r = ranges.get(id);
    if (scrollDoc && r) {
      const rect = r.getBoundingClientRect();
      const scroller = root.querySelector('.doc-scroll');
      if (scroller) scroller.scrollBy({ top: rect.top - scroller.getBoundingClientRect().top - 120, behavior: 'smooth' });
    }
    panel.querySelector(`[data-thread="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function act(method, url, body) {
    try { comments = await request(method, url, body); render(); store.refresh(); } catch (err) { toast(err.message, { tone: 'error' }); }
  }

  panel.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cp]');
    if (!b) { const t = e.target.closest('[data-thread]'); if (t && !e.target.closest('form')) focusThread(t.dataset.thread); return; }
    const id = b.dataset.id;
    switch (b.dataset.cp) {
      case 'close': setOpen(false); break;
      case 'cancel-new': pending = null; render(); break;
      case 'toggle-resolved': showResolved = !showResolved; render(); break;
      case 'goto': focusThread(id); break;
      case 'resolve': act('PUT', `/api/comments/${id}`, { resolved: true }); break;
      case 'reopen': act('PUT', `/api/comments/${id}`, { resolved: false }); break;
      case 'delete':
        if (await confirmDialog({ title: 'Delete this comment?', message: comments.find((c) => c.id === id)?.parentId ? 'This reply will be removed for everyone.' : 'The comment and its replies will be removed for everyone.', confirmLabel: 'Delete' })) {
          act('DELETE', `/api/comments/${id}`);
        }
        break;
    }
  });
  panel.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const body = form.elements.body.value.trim();
    if (!body) return;
    form.querySelector('button[type=submit]').disabled = true;
    if (form.dataset.cpForm === 'new') {
      const p = pending;
      pending = null;
      await act('POST', `/api/notes/${noteId}/comments`, { body, quote: p.quote, prefix: p.prefix });
      const mine = [...comments].reverse().find((c) => !c.parentId && c.author.id === state.user?.id);
      if (mine) focusThread(mine.id, { scrollDoc: false });
    } else {
      await act('POST', `/api/notes/${noteId}/comments`, { body, parentId: form.dataset.id });
    }
  });
  panel.addEventListener('keydown', (e) => {
    // Cmd/Ctrl+Enter sends.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.tagName === 'TEXTAREA') { e.preventDefault(); e.target.form.requestSubmit(); }
  });
  // Typing @ in a comment box suggests the people who can open this document.
  panel.addEventListener('focusin', (e) => { if (e.target.tagName === 'TEXTAREA') attachMentionsToTextarea(e.target, noteId); });
  panel.addEventListener('input', (e) => {
    if (e.target.tagName === 'TEXTAREA') { e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`; }
  });

  /* ----- Starting a comment from a selection ----- */
  function selectionInfo() {
    const el = container();
    const sel = window.getSelection();
    if (!el || !sel.rangeCount || sel.isCollapsed || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return null;
    const quote = sel.toString().replace(/\s+/g, ' ').trim();
    if (!quote) return null;
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
    return { quote: quote.slice(0, 500), prefix: pre.toString().slice(-60), rect: sel.getRangeAt(0).getBoundingClientRect() };
  }
  function startComment(info = selectionInfo()) {
    if (!info) { toast('Select the text you want to comment on'); return; }
    pending = { quote: info.quote, prefix: info.prefix };
    hideBubble();
    if (!isOpen()) setOpen(true); else render();
  }
  function hideBubble() { bubble?.remove(); bubble = null; }
  function showBubble() {
    const info = selectionInfo();
    if (!info) { hideBubble(); return; }
    if (!bubble) {
      bubble = document.createElement('button');
      bubble.type = 'button';
      bubble.className = 'comment-bubble';
      bubble.innerHTML = `${icon('commentPlus', { size: 16 })}Comment`;
      bubble.addEventListener('mousedown', (e) => e.preventDefault());
      bubble.addEventListener('click', () => startComment());
      document.body.appendChild(bubble);
    }
    const r = info.rect;
    bubble.style.left = `${Math.min(window.innerWidth - bubble.offsetWidth - 8, Math.max(8, r.right - bubble.offsetWidth / 2))}px`;
    bubble.style.top = `${Math.max(8, r.top - bubble.offsetHeight - 8)}px`;
  }
  const onUp = () => setTimeout(showBubble, 0);
  const onSelChange = () => { if (bubble && !selectionInfo()) hideBubble(); };
  const onRequest = () => startComment();
  root.addEventListener('mouseup', onUp);
  root.addEventListener('keyup', (e) => { if (e.shiftKey || e.key === 'Shift') onUp(); });
  document.addEventListener('selectionchange', onSelChange);
  document.addEventListener('doc:comment-request', onRequest);
  const scroller = root.querySelector('.doc-scroll');
  scroller?.addEventListener('scroll', hideBubble);

  // Clicking commented text opens its comment.
  const onDocClick = (e) => {
    if (!ranges.size || e.target.closest('a, button, input')) return;
    const pos = document.caretRangeFromPoint?.(e.clientX, e.clientY)
      || (document.caretPositionFromPoint && (() => { const p = document.caretPositionFromPoint(e.clientX, e.clientY); if (!p) return null; const r = document.createRange(); r.setStart(p.offsetNode, p.offset); return r; })());
    if (!pos) return;
    for (const [id, r] of ranges) {
      if (r.comparePoint(pos.startContainer, pos.startOffset) === 0 && window.getSelection().isCollapsed) {
        if (!isOpen()) { activeId = id; focusId = id; setOpen(true); } else focusThread(id, { scrollDoc: false });
        return;
      }
    }
  };
  scroller?.addEventListener('click', onDocClick);

  // Keep highlights in place while typing.
  let hlTimer = null;
  const onInput = (e) => {
    if (e.target.closest?.('.comments-panel')) return;
    clearTimeout(hlTimer);
    hlTimer = setTimeout(() => {
      const before = [...ranges.keys()].sort().join();
      refreshHighlights();
      // A comment's text was deleted or restored: update its "no longer in document" note.
      if ([...ranges.keys()].sort().join() !== before && isOpen()) render();
    }, 400);
  };
  root.addEventListener('input', onInput);

  load();
  // Opening the comments marks this document's comment notifications as read.
  if (isOpen() && state.notifications?.some((n) => n.noteId === noteId)) store.markNotificationsRead([noteId]);

  return {
    reload: load,
    refreshHighlights,
    render,
    start: startComment,
    destroy() {
      hideBubble();
      clearTimeout(hlTimer);
      document.removeEventListener('selectionchange', onSelChange);
      document.removeEventListener('doc:comment-request', onRequest);
      if (canHighlight) { CSS.highlights.delete('doc-comments'); CSS.highlights.delete('doc-comment-active'); }
    },
  };
}
