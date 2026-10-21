// Shared definitions for text styles in documents (used by the reader and the editor).

export const FONTS = {
  default: { label: 'Default', stack: '' },
  serif: { label: 'Serif', stack: 'Georgia, "Iowan Old Style", "Times New Roman", serif' },
  mono: { label: 'Mono', stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
  hand: { label: 'Handwriting', stack: '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive' },
};
export const SIZES = [
  { px: 13, label: 'Small' },
  { px: 0, label: 'Normal' },
  { px: 20, label: 'Large' },
  { px: 24, label: 'Extra large' },
  { px: 32, label: 'Huge' },
];
export const TEXT_COLORS = {
  gray: { label: 'Grey' }, red: { label: 'Red' }, orange: { label: 'Orange' }, green: { label: 'Green' },
  blue: { label: 'Blue' }, purple: { label: 'Purple' }, pink: { label: 'Pink' },
};
export const HIGHLIGHTS = {
  yellow: { label: 'Yellow' },
  green: { label: 'Green' },
  blue: { label: 'Blue' },
  pink: { label: 'Pink' },
  orange: { label: 'Orange' },
};

/** "font:serif,size:20,hl:yellow" -> { font, size, hl } (invalid parts dropped). */
export function parseSpec(spec) {
  const out = {};
  for (const part of String(spec).split(',')) {
    const [k, v] = part.split(':');
    if (k === 'font' && FONTS[v] && v !== 'default') out.font = v;
    if (k === 'size' && /^\d{1,3}$/.test(v) && +v >= 6 && +v <= 128) out.size = +v;
    if (k === 'hl' && HIGHLIGHTS[v]) out.hl = v;
    if (k === 'color' && TEXT_COLORS[v]) out.color = v;
    if (k === 'color' && /^x[0-9a-f]{6}$/.test(v)) out.color = `#${v.slice(1)}`;
  }
  return out;
}


/** Opening tag for a styled span. */
export function styleSpanOpen(st) {
  const css = [st.font && `font-family:${FONTS[st.font].stack.replace(/"/g, "'")}`, st.size && `font-size:${st.size}px`, st.hl && `background-color:var(--hl-${st.hl})`, st.color && (st.color.startsWith('#') ? `color:${st.color}` : `color:var(--tc-${st.color})`)].filter(Boolean).join(';');
  return `<span class="st"${st.font ? ` data-font="${st.font}"` : ''}${st.size ? ` data-size="${st.size}"` : ''}${st.hl ? ` data-hl="${st.hl}"` : ''}${st.color ? ` data-color="${st.color}"` : ''}${css ? ` style="${css}"` : ''}>`;
}
