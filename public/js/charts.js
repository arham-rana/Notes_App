// Charts drawn as SVG (bar, column, line, pie) — used by the editor, reading view, print and exports.
import { esc } from './util.js';
import { icon } from './icons.js';

export const CHART_COLORS = ['#4a86e8', '#e06666', '#f6b26b', '#6aa84f', '#8e7cc3', '#45818e', '#c27ba0', '#a64d79'];
export const CHART_TYPES = { column: 'Column', bar: 'Bar', line: 'Line', pie: 'Pie' };

export function normalizeChart(spec = {}) {
  const labels = (Array.isArray(spec.labels) ? spec.labels : []).map((l) => String(l ?? '').slice(0, 40)).slice(0, 24);
  const series = (Array.isArray(spec.series) ? spec.series : []).slice(0, 8).map((s, i) => ({
    n: String(s?.n ?? `Series ${i + 1}`).slice(0, 40),
    c: /^#[0-9a-f]{6}$/i.test(s?.c || '') ? s.c : CHART_COLORS[i % CHART_COLORS.length],
    v: labels.map((_, j) => { const n = Number(s?.v?.[j]); return Number.isFinite(n) ? n : 0; }),
  }));
  return { t: CHART_TYPES[spec.t] ? spec.t : 'column', title: String(spec.title || '').slice(0, 80), labels, series, legend: spec.legend !== false, snap: typeof spec.snap === 'string' ? spec.snap : '' };
}

const niceMax = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
const fmt = (n) => (Math.abs(n) >= 1000 ? n.toLocaleString() : String(Math.round(n * 100) / 100));

/** SVG markup for a chart. Text uses currentColor so it suits light and dark pages. */
export function chartSvg(raw, { width = 640, height = 360 } = {}) {
  const c = normalizeChart(raw);
  const W = width, H = height;
  const top = c.title ? 44 : 18;
  const legendH = c.legend && c.t !== 'pie' && c.series.length ? 28 : 0;
  const parts = [];
  if (c.title) parts.push(`<text x="${W / 2}" y="26" text-anchor="middle" font-size="16" font-weight="700" fill="currentColor">${esc(c.title)}</text>`);
  if (!c.labels.length || !c.series.length) {
    parts.push(`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="14" fill="currentColor" opacity=".6">Add data to see the chart</text>`);
  } else if (c.t === 'pie') {
    const vals = c.labels.map((_, j) => Math.max(0, c.series[0].v[j]));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const r = Math.min(W * 0.32, (H - top - 16) / 2), cx = c.legend ? W * 0.36 : W / 2, cy = top + (H - top) / 2;
    let a0 = -Math.PI / 2;
    vals.forEach((v, j) => {
      const a1 = a0 + (v / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
      const col = CHART_COLORS[j % CHART_COLORS.length];
      parts.push(v >= total ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${col}"/>` : `<path d="M${cx} ${cy} L${p(a0)} A${r} ${r} 0 ${large} 1 ${p(a1)} Z" fill="${col}" stroke="var(--chart-bg, #fff)" stroke-width="1.5"/>`);
      if (v / total > 0.06) { const am = (a0 + a1) / 2; parts.push(`<text x="${cx + r * 0.62 * Math.cos(am)}" y="${cy + r * 0.62 * Math.sin(am) + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${Math.round((v / total) * 100)}%</text>`); }
      a0 = a1;
    });
    if (c.legend) c.labels.forEach((l, j) => {
      const y = top + 10 + j * 22;
      parts.push(`<rect x="${W * 0.66}" y="${y}" width="12" height="12" rx="2" fill="${CHART_COLORS[j % CHART_COLORS.length]}"/><text x="${W * 0.66 + 18}" y="${y + 11}" font-size="13" fill="currentColor">${esc(l)} (${fmt(vals[j])})</text>`);
    });
  } else {
    const all = c.series.flatMap((s) => s.v);
    const max = niceMax(Math.max(0, ...all)), min = Math.min(0, ...all) < 0 ? -niceMax(-Math.min(...all)) : 0;
    const L = 52, R = 16, B = 34 + legendH, T = top;
    const pw = W - L - R, ph = H - T - B;
    const horizontal = c.t === 'bar';
    const scale = (v) => (v - min) / (max - min || 1);
    for (let i = 0; i <= 4; i++) {
      const v = min + ((max - min) * i) / 4;
      if (horizontal) { const x = L + pw * (i / 4); parts.push(`<line x1="${x}" y1="${T}" x2="${x}" y2="${T + ph}" stroke="currentColor" opacity=".12"/><text x="${x}" y="${T + ph + 16}" text-anchor="middle" font-size="11" fill="currentColor" opacity=".7">${fmt(v)}</text>`); }
      else { const y = T + ph - ph * (i / 4); parts.push(`<line x1="${L}" y1="${y}" x2="${L + pw}" y2="${y}" stroke="currentColor" opacity=".12"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="currentColor" opacity=".7">${fmt(v)}</text>`); }
    }
    const n = c.labels.length, band = (horizontal ? ph : pw) / n;
    c.labels.forEach((l, j) => {
      if (horizontal) parts.push(`<text x="${L - 8}" y="${T + band * j + band / 2 + 4}" text-anchor="end" font-size="11" fill="currentColor">${esc(l.slice(0, 10))}</text>`);
      else parts.push(`<text x="${L + band * j + band / 2}" y="${T + ph + 16}" text-anchor="middle" font-size="11" fill="currentColor">${esc(l.slice(0, 12))}</text>`);
    });
    if (c.t === 'line') {
      c.series.forEach((s) => {
        const pts = s.v.map((v, j) => `${L + band * j + band / 2},${T + ph - ph * scale(v)}`);
        parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${s.c}" stroke-width="2.5" stroke-linejoin="round"/>`);
        pts.forEach((p) => { const [x, y] = p.split(','); parts.push(`<circle cx="${x}" cy="${y}" r="3.5" fill="${s.c}"/>`); });
      });
    } else {
      const k = c.series.length, gap = band * 0.2, bw = (band - gap) / k;
      c.series.forEach((s, si) => s.v.forEach((v, j) => {
        const z = scale(0), a = scale(v);
        if (horizontal) { const y = T + band * j + gap / 2 + si * bw; const x0 = L + pw * Math.min(z, a); parts.push(`<rect x="${x0}" y="${y}" width="${Math.abs(a - z) * pw}" height="${bw - 1}" rx="2" fill="${s.c}"/>`); }
        else { const x = L + band * j + gap / 2 + si * bw; const y0 = T + ph - ph * Math.max(z, a); parts.push(`<rect x="${x}" y="${y0}" width="${bw - 1}" height="${Math.abs(a - z) * ph}" rx="2" fill="${s.c}"/>`); }
      }));
    }
    if (legendH) {
      let x = L;
      c.series.forEach((s) => { parts.push(`<rect x="${x}" y="${H - 18}" width="12" height="12" rx="2" fill="${s.c}"/><text x="${x + 17}" y="${H - 8}" font-size="12" fill="currentColor">${esc(s.n)}</text>`); x += 34 + s.n.length * 7; });
    }
  }
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(c.title || `${CHART_TYPES[c.t]} chart`)}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, -apple-system, Segoe UI, sans-serif">${parts.join('')}</svg>`;
}

/** A PNG snapshot (for Word export). */
export function chartPng(spec, { width = 1280, height = 720, color = '#1f2328' } = {}) {
  const svg = chartSvg(spec, { width: 640, height: 360 }).replace('<svg ', `<svg style="color:${color};background:#fff" `).replace(/currentColor/g, color).replace(/var\(--chart-bg, #fff\)/g, '#fff');
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { const cv = document.createElement('canvas'); cv.width = width; cv.height = height; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, width, height); g.drawImage(img, 0, 0, width, height); cv.toBlob((b) => resolve(b), 'image/png'); };
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace('width="100%"', `width="640" height="360"`))}`;
  });
}

import { openModal } from './ui.js';
/** Edit a chart (type, title, legend and data table) with a live preview. Resolves to a spec or null. */
export function openChartDialog(spec = null) {
  return new Promise((resolve) => {
    let c = normalizeChart(spec || { t: 'column', title: 'Chart title', labels: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ n: 'Series 1', v: [12, 19, 8, 15] }, { n: 'Series 2', v: [7, 11, 14, 9] }] });
    let result = null;
    const grid = () => `<table class="chart-grid"><thead><tr><th></th>${c.series.map((s, i) => `<th><input data-sn="${i}" value="${esc(s.n)}" aria-label="Series ${i + 1} name"><input type="color" data-sc="${i}" value="${s.c}" aria-label="Series ${i + 1} colour"><button type="button" class="icon-btn" data-delcol="${i}" aria-label="Remove series">${icon('x', { size: 14 })}</button></th>`).join('')}<th><button type="button" class="btn btn-plain btn-xs" data-addcol>+ Series</button></th></tr></thead>
      <tbody>${c.labels.map((l, j) => `<tr><th><input data-lb="${j}" value="${esc(l)}" aria-label="Label ${j + 1}"></th>${c.series.map((s, i) => `<td><input data-v="${i}-${j}" value="${s.v[j]}" inputmode="decimal" aria-label="${esc(s.n)} ${esc(l)}"></td>`).join('')}<td><button type="button" class="icon-btn" data-delrow="${j}" aria-label="Remove row">${icon('x', { size: 14 })}</button></td></tr>`).join('')}
      <tr><td colspan="${c.series.length + 2}"><button type="button" class="btn btn-plain btn-xs" data-addrow>+ Row</button></td></tr></tbody></table>`;
    openModal({
      title: spec ? 'Edit chart' : 'Insert chart',
      size: 'xl',
      body: `<div class="chart-dialog">
        <div class="chart-side">
          <div class="segmented chart-types">${Object.entries(CHART_TYPES).map(([k, l]) => `<label><input type="radio" name="ctype" value="${k}" ${c.t === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
          <label class="field"><span>Title</span><input name="ctitle" value="${esc(c.title)}" maxlength="80"></label>
          <label class="check-line"><input type="checkbox" name="clegend" ${c.legend ? 'checked' : ''}> Show legend</label>
          <div class="chart-grid-wrap"></div>
          <p class="muted small">Pie charts use the first series.</p>
        </div>
        <div class="chart-preview"></div>
      </div>`,
      footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-save>${spec ? 'Save' : 'Insert'}</button>`,
      onMount: (el, close) => {
        const wrap = el.querySelector('.chart-grid-wrap'), pv = el.querySelector('.chart-preview');
        const preview = () => { pv.innerHTML = chartSvg(c); };
        const drawGrid = () => { wrap.innerHTML = grid(); preview(); };
        drawGrid();
        el.addEventListener('input', (e) => {
          const t = e.target, d = t.dataset;
          if (t.name === 'ctitle') c.title = t.value;
          if (t.name === 'clegend') c.legend = t.checked;
          if (t.name === 'ctype') c.t = t.value;
          if (d.sn !== undefined) c.series[+d.sn].n = t.value;
          if (d.sc !== undefined) c.series[+d.sc].c = t.value;
          if (d.lb !== undefined) c.labels[+d.lb] = t.value;
          if (d.v !== undefined) { const [i, j] = d.v.split('-').map(Number); c.series[i].v[j] = Number(t.value) || 0; }
          preview();
        });
        el.addEventListener('change', (e) => { if (e.target.name === 'clegend' || e.target.name === 'ctype') { c.legend = el.querySelector('[name=clegend]').checked; c.t = el.querySelector('[name=ctype]:checked').value; preview(); } });
        el.addEventListener('click', (e) => {
          const t = e.target.closest('button'); if (!t) return;
          if (t.dataset.addrow !== undefined) { c.labels.push(`Item ${c.labels.length + 1}`); c.series.forEach((s) => s.v.push(0)); drawGrid(); }
          if (t.dataset.addcol !== undefined && c.series.length < 8) { c.series.push({ n: `Series ${c.series.length + 1}`, c: CHART_COLORS[c.series.length % CHART_COLORS.length], v: c.labels.map(() => 0) }); drawGrid(); }
          if (t.dataset.delrow !== undefined && c.labels.length > 1) { const j = +t.dataset.delrow; c.labels.splice(j, 1); c.series.forEach((s) => s.v.splice(j, 1)); drawGrid(); }
          if (t.dataset.delcol !== undefined && c.series.length > 1) { c.series.splice(+t.dataset.delcol, 1); drawGrid(); }
          if (t.dataset.save !== undefined) { result = normalizeChart(c); close(); }
        });
      },
      onClose: () => resolve(result),
    });
  });
}
