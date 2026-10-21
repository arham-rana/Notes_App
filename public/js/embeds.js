// Embedded apps: live embeds (YouTube) and link cards
// (Outlook, Teams, VS Code, Claude — these services don't allow being shown inside other sites).
import { esc } from './util.js';
import { icon } from './icons.js';

export const EMBED_SIZES = { 0: 'Automatic', 240: 'Small', 400: 'Medium', 600: 'Large', 800: 'Extra large' };

const PROVIDERS = {
  youtube: { name: 'YouTube', color: '#cc0000', live: true },
  outlook: { name: 'Outlook', color: '#0f6cbd' },
  teams: { name: 'Microsoft Teams', color: '#5b5fc7' },
  vscode: { name: 'VS Code', color: '#0065a9' },
  claude: { name: 'Claude', color: '#c96442' },
};
export const providerOf = (k) => PROVIDERS[k] || null;

/** Work out what a link is. Returns { k, embed?, title } or null if it isn't supported. */
export function detectEmbed(raw) {
  let u;
  const text = String(raw || '').trim();
  if (/^vscode(-insiders)?:\/\//i.test(text)) return { k: 'vscode', u: text, title: 'Open in VS Code' };
  try { u = new URL(text); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const path = u.pathname;
  // YouTube (privacy-enhanced mode)
  let yt = null;
  if (host === 'youtu.be') yt = path.slice(1).split('/')[0];
  if (['youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) yt = u.searchParams.get('v') || (path.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/) || [])[1];
  if (yt && /^[\w-]{6,20}$/.test(yt)) {
    const t = u.searchParams.get('t') || u.searchParams.get('start');
    const start = t ? (t.match(/^(\d+)s?$/) ? Number(RegExp.$1) : ((Number((t.match(/(\d+)h/) || [])[1]) || 0) * 3600 + (Number((t.match(/(\d+)m/) || [])[1]) || 0) * 60 + (Number((t.match(/(\d+)s/) || [])[1]) || 0))) : 0;
    return { k: 'youtube', u: text, embed: `https://www.youtube-nocookie.com/embed/${yt}${start ? `?start=${start}` : ''}`, title: 'YouTube video' };
  }
  // Outlook mail (calendar links aren't supported)
  if (['outlook.office365.com', 'outlook.office.com', 'outlook.live.com'].includes(host)) {
    if (/calendar/i.test(path)) return null;
    return { k: 'outlook', u: text, title: 'Outlook' };
  }
  if (['teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft'].includes(host)) return { k: 'teams', u: text, title: /meetup-join|meet\//i.test(path) ? 'Teams meeting' : /\/l\/chat\/|\/chat\b/i.test(path) ? 'Teams chat' : 'Microsoft Teams' };
  if (['vscode.dev', 'insiders.vscode.dev', 'github.dev'].includes(host)) return { k: 'vscode', u: text, title: `VS Code${path.length > 1 ? ` — ${decodeURIComponent(path.split('/').filter(Boolean).slice(-2).join('/'))}` : ''}` };
  if (['claude.ai', 'claude.site'].includes(host)) return { k: 'claude', u: text, title: /artifact/i.test(path) ? 'Claude artifact' : /share/i.test(path) ? 'Shared Claude chat' : 'Claude' };
  return null;
}

const badge = (p) => `<span class="emb-badge" style="background:${p.color}">${esc(p.name.replace(/^Microsoft /, '').slice(0, 1))}</span>`;
const safeUrl = (u) => (/^(https:\/\/|vscode(-insiders)?:\/\/)/i.test(u) ? u : '#');

/** HTML for an embed (reading view, editor, print). data = { u, k, t, h } */
export function embedHtml(data, { forPrint = false } = {}) {
  const info = detectEmbed(data?.u);
  const p = providerOf(info?.k);
  if (!info || !p) {
    if (!/^https:\/\//i.test(data?.u || '')) return '';
    return `<figure class="embed-block emb-cardwrap"><div class="emb-card"><span class="emb-badge" style="background:#6b7280">↗</span><span class="emb-text"><b>${esc(data.t || 'Link')}</b><small>${esc(data.u.replace(/^https:\/\//, '').slice(0, 70))}</small></span><a class="emb-open" href="${esc(data.u)}" target="_blank" rel="noopener noreferrer">Open ↗</a></div></figure>`;
  }
  const title = data.t || info.title;
  const open = `<a class="emb-open" href="${esc(safeUrl(info.u))}" target="_blank" rel="noopener noreferrer">Open${info.k === 'teams' || info.u.startsWith('vscode') ? '' : ' ↗'}</a>`;
  if (!p.live || forPrint) {
    return `<figure class="embed-block emb-cardwrap"><div class="emb-card">${badge(p)}<span class="emb-text"><b>${esc(title)}</b><small>${esc(p.name)} · ${esc(info.u.replace(/^https:\/\//, '').slice(0, 70))}</small></span>${open}</div></figure>`;
  }
  const h = Number(data.h) || 0;
  const sandbox = 'allow-scripts allow-same-origin allow-popups allow-presentation allow-forms';
  const allow = info.k === 'youtube' ? 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen' : 'fullscreen';
  return `<figure class="embed-block emb-live emb-${info.k}">
    <div class="emb-strip">${badge(p)}<b>${esc(title)}</b>${open}</div>
    <div class="emb-print emb-card">${badge(p)}<span class="emb-text"><b>${esc(title)}</b><small>${esc(info.u)}</small></span></div>
    <div class="emb-frame ${h ? '' : `emb-auto-${info.k}`}" ${h ? `style="height:${h}px"` : ''}>
      <iframe src="${esc(info.embed)}" title="${esc(title)}" loading="lazy" sandbox="${sandbox}" allow="${allow}" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
    </div>
  </figure>`;
}

import { openModal } from './ui.js';
/** Insert or change an embed. Resolves to { u, k, t, h } or null. */
export function embedDialog(existing = null) {
  return new Promise((resolve) => {
    let result = null;
    openModal({
      title: existing ? 'Change embed' : 'Embed an app',
      body: `<form class="form" id="emb-form" novalidate>
        <label class="field"><span>Link</span><input name="u" value="${esc(existing?.u || '')}" placeholder="Paste a YouTube, Outlook mail, Teams, VS Code or Claude link" autocomplete="off" autofocus></label>
        <div class="emb-detect muted small"></div>
        <label class="field"><span>Title <em>(optional)</em></span><input name="t" value="${esc(existing?.t || '')}" maxlength="80"></label>
        <label class="field emb-size-field"><span>Height</span><select name="h">${Object.entries(EMBED_SIZES).map(([v, l]) => `<option value="${v}" ${Number(existing?.h || 0) === Number(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <p class="muted small">Live: YouTube videos. Outlook, Teams, VS Code and Claude don’t allow being shown inside other sites, so they appear as a card with an Open button.</p>
      </form>`,
      footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="emb-form">${existing ? 'Save' : 'Embed'}</button>`,
      onMount: (el, close) => {
        const f = el.querySelector('#emb-form'), out = el.querySelector('.emb-detect'), sizeField = el.querySelector('.emb-size-field');
        const check = () => {
          const d = detectEmbed(f.elements.u.value);
          const p = d && providerOf(d.k);
          out.innerHTML = !f.elements.u.value.trim() ? '' : !d ? 'This link isn’t supported. Supported: YouTube, Outlook mail, Teams, VS Code and Claude.' : p.live ? `${icon('check', { size: 14 })} ${p.name}: shown live in the document` : `${icon('check', { size: 14 })} ${p.name}: shown as a card with an Open button`;
          out.classList.toggle('form-error', !!f.elements.u.value.trim() && !d);
          sizeField.hidden = !(p && p.live);
          return d;
        };
        check();
        f.elements.u.addEventListener('input', check);
        f.addEventListener('submit', (e) => {
          e.preventDefault();
          const d = check();
          if (!d) return;
          result = { u: d.u, k: d.k, t: f.elements.t.value.trim(), h: Number(f.elements.h.value) || 0 };
          close();
        });
      },
      onClose: () => resolve(result),
    });
  });
}
