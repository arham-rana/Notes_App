// Page setup shared by the browser (page view, print) and the server (Word export).
export const PAPER = {
  letter: { label: 'Letter (8.5 × 11 in)', w: 8.5, h: 11 },
  legal: { label: 'Legal (8.5 × 14 in)', w: 8.5, h: 14 },
  tabloid: { label: 'Tabloid (11 × 17 in)', w: 11, h: 17 },
  a4: { label: 'A4 (210 × 297 mm)', w: 8.27, h: 11.69 },
  a5: { label: 'A5 (148 × 210 mm)', w: 5.83, h: 8.27 },
};
export const PAGE_COLORS = { '#ffffff': 'White', '#fbf6e9': 'Cream', '#f3f4f6': 'Light grey', '#eef4fb': 'Light blue', '#eef7f0': 'Light green' };
const PX = 96; // CSS pixels per inch (also what browsers print at)

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const pick = (v, list, d) => (list.includes(v) ? v : d);
const hf = (o = {}, align) => ({
  text: String(o.text ?? '').slice(0, 300),
  align: pick(o.align, ['left', 'center', 'right'], align),
  bold: !!o.bold, italic: !!o.italic,
  size: clamp(o.size, 8, 16, 10),
});

/** A complete, safe page setup from whatever was stored. */
export function normalizeSetup(raw, pageSize = 'letter') {
  let s = raw;
  if (typeof raw === 'string') { try { s = raw ? JSON.parse(raw) : {}; } catch { s = {}; } }
  s = s && typeof s === 'object' ? s : {};
  const m = s.margins || {};
  return {
    size: PAPER[s.size] ? s.size : (PAPER[pageSize] ? pageSize : 'letter'),
    orientation: pick(s.orientation, ['portrait', 'landscape'], 'portrait'),
    margins: { top: clamp(m.top, 0.25, 3, 1), bottom: clamp(m.bottom, 0.25, 3, 1), left: clamp(m.left, 0.25, 3, 1), right: clamp(m.right, 0.25, 3, 1) },
    headerMargin: clamp(s.headerMargin, 0.2, 2, 0.5),
    footerMargin: clamp(s.footerMargin, 0.2, 2, 0.5),
    header: hf(s.header, 'left'),
    footer: hf(s.footer, 'center'),
    differentFirst: !!s.differentFirst,
    pageNumbers: {
      place: pick(s.pageNumbers?.place, ['none', 'header', 'footer'], 'none'),
      align: pick(s.pageNumbers?.align, ['left', 'center', 'right'], 'right'),
      format: pick(s.pageNumbers?.format, ['n', 'n-of-m'], 'n'),
    },
    color: '#ffffff', // pages are always white
  };
}

/** Page and margin sizes in CSS pixels. */
export function pageMetrics(setup) {
  const p = PAPER[setup.size] || PAPER.letter;
  const [wIn, hIn] = setup.orientation === 'landscape' ? [p.h, p.w] : [p.w, p.h];
  const m = setup.margins;
  const r = (x) => Math.round(x * PX);
  return {
    wIn, hIn, width: r(wIn), height: r(hIn),
    top: r(m.top), bottom: r(m.bottom), left: r(m.left), right: r(m.right),
    headerAt: r(setup.headerMargin), footerAt: r(setup.footerMargin),
    body: r(hIn) - r(m.top) - r(m.bottom), // height available for text on each page
    text: r(wIn) - r(m.left) - r(m.right),
  };
}

/** Fill {page}, {pages}, {title} and {date}. */
export const fillTokens = (text, v) => String(text || '').replace(/\{(page|pages|title|date)\}/g, (m, k) => (v[k] ?? m));
