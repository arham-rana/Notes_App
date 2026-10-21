import { esc, timeAgo } from './util.js';
import { icon } from './icons.js';
import { renderNote, taskProgress, wordCount } from './markdown.js';


/** Title, details line and formatted text of a document (reading view). */
export function noteBodyHtml(note, { title = true, editAction = 'edit-note', remindable = false } = {}) {
  const progress = taskProgress(note.content);
  const words = wordCount(note.content);
  return `
    <header class="doc-head">
    ${title ? `<h1 class="note-title">${esc(note.title || 'Untitled')}</h1>` : ''}
    <div class="note-meta">
      <span class="meta-item">${icon('calendar', { size: 16 })}Last edited ${timeAgo(note.updatedAt)}</span>
      ${sharingPill(note)}
      ${note.tag ? `<button type="button" class="pill pill-tag c-${note.color}" data-action="filter-tag" data-tag="${esc(note.tag)}" title="Show documents tagged ${esc(note.tag)}">${icon('tag', { size: 14 })}${esc(note.tag)}</button>` : ''}
      ${note.kind === 'project' ? `<span class="pill c-slate">${icon('briefcase', { size: 14 })}Project</span>` : ''}
      ${progress.total ? `<span class="meta-item">${icon('checkSquare', { size: 16 })}${progress.done} of ${progress.total} done</span>` : ''}
      ${words ? `<span class="meta-item">${words.toLocaleString()} word${words === 1 ? '' : 's'}</span>` : ''}
    </div>
    </header>
    <div class="prose" data-note="${note.id}">
      ${note.content.trim() ? renderNote(note.content, { readOnly: note.access === 'view', remindable }) : ''}
    </div>`;
}

export const canEdit = (note) => !note.access || note.access === 'owner' || note.access === 'edit';
export const isOwner = (note) => !note.access || note.access === 'owner';

/** "Shared with 2 people" for owners; "Shared by Alex, can edit" for recipients. */
export function sharingPill(note) {
  if (isOwner(note)) {
    return note.shareCount ? `<button class="pill pill-share" data-action="share-note" data-id="${note.id}">${icon('users', { size: 14 })}Shared with ${note.shareCount} ${note.shareCount === 1 ? 'person' : 'people'}</button>` : '';
  }
  return `<span class="pill pill-share">${icon('users', { size: 14 })}Shared by ${esc(note.ownerName)}${note.ownerUsername ? ` <span class="pill-user">@${esc(note.ownerUsername)}</span>` : ''} · ${note.access === 'edit' ? 'Can edit' : 'View only'}</span>`;
}

/** Small marker for list rows. */
export function sharedBadge(note) {
  if (isOwner(note)) return note.shareCount ? `<span class="shared-badge" title="Shared with ${note.shareCount} ${note.shareCount === 1 ? 'person' : 'people'}">${icon('users', { size: 13 })}</span>` : '';
  return `<span class="shared-badge from" title="Shared by ${esc(note.ownerName)}${note.ownerUsername ? ` (@${esc(note.ownerUsername)})` : ''}">${icon('users', { size: 13 })}${esc(note.ownerName.split(' ')[0])}${note.ownerUsername ? ` <span class="badge-user">@${esc(note.ownerUsername)}</span>` : ''}</span>`;
}
