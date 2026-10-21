// Shapes (like Google Docs' Insert → Drawing): arrange shapes on a canvas, saved as an image
// that keeps its shapes so it can be edited again.
import { esc } from './util.js';
import { openModal } from './ui.js';

const KINDS = {
  rect: 'Rectangle', round: 'Rounded rectangle', ellipse: 'Oval', triangle: 'Triangle', diamond: 'Diamond',
  star: 'Star', arrow: 'Arrow', line: 'Line', text: 'Text box',
};
const ICONS = {
  rect: '<rect x="4" y="6" width="16" height="12"/>', round: '<rect x="4" y="6" width="16" height="12" rx="4"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>', triangle: '<path d="M12 5 20 19H4z"/>', diamond: '<path d="M12 4 20 12 12 20 4 12z"/>',
  star: '<path d="m12 4 2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16.3 7 19l1.2-5.6L4 9.6l5.6-.6z"/>', arrow: '<path d="M4 12h14M13 7l5 5-5 5"/>',
  line: '<path d="M5 19 19 5"/>', text: '<path d="M6 6h12M12 6v12"/>',
};
const W = 860, H = 520;

function shapeSvg(s, { selected = false } = {}) {
  const { x, y, w, h } = s;
  const fill = s.k === 'line' || s.k === 'arrow' || s.k === 'text' ? 'none' : s.fill;
  const common = `fill="${fill}" stroke="${s.k === 'text' ? 'none' : s.stroke}" stroke-width="${s.sw}" stroke-linejoin="round"`;
  let body = '';
  switch (s.k) {
    case 'rect': body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${common}/>`; break;
    case 'round': body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(w, h) * 0.18}" ${common}/>`; break;
    case 'ellipse': body = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${common}/>`; break;
    case 'triangle': body = `<path d="M${x + w / 2} ${y} L${x + w} ${y + h} L${x} ${y + h} Z" ${common}/>`; break;
    case 'diamond': body = `<path d="M${x + w / 2} ${y} L${x + w} ${y + h / 2} L${x + w / 2} ${y + h} L${x} ${y + h / 2} Z" ${common}/>`; break;
    case 'star': {
      const cx = x + w / 2, cy = y + h / 2, pts = [];
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.42 : 1, a = -Math.PI / 2 + (i * Math.PI) / 5; pts.push(`${cx + (w / 2) * r * Math.cos(a)},${cy + (h / 2) * r * Math.sin(a)}`); }
      body = `<polygon points="${pts.join(' ')}" ${common}/>`; break;
    }
    case 'line': case 'arrow': {
      const x2 = x + w, y2 = y + h;
      const ang = Math.atan2(h, w), L = 10 + s.sw * 2;
      const head = s.k === 'arrow' ? `<path d="M${x2 - L * Math.cos(ang - 0.45)} ${y2 - L * Math.sin(ang - 0.45)} L${x2} ${y2} L${x2 - L * Math.cos(ang + 0.45)} ${y2 - L * Math.sin(ang + 0.45)}" fill="none" stroke="${s.stroke}" stroke-width="${s.sw}" stroke-linecap="round" stroke-linejoin="round"/>` : '';
      body = `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${s.stroke}" stroke-width="${s.sw}" stroke-linecap="round"/>${head}`;
      break;
    }
    default: break;
  }
  const text = s.text ? `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${s.fs || 18}" font-family="system-ui, -apple-system, sans-serif" fill="${s.color || '#1f2328'}">${esc(s.text)}</text>` : '';
  const hit = s.k === 'line' || s.k === 'arrow' ? `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="transparent" stroke-width="16"/>` : '';
  const sel = selected ? `<rect x="${Math.min(x, x + w) - 4}" y="${Math.min(y, y + h) - 4}" width="${Math.abs(w) + 8}" height="${Math.abs(h) + 8}" fill="none" stroke="#1f6feb" stroke-dasharray="5 4"/><rect class="sh-handle" x="${x + w - 6}" y="${y + h - 6}" width="12" height="12" fill="#fff" stroke="#1f6feb" stroke-width="2" rx="2"/>` : '';
  return `<g class="sh" data-id="${s.id}">${hit}${body}${text}${sel}</g>`;
}

/** Render shapes as a standalone SVG cropped to their extent. */
function exportSvg(shapes) {
  const pad = 12;
  const xs = shapes.flatMap((s) => [s.x, s.x + s.w]), ys = shapes.flatMap((s) => [s.y, s.y + s.h]);
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad, x1 = Math.max(...xs) + pad, y1 = Math.max(...ys) + pad;
  const w = Math.max(40, x1 - x0), h = Math.max(30, y1 - y0);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" width="${w}" height="${h}">${shapes.map((s) => shapeSvg(s)).join('')}</svg>`, w, h };
}
function toPng(svg, w, h) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; const g = c.getContext('2d'); g.scale(2, 2); g.drawImage(img, 0, 0, w, h); c.toBlob((b) => resolve(b), 'image/png'); };
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** Open the shapes editor. Resolves to { shapes, blob } or null. */
export function openShapes(initial = []) {
  return new Promise((resolve) => {
    let shapes = (Array.isArray(initial) ? initial : []).map((s, i) => ({ id: `s${i}`, ...s }));
    let sel = null, nextId = shapes.length, result = null;
    openModal({
      title: 'Shapes',
      size: 'xl',
      body: `<div class="sh-tools" role="toolbar" aria-label="Shapes">
          ${Object.entries(KINDS).map(([k, l]) => `<button type="button" class="tb-btn" data-add="${k}" title="${l}" aria-label="Add ${l}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8">${ICONS[k]}</svg></button>`).join('')}
          <span class="tb-sep"></span>
          <label class="sh-prop" title="Fill colour">Fill <input type="color" data-p="fill" value="#cfe2ff"></label>
          <label class="sh-prop" title="Border colour">Border <input type="color" data-p="stroke" value="#1f6feb"></label>
          <label class="sh-prop" title="Border thickness">Weight <select data-p="sw">${[0, 1, 2, 3, 4, 6, 8].map((n) => `<option value="${n}" ${n === 2 ? 'selected' : ''}>${n}px</option>`).join('')}</select></label>
          <label class="sh-prop sh-textprop">Text <input data-p="text" maxlength="80" placeholder="Text in the shape"></label>
          <button type="button" class="btn btn-plain btn-sm" data-act="front" title="Bring to front">Front</button>
          <button type="button" class="btn btn-plain btn-sm" data-act="back" title="Send to back">Back</button>
          <button type="button" class="btn btn-ghost-danger btn-sm" data-act="delete" title="Delete shape">Delete</button>
        </div>
        <svg class="sh-canvas" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" tabindex="0" aria-label="Shapes canvas"></svg>
        <p class="muted small">Click a shape to add it, drag to move, drag the corner square to resize. Delete or Backspace removes the selected shape.</p>`,
      footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-save>Save and insert</button>',
      onMount: (el, close) => {
        const canvas = el.querySelector('.sh-canvas');
        const prop = (p) => el.querySelector(`[data-p="${p}"]`);
        const draw = () => { canvas.innerHTML = `<rect width="${W}" height="${H}" fill="#fff"/>${shapes.map((s) => shapeSvg(s, { selected: s.id === sel })).join('')}`; };
        const current = () => shapes.find((s) => s.id === sel);
        const syncProps = () => { const s = current(); if (!s) return; prop('fill').value = s.fill; prop('stroke').value = s.stroke; prop('sw').value = String(s.sw); prop('text').value = s.text || ''; };
        draw();
        el.querySelector('.sh-tools').addEventListener('click', (e) => {
          const add = e.target.closest('[data-add]');
          if (add) {
            const k = add.dataset.add;
            const s = { id: `s${nextId++}`, k, x: 300 + (shapes.length % 6) * 18, y: 170 + (shapes.length % 6) * 18, w: k === 'line' || k === 'arrow' ? 200 : 180, h: k === 'line' || k === 'arrow' ? 0 : k === 'text' ? 50 : 120,
              fill: prop('fill').value, stroke: prop('stroke').value, sw: Number(prop('sw').value), text: k === 'text' ? 'Text' : '', fs: 18 };
            shapes.push(s); sel = s.id; syncProps(); draw(); canvas.focus();
          }
          const act = e.target.closest('[data-act]')?.dataset.act;
          const s = current();
          if (s && act === 'delete') { shapes = shapes.filter((x) => x !== s); sel = null; draw(); }
          if (s && act === 'front') { shapes = [...shapes.filter((x) => x !== s), s]; draw(); }
          if (s && act === 'back') { shapes = [s, ...shapes.filter((x) => x !== s)]; draw(); }
        });
        el.querySelector('.sh-tools').addEventListener('input', (e) => {
          const p = e.target.dataset.p; const s = current();
          if (!p || !s) return;
          s[p] = p === 'sw' ? Number(e.target.value) : e.target.value;
          draw();
        });
        // Move and resize.
        let drag = null;
        const pt = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)]; };
        canvas.addEventListener('pointerdown', (e) => {
          const g = e.target.closest('.sh');
          if (!g) { sel = null; draw(); return; }
          sel = g.dataset.id; syncProps();
          const s = current(); const [px, py] = pt(e);
          drag = { mode: e.target.classList.contains('sh-handle') ? 'size' : 'move', px, py, ox: s.x, oy: s.y, ow: s.w, oh: s.h };
          canvas.setPointerCapture(e.pointerId); draw();
        });
        canvas.addEventListener('pointermove', (e) => {
          if (!drag) return;
          const s = current(); const [px, py] = pt(e); const dx = px - drag.px, dy = py - drag.py;
          if (drag.mode === 'move') { s.x = Math.round(drag.ox + dx); s.y = Math.round(drag.oy + dy); }
          else { s.w = Math.round(s.k === 'line' || s.k === 'arrow' ? drag.ow + dx : Math.max(16, drag.ow + dx)); s.h = Math.round(s.k === 'line' || s.k === 'arrow' ? drag.oh + dy : Math.max(16, drag.oh + dy)); }
          draw();
        });
        canvas.addEventListener('pointerup', () => { drag = null; });
        canvas.addEventListener('keydown', (e) => {
          const s = current(); if (!s) return;
          if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); shapes = shapes.filter((x) => x !== s); sel = null; draw(); }
          const step = e.shiftKey ? 10 : 2;
          const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
          if (mv) { e.preventDefault(); s.x += mv[0]; s.y += mv[1]; draw(); }
        });
        el.querySelector('[data-save]').addEventListener('click', async () => {
          if (!shapes.length) { close(); return; }
          const { svg, w, h } = exportSvg(shapes);
          const blob = await toPng(svg, w, h);
          result = { shapes: shapes.map(({ id, ...s }) => s), blob };
          close();
        });
      },
      onClose: () => resolve(result),
    });
  });
}
