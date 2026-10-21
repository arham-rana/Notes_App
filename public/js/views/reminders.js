import { esc, relativeDay, formatTime, todayKey, nowLocal, pad, $ } from '../util.js';
import { icon, tile, REMINDER_CATEGORIES } from '../icons.js';
import { state, store } from '../store.js';
import { openModal, openMenu, confirmDialog, toast, formData, showFormError } from '../ui.js';
import { hero, emptyState } from './common.js';

const ui = { filter: 'all' };
const FILTERS = {
  all: { label: 'All', icon: null },
  today: { label: 'Today', icon: 'calendar' },
  upcoming: { label: 'Upcoming', icon: 'clock' },
  completed: { label: 'Completed', icon: 'check' },
};

export function dueLabel(dueAt) {
  const [date, time] = dueAt.split('T');
  return `${relativeDay(date)} · ${formatTime(time)}`;
}
export const isOverdue = (r) => !r.completed && r.dueAt < nowLocal();

function visibleReminders() {
  const today = todayKey();
  const open = state.reminders.filter((r) => !r.completed);
  const done = state.reminders.filter((r) => r.completed).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  switch (ui.filter) {
    case 'today': return open.filter((r) => r.dueAt.slice(0, 10) <= today);
    case 'upcoming': return open.filter((r) => r.dueAt.slice(0, 10) > today);
    case 'completed': return done;
    default: return [...open, ...done];
  }
}

function row(r) {
  const cat = REMINDER_CATEGORIES[r.category] || REMINDER_CATEGORIES.task;
  const overdue = isOverdue(r);
  return `
  <div class="row reminder-row ${r.completed ? 'done' : ''} ${overdue ? 'overdue' : ''}">
    <label class="check">
      <input type="checkbox" data-toggle-reminder="${r.id}" ${r.completed ? 'checked' : ''}>
      <span class="sr-only">${r.completed ? 'Mark as not done' : 'Mark as done'}: ${esc(r.title)}</span>
    </label>
    ${tile(cat.icon, cat.color)}
    <div class="row-text">
      <button class="row-title stretched as-link" data-action="edit-reminder" data-id="${r.id}">${esc(r.title)}</button>
      <span class="row-sub">${overdue ? '<span class="badge-overdue">Overdue</span>' : ''}${esc(dueLabel(r.dueAt))}${r.noteId && store.find('notes', r.noteId) ? `<a class="doc-chip" href="#/documents/${r.noteId}" title="Open the document">${icon('file', { size: 12 })}${esc(store.find('notes', r.noteId).title || 'Untitled')}</a>` : ''}</span>
    </div>
    <button class="icon-btn row-menu" data-action="reminder-menu" data-id="${r.id}" aria-label="More options for ${esc(r.title)}">${icon('more')}</button>
  </div>`;
}

function listHtml() {
  const items = visibleReminders();
  if (items.length) return items.map(row).join('');
  const copy = {
    all: ['Nothing to remember', 'Add a reminder and it will show up here.'],
    today: ['Nothing due today', 'Enjoy the space, or plan something for later.'],
    upcoming: ['Nothing coming up', 'Reminders due after today will show up here.'],
    completed: ['No completed reminders', 'Tick off a reminder to see it here.'],
  }[ui.filter];
  return emptyState({ iconName: 'bell', title: copy[0], text: copy[1], action: ui.filter === 'completed' ? '' : '<button class="btn btn-primary" data-action="new-reminder">New Reminder</button>' });
}

function render() {
  return `
  ${hero({ iconName: 'bell', title: 'Reminders', subtitle: 'Stay on track with your important tasks and upcoming events.', actions: `<button class="btn btn-soft" data-action="new-reminder">${icon('bellPlus')}New Reminder</button>` })}
  <div class="page">
    <div class="tabs" role="tablist" aria-label="Filter reminders">
      ${Object.entries(FILTERS).map(([key, f]) => `<button role="tab" class="tab ${ui.filter === key ? 'active' : ''}" aria-selected="${ui.filter === key}" data-action="reminder-filter" data-filter="${key}">${f.icon ? icon(f.icon, { size: 18 }) : '<span class="tab-dot"></span>'}${f.label}</button>`).join('')}
    </div>
    <div class="rows rows-ruled" id="reminder-list">${listHtml()}</div>
  </div>`;
}

function mount(root) {
  root.addEventListener('change', (e) => {
    const id = e.target.dataset?.toggleReminder;
    if (!id) return;
    setDone(id, e.target.checked);
  });
}

async function setDone(id, completed) {
  await store.update('reminders', id, { completed }).catch(() => {});
  if (completed) {
    const r = store.find('reminders', id);
    toast(`Done: ${r?.title ?? 'reminder'}`, { action: { label: 'Undo', run: () => store.update('reminders', id, { completed: false }) } });
  }
}

export function reminderForm(reminder, defaults = {}) {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 60 - now.getMinutes()); // next full hour
  const date = reminder?.dueAt.slice(0, 10) || defaults.date || todayKey();
  const time = reminder?.dueAt.slice(11) || defaults.time || `${pad(now.getHours())}:00`;
  const category = reminder?.category || defaults.category || 'task';
  const noteId = reminder?.noteId || defaults.noteId || '';
  const linked = noteId ? store.find('notes', noteId) : null;
  openModal({
    title: reminder ? 'Edit reminder' : 'New reminder',
    body: `
      <form class="form" id="reminder-form" novalidate>
        <label class="field"><span>What do you want to remember?</span><input name="title" required maxlength="200" value="${esc(reminder?.title || defaults.title || '')}" placeholder="e.g. Call the dentist" autofocus></label>
        ${linked ? `<p class="linked-doc">${icon('file', { size: 14 })}Linked to “${esc(linked.title || 'Untitled')}”</p>` : ''}
        <div class="field-row">
          <label class="field"><span>Date</span><input type="date" name="date" required value="${date}"></label>
          <label class="field"><span>Time</span><input type="time" name="time" required value="${time}"></label>
        </div>
        <fieldset class="field">
          <legend>Type</legend>
          <div class="chip-choices">${Object.entries(REMINDER_CATEGORIES).map(([key, c]) => `
            <label class="chip-choice"><input type="radio" name="category" value="${key}" ${category === key ? 'checked' : ''}><span>${icon(c.icon, { size: 16 })}${c.label}</span></label>`).join('')}
          </div>
        </fieldset>
      </form>`,
    footer: `
      ${reminder ? `<button class="btn btn-ghost-danger" data-delete>${icon('trash', { size: 16 })}Delete</button>` : ''}
      <span class="spacer"></span>
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" type="submit" form="reminder-form">${reminder ? 'Save changes' : 'Add reminder'}</button>`,
    onMount: (el, close) => {
      const form = $('#reminder-form', el);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = formData(form);
        if (!d.title.trim()) return showFormError(form, 'Give the reminder a name.');
        if (!d.date || !d.time) return showFormError(form, 'Pick a date and time.');
        const payload = { title: d.title.trim(), dueAt: `${d.date}T${d.time}`, category: d.category, noteId };
        try {
          if (reminder) await store.update('reminders', reminder.id, payload);
          else await store.create('reminders', payload);
          close();
          toast(reminder ? 'Reminder saved' : 'Reminder added');
        } catch (err) { showFormError(form, err.message); }
      });
      el.querySelector('[data-delete]')?.addEventListener('click', async () => {
        close();
        deleteReminder(reminder.id);
      });
    },
  });
}

async function deleteReminder(id) {
  const r = store.find('reminders', id);
  if (!r) return;
  if (!(await confirmDialog({ title: 'Delete this reminder?', message: `“${r.title}” will be removed from all your devices.`, confirmLabel: 'Delete reminder' }))) return;
  await store.remove('reminders', id);
  const { id: _id, createdAt, updatedAt, ...copy } = r;
  toast('Reminder deleted', { action: { label: 'Undo', run: () => store.create('reminders', copy) } });
}

export const actions = {
  'new-reminder': () => reminderForm(null),
  'edit-reminder': (el) => reminderForm(store.find('reminders', el.dataset.id)),
  'reminder-filter': (el) => { ui.filter = el.dataset.filter; window.dispatchEvent(new Event('app:rerender')); },
  'reminder-menu': (el) => {
    const r = store.find('reminders', el.dataset.id);
    if (!r) return;
    const snooze = (mins) => {
      const d = new Date(Date.now() + mins * 60000);
      const dueAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      store.update('reminders', r.id, { dueAt, completed: false }).then(() => toast(`Snoozed until ${dueLabel(dueAt)}`)).catch(() => {});
    };
    openMenu(el, [
      { label: r.completed ? 'Mark as not done' : 'Mark as done', icon: 'check', run: () => setDone(r.id, !r.completed) },
      { label: 'Edit', icon: 'edit', run: () => reminderForm(r) },
      ...(r.completed ? [] : [
        { label: 'Snooze 1 hour', icon: 'clock', run: () => snooze(60) },
        { label: 'Snooze until tomorrow', icon: 'calendar', run: () => {
          const [, time] = r.dueAt.split('T');
          const t = new Date(); t.setDate(t.getDate() + 1);
          const dueAt = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${time}`;
          store.update('reminders', r.id, { dueAt }).then(() => toast(`Moved to ${dueLabel(dueAt)}`)).catch(() => {});
        } },
      ]),
      'divider',
      { label: 'Delete', icon: 'trash', danger: true, run: () => deleteReminder(r.id) },
    ]);
  },
};

export const remindersView = {
  render,
  mount,
  onChange(change, route, root) {
    if (change.kind && change.kind !== 'reminders') return true;
    const list = $('#reminder-list', root);
    if (!list) return false;
    list.innerHTML = listHtml();
    return true;
  },
};
