// Code colouring (like a code editor) and language detection. Shared by the editor,
// reading view, page view and print. Returns ranges; callers turn them into spans.

export const LANG_NAMES = {
  text: 'Plain text', js: 'JavaScript', ts: 'TypeScript', python: 'Python', html: 'HTML', css: 'CSS', json: 'JSON',
  sql: 'SQL', shell: 'Shell', java: 'Java', c: 'C / C++', go: 'Go', rust: 'Rust', swift: 'Swift', php: 'PHP', ruby: 'Ruby',
};

const words = (s) => new Set(s.split(' '));
const KEYWORDS = words('abstract and as assert async await break case catch class const continue def default defer del do elif else enum except export extends '
  + 'final finally fn for from func function global go if impl implements import in instanceof interface is lambda let loop match mod module mut namespace new '
  + 'nonlocal not or package pass private protected pub public raise return static struct super switch then this throw throws trait try type typeof '
  + 'use var void when where while with yield self Self unless until begin end elsif rescue ensure module require include using goto sizeof typedef '
  + 'extern union volatile register signed unsigned auto inline override virtual readonly declare keyof infer satisfies of get set guard protocol '
  + 'extension inout fileprivate internal open operator echo fi done esac local');
const LITERALS = words('true false null undefined None True False nil NaN Infinity');
const TYPES = words('int float double char bool boolean string str number void byte short long any never unknown object Object String Number Boolean Array '
  + 'Map Set Promise Error Date RegExp list dict tuple set bytes i8 i16 i32 i64 u8 u16 u32 u64 f32 f64 usize isize Vec Option Result Int Float Double Bool');
const BUILTINS = words('console window document Math JSON fetch setTimeout setInterval require module exports process print len range input open enumerate zip map filter '
  + 'sorted sum min max abs isinstance type super printf println fmt std echo cd ls grep sed awk curl git npm docker sudo');
const SQL_KW = words('select from where insert into update delete create table drop alter join left right inner outer full on group by order having limit offset values '
  + 'set as and or not null is in like between distinct union all case when then else end primary key foreign references index view with returning default '
  + 'asc desc count sum avg min max exists unique check constraint begin commit rollback');
const SHELL_KW = words('if then else elif fi for while until do done case esac in function return export local readonly echo exit source alias unset');

/** Guess the language of some code. */
export function detectLang(code) {
  const c = String(code || '').trim();
  if (!c) return 'text';
  if (/^<\?php/.test(c)) return 'php';
  if (/^\s*[{[]/.test(c)) { try { JSON.parse(c); return 'json'; } catch { /* not JSON */ } }
  if (/^<(!doctype|html|[a-z][\w-]*)(\s|>)/i.test(c) && /<\/[a-z]/i.test(c)) return 'html';
  if (/^#!.*\b(ba|z)?sh\b/.test(c) || /^\s*(\$ |sudo |npm |npx |yarn |pip |brew |cd |ls |echo |export |docker |git )/m.test(c)) return 'shell';
  if (/^\s*(select|insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+(table|index|view)|with\s+\w+\s+as)\b/i.test(c)) return 'sql';
  if (/^\s*#include\s*[<"]/m.test(c)) return 'c';
  if (/\bfn\s+\w+\s*\(|\blet\s+mut\b|::\w+|println!\(/.test(c)) return 'rust';
  if (/^\s*package\s+\w+/m.test(c) && /\bfunc\b/.test(c)) return 'go';
  if (/\bpublic\s+(static\s+)?(class|void)\b|System\.out\./.test(c)) return 'java';
  if (/\bfunc\s+\w+\s*\(.*\)\s*(->|\{)|\bguard\s+let\b/.test(c)) return 'swift';
  if (/^\s*(def\s+\w+\s*\(.*\)\s*:|class\s+\w+(\(.*\))?\s*:|from\s+\w+(\.\w+)*\s+import\b|import\s+\w+\s*$|elif\b|print\()/m.test(c) && !/[{};]\s*$/m.test(c)) return 'python';
  if (/^\s*(def\s+\w+|end\s*$|puts\s)/m.test(c) && !/:\s*$/m.test(c)) return 'ruby';
  if (/^[\s\S]*?[\w\-.#:\[\]*>~+]+\s*\{[\s\S]*?[\w-]+\s*:\s*[^;{}]+;/.test(c) && !/\b(function|const|let|var|return)\b/.test(c)) return 'css';
  if (/:\s*(string|number|boolean|any)\b|\binterface\s+\w+|\btype\s+\w+\s*=|<\w+>\(/.test(c)) return 'ts';
  return 'js';
}

/* ---------- Tokenisers ---------- */
function push(out, from, to, cls) { if (to > from) out.push({ from, to, cls }); }

function tokenizeHtml(code) {
  const out = [];
  const re = /(<!--[\s\S]*?-->)|(<\/?)([a-zA-Z][\w:-]*)|("[^"]*"|'[^']*')|([a-zA-Z_:][\w:.-]*)(?==)|(\/?>)/g;
  let m, inTag = false;
  while ((m = re.exec(code))) {
    if (m[1]) push(out, m.index, m.index + m[0].length, 'tk-c');
    else if (m[2]) { push(out, m.index, m.index + m[2].length, 'tk-o'); push(out, m.index + m[2].length, m.index + m[0].length, 'tk-tag'); inTag = true; }
    else if (m[4] && inTag) push(out, m.index, m.index + m[0].length, 'tk-s');
    else if (m[5] && inTag) push(out, m.index, m.index + m[0].length, 'tk-a');
    else if (m[6]) { push(out, m.index, m.index + m[0].length, 'tk-o'); inTag = false; }
  }
  return out;
}

function tokenizeCss(code) {
  const out = [];
  const re = /(\/\*[\s\S]*?\*\/)|("[^"]*"|'[^']*')|(@[\w-]+)|(#[0-9a-fA-F]{3,8}\b)|(-?\d*\.?\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr|pt)?\b)|([\w-]+)(?=\s*:(?!:))|([{}:;,>+~])|(![a-z]+)/g;
  let m, depth = 0;
  while ((m = re.exec(code))) {
    const s = m.index, e = s + m[0].length;
    if (m[1]) push(out, s, e, 'tk-c');
    else if (m[2]) push(out, s, e, 'tk-s');
    else if (m[3] || m[8]) push(out, s, e, 'tk-k');
    else if (m[4] || m[5]) push(out, s, e, 'tk-n');
    else if (m[6]) push(out, s, e, depth > 0 ? 'tk-p' : 'tk-tag');
    else if (m[7]) { if (m[7] === '{') depth++; if (m[7] === '}') depth = Math.max(0, depth - 1); push(out, s, e, 'tk-o'); }
  }
  return out;
}

function tokenizeJson(code) {
  const out = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;
  let m;
  while ((m = re.exec(code))) {
    const s = m.index;
    if (m[1]) push(out, s, s + m[1].length, m[2] ? 'tk-key' : 'tk-s');
    else if (m[3]) push(out, s, s + m[0].length, 'tk-n');
    else if (m[4]) push(out, s, s + m[0].length, 'tk-l');
    else if (m[5]) push(out, s, s + m[0].length, 'tk-o');
  }
  return out;
}

function tokenizeCodeLike(code, lang) {
  const out = [];
  const hash = ['python', 'shell', 'ruby'].includes(lang);
  const comment = lang === 'sql' ? '--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/' : hash ? '#[^\\n]*' : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/';
  const strings = lang === 'python' ? '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|[fFrRbB]?"(?:\\\\.|[^"\\\\\\n])*"|[fFrRbB]?\'(?:\\\\.|[^\'\\\\\\n])*\''
    : '`(?:\\\\.|[^`\\\\])*`|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'';
  const re = new RegExp(`(${comment})|(${strings})|(\\b0[xX][0-9a-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)|(@[A-Za-z_][\\w.]*)|(\\$\\{?[A-Za-z_]\\w*\\}?)|([A-Za-z_$][\\w$]*!?)|(=>|->|[+\\-*/%=<>!&|^~?:]+)`, 'g');
  let m;
  while ((m = re.exec(code))) {
    const s = m.index, e = s + m[0].length;
    if (m[1]) push(out, s, e, 'tk-c');
    else if (m[2]) push(out, s, e, 'tk-s');
    else if (m[3]) push(out, s, e, 'tk-n');
    else if (m[4]) push(out, s, e, lang === 'shell' ? 'tk-p' : 'tk-d');
    else if (m[5]) push(out, s, e, lang === 'shell' || lang === 'php' ? 'tk-p' : 'tk-o');
    else if (m[6]) {
      const w = m[6];
      const before = code.slice(Math.max(0, s - 1), s);
      const after = code.slice(e).match(/^\s*(\(|!)?/)[1];
      const lower = w.toLowerCase();
      if (lang === 'sql') { if (SQL_KW.has(lower)) push(out, s, e, 'tk-k'); else if (after === '(') push(out, s, e, 'tk-f'); continue; }
      if (lang === 'shell') {
        if (SHELL_KW.has(w)) push(out, s, e, 'tk-k');
        else if (/(^|\n)\s*$/.test(code.slice(0, s)) || BUILTINS.has(w)) push(out, s, e, 'tk-f');
        continue;
      }
      if (LITERALS.has(w)) push(out, s, e, 'tk-l');
      else if (KEYWORDS.has(w)) push(out, s, e, 'tk-k');
      else if (before === '.') push(out, s, e, after === '(' ? 'tk-f' : 'tk-p');
      else if (after === '(' || w.endsWith('!')) push(out, s, e, BUILTINS.has(w) ? 'tk-b' : 'tk-f');
      else if (TYPES.has(w)) push(out, s, e, 'tk-t');
      else if (BUILTINS.has(w)) push(out, s, e, 'tk-b');
      else if (/^[A-Z][a-z]/.test(w)) push(out, s, e, 'tk-t');
    } else if (m[7]) push(out, s, e, 'tk-o');
  }
  return out;
}

/** Colour ranges for some code. lang '' means "detect it". */
export function codeTokens(code, lang = '') {
  const l = lang || detectLang(code);
  if (l === 'text') return [];
  if (l === 'html') return tokenizeHtml(code);
  if (l === 'css') return tokenizeCss(code);
  if (l === 'json') return tokenizeJson(code);
  return tokenizeCodeLike(code, l);
}

const escHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Coloured HTML for some code (reading view, print). */
export function highlightHtml(code, lang = '') {
  let out = '', last = 0;
  for (const t of codeTokens(code, lang)) {
    if (t.from < last) continue;
    out += escHtml(code.slice(last, t.from)) + `<span class="${t.cls}">${escHtml(code.slice(t.from, t.to))}</span>`;
    last = t.to;
  }
  return out + escHtml(code.slice(last));
}
