// Live co-editing: a Hocuspocus (Yjs) server attached to the app's HTTP server.
// The live document lives in memory while people edit it; its state is stored in
// SQLite, and its text is saved back to the document so reading, search,
// previews and version history keep working.
import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON, updateYFragment } from 'y-prosemirror';
import { markdownToDoc, docToMarkdown } from '../shared/convert.mjs';
import { documentSchema } from '../shared/schema.mjs';

const FIELD = 'default';

export function createCollab({ db, userForRequest }) {
  const lastEditor = new Map(); // noteId -> user id of the most recent editor

  const hocus = Server.configure({
    quiet: true,
    debounce: 1200,
    maxDebounce: 6000,
    async onAuthenticate({ request, documentName, connection }) {
      const user = userForRequest(request);
      if (!user) throw new Error('Please sign in');
      const note = db.get('notes', documentName, user.id);
      if (!note) throw new Error('Document not found');
      if (note.access === 'view') connection.readOnly = true;
      return { user };
    },
    async onLoadDocument({ documentName, document }) {
      const state = db.loadYState(documentName);
      if (state) {
        Y.applyUpdate(document, new Uint8Array(state));
      } else {
        // First time this document is opened live: build it from the saved text.
        const seed = prosemirrorJSONToYDoc(documentSchema(), markdownToDoc(db.noteContent(documentName)), FIELD);
        Y.applyUpdate(document, Y.encodeStateAsUpdate(seed));
      }
      return document;
    },
    async onChange({ documentName, context }) {
      if (context?.user) lastEditor.set(documentName, context.user.id);
    },
    async onStoreDocument({ documentName, document }) {
      db.saveYState(documentName, Buffer.from(Y.encodeStateAsUpdate(document)));
      const uid = lastEditor.get(documentName);
      if (!uid) return;
      try {
        const markdown = docToMarkdown(yDocToProsemirrorJSON(document, FIELD));
        db.saveContentFromCollab(documentName, markdown, uid);
      } catch (err) { console.error('Couldn’t save live document', documentName, err); }
    },
  });

  return {
    handleConnection: (ws, request) => hocus.handleConnection(ws, request),
    /** The document's text changed outside the editor (checkbox, restore, import): update live copies. */
    replaceContent(noteId, markdown) {
      const doc = hocus.documents.get(noteId);
      if (!doc) { db.clearYState(noteId); return; }
      try {
        const node = documentSchema().nodeFromJSON(markdownToDoc(markdown));
        doc.transact(() => updateYFragment(doc, doc.getXmlFragment(FIELD), node, { mapping: new Map(), isOMark: new Map() }), 'server');
      } catch (err) {
        console.error('Couldn’t update live document', noteId, err);
        db.clearYState(noteId);
      }
    },
    connectionsFor: (noteId) => hocus.documents.get(noteId)?.getConnectionsCount?.() || 0,
    close: () => hocus.closeConnections?.(),
    /** Disconnect everyone from a document (they reconnect if they still have access). */
    closeDocument: (noteId) => hocus.closeConnections?.(noteId),
  };
}
