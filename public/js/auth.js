import { $ } from './util.js';
import { icon } from './icons.js';
import { bannerArt } from './art.js';
import { request } from './store.js';


let config = { allowSignup: true, hasUsers: true };

function field({ name, type = 'text', label, iconName, autocomplete, extra = '', reveal = false }) {
  return `
    <label class="glass-field">
      <span class="sr-only">${label}</span>
      <span class="glass-field-icon" aria-hidden="true">${icon(iconName, { size: 20 })}</span>
      <input name="${name}" type="${type}" placeholder="${label}" autocomplete="${autocomplete}" ${extra}>
      ${reveal ? `<button type="button" class="glass-reveal" aria-label="Show password" aria-pressed="false">${icon('eyeOff', { size: 20 })}</button>` : ''}
    </label>`;
}

function cardHtml(mode) {
  const signup = mode === 'signup';
  const first = !config.hasUsers;
  return `
  <div class="glass-card" role="main">
    ${config.hasUsers ? `
    <div class="glass-tabs" role="tablist" aria-label="Sign in or create an account">
      <button type="button" role="tab" class="glass-tab ${signup ? '' : 'active'}" aria-selected="${!signup}" data-mode="login">Sign In</button>
      <button type="button" role="tab" class="glass-tab ${signup ? 'active' : ''}" aria-selected="${signup}" data-mode="signup">Sign Up</button>
    </div>` : ''}
    <div class="glass-head">
      <h1>${signup ? (first ? 'Create your account' : 'Create an account') : 'Welcome back'}</h1>
      <p>${signup
        ? 'Choose a username and password to get started.'
        : 'Enter your username and password to sign in.'}</p>
    </div>
    <form class="glass-form" novalidate>
      ${signup ? field({ name: 'name', label: 'Your name', iconName: 'smile', autocomplete: 'name', extra: 'maxlength="60" autofocus' }) : ''}
      ${field({ name: 'username', label: 'Username', iconName: 'user', autocomplete: 'username', extra: `maxlength="30" autocapitalize="none" autocorrect="off" spellcheck="false" ${signup ? '' : 'autofocus'}` })}
      ${field({ name: 'password', type: 'password', label: signup ? 'Password (8+ characters)' : 'Password', iconName: 'lock', autocomplete: signup ? 'new-password' : 'current-password', reveal: true })}
      <p class="glass-error" role="alert" hidden></p>
      <button class="glass-submit" type="submit">${icon('arrowRight', { size: 22 })}<span>${signup ? 'Create Account' : 'Sign In'}</span></button>
    </form>
  </div>`;
}

function render(root, mode) {
  root.innerHTML = cardHtml(mode);
  const form = $('form', root);
  const error = $('.glass-error', root);
  const submit = $('.glass-submit', root);
  const label = submit.querySelector('span');
  const idle = label.textContent;
  const showError = (msg) => { error.textContent = msg; error.hidden = false; };

  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode !== mode) render(root, b.dataset.mode);
  }));

  $('.glass-reveal', root).addEventListener('click', (e) => {
    const input = form.elements.password;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    const btn = e.currentTarget;
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    btn.innerHTML = icon(show ? 'eye' : 'eyeOff', { size: 20 });
    input.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const data = {
      name: form.elements.name?.value,
      username: form.elements.username.value.trim().replace(/^@/, ''),
      password: form.elements.password.value,
    };
    if (mode === 'signup' && !data.name?.trim()) return showError('Enter your name.');
    if (!data.username) return showError('Enter your username.');
    if (mode === 'signup' && !/^[a-zA-Z0-9._-]{3,30}$/.test(data.username)) return showError('Usernames are 3–30 characters: letters, numbers, dots, dashes or underscores.');
    if (!data.password) return showError('Enter your password.');
    if (mode === 'signup' && data.password.length < 8) return showError('Use a password with at least 8 characters.');
    submit.disabled = true;
    label.textContent = mode === 'signup' ? 'Creating account…' : 'Signing in…';
    try {
      await request('POST', `/api/auth/${mode}`, data);
      location.reload();
    } catch (err) {
      showError(err.message);
      submit.disabled = false;
      label.textContent = idle;
    }
  });
  (root.querySelector('[autofocus]') || form.elements.username).focus();
}

export async function showAuth() {
  try { config = await request('GET', '/api/auth/config'); } catch { /* keep defaults */ }
  document.body.classList.add('auth-mode');
  if (!document.querySelector('.auth-bg')) {
    const bg = document.createElement('div');
    bg.className = 'auth-bg';
    bg.setAttribute('aria-hidden', 'true');
    bg.innerHTML = `<div class="auth-banner-bg">${bannerArt()}</div>`;
    document.body.appendChild(bg);
  }
  let root = document.getElementById('auth');
  if (!root) {
    root = document.createElement('div');
    root.id = 'auth';
    document.body.appendChild(root);
  }
  render(root, config.hasUsers ? 'login' : 'signup');
}

