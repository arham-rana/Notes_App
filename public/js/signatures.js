// E-signatures: "Signature needed" boxes. The signed details live on the server and lock once signed.
import { esc } from './util.js';
import { icon } from './icons.js';
import { state, store, request } from './store.js';
import { openModal, toast } from './ui.js';
import { peopleFor } from './mentions.js';

const cache = new Map(); // noteId -> Map(id -> signature)
export async function loadSignatures(noteId, { force = false } = {}) {
  if (!force && cache.has(noteId)) return cache.get(noteId);
  try { const list = await request('GET', `/api/notes/${noteId}/signatures`); cache.set(noteId, new Map(list.map((s) => [s.id, s]))); }
  catch { cache.set(noteId, cache.get(noteId) || new Map()); }
  return cache.get(noteId);
}
/** A signature from the cache (if this document's signatures have been loaded). */
export const signatureFor = (noteId, id) => cache.get(noteId)?.get(id) || null;
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

/** HTML for one signature box. */
export function signatureHtml(sig) {
  if (!sig) return '<div class="sig-inner sig-missing">Signature box (not found)</div>';
  if (sig.status === 'signed') {
    return `<div class="sig-inner sig-signed">
      <img class="sig-img" src="${esc(sig.image)}" alt="Signature of ${esc(sig.signedName)}">
      <div class="sig-line"></div>
      <div class="sig-meta"><b>${esc(sig.signedName)}</b>${sig.label ? ` · ${esc(sig.label)}` : ''}<span>${icon('lock', { size: 12 })}Signed ${esc(fmtDate(sig.signedAt))}${sig.signedBy ? ` by @${esc(sig.signedBy.username)}` : ''}</span></div>
    </div>`;
  }
  const mine = !sig.signer || sig.signer.id === state.user?.id;
  return `<div class="sig-inner sig-pending">
    <div class="sig-space">${mine ? `<button type="button" class="btn btn-primary btn-sm sig-sign" data-sign="${sig.id}">${icon('pen', { size: 15 })}Sign here</button>` : `<span class="sig-wait">Waiting for ${esc(sig.signer.name)} to sign</span>`}</div>
    <div class="sig-line"></div>
    <div class="sig-meta"><b>Signature needed${sig.signer ? ` from ${esc(sig.signer.name)} <small>@${esc(sig.signer.username)}</small>` : ''}</b>${sig.label ? ` · ${esc(sig.label)}` : ''}</div>
  </div>`;
}

/** Fill every signature box inside root (reading view, print, editor). */
export async function hydrateSignatures(root, noteId) {
  const boxes = root.querySelectorAll('[data-sig]');
  if (!boxes.length) return;
  const map = await loadSignatures(noteId);
  const missing = [...boxes].some((b) => !map.has(b.dataset.sig));
  const m2 = missing ? await loadSignatures(noteId, { force: true }) : map;
  boxes.forEach((b) => { b.innerHTML = signatureHtml(m2.get(b.dataset.sig)); });
}
export function signatureSync(root, noteId) {
  const map = cache.get(noteId);
  if (!map) return false;
  root.querySelectorAll('[data-sig]').forEach((b) => { b.innerHTML = signatureHtml(map.get(b.dataset.sig)); });
  return true;
}

/** Ask for a signature: who signs, and what it's for. Resolves to the new signature (or null). */
export function requestSignatureDialog(noteId) {
  return new Promise(async (resolve) => {
    const people = (await peopleFor(noteId)).filter((p) => p.id !== state.user?.id);
    let result = null;
    openModal({
      title: 'Add a signature box',
      size: 'sm',
      body: `<form class="form" id="sig-req" novalidate>
        <label class="field"><span>Who should sign?</span><select name="signer">
          <option value="__me">Me (sign now)</option>
          ${people.map((p) => `<option value="${esc(p.username)}">${esc(p.name)} (@${esc(p.username)})</option>`).join('')}
          <option value="">Anyone who can open the document</option>
        </select></label>
        <label class="field"><span>What for? <em>(optional)</em></span><input name="label" maxlength="80" placeholder="e.g. Approved by"></label>
        <p class="muted small">Once signed, the signature, name and date are locked and can’t be changed.${people.length ? '' : ' To ask someone else, share the document with them first.'}</p>
      </form>`,
      footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="sig-req">Add</button>',
      onMount: (el, close) => {
        el.querySelector('#sig-req').addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = e.target.elements;
          const me = f.signer.value === '__me';
          try {
            const sig = await request('POST', `/api/notes/${noteId}/signatures`, { signer: me ? state.user.username : f.signer.value, label: f.label.value });
            (cache.get(noteId) || cache.set(noteId, new Map()).get(noteId)).set(sig.id, sig);
            result = { sig, signNow: me };
            close();
          } catch (err) { toast(err.message, { tone: 'error' }); }
        });
      },
      onClose: () => resolve(result),
    });
  });
}

/** Sign: draw, type or upload a signature, plus the full name. */
export function signDialog(sig, onDone) {
  openModal({
    title: 'Sign',
    body: `<div class="segmented sig-tabs" role="radiogroup">
        <label><input type="radio" name="mode" value="draw" checked><span>Draw</span></label>
        <label><input type="radio" name="mode" value="type"><span>Type</span></label>
        <label><input type="radio" name="mode" value="upload"><span>Upload</span></label>
      </div>
      <div class="sig-pane" data-pane="draw"><canvas class="sig-pad" width="640" height="200" aria-label="Draw your signature"></canvas><button type="button" class="btn-link sig-clear">Clear</button></div>
      <div class="sig-pane" data-pane="type" hidden><input class="sig-typed" maxlength="60" placeholder="Type your signature" aria-label="Typed signature"></div>
      <div class="sig-pane" data-pane="upload" hidden><input type="file" accept="image/png,image/jpeg" class="sig-file" aria-label="Signature image"><img class="sig-preview" alt="" hidden></div>
      <form class="form" id="sig-form" novalidate>
        <label class="field"><span>Full name</span><input name="name" maxlength="80" value="${esc(state.user?.name || '')}"></label>
        <p class="muted small">By signing you agree this is your signature. It will be locked with today’s date.</p>
      </form>`,
    footer: '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="sig-form">Sign and lock</button>',
    onMount: (el, close) => {
      const pad = el.querySelector('.sig-pad'), g = pad.getContext('2d');
      g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#13213a';
      let drawing = false, drawn = false, uploaded = null;
      const pt = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * (pad.width / r.width), (e.clientY - r.top) * (pad.height / r.height)]; };
      pad.addEventListener('pointerdown', (e) => { drawing = true; drawn = true; pad.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...pt(e)); });
      pad.addEventListener('pointermove', (e) => { if (drawing) { g.lineTo(...pt(e)); g.stroke(); } });
      pad.addEventListener('pointerup', () => { drawing = false; });
      el.querySelector('.sig-clear').addEventListener('click', () => { g.clearRect(0, 0, pad.width, pad.height); drawn = false; });
      el.querySelector('.sig-tabs').addEventListener('change', (e) => el.querySelectorAll('.sig-pane').forEach((p) => { p.hidden = p.dataset.pane !== e.target.value; }));
      el.querySelector('.sig-file').addEventListener('change', (e) => {
        uploaded = e.target.files[0] || null;
        const pv = el.querySelector('.sig-preview');
        if (uploaded) { pv.src = URL.createObjectURL(uploaded); pv.hidden = false; }
      });
      el.querySelector('#sig-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = e.target.elements.name.value.trim();
        const mode = el.querySelector('[name=mode]:checked').value;
        if (!name) return toast('Type your full name', { tone: 'error' });
        let blob = null;
        if (mode === 'draw') { if (!drawn) return toast('Draw your signature first', { tone: 'error' }); blob = await new Promise((r) => pad.toBlob(r, 'image/png')); }
        if (mode === 'type') {
          const t = el.querySelector('.sig-typed').value.trim();
          if (!t) return toast('Type your signature first', { tone: 'error' });
          const c = document.createElement('canvas'); c.width = 640; c.height = 200;
          const x = c.getContext('2d'); x.fillStyle = '#13213a'; x.font = 'italic 64px "Brush Script MT", "Segoe Script", "Bradley Hand", cursive'; x.textBaseline = 'middle'; x.fillText(t, 20, 100);
          blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        }
        if (mode === 'upload') { if (!uploaded) return toast('Choose a picture of your signature', { tone: 'error' }); blob = uploaded; }
        try {
          const file = await store.uploadFile(blob, { noteId: sig.noteId, name: 'signature.png' });
          const signed = await request('POST', `/api/signatures/${sig.id}/sign`, { name, image: file.url });
          (cache.get(sig.noteId) || cache.set(sig.noteId, new Map()).get(sig.noteId)).set(signed.id, signed);
          close();
          toast('Signed and locked');
          onDone?.(signed);
        } catch (err) { toast(err.message, { tone: 'error' }); }
      });
    },
  });
}

// "Sign here" buttons anywhere (reading view or editor).
document.addEventListener('click', async (e) => {
  const b = e.target.closest?.('[data-sign]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const noteId = (location.hash.match(/#\/(?:documents|popout)\/([^/]+)/) || [])[1];
  const map = await loadSignatures(noteId, { force: true });
  const sig = map.get(b.dataset.sign);
  if (!sig) return;
  if (sig.status === 'signed') { toast('This has already been signed'); return; }
  signDialog(sig, () => document.querySelectorAll(`[data-sig="${sig.id}"]`).forEach((box) => { box.innerHTML = signatureHtml(cache.get(noteId).get(sig.id)); }));
}, true);
