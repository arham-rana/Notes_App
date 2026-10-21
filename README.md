# Documents app

Documents, reminders and a calendar in one self-hosted web app. Each person has their own account, and notes can be shared with other accounts. Everything is stored in a small SQLite database on your server, so it's the same on every device you sign in from.

## Run with Docker

```bash
docker compose up -d --build
```

Open http://localhost:3000 (or `http://<server-ip>:3000` from another device). There's nothing to configure: no `.env` file is needed. The Docker build also runs `npm run build`, which bundles the editor and combines the app's code and stylesheet into compact files, so the first build takes a minute or two longer.

Your data lives in the `notes-data` Docker volume and survives restarts, rebuilds and upgrades.

### Without Compose

```bash
docker build -t notes-app .
docker run -d --name notes-app -p 3000:3000 \
  -v notes-data:/data --restart unless-stopped notes-app
```

## How it's set up

- **Time zone:** dates and times are shown in the time zone of the computer or phone you're using, so there's nothing to set.
- **Accounts:** anyone who can reach the app can create an account. If you make it reachable from the internet, put it behind HTTPS (see below).
- **Starting empty:** a new install has no sample content.
- **File uploads:** files attached to documents can be up to 50 MB each.
- **Storage:** the database and uploaded files are kept in the Docker volume (`/data/app.db` and `/data/files/`).

## Accounts

- **Signing up:** open the app and choose **Sign Up**, then enter your name, a username and a password. Each person's notes, reminders, calendar and settings are private to them.
- **Account settings:** open **Settings** from your initials at the top right. In **Settings → Account** you can change your name, change your password (which signs out your other devices), sign out, or delete your account.
- **Staying signed in:** you stay signed in for 30 days on that device, until you sign out (on a shared computer, sign out when you're done). Sessions use a secure, HTTP-only cookie.
- **Usernames:** accounts sign in with a username (3–30 letters, numbers, dots, dashes or underscores; not case-sensitive) instead of an email. Accounts created before usernames existed get the part of their email before the @ (for example `alex@example.com` becomes `alex`; if two clash, a number is added). Each person's username is shown in **Settings → Account**, where they can also change it with **Change username** (it asks for their current password). After a change, they sign in with the new username; shared documents are unaffected.
- **Forgotten passwords:** there's no reset option, so keep passwords somewhere safe. Signed-in people can change theirs in **Settings → Account**.
- **Brute-force protection:** sign-in and sign-up are limited to 20 attempts per 15 minutes from one address.

## Sharing notes

- **Share a note:** open a note you own and click the **Share** button (person with a plus), or choose **Share…** from its ⋮ menu. Enter the username of someone who already has an account and pick **Can view** or **Can edit**.
- **What they see:** the note appears in their list marked with your name. View-only notes can't be edited, and their checkboxes can't be ticked.
- **Managing access:** the Share dialog lists everyone with access. Change their access or remove them at any time. Owners see "Shared with N people" on the note.
- **Leaving a shared note:** recipients can choose **Remove from my notes** to hide it, or **Make my own copy** to get a private copy.
- **Owners keep control:** only the owner can delete a note or share it further. Favourites are personal.
- **Simultaneous editing:** changes from other people appear within about 30 seconds. If two people edit the same note at the same moment, the last save wins.

## Backups

- In the app: **Settings → Download backup** saves your own notes, reminders, events and settings as JSON, and **Restore from backup** loads them back into your account.
- In-app backups don't include attached files or header images. To back up everything, copy the whole Docker volume, for example: `docker run --rm -v notes-app_notes-data:/data -v "$PWD":/backup alpine tar czf /backup/notes-backup.tgz -C /data .`

## Using it on other devices

Any browser on your network can open `http://<server-ip>:3000`. Open tabs pick up changes from other devices every 30 seconds and whenever you return to the tab.

To use it outside your home network, put it behind a reverse proxy with HTTPS (Caddy, Traefik, Nginx Proxy Manager, or a Cloudflare Tunnel). Don't expose it over plain HTTP, because passwords would travel unencrypted. Remember that anyone who can reach it can create an account, so share the address only with people you trust.

## Layout

- **Side menu:** a flat sidebar on the left with labelled links to **Documents**, **Reminders** and **Calendar** (the current page is highlighted). The **⋮** button at its top right hides it completely so pages use the full window; a small **⋮** button at the top left brings it back. Your choice is remembered on each device. On phones the menu opens as a drawer over a dimmed page (tap outside it to close).
- **Colours:** a calm light theme (soft blue-white background, white surfaces, Google-style blue) and a warm dark theme (charcoal rather than black, warm off-white text) with the same blue accents (a lighter tint of the blue for blue text, so it stays readable). Choose in **Settings → Appearance → Theme**.
- **Theme:** change between Device, Light and Dark in **Settings → Appearance**. Dark mode is black and grey, with white buttons and no blue.
- **Settings and signing out:** click your initials at the top right.

## Documents

- **The Documents page** lists all your documents, with search, a favourites filter and sorting.
- **Preview:** click a document once to see a preview card. It appears above or below the document, never covers it, and always fits on screen; longer previews scroll inside the card. On phones and tablets, tap it. The card's header has **Rename** (edit the title in place; Enter saves, Esc cancels), **Move to folder**, **Favourite** (owners), **Pin** and **Duplicate** ("Make my own copy" for shared documents); its bottom row has **Open**, **Edit**, **Share** (owners), **Window**, and **Delete** (or **Remove** for documents shared with you, which takes them off your list only).
- **Pinning:** pinned documents stay at the top of your list, whatever the sort order, marked with a pin. Pins are personal and sync across your devices; pinning a shared document doesn't affect anyone else's list.
- **Open:** double-click a document (or press Enter on it) to open it as a full page. Its title is a text box in the top bar (rename it any time, reading or editing; Enter saves, Esc undoes). **Details** beside it sets the description, icon, colour and tag; changes apply when you press **Save** (Cancel, Esc or clicking outside discards them). The top bar has, left to right: Version history, Comments, Full screen, Contents (when there are headings), Edit (or Done) and ⋮ (Share, Window, Favourite, Pin, reminders, templates, page setup, print and downloads, Duplicate, Delete). When you scroll down, the document's name appears beside **← Documents**. The sidebar and search bar are hidden so the document has the whole window. Press Esc or **Documents** at the top left to go back. The four-corners button also hides the browser's own toolbars.
- **Window menu** (the **Window** button in the preview card, **Window…** in the ⋮ menu, and the pane icon on each floating window's title bar): one place for every window option. **Open as** (full page, floating window or new browser window), **Open in** (this app or new browser windows) and **Layout**:
  - **Open as:** Full page, Floating window or New browser window (the current one is ticked).
  - **Open in:** *This app* (floating windows inside the browser window) or *New browser windows* (separate windows across your screen). Your choice is remembered.
  - **Layout:** Left half, Right half, Top half or Bottom half. Opens the document there, or moves it if it's already open.
  - **Layout** (several windows): Side by side, One left with two stacked on the right, or Grid of four. Uses the windows that are already open, with this document first.
  - Dragging or resizing a snapped window by hand frees it again. **Close all floating windows** clears the screen.
  - Inside a browser window opened this way, the button moves or resizes that window. On phones it simply opens a floating window.
- **Floating windows** can be dragged and resized, and stay open while you use Reminders or Calendar.
- **New browser window:** opens the document in its own browser window (the stacked-windows button on an open document, **Pop out** in the preview card, or **Pop out into its own window** in the ⋮ menu). It stays open when the main window is minimized and can be moved anywhere on your desktop or onto another screen. Edits sync instantly between the pop-out and the main window. The arrow button shows the document in the main window. Pop-outs aren't always on top, so another app you click comes in front. The next pop-out opens where you last left one. If nothing happens, allow pop-ups for the app's address in your browser. Not shown on phones.

## Writing documents

Click **Edit**. Documents are formatted as you type, the same way they look when reading.

- **Toolbar:** Undo, Redo, Text, H1 (heading), H2 (subheading), Font, Size, bulleted list, numbered list, checklist, callout, bold, italic, underline (Cmd+U), strikethrough (Cmd+Shift+X), superscript, subscript, text colour, highlighter, table, table of contents, divider, draw and attach (paperclip).
- **Fonts and sizes:** select text, then choose **Aa** (Default, Serif, Mono or Handwriting) or the size button (Small, Normal, Large, Extra large, Huge).
- **Highlighter:** select text and pick yellow, green, blue, pink or orange; **No highlight** removes it, including from part of a highlighted phrase. Colours adapt to dark mode.
- **Tables:** the table button inserts a table with a header row. **Tab** moves to the next cell (and adds a row at the end), **Shift+Tab** goes back, **Enter** moves down. While the cursor is in a table, a bar above it adds or deletes rows and columns, or deletes the table.
- **Table of contents:** the contents button inserts a list of the document's headings that stays up to date; clicking an entry jumps to that heading. Open documents with headings also have a **Contents** button in the top bar.
- **Align and indent:** the align button sets left, centre, right or justified for the paragraph(s) you're in. The indent buttons (or **Tab** / **Shift+Tab**) move paragraphs and list items in or out, up to four levels.
- **Line and paragraph spacing:** the spacing button sets line spacing (Single, 1.15, 1.5, Double) and the space after each paragraph (None, Small, Medium, Large) for the selected paragraphs.
- **Links:** select text and click the link button (or press **Cmd+K**). Enter a web or email address, or choose **Document** to link to another of your documents. While editing, click a link to **Open**, **Edit** or **Remove** it.
- **Drawing:** the pen button opens a drawing pad with eight colours, four thicknesses, an eraser, undo/redo and clear, and inserts the drawing as an image. Click any uploaded image while editing and choose **Draw** to draw on it (the eraser only removes your ink, not the photo).
- **Undo and redo:** reverse typing or the last formatting or image change. Typing is grouped into steps after a short pause or a new line. Shortcuts: **Cmd+Z** to undo, **Cmd+Shift+Z** to redo (Ctrl on Windows).
- **Find and replace:** while editing, press **Cmd+F** (or the magnifier in the toolbar). Enter / Shift+Enter move between matches; **Replace** and **Replace all** (undoable); **Aa** matches case.
- **Word count:** shown in the toolbar while editing ("x of y words" when text is selected) and in the document's details line with a reading time.
- **@mentions:** type **@** in a document or a comment to pick someone who can open it. They get a notification in the bell (once per new mention).
- **Slash commands:** type **/** at the start of a line or after a space for a menu of everything you can insert: text, headings, lists, checklist, callout, code block, table, table of contents, divider, drawing (pen), shapes, image or file, and link. Keep typing to filter, use the arrow keys, and press Enter (or Esc to close and keep the "/").
- **Code blocks:** **Insert → Code block**, **/code**, or type ``` then a space. Inside, Enter adds a line, Tab indents, and Enter on an empty last line leaves the block. The language is detected automatically (JavaScript, TypeScript, Python, HTML, CSS, JSON, SQL, Shell, Java, C/C++, Go, Rust, Swift, PHP, Ruby) and shown in the block's corner; pick a different one from that menu, or **Plain text** for no colours. Code is coloured like a code editor (keywords, strings, numbers, comments, functions, built-ins, types, properties, operators, HTML tags and attributes, CSS properties, JSON keys) in the editor, reading view, page view and print. The corner also has **Copy** and **Delete** (Undo brings a deleted block back).
- **Typing shortcuts** at the start of a line, followed by a space: `#` heading, `###` subheading, `-` bullet, `1.` numbered list, `[]` checklist, `>` callout.
- **Shift+Enter** in a bullet adds a grey detail line under it.
- **Attaching files:** use the paperclip, paste, or drag files into the document. Images appear inline; other files appear as a chip that downloads when clicked. Everyone who can open the document can open its files.
- **Resizing and cropping images:** while editing, click an image. Choose 25%, 50%, 75% or Full width, or drag the blue corner handle to any size. **Crop** opens a crop box you can drag and resize, with Free, Square, 4:3, 3:2 and 16:9 shapes; the cropped copy replaces the image and the original stays in Settings → Files. **Remove** (or Delete) takes the image out of the document.
- **Description, icon, colour and tag** sit in the collapsible section under the title.

## Live co-editing

- When several people open the same document, everyone's changes appear as they type, merged character by character, like Google Docs. Two people can type in the same sentence at once.
- While editing, each person's cursor and selection show in their own colour with their name, and their initials appear in the toolbar. The toolbar shows **Live** when connected, or **Reconnecting…** if the connection drops (changes catch up automatically).
- People who are just reading also see changes appear live.
- The editor is built on Tiptap/ProseMirror with Yjs. The live document is kept on the server (in the database) and its text is saved continuously, so reading, search, previews, version history, comments and backups all keep working. Changes made outside the editor (ticking a checkbox while reading, restoring a version) appear in open editors immediately.
- If you put the app behind a reverse proxy for HTTPS, make sure it passes WebSocket connections to `/collab` (Caddy and Nginx Proxy Manager do this by default; for plain Nginx add the `Upgrade`/`Connection` headers).

## The editing toolbar

Shortcut hints in tooltips and menus show **Ctrl** on Windows and Linux and **Cmd** on Mac, to suit the computer you're using.


Left to right: Undo, Redo, Find · **Normal text ▾** (Normal text, Heading 1, Heading 2) · Font · **− 12 +** · Bold, Italic, Underline, Text colour, Highlight, **More ▾** (Strikethrough, Superscript, Subscript, Clear formatting) · Link, Comment, **Insert ▾** · Align, Line spacing, Checklist, Bulleted list, Numbered list, Decrease / Increase indent · word count and Live status.

**Insert ▾** has everything else, in sections: *Media* (image or file, pen drawing, shapes), *Blocks* (table, chart, code block, callout, equation, inline equation), *Smart* (dropdown, signature, embedded app) and *Layout* (divider, page break, table of contents). Slash commands (type **/**) still work for all of them.

The open document's **⋮** menu is grouped: Share and Window · Favourite, Pin, Move to folder, Remind me · Page setup, Print, Download ▸ (PDF, Word, Markdown) · Save as template, Duplicate · Delete.

## Share links (no account needed)

- In **Share**, set **General access** to **Anyone with the link**, choose **Can view** or **Can edit**, and **Copy link**. The link looks like `http://your-server:3000/s/…` and contains a long random code.
- People who open it enter their name (remembered on their device) and go straight to the document: no sign-in, and no access to anything else in the app. With **Can edit** they get the full editor and live co-editing; everyone with the link can comment, print and download. They can't rename, share, delete, see version history or open other documents.
- Guests' names appear on their edits ("Jordan (guest)" in version history), comments ("Guest") and live cursors. They aren't listed under People with access or in @mentions.
- **Link settings:** an optional **expiry date** (the link stops working at the end of that day), an optional **password**, and **Reset link** (makes a new address; the old one stops working).
- Setting access back to **Restricted**, resetting the link, changing or removing its password, or the link expiring cuts off everyone using it straight away, including anyone editing at that moment. Their earlier comments and edits stay.
- Anyone the link is forwarded to can use it, so share it carefully, and use a password for anything sensitive. People can only open it if they can reach your server (your Wi-Fi at home, or HTTPS from outside; see below).

## Spelling and grammar

- While editing, spelling mistakes get a red wavy underline and grammar issues a blue one. Click one for suggestions, **Ignore**, or **Add to dictionary** (spelling). The toolbar shows how many issues there are ("3 issues"); click it to step through them in the **Spelling & grammar** panel. **More ▾ → Check as I type** turns checking on or off.
- Checks follow your computer's language and region (for example Canadian, US or British English, French, Spanish or German). Code blocks, equations, links, web addresses and @mentions are skipped. Underlines only appear while editing, never when reading, printing or exporting.
- Your dictionary is saved to your account, so added words are accepted on all your devices.
- Checking is done by **LanguageTool**, an open-source checker that runs as a second container in `docker-compose.yml` (`notes-languagetool`), so your text never leaves your server. The first start downloads it (about 300 MB) and it uses about 1 GB of memory. While it's starting (or if it's stopped), the editor uses the browser's own spellcheck instead.

## Dropdowns, charts, shapes and signatures

- **Dropdowns** (toolbar or **/dropdown**): a coloured chip with options, like Google Docs. Start from Project status, Review status or Priority, or make your own options and colours. Click a chip to choose; people who can edit can change it while reading or editing; **Edit options…** changes the list.
- **Charts** (toolbar or **/chart**): Column, Bar, Line or Pie, with a title, legend and a data table (rows, series, colours) in the chart dialog, plus a live preview. Click a chart to edit it. Word export includes it as a picture.
- **Shapes** (**Insert → Shapes** or **/shapes**), like Google Docs' Insert → Drawing: rectangles, rounded rectangles, ovals, triangles, diamonds, stars, arrows, lines and text boxes, with fill, border, thickness, text, and bring-to-front / send-to-back. It's inserted as an image; select it and choose **Edit shapes** to change it later. (The pen **Drawing** is a separate feature for sketching freehand.)
- **Signatures** (toolbar or **/signature**): add a signature box for yourself (sign straight away), a specific person who can open the document (they're notified), or anyone. Sign by drawing, typing or uploading a picture, plus your full name. Once signed, the signature, name and date are locked on the server and can't be changed or re-signed by editing the document. This isn't a certified legal e-signature service.
- **Text colour** uses the Google Docs palette (greys, bright colours, and lighter/darker shades), plus **Custom** colours (remembered) and **Reset**.
- **Font size** works like Google Docs: **− [size] +**, type a size, or pick from 8–96 (points). Documents use 12 pt by default.
- **Formatting with nothing selected** (colour, highlight, font, size, bold, italic, underline and so on) applies to what you type next; the toolbar shows it as on, and the colour and highlight buttons show the colour that will be used. It never changes the word the cursor is in.

## Embedded apps

- **Embed** (toolbar or **/embed**), or paste a supported link and choose **Embed instead** / **Show as card** in the message that appears.
- **Live in the document:** YouTube videos (privacy-enhanced mode, keeps a start time like `&t=1m5s`).
- **Cards with an Open button:** Outlook mail, Microsoft Teams (meetings show as "Teams meeting", chats as "Teams chat"), VS Code (vscode.dev, github.dev and `vscode://` links that open the desktop app) and Claude (chats, shares and artifacts). These services don't allow being shown inside other websites, so they can't appear live.
- Click an embed's title strip to select it: change its height (automatic, small, medium, large, extra large), open it, change the link, or remove it. Embeds run sandboxed, so they can't read your documents or session.
- Print and PDF show embeds as cards with their links; Word and Markdown exports include the links.

## Equations

- **Inline:** type `$x^2$` (or use the Σ button or **/inline equation**) to put maths inside a sentence.
- **Block:** type `$$` then a space (or use the block Σ button or **/equation**) for an equation on its own line.
- You write LaTeX (e.g. `\frac{a}{b}`, `\sqrt{x}`, `\sum_{i=1}^{n} i`) with a live preview; click any equation while editing to change it. Typesetting is done by KaTeX, bundled with the app (works offline).

## Page view, printing and exporting

- **⋮ → Page setup…** (like Google Docs' File → Page setup): **Pages** or **Pageless** (the default), portrait or landscape, paper size (Letter, Legal, Tabloid, A4, A5), margins, how far the header and footer sit from the edge, a different first page, and page numbers (header or footer; left, centre or right; "3" or "Page 3 of 10"). Pages are white. The setting is saved with the document.
- **Pages** shows real, separate pages, like Google Docs: text that reaches a page's bottom margin continues on the next page (paragraphs split line by line), and the page-break button (or **/page break**) starts a new page. Tables, images, equations and code blocks that don't fit move to the next page whole (one taller than a full page runs past the margin). This works while reading and while editing, including live co-editing. Switching to Pages re-flows the document to the page's real text width; switching back to Pageless returns to the full-width layout. Pages stay paper-coloured with dark text in dark mode, and the big title is hidden (the title is in the top bar), as in Google Docs.
- **Headers and footers:** click the header or footer area on any page to write in it. Options: bold, italic, size, alignment, and placeholders for the page number, page count, title and date.
- **⋮ → Print…** prints only the document's content (no title, "Last edited" or word count). Every printout is laid out as real pages with the margins built in, so the browser doesn't add its date, title and web address (on some Safari versions, untick **Print headers and footers** once if they still appear). In Pages mode it prints exactly the pages you see (same breaks, headers, footers and page numbers, on the chosen paper and orientation); in Pageless mode it prints a clean continuous copy with automatic page breaks.
- **⋮ → Download as PDF** opens the same print view; choose **Save as PDF**.
- **⋮ → Download as Word (.docx)** uses the page setup (paper, orientation, margins, real Word headers and footers with automatic page numbers, different first page) and keeps headings, styles, colours, lists, checklists, tables, images, code, links, alignment and spacing; equations become Word equations.
- **⋮ → Download as Markdown (.md)** gives standard Markdown (content only; dropdowns become their value, charts a table, signatures who signed) (fonts and colours aren't part of Markdown, so they're left out).

## Reminders from documents

- While reading, hover over a checklist item and click the bell to turn it into a reminder.
- **⋮ → Remind me about this…** sets a reminder for the whole document (tomorrow at 9:00 by default).
- These reminders show the document's name in Reminders; click it to open the document.

## Folders

- **New folder** (next to the favourites star) creates a folder in the current folder. Folders show as cards above the list; click one to open it. Inside, the path at the top (All documents › Work › Reports) takes you back up.
- Put documents in a folder by dragging them onto a folder card (or onto a folder in the path), or with **Move to folder** in a document's preview. Drag a folder onto another to nest it.
- Each folder's ⋮ has Rename, New folder inside, Move to, and Delete. Deleting a folder moves its documents and subfolders up one level; nothing is deleted.
- **All documents** lists everything; inside a folder you see its own documents and subfolders.
- Folders are personal: each person organises their own, including documents shared with them. Folders are included in backups.

## Templates and tags

- **⋮ → Save as template…** saves a document's layout. **New Template** then shows **Your templates** (with a delete button) above the built-in ones.
- The tag chips above the document list filter it by tag; clicking a tag on a document or in its preview does the same. **All** clears the filter.

## Version history

- The app saves versions of each document as it's edited: a new one after 10 minutes of editing, or when someone else starts editing. Up to 100 versions are kept per document.
- Open a document and click the **clock button** (left of Comments in the top bar) to see versions by day, time and author. Click one to preview it, then **Restore this version**. Restoring keeps the version you replaced in the history, so you can always go back.
- Anyone who can open the document can browse its history; only people who can edit can restore.

## Deleted

- Deleting a document moves it to **Deleted** (the bin button beside the search on the Documents page) and it disappears for anyone it was shared with. **Undo** in the message after deleting brings it straight back.
- In **Deleted documents**, **Restore** a document or **Delete forever**; **Delete all permanently** clears everything. Documents are removed for good, with their files, 30 days after being deleted.

## Comments

- **Adding:** select text and click the **Comment** bubble that appears beside it (or the comment button in the editing toolbar), type, and press **Comment** (or Cmd+Enter).
- **Who can comment:** anyone who can open the document, including people with view-only access.
- **The Comments panel:** the speech-bubble button on an open document (with the number of open comments) shows every comment beside the document. Commented text is underlined in yellow; click it to jump to its comment, or click a comment to jump to its text.
- **Conversations:** reply in the box under any comment. Resolve with the tick (replying reopens it), and use **Show resolved** to see past ones. People can delete their own comments; the owner can delete any.
- **If text changes:** comments are tied to the text they quote, so they don't change the document. If that text is deleted, the comment is marked "Text no longer in document".
- **Notifications:** a new comment notifies the document's owner; a reply notifies the owner and everyone in that conversation. They appear in the bell; clicking one opens the document at that comment.
- **In the list:** documents with open comments show a speech-bubble count.

## Header image

In **Settings → Appearance → Header image**, upload a wide photo to replace the mountain illustration at the top of Documents, Reminders, Calendar and Settings. Choose whether to focus on the top, middle or bottom of the photo, or switch back to the mountains. Large photos are resized before upload. The header is personal to your account.

## Files

**Settings → Files** lists everything you've attached to documents, with download and delete buttons and your total storage. Deleting a document deletes its files too.

## Notifications

The bell shows reminders that are due and events about to start (the lead time is in Settings). Alerts also pop up while the app is open. They are in-app only, so nothing is sent when every tab is closed.

## Keyboard shortcuts

- `/` or `Ctrl+K` / `Cmd+K`: search everything
- `Esc`: close dialogs, menus and search

## Run without Docker

Requires Node.js 18 or newer.

```bash
npm install
npm start
```

## Project layout

```
server.js         Express server, sign-in, sessions and API routes
build.mjs         Builds what the browser loads (npm run build): the editor engine + KaTeX (public/js/vendor),
                  and the app's code and stylesheet combined and compacted (public/dist). Edit public/js and
                  public/css, then rebuild (Docker does this automatically).
client-src/       Browser bundle entry point (editor engine, including KaTeX for maths)
shared/           Document schema and text converter, used by browser and server
src/collab.mjs    Live co-editing server (Hocuspocus/Yjs, WebSocket at /collab)
src/export-docx.mjs  Word export
src/db.js         SQLite schema, accounts, sharing, validation, import/export
public/           The web app (plain HTML, CSS and JavaScript; npm run build compacts it into public/dist)
  js/views/       Notes, reminders, calendar and settings screens
```

## API

All endpoints are JSON under `/api` and need a signed-in session, except `/auth/*` and `/health`. Requests that change data must send the header `X-Requested-With: notes-app`. Endpoints: `GET`/`PUT /notes/:id/link`, `POST /notes/:id/link/reset`, `GET /share/:token`, `POST /share/:token/join`, `POST /check`, `GET /check/status`, `GET`/`POST /dictionary`, `DELETE /dictionary/:word`, `GET`/`POST /notes/:id/signatures`, `POST /signatures/:id/sign`, `GET`/`POST /folders`, `PUT`/`DELETE /folders/:id`, `PUT /notes/:id/folder`, `GET /notes/:id/export.docx`, WebSocket `/collab`, `GET /notes/:id/people`, `GET`/`POST /templates`, `DELETE /templates/:id`, `GET /trash`, `POST /trash/:id/restore`, `DELETE /trash/:id`, `DELETE /trash`, `GET /notes/:id/versions`, `GET /notes/:id/versions/:vid`, `POST /notes/:id/versions/:vid/restore`, `PUT /notes/:id/pin`, `GET`/`POST /notes/:id/comments`, `PUT`/`DELETE /comments/:id`, `POST /notifications/read`, `PUT /account/username`, `POST /files` (raw body with `X-File-Name`, `X-File-Type`, optional `X-Note-Id`), `GET /files`, `GET`/`DELETE /files/:id`, `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/config`, `GET /me`, `PUT /account`, `PUT /account/password`, `DELETE /account`, `GET`/`POST /notes/:id/shares`, `PUT`/`DELETE /notes/:id/shares/:userId`, `GET /bootstrap`, CRUD on `/notes`, `/reminders` and `/events` (`GET`, `POST`, `GET /:id`, `PUT /:id`, `DELETE /:id`), `GET`/`PUT /settings`, `GET /export`, `POST /import`, and `GET /health` (always open, used by the Docker health check).
