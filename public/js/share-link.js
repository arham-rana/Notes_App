// The page someone opens from a share link: enter a name (and password, if set), then open the document.
import { esc } from './util.js';
import { icon } from './icons.js';
import { request } from './store.js';
import { bannerArt } from './art.js';

const token = location.pathname.split('/').filter(Boolean)[1] || '';
const root = document.getElementById('auth');
document.querySelector('.auth-banner-bg').innerHTML = bannerArt();
const open = (noteId) => { location.replace(`/#/documents/${noteId}`); };

function card(inner) { root.innerHTML = `<div class="glass-card share-card" role="main">${inner}</div>`; }
function message(title, text, extra = '') {
  card(`<div class="glass-head"><h1>${esc(title)}</h1><p>${esc(text)}</p></div>${extra}`);
}

async function start() {
  let info;
  try { info = await request('GET', `/api/share/${encodeURIComponent(token)}`); } catch (err) {
    message(err.status === 410 ? 'This link has expired' : 'Link not available', err.status === 410 ? 'Ask the person who shared it for a new link.' : err.message);
    return;
  }
  if (info.openAs) { open(info.noteId); return; } // already allowed in on this device
  const perm = info.permission === 'edit' ? 'view and edit' : 'view';
  const head = info.title
    ? `<h1>${esc(info.title)}</h1><p>${esc(info.owner)} shared this document with you. You can ${perm} it${info.permission === 'edit' ? ' and comment' : ' and comment'}.</p>`
    : `<h1>Shared document</h1><p>This document is protected with a password. You can ${perm} it once you enter it.</p>`;
  if (info.signedInAs) {
    card(`<div class="glass-head">${head}</div>
      <p class="share-note">You’re signed in as <b>${esc(info.signedInAs)}</b>, and this document hasn’t been shared with your account. Ask the owner to add you, or sign out to open it as a guest.</p>
      <button type="button" class="glass-submit" data-signout>${icon('arrowRight', { size: 22 })}<span>Sign out and continue</span></button>`);
    root.querySelector('[data-signout]').addEventListener('click', async () => { await request('POST', '/api/auth/logout').catch(() => {}); location.reload(); });
    return;
  }
  let saved = '';
  try { saved = localStorage.getItem('guestName') || ''; } catch { /* */ }
  card(`<div class="glass-head">${head}</div>
    <form class="glass-form" novalidate>
      <label class="glass-field"><span class="sr-only">Your name</span><span class="glass-field-icon" aria-hidden="true">${icon('smile', { size: 20 })}</span>
        <input name="name" placeholder="Your name" autocomplete="name" maxlength="40" value="${esc(saved)}" ${saved ? '' : 'autofocus'}></label>
      ${info.needsPassword ? `<label class="glass-field"><span class="sr-only">Link password</span><span class="glass-field-icon" aria-hidden="true">${icon('lock', { size: 20 })}</span>
        <input name="password" type="password" placeholder="Link password" autocomplete="off" ${saved ? 'autofocus' : ''}></label>` : ''}
      <p class="share-note">Your name is shown to others in the document, next to your edits and comments.</p>
      <p class="glass-error" role="alert" hidden></p>
      <button class="glass-submit" type="submit">${icon('arrowRight', { size: 22 })}<span>Open document</span></button>
    </form>`);
  const form = root.querySelector('form');
  const error = root.querySelector('.glass-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const name = form.elements.name.value.trim();
    if (!name) { error.textContent = 'Type your name so others know who you are.'; error.hidden = false; return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const res = await request('POST', `/api/share/${encodeURIComponent(token)}/join`, { name, password: form.elements.password?.value || '' });
      try { localStorage.setItem('guestName', name); } catch { /* */ }
      open(res.noteId);
    } catch (err) {
      error.textContent = err.message; error.hidden = false; btn.disabled = false;
    }
  });
}
start();
