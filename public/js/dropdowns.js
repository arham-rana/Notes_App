// Dropdown chips (like Google Docs): a coloured chip in the text with a list of options.
import { esc } from './util.js';
import { icon } from './icons.js';
import { openModal } from './ui.js';
import { DD_COLORS } from './markdown.js';

export const DD_PRESETS = {
  project: { label: 'Project status', o: [{ l: 'Not started', c: 'gray' }, { l: 'In progress', c: 'blue' }, { l: 'Blocked', c: 'red' }, { l: 'Done', c: 'green' }] },
  review: { label: 'Review status', o: [{ l: 'Draft', c: 'gray' }, { l: 'In review', c: 'yellow' }, { l: 'Changes needed', c: 'orange' }, { l: 'Approved', c: 'green' }] },
  priority: { label: 'Priority', o: [{ l: 'Low', c: 'gray' }, { l: 'Medium', c: 'yellow' }, { l: 'High', c: 'orange' }, { l: 'Urgent', c: 'red' }] },
};

/** Create or edit a dropdown's options. Resolves to { o, v } or null. */
export function dropdownDialog(existing = null) {
  return new Promise((resolve) => {
    let result = null;
    let opts = existing?.o?.length ? existing.o.map((x) => ({ ...x })) : DD_PRESETS.project.o.map((x) => ({ ...x }));
    const row = (o, i) => `<div class="dd-row" data-i="${i}">
      <select class="dd-color" aria-label="Colour">${Object.entries(DD_COLORS).map(([k, l]) => `<option value="${k}" ${o.c === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="dd-swatch dd-${o.c}" aria-hidden="true"></span>
      <input class="dd-label" value="${esc(o.l)}" maxlength="40" aria-label="Option ${i + 1}">
      <button type="button" class="icon-btn dd-del" aria-label="Remove option">${icon('x', { size: 15 })}</button></div>`;
    openModal({
      title: existing ? 'Edit dropdown' : 'Insert dropdown',
      body: `<div class="dd-presets"><span class="muted small">Start from:</span>${Object.entries(DD_PRESETS).map(([k, p]) => `<button type="button" class="chip-btn" data-preset="${k}">${p.label}</button>`).join('')}</div>
        <div class="dd-rows"></div>
        <button type="button" class="btn btn-plain btn-sm dd-add">+ Add option</button>`,
      footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-save>${existing ? 'Save' : 'Insert'}</button>`,
      onMount: (el, close) => {
        const box = el.querySelector('.dd-rows');
        const read = () => { opts = [...box.querySelectorAll('.dd-row')].map((r) => ({ l: r.querySelector('.dd-label').value.trim(), c: r.querySelector('.dd-color').value })); };
        const draw = () => { box.innerHTML = opts.map(row).join(''); };
        draw();
        el.addEventListener('click', (e) => {
          const p = e.target.closest('[data-preset]');
          if (p) { opts = DD_PRESETS[p.dataset.preset].o.map((x) => ({ ...x })); draw(); }
          if (e.target.closest('.dd-add')) { read(); opts.push({ l: '', c: 'gray' }); draw(); box.querySelector('.dd-row:last-child .dd-label').focus(); }
          const del = e.target.closest('.dd-del');
          if (del) { read(); opts.splice(+del.closest('.dd-row').dataset.i, 1); draw(); }
          if (e.target.closest('[data-save]')) {
            read();
            const o = opts.filter((x) => x.l).slice(0, 20);
            if (!o.length) return;
            result = { o, v: o.some((x) => x.l === existing?.v) ? existing.v : o[0].l };
            close();
          }
        });
        el.addEventListener('change', (e) => { if (e.target.classList.contains('dd-color')) { const chip = e.target.parentElement.querySelector('.dd-swatch'); chip.className = `dd-swatch dd-${e.target.value}`; } });
      },
      onClose: () => resolve(result),
    });
  });
}

/** The option list shown when a chip is clicked. */
let pop = null;
export function closeDropdownPicker() { pop?.remove(); pop = null; }
export function openDropdownPicker(anchor, data, { onPick, onEdit, editable = true } = {}) {
  if (pop && pop.__anchor === anchor) { closeDropdownPicker(); return; }
  closeDropdownPicker();
  pop = document.createElement('div');
  pop.__anchor = anchor;
  pop.className = 'menu dd-menu';
  pop.setAttribute('role', 'listbox');
  pop.innerHTML = (data.o || []).map((o, i) => `<button type="button" class="menu-item" role="option" data-i="${i}" aria-selected="${o.l === data.v}"><span class="dd-chip dd-${o.c}">${esc(o.l)}</span>${o.l === data.v ? `<span class="dd-check">${icon('check', { size: 15 })}</span>` : ''}</button>`).join('')
    + (onEdit && editable ? '<div class="menu-divider"></div><button type="button" class="menu-item" data-edit>Edit options…</button>' : '');
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)}px`;
  pop.style.top = `${r.bottom + 6 + pop.offsetHeight > window.innerHeight ? r.top - pop.offsetHeight - 6 : r.bottom + 6}px`;
  pop.addEventListener('mousedown', (e) => e.preventDefault());
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (b) { closeDropdownPicker(); onPick?.(data.o[+b.dataset.i].l); }
    if (e.target.closest('[data-edit]')) { closeDropdownPicker(); onEdit?.(); }
  });
  setTimeout(() => document.addEventListener('mousedown', function out(ev) { if (pop && !pop.contains(ev.target) && ev.target !== anchor && !anchor.contains(ev.target)) { closeDropdownPicker(); document.removeEventListener('mousedown', out, true); } }, true));
}
