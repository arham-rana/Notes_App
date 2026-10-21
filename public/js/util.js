export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const pad = (n) => String(n).padStart(2, '0');
export const toDateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = () => toDateKey(new Date());
export const nowLocal = () => {
  const d = new Date();
  return `${toDateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Parse "YYYY-MM-DD" (and optional "HH:mm") as a local date. */
export function parseLocal(dateKey, time = '00:00') {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const startOfWeek = (d, weekStartsOn = 0) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(x, -((x.getDay() - weekStartsOn + 7) % 7));
};
export const dayDiff = (aKey, bKey) => Math.round((parseLocal(aKey) - parseLocal(bKey)) / 86400000);
export const toMinutes = (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const monthDayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
export const formatTime = (time) => timeFmt.format(parseLocal('2000-01-01', time));
export const formatMonthDay = (dateKey) => monthDayFmt.format(parseLocal(dateKey));
export const formatHour = (h) => new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2000, 0, 1, h));
export const formatMonthYear = (d) => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(d);
export const formatLongDate = (d) => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(d);
export const weekdayNames = (weekStartsOn = 0, style = 'short') => {
  const fmt = new Intl.DateTimeFormat(undefined, { weekday: style });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + ((i + weekStartsOn) % 7))));
};

/** "Today", "Tomorrow", "Yesterday" or "Apr 26". */
export function relativeDay(dateKey) {
  const diff = dayDiff(dateKey, todayKey());
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return formatMonthDay(dateKey);
}

export function timeAgo(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`;
  return monthDayFmt.format(new Date(iso));
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** The shortcut key name for this computer: Cmd on Apple devices, Ctrl elsewhere. */
export const MOD = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '') ? 'Cmd' : 'Ctrl';
/** Show shortcut hints with this computer's key name. */
export const kbd = (text) => String(text).replace(/Cmd\/Ctrl|Cmd/g, MOD);
