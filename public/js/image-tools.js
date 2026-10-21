import { icon } from './icons.js';
import { openModal } from './ui.js';

// The crop dialog, used by the editor's image bar.
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function openCropper(src) {
  return new Promise((resolve) => {
    let result = null;
    openModal({
      title: 'Crop image',
      size: 'lg',
      body: `
        <div class="crop-aspects" role="radiogroup" aria-label="Shape">
          ${ASPECTS.map(([k, l], i) => `<button type="button" class="chip-btn ${i === 0 ? 'active' : ''}" data-aspect="${k}" aria-pressed="${i === 0}">${l}</button>`).join('')}
        </div>
        <div class="crop-stage">
          <img class="crop-img" alt="Image to crop" draggable="false">
          <div class="crop-box" tabindex="0" aria-label="Crop area. Drag to move; use the corners to resize.">
            <span class="crop-grid" aria-hidden="true"></span>
            ${['nw', 'ne', 'sw', 'se'].map((h) => `<span class="crop-h crop-${h}" data-h="${h}"></span>`).join('')}
          </div>
        </div>
        <p class="muted small crop-dims" aria-live="polite"></p>`,
      footer: `<button class="btn btn-ghost" data-crop-reset>Reset</button><span class="spacer"></span>
        <button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-crop-apply>${icon('crop', { size: 16 })}Apply crop</button>`,
      onMount: async (el, close) => {
        const stageImg = $('.crop-img', el), box = $('.crop-box', el), dims = $('.crop-dims', el), stage = $('.crop-stage', el);
        let source;
        try {
          source = await fetch(src, { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error(); return r.blob(); });
        } catch { toast('Couldn’t load the image', { tone: 'error' }); close(); return; }
        const url = URL.createObjectURL(source);
        stageImg.src = url;
        await stageImg.decode().catch(() => {});
        let ratio = null;
        const c = { x: 0, y: 0, w: 0, h: 0 }; // in displayed pixels
        const W = () => stageImg.clientWidth, H = () => stageImg.clientHeight;
        const scale = () => stageImg.naturalWidth / W();
        function draw() {
          Object.assign(box.style, { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` });
          dims.textContent = `${Math.round(c.w * scale())} × ${Math.round(c.h * scale())} pixels`;
        }
        function fit(r) {
          // Largest box of the chosen shape, centred.
          let w = W() * 0.9, h = H() * 0.9;
          if (r) { if (w / h > r) w = h * r; else h = w / r; }
          Object.assign(c, { w, h, x: (W() - w) / 2, y: (H() - h) / 2 });
          draw();
        }
        fit(null);

        el.querySelector('.crop-aspects').addEventListener('click', (e) => {
          const b = e.target.closest('[data-aspect]');
          if (!b) return;
          el.querySelectorAll('[data-aspect]').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
          ratio = ASPECTS.find((a) => a[0] === b.dataset.aspect)[2];
          fit(ratio);
        });
        el.querySelector('[data-crop-reset]').addEventListener('click', () => {
          ratio = null;
          el.querySelectorAll('[data-aspect]').forEach((x, i) => { x.classList.toggle('active', i === 0); x.setAttribute('aria-pressed', String(i === 0)); });
          fit(null);
        });

        stage.addEventListener('pointerdown', (e) => {
          const handleEl = e.target.closest('[data-h]');
          if (!handleEl && !e.target.closest('.crop-box')) return;
          e.preventDefault();
          stage.setPointerCapture(e.pointerId);
          const start = { ...c, px: e.clientX, py: e.clientY };
          const mode = handleEl ? handleEl.dataset.h : 'move';
          const MIN = 24;
          const move = (ev) => {
            const dx = ev.clientX - start.px, dy = ev.clientY - start.py;
            if (mode === 'move') {
              c.x = clamp(start.x + dx, 0, W() - c.w);
              c.y = clamp(start.y + dy, 0, H() - c.h);
            } else {
              const west = mode.includes('w'), north = mode.includes('n');
              const ax = west ? start.x + start.w : start.x;   // fixed (anchor) corner
              const ay = north ? start.y + start.h : start.y;
              let w = clamp((west ? -dx : dx) + start.w, MIN, west ? ax : W() - ax);
              let h = clamp((north ? -dy : dy) + start.h, MIN, north ? ay : H() - ay);
              if (ratio) {
                if (w / h > ratio) w = h * ratio; else h = w / ratio;
                const maxW = west ? ax : W() - ax, maxH = north ? ay : H() - ay;
                if (w > maxW) { w = maxW; h = w / ratio; }
                if (h > maxH) { h = maxH; w = h * ratio; }
              }
              c.w = w; c.h = h;
              c.x = west ? ax - w : ax;
              c.y = north ? ay - h : ay;
            }
            draw();
          };
          const up = () => {
            stage.removeEventListener('pointermove', move);
            stage.removeEventListener('pointerup', up);
            stage.removeEventListener('pointercancel', up);
          };
          stage.addEventListener('pointermove', move);
          stage.addEventListener('pointerup', up);
          stage.addEventListener('pointercancel', up);
        });
        // Arrow keys nudge the crop area.
        box.addEventListener('keydown', (e) => {
          const step = e.shiftKey ? 10 : 2;
          const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
          if (!d) return;
          e.preventDefault();
          c.x = clamp(c.x + d[0], 0, W() - c.w);
          c.y = clamp(c.y + d[1], 0, H() - c.h);
          draw();
        });

        el.querySelector('[data-crop-apply]').addEventListener('click', async () => {
          const s = scale();
          const sx = Math.round(c.x * s), sy = Math.round(c.y * s);
          const sw = Math.max(1, Math.round(c.w * s)), sh = Math.max(1, Math.round(c.h * s));
          const canvas = document.createElement('canvas');
          canvas.width = sw; canvas.height = sh;
          canvas.getContext('2d').drawImage(stageImg, sx, sy, sw, sh, 0, 0, sw, sh);
          const type = source.type === 'image/png' || source.type === 'image/gif' ? 'image/png' : 'image/jpeg';
          result = await new Promise((r) => canvas.toBlob(r, type, 0.92));
          close();
        });
      },
      onClose: () => resolve(result),
    });
  });
}
