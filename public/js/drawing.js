import { $ } from './util.js';
import { icon } from './icons.js';
import { openModal, toast } from './ui.js';

const COLORS = [
  ['#1b2a3d', 'Black'], ['#2b77ee', 'Blue'], ['#d23b33', 'Red'], ['#14a073', 'Green'],
  ['#e08a00', 'Orange'], ['#7a4fe0', 'Purple'], ['#e04f9a', 'Pink'], ['#ffffff', 'White'],
];
const SIZES = [[2, 'Fine'], [4, 'Medium'], [8, 'Thick'], [16, 'Marker']];

/**
 * Open the drawing pad. base: optional image URL to draw on.
 * Resolves with a PNG Blob, or null if cancelled.
 */
export function openDrawing({ base = null } = {}) {
  return new Promise((resolve) => {
    let result = null;
    openModal({
      title: base ? 'Draw on image' : 'New drawing',
      size: 'xl',
      body: `
        <div class="draw-tools" role="toolbar" aria-label="Pen">
          <div class="draw-group" role="radiogroup" aria-label="Colour">
            ${COLORS.map(([c, n], i) => `<button type="button" class="draw-color ${i === 0 ? 'active' : ''}" data-color="${c}" style="--c:${c}" aria-label="${n}" aria-pressed="${i === 0}" title="${n}"></button>`).join('')}
          </div>
          <span class="img-sep"></span>
          <div class="draw-group" role="radiogroup" aria-label="Thickness">
            ${SIZES.map(([w, n], i) => `<button type="button" class="draw-size ${i === 1 ? 'active' : ''}" data-size="${w}" aria-label="${n}" aria-pressed="${i === 1}" title="${n}"><i style="width:${Math.max(4, w)}px;height:${Math.max(4, w)}px"></i></button>`).join('')}
          </div>
          <span class="img-sep"></span>
          <button type="button" class="draw-btn" data-tool="eraser" aria-pressed="false" title="Eraser">${icon('eraser', { size: 18 })}<span>Eraser</span></button>
          <span class="spacer"></span>
          <button type="button" class="draw-btn" data-do="undo" title="Undo (Cmd/Ctrl+Z)">${icon('undo', { size: 18 })}</button>
          <button type="button" class="draw-btn" data-do="redo" title="Redo">${icon('redo', { size: 18 })}</button>
          <button type="button" class="draw-btn" data-do="clear" title="Clear all ink">${icon('trash', { size: 18 })}<span>Clear</span></button>
        </div>
        <div class="draw-stage">
          <canvas class="draw-base" aria-hidden="true"></canvas>
          <canvas class="draw-ink" aria-label="Drawing area"></canvas>
        </div>`,
      footer: `<span class="muted small draw-hint">Draw with a mouse, trackpad, pen or finger.</span><span class="spacer"></span>
        <button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-draw-save>${icon('check', { size: 16 })}Insert drawing</button>`,
      onMount: async (el, close) => {
        const baseCv = $('.draw-base', el), ink = $('.draw-ink', el), stage = $('.draw-stage', el);
        let W = 1600, H = 1000;
        let baseImg = null;
        if (base) {
          try {
            const blob = await fetch(base, { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error(); return r.blob(); });
            baseImg = await createImageBitmap(blob);
            const scale = Math.min(1, 2400 / Math.max(baseImg.width, baseImg.height));
            W = Math.round(baseImg.width * scale); H = Math.round(baseImg.height * scale);
          } catch { toast('Couldn’t load the image to draw on', { tone: 'error' }); close(); return; }
        }
        for (const c of [baseCv, ink]) { c.width = W; c.height = H; }
        stage.style.aspectRatio = `${W} / ${H}`;
        stage.style.width = `min(100%, calc(62vh * ${(W / H).toFixed(4)}))`;
        const bctx = baseCv.getContext('2d');
        if (baseImg) bctx.drawImage(baseImg, 0, 0, W, H);
        else { bctx.fillStyle = '#ffffff'; bctx.fillRect(0, 0, W, H); }

        const ctx = ink.getContext('2d');
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        let color = COLORS[0][0], size = 4, eraser = false;
        const strokes = []; let undone = [];
        // Line widths are chosen for how big the drawing looks on screen.
        const scale = () => W / ink.getBoundingClientRect().width;

        function drawStroke(s) {
          ctx.save();
          ctx.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over';
          ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.size;
          const p = s.points;
          if (p.length === 1) { ctx.beginPath(); ctx.arc(p[0][0], p[0][1], s.size / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return; }
          ctx.beginPath();
          ctx.moveTo(p[0][0], p[0][1]);
          for (let i = 1; i < p.length - 1; i++) {
            const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
            ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my);
          }
          ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
          ctx.stroke();
          ctx.restore();
        }
        function redraw() { ctx.clearRect(0, 0, W, H); strokes.forEach(drawStroke); }
        const pos = (e) => { const r = ink.getBoundingClientRect(); return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)]; };

        let current = null;
        ink.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          ink.setPointerCapture(e.pointerId);
          const pressure = e.pointerType === 'pen' && e.pressure ? 0.5 + e.pressure : 1;
          current = { color, size: size * scale() * pressure * (eraser ? 3 : 1), eraser, points: [pos(e)] };
          undone = [];
          drawStroke(current);
        });
        ink.addEventListener('pointermove', (e) => {
          if (!current) return;
          for (const ev of e.getCoalescedEvents?.() || [e]) current.points.push(pos(ev));
          redraw(); drawStroke(current);
        });
        const end = () => { if (current) { strokes.push(current); current = null; redraw(); } };
        ink.addEventListener('pointerup', end);
        ink.addEventListener('pointercancel', end);

        const tools = $('.draw-tools', el);
        tools.addEventListener('click', (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          const pick = (sel, btn) => tools.querySelectorAll(sel).forEach((x) => { x.classList.toggle('active', x === btn); x.setAttribute('aria-pressed', String(x === btn)); });
          if (b.dataset.color) { color = b.dataset.color; eraser = false; pick('.draw-color', b); tools.querySelector('[data-tool="eraser"]').setAttribute('aria-pressed', 'false'); }
          if (b.dataset.size) { size = Number(b.dataset.size); pick('.draw-size', b); }
          if (b.dataset.tool === 'eraser') { eraser = !eraser; b.setAttribute('aria-pressed', String(eraser)); }
          if (b.dataset.do === 'undo' && strokes.length) { undone.push(strokes.pop()); redraw(); }
          if (b.dataset.do === 'redo' && undone.length) { strokes.push(undone.pop()); redraw(); }
          if (b.dataset.do === 'clear' && strokes.length) { undone = []; strokes.length = 0; redraw(); }
        });
        el.addEventListener('keydown', (e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) { if (undone.length) { strokes.push(undone.pop()); redraw(); } }
            else if (strokes.length) { undone.push(strokes.pop()); redraw(); }
          }
        });

        el.querySelector('[data-draw-save]').addEventListener('click', async () => {
          if (!strokes.length && !base) { toast('Draw something first'); return; }
          const out = document.createElement('canvas');
          out.width = W; out.height = H;
          const o = out.getContext('2d');
          o.drawImage(baseCv, 0, 0);
          o.drawImage(ink, 0, 0);
          result = await new Promise((r) => out.toBlob(r, 'image/png'));
          close();
        });
      },
      onClose: () => resolve(result),
    });
  });
}
