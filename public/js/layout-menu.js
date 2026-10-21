import { openFloat, openFloatIds, snapFloat, closeFloat } from './float.js';
import { openPopoutIds, placePopout, placeSelf, screenArea, openPopout } from './popout.js';
import { icon } from './icons.js';

/* ---------- Layout geometry ---------- */

const SINGLE = {
  left: { icon: 'layoutLeft', label: 'Left half', slots: (a, g) => [{ x: a.x, y: a.y, w: (a.w - g) / 2, h: a.h }] },
  right: { icon: 'layoutRight', label: 'Right half', slots: (a, g) => [{ x: a.x + (a.w + g) / 2, y: a.y, w: (a.w - g) / 2, h: a.h }] },
  top: { icon: 'layoutTop', label: 'Top half', slots: (a, g) => [{ x: a.x, y: a.y, w: a.w, h: (a.h - g) / 2 }] },
  bottom: { icon: 'layoutBottom', label: 'Bottom half', slots: (a, g) => [{ x: a.x, y: a.y + (a.h + g) / 2, w: a.w, h: (a.h - g) / 2 }] },
};
const ARRANGE = {
  side: {
    label: 'Side by side', icon: 'layoutSide', count: 2,
    slots: (a, g) => [SINGLE.left.slots(a, g)[0], SINGLE.right.slots(a, g)[0]],
  },
  oneTwo: {
    label: 'One left, two stacked right', icon: 'layoutOneTwo', count: 3,
    slots: (a, g) => {
      const w = (a.w - g) / 2, h = (a.h - g) / 2, x2 = a.x + w + g;
      return [{ x: a.x, y: a.y, w, h: a.h }, { x: x2, y: a.y, w, h }, { x: x2, y: a.y + h + g, w, h }];
    },
  },
  grid: {
    label: 'Grid of four', icon: 'layoutGrid', count: 4,
    slots: (a, g) => {
      const w = (a.w - g) / 2, h = (a.h - g) / 2;
      return [{ x: a.x, y: a.y, w, h }, { x: a.x + w + g, y: a.y, w, h }, { x: a.x, y: a.y + h + g, w, h }, { x: a.x + w + g, y: a.y + h + g, w, h }];
    },
  },
};

/* ---------- Applying a layout ---------- */

const IN_APP_GAP = 8;
const inAppArea = () => ({ x: IN_APP_GAP, y: IN_APP_GAP, w: window.innerWidth - IN_APP_GAP * 2, h: window.innerHeight - IN_APP_GAP * 2 });

function leaveFullPage(id) {
  // Floating windows sit over the app, so close the full-page view of this document first.
  if (id && location.hash === `#/documents/${id}`) location.hash = '#/documents';
}

/** id: the document the menu was opened from (placed first). target: 'app' | 'popout'. */
function applyLayout(kind, { id, target, self }) {
  if (self) { placeSelf(SINGLE[kind].slots(screenArea(), 0)[0]); return; }
  const def = SINGLE[kind] || ARRANGE[kind];
  if (target === 'popout') {
    const slots = def.slots(screenArea(), 0);
    const ids = SINGLE[kind] ? [id] : [...new Set([id, ...openPopoutIds()].filter(Boolean))].slice(0, slots.length);
    ids.forEach((docId, i) => placePopout(docId, slots[i]));
    return;
  }
  leaveFullPage(id);
  // Wait a frame so leaving the full page doesn't fight with placing the windows.
  requestAnimationFrame(() => {
    const slots = def.slots(inAppArea(), IN_APP_GAP);
    const ids = SINGLE[kind] ? [id] : [...new Set([id, ...openFloatIds()].filter(Boolean))].slice(0, slots.length);
    ids.forEach((docId, i) => snapFloat(docId, slots[i]));
  });
}

/* ---------- The menu ---------- */

let pop = null;
const narrow = () => window.matchMedia('(max-width: 860px), (hover: none)').matches;
const getTarget = () => { try { return localStorage.getItem('layoutTarget') === 'popout' ? 'popout' : 'app'; } catch { return 'app'; } };
const setTarget = (t) => { try { localStorage.setItem('layoutTarget', t); } catch { /* ignore */ } };

let popAnchor = null;
const onAnchor = (t) => popAnchor && popAnchor.nodeType === 1 && (popAnchor === t || popAnchor.contains(t));
export function closeLayoutMenu() {
  pop?.remove();
  pop = null;
  popAnchor = null;
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
}
function onOutside(e) { if (pop && !pop.contains(e.target) && !onAnchor(e.target)) closeLayoutMenu(); }
function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeLayoutMenu(); } }

function countHint(target, id) {
  const open = target === 'popout' ? openPopoutIds() : openFloatIds();
  const others = open.filter((x) => x !== id).length;
  const what = target === 'popout' ? 'browser' : 'floating';
  return others
    ? `Layouts with several windows put this document first, then ${others} other open ${what} window${others === 1 ? '' : 's'}.`
    : `Layouts with several windows use ${what} windows that are already open. Open more to fill them.`;
}

/**
 * anchor: the button (or a DOMRect) to open beside.
 * options.id: the document; options.self: true inside a pop-out window (moves that window).
 */
/** The "open as" choices that make sense from where the menu was opened. */
function openAsItems(id, from) {
  if (!id) return [];
  const onPage = location.hash === `#/documents/${id}`;
  const items = [];
  if (!onPage && from !== 'page') items.push(['page', 'maximize', 'Full page']);
  if (from !== 'float') items.push(['float', 'popout', 'Floating window']);
  if (!narrow()) items.push(['popout', 'newWindow', 'New browser window']);
  return items;
}

function openAs(kind, id) {
  if (kind === 'page') { closeFloat(id); location.hash = `#/documents/${id}`; return; }
  if (kind === 'float') { leaveFullPage(id); openFloat(id); return; }
  if (kind === 'popout') { leaveFullPage(id); closeFloat(id); openPopout(id); }
}

/**
 * The Window menu: open as full page / floating window / new browser window, then layouts.
 * from: 'list' (preview or document list), 'page' (open document), 'float' (a floating window's title bar).
 */
export function openLayoutMenu(anchor, { id = null, self = false, from = 'list' } = {}) {
  // Clicking the button that opened it closes it.
  if (pop && popAnchor && anchor?.nodeType === 1 && onAnchor(anchor)) { closeLayoutMenu(); return; }
  closeLayoutMenu();
  popAnchor = anchor?.nodeType === 1 ? anchor : null;
  const small = narrow() && !self;

  let target = getTarget();
  pop = document.createElement('div');
  pop.className = 'layout-pop menu';
  pop.setAttribute('role', 'menu');
  pop.setAttribute('aria-label', 'Window');
  const openItems = self ? [] : openAsItems(id, from);
  const current = from === 'page' ? 'page' : from === 'float' ? 'float' : null;
  const layoutItem = ([k, d]) => `<button type="button" class="menu-item lp-item" role="menuitem" data-layout="${k}">${icon(d.icon, { size: 17 })}<span>${d.label}</span>${d.count ? `<small>${d.count} windows</small>` : ''}</button>`;
  const draw = () => {
    pop.innerHTML = `
      ${openItems.length ? `
      <div class="menu-label" id="lp-open-label">Open as</div>
      <div role="group" aria-labelledby="lp-open-label">
        ${current ? `<div class="menu-item lp-item is-current" role="menuitemradio" aria-checked="true">${icon('check', { size: 16 })}<span>${current === 'page' ? 'Full page' : 'Floating window'}</span></div>` : ''}
        ${openItems.map(([k, ic, label]) => `<button type="button" class="menu-item lp-item lp-open-btn" role="menuitemradio" aria-checked="false" data-open="${k}"><span class="lp-radio" aria-hidden="true"></span><span>${label}</span>${icon(ic, { size: 16 })}</button>`).join('')}
      </div>` : ''}
      ${small ? '' : `
      ${self ? '' : `
      <div class="menu-divider"></div>
      <label class="menu-label lp-target-label" for="lp-target">Open in</label>
      <div class="lp-target-wrap"><select id="lp-target" class="select select-sm lp-target-select">
        <option value="app" ${target === 'app' ? 'selected' : ''}>This app (floating windows)</option>
        <option value="popout" ${target === 'popout' ? 'selected' : ''}>New browser windows</option>
      </select></div>`}
      <div class="menu-divider"></div>
      <div class="menu-label">Layout</div>
      ${Object.entries(SINGLE).map(layoutItem).join('')}
      ${self ? '' : `
      ${Object.entries(ARRANGE).map(layoutItem).join('')}
      <p class="lp-hint">${countHint(target, id)}</p>
      ${target === 'app' && openFloatIds().length ? `<div class="menu-divider"></div><button type="button" class="menu-item lp-item lp-close-all" data-close-all>${icon('x', { size: 16 })}<span>Close all floating windows</span></button>` : ''}`}`}`;
  };
  draw();
  document.body.appendChild(pop);

  // Position next to the anchor, inside the window.
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor;
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
  let top = r.bottom + 8;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
  Object.assign(pop.style, { left: `${left}px`, top: `${top}px` });

  pop.addEventListener('change', (e) => {
    if (e.target.id !== 'lp-target') return;
    target = e.target.value; setTarget(target); draw(); pop.querySelector('#lp-target')?.focus();
  });
  pop.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-all]')) { openFloatIds().forEach(closeFloat); closeLayoutMenu(); return; }
    const o = e.target.closest('[data-open]');
    if (o) { closeLayoutMenu(); openAs(o.dataset.open, id); return; }
    const b = e.target.closest('[data-layout]');
    if (!b) return;
    closeLayoutMenu();
    applyLayout(b.dataset.layout, { id, target, self });
  });
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  });
  (pop.querySelector('.lp-open-btn') || pop.querySelector('.lp-item'))?.focus({ preventScroll: true });
}
