// Word (.docx) export, built from the same document structure the editor uses.
import fs from 'node:fs';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType,
  ExternalHyperlink, ImageRun, BorderStyle, ShadingType, PageBreak, Math as DocMath, MathRun, LevelFormat,
  Header, Footer, PageNumber, PageOrientation,
} from 'docx';
import { normalizeSetup, PAPER } from '../shared/pages.mjs';
import sizeOf from 'image-size';
import { markdownToDoc } from '../shared/convert.mjs';

const COLORS = { gray: '6B7280', red: 'D1242F', orange: 'C2620A', green: '1A7F37', blue: '0969DA', purple: '8250DF', pink: 'BF3989' };
const HIGHLIGHT = { yellow: 'yellow', green: 'green', blue: 'cyan', pink: 'magenta', orange: 'darkYellow' };
const FONTS = { serif: 'Georgia', mono: 'Menlo', hand: 'Bradley Hand' };
const ALIGN = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
const LH = { '1': 240, '1.15': 276, '1.5': 360, '2': 480 };
const SA = { '0': 0, '1': 90, '2': 240, '3': 420 };

export async function buildDocx({ note, filePath, origin, pageSize = 'letter', signatures = new Map() }) {
  const doc = markdownToDoc(note.content);
  const setup = normalizeSetup(note.pageSetup, pageSize);
  const paged = note.layout === 'pages';
  const paper = PAPER[setup.size] || PAPER.letter;
  const tw = (inches) => Math.round(inches * 1440);
  const landscape = paged && setup.orientation === 'landscape';
  const [pw, ph] = landscape ? [paper.h, paper.w] : [paper.w, paper.h];
  const mg = paged ? setup.margins : { top: 1, bottom: 1, left: 1, right: 1 };
  const contentWidthPx = Math.round((pw - mg.left - mg.right) * 96);

  const runs = (nodes = [], base = {}) => {
    const out = [];
    for (const n of nodes) {
      if (n.type === 'hardBreak') { out.push(new TextRun({ break: 1 })); continue; }
      if (n.type === 'dropdown') { let d = {}; try { d = JSON.parse(n.attrs.data); } catch { /* */ } out.push(new TextRun({ text: d.v || '—', bold: true, shading: { type: ShadingType.CLEAR, fill: 'EEF1F5' } })); continue; }
      if (n.type === 'mention') { out.push(new TextRun({ text: `@${n.attrs.label}`, bold: true, color: '0969DA' })); continue; }
      if (n.type === 'mathInline') { out.push(new DocMath({ children: [new MathRun(n.attrs.latex)] })); continue; }
      if (n.type === 'fileChip') { out.push(new ExternalHyperlink({ link: origin + n.attrs.href + '?download', children: [new TextRun({ text: n.attrs.name, style: 'Hyperlink' })] })); continue; }
      if (n.type === 'image') { const img = imageRun(n.attrs); if (img) out.push(img); continue; }
      if (n.type !== 'text') continue;
      const m = Object.fromEntries((n.marks || []).map((x) => [x.type, x.attrs || true]));
      const ts = m.textStyle || {};
      const opts = {
        text: n.text, bold: !!m.bold, italics: !!m.italic, strike: !!m.strike,
        underline: m.underline ? {} : undefined, superScript: !!m.superscript, subScript: !!m.subscript,
        color: ts.color ? (ts.color.startsWith('#') ? ts.color.slice(1) : COLORS[ts.color]) : undefined, highlight: m.highlight ? HIGHLIGHT[m.highlight.color] || 'yellow' : undefined,
        font: m.code ? 'Menlo' : ts.font ? FONTS[ts.font] : undefined, size: ts.size ? ts.size * 1.5 : undefined, ...base,
      };
      if (m.link) {
        const href = m.link.href.startsWith('#') ? `${origin}/${m.link.href}` : m.link.href;
        out.push(new ExternalHyperlink({ link: href, children: [new TextRun({ ...opts, style: 'Hyperlink' })] }));
      } else out.push(new TextRun(opts));
    }
    return out;
  };

  const imageRun = ({ src, width }) => {
    const m = String(src).match(/^\/api\/files\/([0-9a-f-]{36})$/);
    if (!m) return null;
    try {
      const data = fs.readFileSync(filePath(m[1]));
      const dim = sizeOf(data);
      const type = { jpg: 'jpg', jpeg: 'jpg', png: 'png', gif: 'gif', bmp: 'bmp' }[dim.type];
      if (!type) return null;
      const w = Math.min(contentWidthPx * ((width || 100) / 100), dim.width);
      return new ImageRun({ type, data, transformation: { width: Math.round(w), height: Math.round(w * (dim.height / dim.width)) } });
    } catch { return null; }
  };

  const paraOpts = (a = {}) => ({
    alignment: ALIGN[a.textAlign],
    indent: a.indent ? { left: a.indent * 720 } : undefined,
    spacing: { line: a.lh ? LH[a.lh] : undefined, after: a.sa !== null && a.sa !== undefined ? SA[a.sa] : undefined },
  });
  const children = []; // content only (no title)
  const headings = [];
  doc.content.forEach((b) => { if (b.type === 'heading') headings.push(b); });

  const list = (b, level = 0) => {
    for (const item of b.content || []) {
      const p = item.content?.find((c) => c.type === 'paragraph');
      const prefix = b.type === 'taskList' ? [new TextRun(item.attrs?.checked ? '☑ ' : '☐ ')] : [];
      children.push(new Paragraph({
        ...paraOpts(item.attrs),
        numbering: b.type === 'taskList' ? undefined : { reference: b.type === 'orderedList' ? 'numbers' : 'bullets', level: Math.min(level, 3) },
        indent: b.type === 'taskList' ? { left: 360 + level * 360 } : undefined,
        children: [...prefix, ...runs(p?.content, item.attrs?.checked ? { strike: true, color: '808080' } : {})],
      }));
      for (const c of item.content || []) if (['bulletList', 'orderedList', 'taskList'].includes(c.type)) list(c, level + 1);
    }
  };

  for (const b of doc.content) {
    switch (b.type) {
      case 'heading': children.push(new Paragraph({ ...paraOpts(b.attrs), heading: b.attrs.level === 3 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1, children: runs(b.content) })); break;
      case 'paragraph': children.push(new Paragraph({ ...paraOpts(b.attrs), children: runs(b.content) })); break;
      case 'callout': children.push(new Paragraph({ ...paraOpts(b.attrs), shading: { type: ShadingType.CLEAR, fill: 'EAF2FE' }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: '2B77EE', space: 8 } }, children: [new TextRun('💡 '), ...runs(b.content)] })); break;
      case 'bulletList': case 'orderedList': case 'taskList': list(b); break;
      case 'codeBlock': {
        const lines = (b.content?.[0]?.text || '').split('\n');
        lines.forEach((l) => children.push(new Paragraph({ shading: { type: ShadingType.CLEAR, fill: 'F4F6F9' }, spacing: { after: 0 }, children: [new TextRun({ text: l || ' ', font: 'Menlo', size: 19 })] })));
        children.push(new Paragraph({ children: [] }));
        break;
      }
      case 'table': {
        const rows = b.content.map((r, ri) => new TableRow({ tableHeader: ri === 0, children: r.content.map((cell) => new TableCell({ shading: ri === 0 ? { type: ShadingType.CLEAR, fill: 'EEF1F5' } : undefined, children: [new Paragraph({ children: runs(cell.content?.[0]?.content, ri === 0 ? { bold: true } : {}) })] })) }));
        children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
        children.push(new Paragraph({ children: [] }));
        break;
      }
      case 'horizontalRule': children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BBBBBB', space: 4 } }, children: [] })); break;
      case 'pageBreak': children.push(new Paragraph({ children: [new PageBreak()] })); break;
      case 'chart': {
        let spec = {}; try { spec = JSON.parse(b.attrs.spec); } catch { /* */ }
        const img = spec.snap ? imageRun({ src: spec.snap, width: 100 }) : null;
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: img ? [img] : [new TextRun({ text: `[Chart: ${spec.title || 'untitled'}]`, italics: true })] }));
        break;
      }
      case 'embed': {
        let d = {}; try { d = JSON.parse(b.attrs.data); } catch { /* */ }
        if (/^(https:|vscode)/i.test(d.u || '')) children.push(new Paragraph({ children: [new TextRun({ text: `${d.t || 'Embedded app'}: `, bold: true }), new ExternalHyperlink({ link: d.u, children: [new TextRun({ text: d.u, style: 'Hyperlink' })] })] }));
        break;
      }
      case 'signature': {
        const sg = signatures.get(b.attrs.id);
        if (sg?.status === 'signed') {
          const img = imageRun({ src: sg.image, width: 35 });
          if (img) children.push(new Paragraph({ children: [img] }));
          children.push(new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 6, color: '555555', space: 2 } }, children: [new TextRun({ text: sg.signedName, bold: true }), new TextRun({ text: `   Signed ${new Date(sg.signedAt).toLocaleDateString('en-CA')}`, color: '666666' })] }));
        } else {
          children.push(new Paragraph({ spacing: { before: 480 }, border: { top: { style: BorderStyle.SINGLE, size: 6, color: '555555', space: 2 } }, children: [new TextRun({ text: `Signature needed${sg?.signer ? ` from ${sg.signer.name}` : ''}${sg?.label ? ` (${sg.label})` : ''}`, italics: true, color: '666666' })] }));
        }
        break;
      }
      case 'mathBlock': children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new DocMath({ children: [new MathRun(b.attrs.latex)] })] })); break;
      case 'toc':
        children.push(new Paragraph({ children: [new TextRun({ text: 'Contents', bold: true })] }));
        headings.forEach((h) => children.push(new Paragraph({ indent: { left: h.attrs.level === 3 ? 720 : 360 }, children: [new TextRun(h.content?.map((t) => t.text || '').join('') || 'Untitled')] })));
        break;
      default: break;
    }
  }

  // Headers and footers (page view): text with {page}, {pages}, {title}, {date}, plus page numbers.
  function hfParagraph(kind) {
    const c = setup[kind];
    const pn = setup.pageNumbers.place === kind;
    if (!c.text && !pn) return null;
    const style = { bold: c.bold, italics: c.italic, size: c.size * 2, color: '4B5260' };
    const parts = [];
    String(c.text).split(/(\{page\}|\{pages\}|\{title\}|\{date\})/).forEach((t) => {
      if (!t) return;
      if (t === '{page}') parts.push(new TextRun({ ...style, children: [PageNumber.CURRENT] }));
      else if (t === '{pages}') parts.push(new TextRun({ ...style, children: [PageNumber.TOTAL_PAGES] }));
      else if (t === '{title}') parts.push(new TextRun({ ...style, text: note.title || 'Untitled' }));
      else if (t === '{date}') parts.push(new TextRun({ ...style, text: new Date().toLocaleDateString('en-CA') }));
      else parts.push(new TextRun({ ...style, text: t }));
    });
    if (pn) {
      if (parts.length) parts.push(new TextRun({ ...style, text: '    ' }));
      parts.push(...(setup.pageNumbers.format === 'n-of-m'
        ? [new TextRun({ ...style, text: 'Page ' }), new TextRun({ ...style, children: [PageNumber.CURRENT] }), new TextRun({ ...style, text: ' of ' }), new TextRun({ ...style, children: [PageNumber.TOTAL_PAGES] })]
        : [new TextRun({ ...style, children: [PageNumber.CURRENT] })]));
    }
    const align = pn && !c.text ? setup.pageNumbers.align : c.align;
    return new Paragraph({ alignment: { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT }[align], children: parts });
  }
  function hf() {
    const h = hfParagraph('header'), f = hfParagraph('footer');
    const out = {};
    if (h) out.headers = { default: new Header({ children: [h] }), ...(setup.differentFirst ? { first: new Header({ children: [new Paragraph('')] }) } : {}) };
    if (f) out.footers = { default: new Footer({ children: [f] }), ...(setup.differentFirst ? { first: new Footer({ children: [new Paragraph('')] }) } : {}) };
    return out;
  }

  const levels = (fmt) => [0, 1, 2, 3].map((level) => ({
    level, format: fmt === 'numbers' ? LevelFormat.DECIMAL : LevelFormat.BULLET, text: fmt === 'numbers' ? `%${level + 1}.` : ['•', '◦', '▪', '•'][level],
    alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
  const file = new Document({
    creator: 'Notes', title: note.title || 'Untitled',
    numbering: { config: [{ reference: 'bullets', levels: levels('bullets') }, { reference: 'numbers', levels: levels('numbers') }] },
    styles: { default: { document: { run: { font: 'Calibri', size: 23 } } } },
    sections: [{
      properties: {
        titlePage: paged && setup.differentFirst,
        page: {
          // docx expects portrait dimensions plus an orientation flag.
          size: { width: tw(paper.w), height: tw(paper.h), orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
          margin: { top: tw(mg.top), bottom: tw(mg.bottom), left: tw(mg.left), right: tw(mg.right), header: tw(paged ? setup.headerMargin : 0.5), footer: tw(paged ? setup.footerMargin : 0.5) },
        },
      },
      ...(paged ? hf() : {}),
      children,
    }],
  });
  return Packer.toBuffer(file);
}
