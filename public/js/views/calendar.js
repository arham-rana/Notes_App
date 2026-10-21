import {
  esc, toDateKey, todayKey, parseLocal, addDays, startOfWeek, toMinutes, formatTime, formatHour,
  formatMonthYear, formatLongDate, formatMonthDay, weekdayNames, pad, $,
} from '../util.js';
import { icon, COLORS, REMINDER_CATEGORIES } from '../icons.js';
import { state, store } from '../store.js';
import { openModal, confirmDialog, toast, formData, showFormError } from '../ui.js';
import { reminderForm } from './reminders.js';
import { hero } from './common.js';

const ui = { mode: 'month', cursor: new Date() };
const HOUR = 52;
const weekStart = () => state.settings.weekStartsOn || 0;

/** Events and reminders for a day, as one sorted list of calendar items. */
function itemsOn(dateKey) {
  const events = state.events.filter((e) => e.date === dateKey).map((e) => ({
    type: 'event', id: e.id, title: e.title, start: e.startTime, end: e.endTime, color: e.color, date: e.date,
  }));
  const reminders = state.reminders.filter((r) => r.dueAt.startsWith(dateKey)).map((r) => {
    const start = r.dueAt.slice(11);
    const endMin = Math.min(toMinutes(start) + 30, 24 * 60 - 1);
    return {
      type: 'reminder', id: r.id, title: r.title, start, end: `${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}`,
      color: (REMINDER_CATEGORIES[r.category] || REMINDER_CATEGORIES.task).color, done: r.completed, date: dateKey,
    };
  });
  return [...events, ...reminders].sort((a, b) => a.start.localeCompare(b.start));
}

const itemAction = (it) => (it.type === 'event' ? 'open-event' : 'edit-reminder');

function chip(it) {
  return `<button class="chip c-${it.color} ${it.type === 'reminder' ? 'chip-reminder' : ''} ${it.done ? 'done' : ''}" data-action="${itemAction(it)}" data-id="${it.id}" title="${esc(it.title)}">
    <span class="chip-title">${it.type === 'reminder' ? icon('bell', { size: 11, stroke: 2.2 }) : '<i class="dot"></i>'}${esc(it.title)}</span>
    <span class="chip-time">${formatTime(it.start)}</span>
  </button>`;
}

function monthHtml() {
  const first = new Date(ui.cursor.getFullYear(), ui.cursor.getMonth(), 1);
  const start = startOfWeek(first, weekStart());
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((Math.round((first - start) / 86400000) + daysInMonth) / 7);
  const today = todayKey();
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const key = toDateKey(d);
    const items = itemsOn(key);
    const outside = d.getMonth() !== first.getMonth();
    cells += `
    <div class="m-cell ${outside ? 'outside' : ''} ${key === today ? 'today' : ''}" data-action="cal-new" data-date="${key}">
      <button class="m-day" data-action="cal-goto-day" data-date="${key}" aria-label="${formatLongDate(d)}">${d.getDate()}</button>
      <div class="m-items">
        ${items.slice(0, 2).map(chip).join('')}
        ${items.length > 2 ? `<button class="more-link" data-action="cal-goto-day" data-date="${key}">+${items.length - 2} more</button>` : ''}
      </div>
    </div>`;
  }
  return `
  <div class="month" style="--weeks:${weeks}">
    <div class="m-head">${weekdayNames(weekStart()).map((n) => `<div>${n}</div>`).join('')}</div>
    <div class="m-grid">${cells}</div>
  </div>`;
}

/** Lay out overlapping items side by side. */
function layout(items) {
  const placed = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((p) => p.col + 1));
    cluster.forEach((p) => { p.cols = cols; });
    cluster = [];
  };
  for (const it of items) {
    const s = toMinutes(it.start), e = Math.max(toMinutes(it.end), s + 20);
    if (s >= clusterEnd) { flush(); clusterEnd = -1; }
    const used = cluster.filter((p) => p.e > s).map((p) => p.col);
    let col = 0;
    while (used.includes(col)) col++;
    const p = { it, s, e, col };
    cluster.push(p); placed.push(p);
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return placed;
}

function timeGridHtml(days) {
  const today = todayKey();
  const now = new Date();
  const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR;
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return `
  <div class="tg" style="--days:${days.length}">
    <div class="tg-head">
      <div class="tg-gutter"></div>
      ${days.map((d) => {
        const key = toDateKey(d);
        return `<button class="tg-day ${key === today ? 'today' : ''}" data-action="cal-goto-day" data-date="${key}"><span>${weekdayNames(0)[d.getDay()]}</span><b>${d.getDate()}</b></button>`;
      }).join('')}
    </div>
    <div class="tg-scroll">
      <div class="tg-body" style="height:${HOUR * 24}px">
        <div class="tg-gutter">${hours.map((h) => `<span style="top:${h * HOUR}px">${h ? formatHour(h) : ''}</span>`).join('')}</div>
        ${days.map((d) => {
          const key = toDateKey(d);
          const blocks = layout(itemsOn(key)).map(({ it, s, e, col, cols }) => `
            <button class="block c-${it.color} ${it.type === 'reminder' ? 'block-reminder' : ''} ${it.done ? 'done' : ''} ${e - s < 45 ? 'short' : ''}" data-action="${itemAction(it)}" data-id="${it.id}"
              style="top:${(s / 60) * HOUR}px;height:${Math.max(22, ((e - s) / 60) * HOUR - 2)}px;left:calc(${(col / cols) * 100}% + 2px);width:calc(${100 / cols}% - 4px)">
              <span class="block-title">${it.type === 'reminder' ? icon('bell', { size: 11, stroke: 2.2 }) : ''}${esc(it.title)}</span>
              <span class="block-time">${formatTime(it.start)}${it.type === 'event' ? ` – ${formatTime(it.end)}` : ''}</span>
            </button>`).join('');
          return `<div class="tg-col ${key === today ? 'today' : ''}" data-date="${key}">
            ${hours.map((h) => `<i class="tg-line" style="top:${h * HOUR}px"></i>`).join('')}
            ${blocks}
            ${key === today ? `<i class="now-line" style="top:${nowTop}px"></i>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;
}

function rangeLabel() {
  if (ui.mode === 'month') return formatMonthYear(ui.cursor);
  if (ui.mode === 'day') return formatLongDate(ui.cursor);
  const s = startOfWeek(ui.cursor, weekStart());
  const e = addDays(s, 6);
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return fmt.formatRange ? fmt.formatRange(s, e) : `${fmt.format(s)} – ${fmt.format(e)}`;
}

function upcomingItems(limit, days = 60) {
  const out = [];
  const start = addDays(parseLocal(todayKey()), 1);
  for (let i = 0; i < days && out.length < limit; i++) {
    const key = toDateKey(addDays(start, i));
    for (const it of itemsOn(key)) if (!it.done && out.length < limit) out.push(it);
  }
  return out;
}

function sideHtml() {
  const today = itemsOn(todayKey());
  const upcoming = upcomingItems(4);
  const sideItem = (it, withDate) => `
    <button class="side-item" data-action="${itemAction(it)}" data-id="${it.id}">
      ${withDate ? `<span class="side-date">${formatMonthDay(it.date)}</span>` : ''}
      <i class="dot c-${it.color}"></i>
      <span class="side-text"><b class="${it.done ? 'strike' : ''}">${esc(it.title)}</b><span>${formatTime(it.start)}${it.type === 'event' ? ` – ${formatTime(it.end)}` : ' · Reminder'}</span></span>
      ${icon('chevronRight', { size: 16 })}
    </button>`;
  return `
  <aside class="cal-side">
    <section class="card">
      <div class="card-head">
        <span class="tile tile-sm c-blue">${icon('calendar', { size: 18 })}</span>
        <div><h2>Today</h2><p class="muted small">${formatLongDate(new Date())}</p></div>
      </div>
      <div class="side-list">${today.length ? today.slice(0, 4).map((it) => sideItem(it, false)).join('') + (today.length > 4 ? `<button class="more-link side-more" data-action="cal-goto-day" data-date="${todayKey()}">+${today.length - 4} more today</button>` : '') : `<p class="muted small side-empty">Nothing scheduled.</p>`}</div>
    </section>
    <section class="card">
      <div class="card-head">
        <span class="tile tile-sm c-purple">${icon('clock', { size: 18 })}</span>
        <div><h2>Upcoming</h2><p class="muted small">After today</p></div>
        <button class="link-more card-head-link" data-action="cal-agenda">View all ${icon('chevronRight', { size: 16 })}</button>
      </div>
      <div class="side-list">${upcoming.length ? upcoming.map((it) => sideItem(it, true)).join('') : '<p class="muted small side-empty">Nothing in the next two months.</p>'}</div>
    </section>
  </aside>`;
}

function render() {
  let body;
  if (ui.mode === 'month') body = monthHtml();
  else if (ui.mode === 'week') {
    const s = startOfWeek(ui.cursor, weekStart());
    body = timeGridHtml(Array.from({ length: 7 }, (_, i) => addDays(s, i)));
  } else body = timeGridHtml([ui.cursor]);

  return `
  ${hero({ iconName: 'calendar', title: 'Calendar', subtitle: 'Keep track of your schedule, deadlines, and important dates.' })}
  <div class="page">
    <div class="cal-layout">
      ${sideHtml()}
      <div class="cal-main">
        <div class="cal-toolbar">
          <div class="tabs" role="tablist" aria-label="Calendar view">
            ${[['month', 'Month', 'calendar'], ['week', 'Week', 'calendar'], ['day', 'Day', 'clock']].map(([k, l, ic]) => `<button role="tab" class="tab ${ui.mode === k ? 'active' : ''}" aria-selected="${ui.mode === k}" data-action="cal-mode" data-mode="${k}">${icon(ic, { size: 18 })}${l}</button>`).join('')}
          </div>
          <div class="cal-nav">
            <button class="icon-btn" data-action="cal-step" data-step="-1" aria-label="Previous">${icon('chevronLeft')}</button>
            <button class="date-label" data-action="cal-today" title="Go to today">${esc(rangeLabel())}</button>
            <button class="icon-btn" data-action="cal-step" data-step="1" aria-label="Next">${icon('chevronRight')}</button>
            <button class="btn btn-primary btn-sm" data-action="cal-new" data-date="${toDateKey(ui.cursor)}">${icon('plus', { size: 16 })}Event</button>
          </div>
        </div>
        <div class="cal-body">${body}</div>
      </div>
    </div>
  </div>`;
}

function mount(root) {
  const scroller = $('.tg-scroll', root);
  if (scroller) {
    const now = new Date();
    const showsToday = !!$('.tg-col.today', root);
    scroller.scrollTop = Math.max(0, (showsToday ? now.getHours() - 1.5 : 7.5) * HOUR);
    scroller.addEventListener('click', (e) => {
      const col = e.target.closest('.tg-col');
      if (!col || e.target.closest('.block')) return;
      const y = e.clientY - col.getBoundingClientRect().top;
      const hour = Math.min(23, Math.max(0, Math.floor(y / HOUR)));
      eventForm(null, { date: col.dataset.date, startTime: `${pad(hour)}:00`, endTime: hour === 23 ? '23:59' : `${pad(hour + 1)}:00` });
    });
  }
}

export function eventForm(ev, defaults = {}) {
  const data = { date: todayKey(), startTime: '09:00', endTime: '10:00', color: 'blue', title: '', location: '', description: '', ...defaults, ...(ev || {}) };
  openModal({
    title: ev ? 'Edit event' : 'New event',
    body: `
    <form class="form" id="event-form" novalidate>
      <label class="field"><span>Title</span><input name="title" required maxlength="200" value="${esc(data.title)}" placeholder="e.g. Lunch with Sam" autofocus></label>
      <div class="field-row three">
        <label class="field"><span>Date</span><input type="date" name="date" required value="${data.date}"></label>
        <label class="field"><span>Starts</span><input type="time" name="startTime" required value="${data.startTime}"></label>
        <label class="field"><span>Ends</span><input type="time" name="endTime" required value="${data.endTime}"></label>
      </div>
      <fieldset class="field">
        <legend>Colour</legend>
        <div class="swatches">${COLORS.map((c) => `<label class="swatch c-${c}" title="${c}"><input type="radio" name="color" value="${c}" ${data.color === c ? 'checked' : ''}><span></span></label>`).join('')}</div>
      </fieldset>
      <label class="field"><span>Location <em>(optional)</em></span><input name="location" maxlength="200" value="${esc(data.location)}" placeholder="Add a place or link"></label>
      <label class="field"><span>Details <em>(optional)</em></span><textarea name="description" rows="3" maxlength="5000" placeholder="Agenda, notes, anything useful">${esc(data.description)}</textarea></label>
    </form>`,
    footer: `
      ${ev ? `<button class="btn btn-ghost-danger" data-delete>${icon('trash', { size: 16 })}Delete</button>` : ''}
      <span class="spacer"></span>
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" type="submit" form="event-form">${ev ? 'Save changes' : 'Add event'}</button>`,
    onMount: (el, close) => {
      const form = $('#event-form', el);
      const start = form.elements.startTime, end = form.elements.endTime;
      start.addEventListener('change', () => {
        if (end.value <= start.value) {
          const m = Math.min(toMinutes(start.value) + 60, 23 * 60 + 59);
          end.value = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
        }
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = formData(form);
        if (!d.title.trim()) return showFormError(form, 'Give the event a title.');
        if (!d.date || !d.startTime || !d.endTime) return showFormError(form, 'Pick a date, start time and end time.');
        if (d.endTime <= d.startTime) return showFormError(form, 'The event has to end after it starts.');
        const payload = { ...d, title: d.title.trim() };
        try {
          if (ev) await store.update('events', ev.id, payload);
          else await store.create('events', payload);
          close();
          toast(ev ? 'Event saved' : 'Event added');
        } catch (err) { showFormError(form, err.message); }
      });
      el.querySelector('[data-delete]')?.addEventListener('click', async () => {
        close();
        if (!(await confirmDialog({ title: 'Delete this event?', message: `“${ev.title}” will be removed from all your devices.`, confirmLabel: 'Delete event' }))) return;
        await store.remove('events', ev.id);
        const { id, createdAt, updatedAt, ...copy } = ev;
        toast('Event deleted', { action: { label: 'Undo', run: () => store.create('events', copy) } });
      });
    },
  });
}

function agenda() {
  const items = upcomingItems(200, 30);
  const groups = {};
  for (const it of items) (groups[it.date] ||= []).push(it);
  const body = Object.keys(groups).length
    ? Object.entries(groups).map(([date, list]) => `
      <section class="agenda-day">
        <h3>${formatLongDate(parseLocal(date))}</h3>
        ${list.map((it) => `<button class="side-item" data-agenda="${itemAction(it)}" data-id="${it.id}"><i class="dot c-${it.color}"></i><span class="side-text"><b>${esc(it.title)}</b><span>${formatTime(it.start)}${it.type === 'event' ? ` – ${formatTime(it.end)}` : ' · Reminder'}</span></span>${icon('chevronRight', { size: 16 })}</button>`).join('')}
      </section>`).join('')
    : '<p class="muted">Nothing scheduled in the next 30 days.</p>';
  openModal({
    title: 'Next 30 days',
    size: 'md',
    body: `<div class="agenda">${body}</div>`,
    onMount: (el, close) => el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-agenda]');
      if (!btn) return;
      close();
      actions[btn.dataset.agenda](btn);
    }),
  });
}

export const actions = {
  'cal-mode': (el) => { ui.mode = el.dataset.mode; window.dispatchEvent(new Event('app:rerender')); },
  'cal-step': (el) => {
    const n = Number(el.dataset.step);
    const c = ui.cursor;
    ui.cursor = ui.mode === 'month' ? new Date(c.getFullYear(), c.getMonth() + n, 1) : addDays(c, ui.mode === 'week' ? 7 * n : n);
    window.dispatchEvent(new Event('app:rerender'));
  },
  'cal-today': () => { ui.cursor = new Date(); window.dispatchEvent(new Event('app:rerender')); },
  'cal-goto-day': (el) => { ui.cursor = parseLocal(el.dataset.date); ui.mode = 'day'; window.dispatchEvent(new Event('app:rerender')); },
  'cal-new': (el) => eventForm(null, { date: el.dataset.date }),
  'cal-agenda': agenda,
  'open-event': (el) => { const ev = store.find('events', el.dataset.id); if (ev) eventForm(ev); },
  'edit-reminder-cal': (el) => reminderForm(store.find('reminders', el.dataset.id)),
};

export const calendarView = {
  render,
  mount,
  onChange(change) {
    return change.kind === 'notes';
  },
};
