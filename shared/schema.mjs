// The document model, shared by the browser editor and the server.
// Node views (interactive rendering) are added in the browser only.
import { Node, Mark, Extension, mergeAttributes, getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Mention from '@tiptap/extension-mention';

export const FONT_STACKS = {
  serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  hand: '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive',
};
export const LINE_HEIGHTS = { '1': 1.2, '1.15': 1.4, '1.5': 1.8, '2': 2.4 };
export const SPACE_AFTER = { '0': 0, '1': 6, '2': 16, '3': 28 };
const BLOCK_TYPES = ['paragraph', 'heading', 'listItem', 'taskItem', 'callout'];

/** Indent, line spacing and space-after on paragraphs, headings, list items and callouts. */
export const ParagraphSettings = Extension.create({
  name: 'paragraphSettings',
  addGlobalAttributes() {
    return [{
      types: BLOCK_TYPES,
      attributes: {
        indent: {
          default: 0,
          parseHTML: (el) => Number(el.dataset.indent) || 0,
          renderHTML: (a) => (a.indent ? { 'data-indent': a.indent, style: `margin-left:${a.indent * 2}em` } : {}),
        },
        lh: {
          default: null,
          parseHTML: (el) => el.dataset.lh || null,
          renderHTML: (a) => (a.lh ? { 'data-lh': a.lh, style: `line-height:${LINE_HEIGHTS[a.lh]}` } : {}),
        },
        sa: {
          default: null,
          parseHTML: (el) => (el.dataset.sa !== undefined ? el.dataset.sa : null),
          renderHTML: (a) => (a.sa !== null && a.sa !== undefined ? { 'data-sa': a.sa, style: `margin-bottom:${SPACE_AFTER[a.sa]}px` } : {}),
        },
      },
    }];
  },
});

/** Font, size and text colour as keys on the textStyle mark. */
export const TextStyleKeys = Extension.create({
  name: 'textStyleKeys',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        font: {
          default: null,
          parseHTML: (el) => el.dataset.font || null,
          renderHTML: (a) => (a.font ? { 'data-font': a.font, style: `font-family:${FONT_STACKS[a.font] || 'inherit'}` } : {}),
        },
        size: {
          default: null,
          parseHTML: (el) => Number(el.dataset.size) || null,
          renderHTML: (a) => (a.size ? { 'data-size': a.size, style: `font-size:${a.size}px` } : {}),
        },
        color: {
          default: null,
          parseHTML: (el) => el.dataset.color || null,
          renderHTML: (a) => (a.color ? { 'data-color': a.color, style: `color:${/^#[0-9a-f]{6}$/i.test(a.color) ? a.color : `var(--tc-${a.color})`}` } : {}),
        },
      },
    }];
  },
});

/** Highlighter with a named colour. */
export const Highlighter = Mark.create({
  name: 'highlight',
  addAttributes() {
    return { color: { default: 'yellow', parseHTML: (el) => el.dataset.hl || 'yellow', renderHTML: (a) => ({ 'data-hl': a.color, style: `background-color:var(--hl-${a.color})` }) } };
  },
  parseHTML() { return [{ tag: 'mark' }, { tag: 'span[data-hl]' }]; },
  renderHTML({ HTMLAttributes }) { return ['mark', mergeAttributes({ class: 'st' }, HTMLAttributes), 0]; },
});

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'inline*',
  defining: true,
  parseHTML() { return [{ tag: 'blockquote' }, { tag: 'div.callout' }]; },
  renderHTML({ HTMLAttributes }) { return ['blockquote', mergeAttributes({ class: 'callout-block' }, HTMLAttributes), 0]; },
});

export const Toc = Node.create({
  name: 'toc', group: 'block', atom: true, selectable: true,
  parseHTML() { return [{ tag: 'div[data-toc]' }]; },
  renderHTML() { return ['div', { 'data-toc': '1', class: 'toc toc-block' }, ['p', { class: 'toc-title' }, 'Contents']]; },
});

export const PageBreak = Node.create({
  name: 'pageBreak', group: 'block', atom: true, selectable: true,
  parseHTML() { return [{ tag: 'div[data-page-break]' }]; },
  renderHTML() { return ['div', { 'data-page-break': '1', class: 'page-break' }]; },
});

export const MathBlock = Node.create({
  name: 'mathBlock', group: 'block', atom: true, selectable: true,
  addAttributes() { return { latex: { default: '', parseHTML: (el) => el.dataset.latex || '' } }; },
  parseHTML() { return [{ tag: 'div[data-math-block]' }]; },
  renderHTML({ node }) { return ['div', { 'data-math-block': '1', 'data-latex': node.attrs.latex, class: 'math-block' }, node.attrs.latex]; },
});

export const MathInline = Node.create({
  name: 'mathInline', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { latex: { default: '', parseHTML: (el) => el.dataset.latex || '' } }; },
  parseHTML() { return [{ tag: 'span[data-math-inline]' }]; },
  renderHTML({ node }) { return ['span', { 'data-math-inline': '1', 'data-latex': node.attrs.latex, class: 'math-inline' }, node.attrs.latex]; },
});

export const FileChip = Node.create({
  name: 'fileChip', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { href: { default: '' }, name: { default: 'file' } }; },
  parseHTML() { return [{ tag: 'a.file-chip', getAttrs: (el) => ({ href: el.dataset.file || el.getAttribute('href')?.replace(/\?download$/, ''), name: el.textContent }) }]; },
  renderHTML({ node }) { return ['a', { class: 'file-chip', href: `${node.attrs.href}?download`, 'data-file': node.attrs.href, contenteditable: 'false' }, node.attrs.name]; },
});

export const DocImage = Node.create({
  name: 'image', group: 'inline', inline: true, atom: true, draggable: true, selectable: true,
  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: 'image' },
      width: { default: null, parseHTML: (el) => parseInt(el.style.width, 10) || null },
      shapes: { default: null, parseHTML: (el) => el.dataset.shapes || null }, // editable drawing (shapes as JSON)
    };
  },
  parseHTML() { return [{ tag: 'img[src]' }]; },
  renderHTML({ node }) {
    return ['img', { class: `doc-img${node.attrs.shapes ? ' is-drawing' : ''}`, src: node.attrs.src, alt: node.attrs.alt, 'data-shapes': node.attrs.shapes || null, style: node.attrs.width && node.attrs.width < 100 ? `width:${node.attrs.width}%` : null }];
  },
});

/** Dropdown chip: { o: [{ l: label, c: colour }], v: chosen label } stored as JSON. */
export const Dropdown = Node.create({
  name: 'dropdown', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { data: { default: '{"o":[],"v":""}', parseHTML: (el) => el.dataset.dropdown || '{"o":[],"v":""}' } }; },
  parseHTML() { return [{ tag: 'span[data-dropdown]' }]; },
  renderHTML({ node }) { let v = ''; try { v = JSON.parse(node.attrs.data).v; } catch { /* */ } return ['span', { 'data-dropdown': node.attrs.data, class: 'dd-chip' }, v || 'Choose…']; },
});
/** Chart: { t: bar|column|line|pie, title, labels, series: [{ n, v: [], c }], legend, snap } as JSON. */
export const Chart = Node.create({
  name: 'chart', group: 'block', atom: true, selectable: true, draggable: true,
  addAttributes() { return { spec: { default: '{}', parseHTML: (el) => el.dataset.chart || '{}' } }; },
  parseHTML() { return [{ tag: 'div[data-chart]' }]; },
  renderHTML({ node }) { return ['div', { 'data-chart': node.attrs.spec, class: 'chart-block' }]; },
});
/** Signature box: the signed details live on the server (so they can't be altered by editing). */
export const Signature = Node.create({
  name: 'signature', group: 'block', atom: true, selectable: true,
  addAttributes() { return { id: { default: '', parseHTML: (el) => el.dataset.sig || '' } }; },
  parseHTML() { return [{ tag: 'div[data-sig]' }]; },
  renderHTML({ node }) { return ['div', { 'data-sig': node.attrs.id, class: 'sig-block' }]; },
});

/** Embedded app or link card: { u: link, k: kind, t: title, h: height } as JSON. */
export const Embed = Node.create({
  name: 'embed', group: 'block', atom: true, selectable: true, draggable: true,
  addAttributes() { return { data: { default: '{}', parseHTML: (el) => el.dataset.embed || '{}' } }; },
  parseHTML() { return [{ tag: 'div[data-embed]' }]; },
  renderHTML({ node }) { return ['div', { 'data-embed': node.attrs.data, class: 'embed-host' }]; },
});

const safeHref = (href) => /^(https?:|mailto:|#\/documents\/[0-9a-f-]{36}$)/i.test(href || '');

/** Everything a document can contain. Browser-only behaviour is layered on top. */
export function baseExtensions({ mention = {} } = {}) {
  return [
    StarterKit.configure({ history: false, blockquote: false, heading: { levels: [2, 3] }, codeBlock: { languageClassPrefix: 'language-', exitOnTripleEnter: false } }),
    Underline, Subscript, Superscript,
    TextStyle, TextStyleKeys, Highlighter,
    TextAlign.configure({ types: ['heading', 'paragraph', 'callout', 'listItem', 'taskItem'] }),
    ParagraphSettings,
    Link.configure({ openOnClick: false, autolink: false, linkOnPaste: true, validate: safeHref, HTMLAttributes: { rel: 'noopener noreferrer', target: null } }),
    Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
    TaskList, TaskItem.configure({ nested: true }),
    Mention.configure({ HTMLAttributes: { class: 'mention' }, renderText: ({ node }) => `@${node.attrs.label || node.attrs.id}`, renderHTML: ({ node, options }) => ['span', mergeAttributes({ 'data-type': 'mention' }, options.HTMLAttributes), `@${node.attrs.label || node.attrs.id}`], ...mention }),
    Callout, Toc, PageBreak, MathBlock, MathInline, FileChip, DocImage, Dropdown, Chart, Signature, Embed,
  ];
}

let cached;
export const documentSchema = () => (cached ||= getSchema(baseExtensions()));
