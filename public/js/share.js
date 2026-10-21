import { esc, $ } from './util.js';
import { icon } from './icons.js';
import { store, request } from './store.js';
import { openModal, toast } from './ui.js';

const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

function peopleHtml(shares) {
  if (!shares.length) {
    return '<p class="muted small share-empty">Only you can see this document.</p>';
  }
  return `<ul class="share-list">${shares.map((s) => `
    <li class="share-person">
      <span class="avatar" aria-hidden="true">${esc(initials(s.name))}</span>
      <span class="share-who"><b>${esc(s.name)}</b><span>@${esc(s.username)}</span></span>
      <label class="sr-only" for="perm-${s.userId}">Access for ${esc(s.name)}</label>
      <select class="select select-sm" id="perm-${s.userId}" data-perm="${s.userId}">
        <option value="view" ${s.permission === 'view' ? 'selected' : ''}>Can view</option>
        <option value="edit" ${s.permission === 'edit' ? 'selected' : ''}>Can edit</option>
      </select>
      <button type="button" class="icon-btn" data-remove="${s.userId}" aria-label="Remove ${esc(s.name)}" title="Remove access">${icon('x', { size: 18 })}</button>
    </li>`).join('')}</ul>`;
}

export function openShareDialog(noteId) {
  const note = store.find('notes', noteId);
  if (!note) return;
  openModal({
    title: `Share “${note.title || 'Untitled'}”`,
    body: `
      <form class="share-form" novalidate>
        <label class="sr-only" for="share-username">Username</label>
        <input id="share-username" class="share-input" type="text" name="username" placeholder="Their username" autocomplete="off" autocapitalize="none" spellcheck="false" autofocus>
        <label class="sr-only" for="share-perm">Access</label>
        <select id="share-perm" class="select select-sm" name="permission">
          <option value="view">Can view</option>
          <option value="edit">Can edit</option>
        </select>
        <button class="btn btn-primary btn-sm" type="submit">Share</button>
      </form>
      <p class="form-error" role="alert" hidden></p>
      <h3 class="share-heading">People with access</h3>
      <div class="share-people" aria-live="polite"><p class="muted small">Loading…</p></div>
      <p class="muted small share-help">People need an account on this app before you can share with them. Their username is in their Settings. They’ll see the document in their list the next time their app refreshes.</p>
      <h3 class="share-heading">General access</h3>
      <div class="share-link" aria-live="polite"><p class="muted small">Loading…</p></div>`,
    footer: '<button class="btn btn-primary" data-close>Done</button>',
    onMount: async (el) => {
      const form = $('.share-form', el);
      const people = $('.share-people', el);
      const error = $('.form-error', el);
      const showError = (m) => { error.textContent = m; error.hidden = !m; };
      const draw = (shares) => { people.innerHTML = peopleHtml(shares); };

      try { draw(await store.listShares(noteId)); } catch (err) { people.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; }

      /* ----- General access: "Anyone with the link" ----- */
      const linkBox = $('.share-link', el);
      let link = null;
      const urlOf = (l) => `${location.origin}/s/${l.token}`;
      const dateIn = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
      const drawLink = () => {
        const on = link.enabled;
        linkBox.innerHTML = `
          <div class="link-access">
            <span class="link-icon ${on ? 'on' : ''}" aria-hidden="true">${icon(on ? 'link' : 'lock', { size: 18 })}</span>
            <label class="sr-only" for="link-mode">General access</label>
            <select id="link-mode" class="select select-sm" data-link="mode">
              <option value="off" ${on ? '' : 'selected'}>Restricted</option>
              <option value="on" ${on ? 'selected' : ''}>Anyone with the link</option>
            </select>
            ${on ? `<label class="sr-only" for="link-perm">Link permission</label>
            <select id="link-perm" class="select select-sm" data-link="perm">
              <option value="view" ${link.permission === 'view' ? 'selected' : ''}>Can view</option>
              <option value="edit" ${link.permission === 'edit' ? 'selected' : ''}>Can edit</option>
            </select>` : ''}
          </div>
          <p class="link-desc">${on ? `Anyone with the link can ${link.permission === 'edit' ? 'view, edit' : 'view'} and comment, without an account.` : 'Only people added above can open this document.'}</p>
          ${on ? `
          ${link.expired ? '<p class="link-warn">This link has expired. Choose a new date or clear it below.</p>' : ''}
          <div class="link-url"><input readonly value="${esc(urlOf(link))}" aria-label="Share link" data-link="url"><button type="button" class="btn btn-primary btn-sm" data-link="copy">${icon('copy', { size: 15 })}Copy link</button></div>
          <details class="link-settings">
            <summary>Link settings${link.hasPassword || link.expiresAt ? ` · ${[link.hasPassword && 'password', link.expiresAt && `expires ${new Date(link.expiresAt).toLocaleDateString()}`].filter(Boolean).join(', ')}` : ''}</summary>
            <div class="link-row"><span>Expires</span><input type="date" data-link="expires" value="${dateIn(link.expiresAt)}" min="${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}" aria-label="Expiry date">
              ${link.expiresAt ? '<button type="button" class="btn btn-plain btn-sm" data-link="noexpiry">Never expires</button>' : '<span class="muted">Optional. The link stops working at the end of this day.</span>'}</div>
            <div class="link-row"><span>Password</span><input type="password" data-link="password" placeholder="${link.hasPassword ? 'Set a new password' : 'Optional password'}" autocomplete="new-password" aria-label="Link password">
              <button type="button" class="btn btn-plain btn-sm" data-link="setpw">${link.hasPassword ? 'Change' : 'Set'}</button>
              ${link.hasPassword ? '<button type="button" class="btn btn-plain btn-sm" data-link="nopw">Remove</button>' : ''}</div>
            <div class="link-row"><span>Reset</span><button type="button" class="btn btn-ghost-danger btn-sm" data-link="reset">Reset link</button><span class="muted">Makes a new link; the old one stops working.</span></div>
          </details>` : ''}`;
      };
      const saveLink = async (changes, msg) => {
        try { link = await request('PUT', `/api/notes/${noteId}/link`, changes); drawLink(); if (msg) toast(msg); } catch (err) { showError(err.message); }
      };
      try { link = await request('GET', `/api/notes/${noteId}/link`); drawLink(); } catch (err) { linkBox.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; }
      linkBox.addEventListener('change', (e) => {
        const k = e.target.dataset.link;
        if (k === 'mode') saveLink({ enabled: e.target.value === 'on' }, e.target.value === 'on' ? 'Anyone with the link can now open this document' : 'Link turned off. People using it can no longer open the document.');
        if (k === 'perm') saveLink({ permission: e.target.value }, 'Link access updated');
        if (k === 'expires' && e.target.value) saveLink({ expiresAt: `${e.target.value}T23:59:59` }, 'Expiry date set');
      });
      linkBox.addEventListener('click', async (e) => {
        const k = e.target.closest('[data-link]')?.dataset.link;
        if (k === 'copy' || k === 'url') {
          const input = $('[data-link="url"]', linkBox);
          input.select();
          try { await navigator.clipboard.writeText(input.value); toast('Link copied'); } catch { document.execCommand('copy'); toast('Link copied'); }
        }
        if (k === 'noexpiry') saveLink({ expiresAt: null }, 'The link no longer expires');
        if (k === 'setpw') {
          const pw = $('[data-link="password"]', linkBox).value;
          if (!pw) { showError('Type a password for the link first.'); return; }
          saveLink({ password: pw }, 'Link password set. People will need it to open the document.');
        }
        if (k === 'nopw') saveLink({ password: null }, 'Link password removed');
        if (k === 'reset') {
          try { link = await request('POST', `/api/notes/${noteId}/link/reset`); drawLink(); toast('New link made. The old link no longer works.'); } catch (err) { showError(err.message); }
        }
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        showError('');
        const username = form.elements.username.value.trim().replace(/^@/, '');
        if (!username) return showError('Enter the username they signed up with.');
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          draw(await store.addShare(noteId, username, form.elements.permission.value));
          form.elements.username.value = '';
          toast(`Shared with @${username}`);
        } catch (err) {
          showError(err.message);
        } finally {
          btn.disabled = false;
          form.elements.username.focus();
        }
      });

      people.addEventListener('change', async (e) => {
        const userId = e.target.dataset.perm;
        if (!userId) return;
        try { draw(await store.updateShare(noteId, userId, e.target.value)); toast('Access updated'); } catch (err) { showError(err.message); }
      });
      people.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-remove]');
        if (!btn) return;
        try { draw(await store.removeShare(noteId, btn.dataset.remove)); toast('Access removed'); } catch (err) { showError(err.message); }
      });
    },
  });
}
