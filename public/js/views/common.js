import { esc } from '../util.js';
import { icon } from '../icons.js';
import { bannerArt } from '../art.js';
import { state } from '../store.js';

export function hero({ iconName, title, subtitle, actions = '' }) {
  return `
  <section class="hero">
    <div class="banner">${bannerHtml()}</div>
    <div class="hero-body">
      <div class="hero-row">
        <div>
          <h1>${esc(title)}</h1>
          <p class="lede">${esc(subtitle)}</p>
        </div>
        ${actions ? `<div class="hero-actions">${actions}</div>` : ''}
      </div>
    </div>
  </section>`;
}

export function emptyState({ iconName, title, text, action = '' }) {
  return `<div class="empty">
    <span class="empty-icon">${icon(iconName, { size: 26 })}</span>
    <h3>${esc(title)}</h3>
    <p>${esc(text)}</p>
    ${action}
  </div>`;
}

/** The user's own header image if they've uploaded one, otherwise the drawn mountains. */
export function bannerHtml() {
  const id = state.settings?.headerImage;
  if (!id) return bannerArt();
  const pos = { top: 'center top', center: 'center center', bottom: 'center bottom' }[state.settings.headerPosition] || 'center center';
  return `<img class="banner-img" src="/api/files/${id}" alt="" style="object-position:${pos}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'banner-fallback'}))">`;
}
