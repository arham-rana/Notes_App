import { esc, $ } from '../util.js';
import { icon } from '../icons.js';
import { state, store } from '../store.js';
import { confirmDialog, toast, openModal, showFormError } from '../ui.js';
import { signOut } from '../app.js';
import { hero, bannerHtml } from './common.js';

function segmented(name, value, options) {
  return `<div class="segmented" role="radiogroup">${options.map(([v, label, ic]) => `
    <label><input type="radio" name="${name}" value="${v}" ${String(value) === String(v) ? 'checked' : ''}><span>${ic ? icon(ic, { size: 16 }) : ''}${label}</span></label>`).join('')}</div>`;
}

function render() {
  const s = state.settings;
  const counts = `${state.notes.length} documents, ${state.reminders.length} reminders and ${state.events.length} events`;
  return `
  ${hero({ iconName: 'settings', title: 'Settings', subtitle: 'Make the app work the way you like.' })}
  <div class="page page-narrow">
    <form id="settings-form" class="settings" autocomplete="off">
      <section class="setting-group">
        <h2>Account</h2>
        <div class="setting">
          <div><h3>Name</h3><p class="muted small">Shown to people you share documents with.</p></div>
          <span class="inline-edit"><label class="sr-only" for="acct-name">Name</label><input id="acct-name" class="select" value="${esc(state.user?.name || '')}" maxlength="60"><button type="button" class="btn btn-outline btn-sm" data-acct="save-name">Save</button></span>
        </div>
        <div class="setting">
          <div><h3>Username</h3><p class="muted small">@${esc(state.user?.username || '')} · you sign in with this, and people use it to share documents with you</p></div>
          <button type="button" class="btn btn-outline" data-acct="username">${icon('user', { size: 16 })}Change username</button>
        </div>
        <div class="setting">
          <div><h3>Password</h3><p class="muted small">Changing it signs you out on your other devices.</p></div>
          <button type="button" class="btn btn-outline" data-acct="password">${icon('key', { size: 16 })}Change password</button>
        </div>
        <div class="setting">
          <div><h3>Sign out</h3><p class="muted small">Signs you out on this device only.</p></div>
          <button type="button" class="btn btn-outline" data-acct="signout">${icon('logout', { size: 16 })}Sign out</button>
        </div>
      </section>
      <section class="setting-group">
        <h2>Appearance</h2>
        <div class="setting">
          <div><h3>Theme</h3><p class="muted small">Follow your device, or pick one.</p></div>
          ${segmented('theme', s.theme, [['system', 'Device', null], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']])}
        </div>
        <div class="setting setting-stack">
          <div><h3>Header image</h3><p class="muted small">Shown across the top of Documents, Reminders, Calendar and Settings. Wide photos work best; it's only visible to you.</p></div>
          <div class="header-preview banner">${bannerHtml()}</div>
          <div class="header-controls">
            <label class="btn btn-outline">${icon('image', { size: 16 })}${s.headerImage ? 'Replace image' : 'Upload image'}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" id="header-file" hidden></label>
            ${s.headerImage ? `
              <span class="header-pos"><span class="muted small">Focus</span>${segmented('headerPosition', s.headerPosition, [['top', 'Top'], ['center', 'Middle'], ['bottom', 'Bottom']])}</span>
              <button type="button" class="btn btn-ghost-danger" data-acct="header-remove">${icon('x', { size: 16 })}Use the mountains</button>` : ''}
          </div>
        </div>
      </section>
      <section class="setting-group">
        <h2>Calendar and alerts</h2>
        <div class="setting">
          <div><h3>Week starts on</h3></div>
          ${segmented('weekStartsOn', s.weekStartsOn, [[0, 'Sunday'], [1, 'Monday']])}
        </div>
        <div class="setting">
          <div><h3>Event alerts</h3><p class="muted small">When to show an alert before an event starts.</p></div>
          <select name="eventAlertMinutes" class="select">
            ${[[0, 'At start time'], [5, '5 minutes before'], [10, '10 minutes before'], [15, '15 minutes before'], [30, '30 minutes before'], [60, '1 hour before']].map(([v, l]) => `<option value="${v}" ${s.eventAlertMinutes === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
      </section>
      <section class="setting-group">
        <h2>Your data</h2>
        <p class="muted small">Everything is stored in the app's database on your server, so it's the same on every device you sign in from. You have ${esc(counts)}. Backups include the documents you own (attached files aren’t included; back up the Docker volume for those).</p>
        <div class="setting">
          <div><h3>Download a backup</h3><p class="muted small">Saves everything as a JSON file.</p></div>
          <a class="btn btn-outline" href="/api/export" download>${icon('download', { size: 16 })}Download backup</a>
        </div>
        <div class="setting">
          <div><h3>Restore from backup</h3><p class="muted small">Replaces your documents, reminders and events with the ones in the file.</p></div>
          <label class="btn btn-outline">${icon('upload', { size: 16 })}Choose file<input type="file" accept="application/json,.json" id="restore-file" hidden></label>
        </div>
      </section>
      <section class="setting-group">
        <h2>Files</h2>
        <p class="muted small">Files and images you've added to documents. To add one, open a document, click Edit, then the paperclip (or paste or drag a file in).</p>
        <div id="files-list" class="files-list"><p class="muted small">Loading…</p></div>
      </section>
      <section class="setting-group danger-zone">
        <h2>Delete account</h2>
        <div class="setting">
          <div><p class="muted small">Permanently deletes your account and everything you own, including documents you’ve shared and their files. This can’t be undone.</p></div>
          <button type="button" class="btn btn-ghost-danger" data-acct="delete">${icon('trash', { size: 16 })}Delete account</button>
        </div>
      </section>
    </form>
  </div>`;
}

function passwordDialog() {
  openModal({
    title: 'Change password',
    size: 'sm',
    body: `<form class="form" id="pw-form" novalidate>
      <label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password" autofocus></label>
      <label class="field"><span>New password</span><input type="password" name="next" autocomplete="new-password" minlength="8"><small class="field-hint">At least 8 characters</small></label>
      <label class="field"><span>Confirm new password</span><input type="password" name="confirm" autocomplete="new-password"></label>
    </form>`,
    footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="pw-form">Change password</button>',
    onMount: (el, close) => {
      const form = $('#pw-form', el);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const { current, next, confirm } = Object.fromEntries(new FormData(form));
        if (next.length < 8) return showFormError(form, 'Use a new password with at least 8 characters.');
        if (next !== confirm) return showFormError(form, 'The new passwords don’t match.');
        try { await store.changePassword(current, next); close(); toast('Password changed. Other devices have been signed out.'); }
        catch (err) { showFormError(form, err.message); }
      });
    },
  });
}

function usernameDialog() {
  openModal({
    title: 'Change username',
    size: 'sm',
    body: `<form class="form" id="un-form" novalidate>
      <label class="field"><span>New username</span><input name="username" value="${esc(state.user?.username || '')}" maxlength="30" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="username" autofocus>
        <small class="field-hint">3–30 characters: letters, numbers, dots, dashes or underscores. You'll sign in with this from now on.</small></label>
      <label class="field"><span>Current password</span><input type="password" name="password" autocomplete="current-password"></label>
    </form>`,
    footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="un-form">Change username</button>',
    onMount: (el, close) => {
      const form = $('#un-form', el);
      setTimeout(() => form.elements.username.select(), 30);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = form.elements.username.value.trim().replace(/^@/, '');
        if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username)) return showFormError(form, 'Usernames are 3–30 characters: letters, numbers, dots, dashes or underscores.');
        if (!form.elements.password.value) return showFormError(form, 'Enter your current password to confirm.');
        try {
          const user = await store.changeUsername(username, form.elements.password.value);
          close();
          toast(`Your username is now @${user.username}. Use it next time you sign in.`, { duration: 7000 });
        } catch (err) { showFormError(form, err.message); }
      });
    },
  });
}

function deleteDialog() {
  openModal({
    title: 'Delete your account?',
    size: 'sm',
    body: `<form class="form" id="del-form" novalidate>
      <p class="muted">This permanently deletes your account, documents, files, reminders and events. Documents you’ve shared will disappear for everyone.</p>
      <label class="field"><span>Enter your password to confirm</span><input type="password" name="password" autocomplete="current-password" autofocus></label>
    </form>`,
    footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-danger" type="submit" form="del-form">Delete my account</button>',
    onMount: (el) => {
      const form = $('#del-form', el);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await store.deleteAccount(form.elements.password.value); location.hash = ''; location.reload(); }
        catch (err) { showFormError(form, err.message); }
      });
    },
  });
}

const fmtSize = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

async function loadFiles(root) {
  const box = $('#files-list', root);
  if (!box) return;
  try {
    const { files, used, maxUploadMb } = await store.listFiles();
    const own = files.filter((f) => f.noteId);
    box.innerHTML = `
      <p class="muted small files-summary">${own.length} ${own.length === 1 ? 'file' : 'files'} in documents · ${fmtSize(used)} used in total · up to ${maxUploadMb} MB per file</p>
      ${own.length ? `<ul class="file-rows">${own.map((f) => `
        <li class="file-row">
          <span class="file-kind">${icon(f.mime.startsWith('image/') ? 'image' : 'paperclip', { size: 18 })}</span>
          <span class="file-info"><b>${esc(f.name)}</b><span>${f.noteTitle ? `In “${esc(f.noteTitle)}”` : 'Document deleted'} · ${fmtSize(f.size)}</span></span>
          <a class="icon-btn" href="${f.url}?download" aria-label="Download ${esc(f.name)}" title="Download">${icon('download', { size: 18 })}</a>
          <button type="button" class="icon-btn" data-file-delete="${f.id}" data-name="${esc(f.name)}" aria-label="Delete ${esc(f.name)}" title="Delete">${icon('trash', { size: 18 })}</button>
        </li>`).join('')}</ul>` : ''}`;
  } catch (err) {
    box.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
  }
}

/** Shrink large photos before upload so headers load fast on every device. */
async function prepareHeader(file) {
  if (file.type === 'image/gif' || file.size < 600 * 1024) return file;
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return file;
  const scale = Math.min(1, 2400 / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
  return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
}

function mount(root) {
  const form = $('#settings-form', root);
  loadFiles(root);
  $('#header-file', root)?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { toast('Choose a PNG, JPEG, GIF or WebP image', { tone: 'error' }); return; }
    toast('Uploading header image…');
    try {
      const old = state.settings.headerImage;
      const info = await store.uploadFile(await prepareHeader(file), { purpose: 'header', name: file.name });
      await store.updateSettings({ headerImage: info.id, headerPosition: state.settings.headerPosition || 'center' });
      if (old) store.deleteFile(old).catch(() => {});
      toast('Header image updated');
    } catch (err) { toast(`Couldn't upload: ${err.message}`, { tone: 'error' }); }
  });
  root.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-file-delete]');
    if (!del) return;
    if (!(await confirmDialog({ title: 'Delete this file?', message: `“${del.dataset.name}” will be removed. Documents that use it will show it as missing.`, confirmLabel: 'Delete file' }))) return;
    try { await store.deleteFile(del.dataset.fileDelete); toast('File deleted'); loadFiles(root); } catch (err) { toast(err.message, { tone: 'error' }); }
  });
  form.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-acct]');
    if (!btn) return;
    const what = btn.dataset.acct;
    if (what === 'password') passwordDialog();
    if (what === 'username') usernameDialog();
    if (what === 'delete') deleteDialog();
    if (what === 'signout') signOut();
    if (what === 'header-remove') {
      const old = state.settings.headerImage;
      await store.updateSettings({ headerImage: null });
      if (old) store.deleteFile(old).catch(() => {});
      toast('Back to the mountain illustration');
    }
    if (what === 'save-name') {
      try { await store.updateAccount({ name: $('#acct-name', root).value }); toast('Name saved'); }
      catch (err) { toast(err.message, { tone: 'error' }); }
    }
  });
  form.addEventListener('change', (e) => {
    const { name, value } = e.target;
    if (!name || e.target.id === 'acct-name') return;
    if (e.target.id === 'header-file' || e.target.id === 'restore-file') return;
    const numeric = name === 'weekStartsOn' || name === 'eventAlertMinutes';
    store.updateSettings({ [name]: numeric ? Number(value) : value });
  });
  $('#restore-file', root).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let payload;
    try { payload = JSON.parse(await file.text()); } catch { toast('That file isn’t a valid backup. Choose a .json file downloaded from this app.', { tone: 'error' }); return; }
    const ok = await confirmDialog({ title: 'Restore this backup?', message: 'Your documents, reminders and events will be replaced with the ones in the file.', confirmLabel: 'Replace my data', tone: 'danger' });
    if (!ok) return;
    try {
      const { imported } = await store.importBackup(payload);
      toast(`Restored ${imported.notes} documents, ${imported.reminders} reminders and ${imported.events} events`);
    } catch (err) {
      toast(`Couldn't restore: ${err.message}`, { tone: 'error' });
    }
  });
}

export const settingsView = {
  render,
  mount,
  onChange(change) {
    // Header changes re-render so the banner and controls update.
    // Settings and account changes re-render so names, usernames and the banner update.
    if (change.type === 'settings' || change.type === 'account') return false;
    return true;
  },
};
export const actions = {};
