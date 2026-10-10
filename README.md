# Arena Utils

Chrome extension for [arena.ai](https://arena.ai).

It exports chats to Markdown, inserts saved prompts, builds codebase snapshots
on demand, restores a normal scrollbar, can disable autoscroll, collapse code
blocks, jump between messages, and bookmark chats.

## Languages

The extension ships with English (`en`) and Russian (`ru`). Translations live
under `_locales/<code>/messages.json`; the manifest has `"default_locale": "en"`.
Adding a new language means dropping a new folder there — nothing else needs to change.

## Features

### Export

Toolbar popup → **Export chat**. Each message becomes a Markdown file inside a
folder named after the chat id from the URL, numbered in the order messages
appear (`1.md`, `2.md`, `3.md`, …).

Markdown is taken from React props when possible, with a DOM fallback.

Files are downloaded via blob URLs created by an offscreen document; if that
fails, the extension falls back to `data:` URLs.

### New chat

Collapsed chip in the top-left of a conversation (`/c/...`). Expanded on
new-chat pages (`/`, `/text`, `/text/direct`, …).

Templates live in **Options → New chat**. Each button opens a URL for that mode:

- Battle → `/`, `/text`, `/code`, `/image`, `/search`, `/video`
- Agent Mode → `/agent`
- Direct → `/{category}/direct?model_a=...`
- Side by Side → `/{category}/side-by-side?model_a=...&model_b=...`

Optional initial prompt is inserted into the composer after the page loads.
It is not sent automatically.

### Autoscroll

Popup checkbox **Disable autoscroll after AI replies**. Stops the page from
jumping to the bottom after a model answer; your own scrolling is unchanged and
navigation buttons still work.

Implemented by patching `scrollIntoView` / `scrollTo` / `scrollBy` in the page's
main world (`pageBridge.js`).

### Prompts

Saved snippets (name + text) in **Options**. They appear as the **Prompts**
panel on arena.ai pages; a click inserts the text into the composer
(`textarea[name="message"]`) without sending.

### Codebase

Chrome cannot read an arbitrary filesystem path such as `C:\project`. Instead,
the extension asks for a folder handle from the page itself.

1. On any arena.ai page, open the **Codebase** panel in the left column
   (below **New chat** and **Prompts**).
2. Click **Select…** and pick a folder — chunk list is built right away.
3. Click **Rebuild** to regenerate from the same folder, or **Change…** to pick another.
4. Click a fragment to insert it into the composer. Each inserted fragment is
   prefixed with a `Fragment n/N` header (localized) so the model knows which
   piece of the snapshot it is and how many parts to expect.

Chunk list and folder handle live only in the current tab — reloading the page
clears them.

Rules for the snapshot (max characters per chunk, exclude patterns, optional
root `.gitignore`) are in **Options → Codebase**. The panel regenerates with
whatever is stored there.

Snapshot format matches the Python helper (`compare_exports.py`):

- directory tree
- file contents
- split by character limit

**Full exclude** drops paths entirely (`.git/`, `node_modules/`, …).  
**Content exclude** keeps them in the tree but skips bodies (`.env`, lockfiles, `*.json`, …).

### Message panel

Collapsed chip in the top-right of a chat page. Click to expand.

- Current position, e.g. `3/12`
- Active row in the list
- **↑ / ↓** — previous / next message (also keyboard arrows when the composer is not focused)
- **⤓** — jump to the bottom of the thread
- Click a row to scroll to the **start** of that message

### Bookmarks

Click ☆ in the **Messages** panel to bookmark the current chat. Bookmarks appear
in the popup and open in a new tab on click.

### Article / Video (from the popup)

On any HTTP page with a large `<article>`, the popup offers **Explain article**:
it extracts the article, wraps it in a template from **Options → Article**, and
opens a fresh arena.ai Direct chat with the prompt ready to send.

On a YouTube video page with captions, the popup offers **Explain video**: it
pulls the subtitles through several fallbacks (page response → refetch →
InnerTube clients → DOM transcript panel), formats them with `[mm:ss]`
timestamps, and opens a new chat.

### Code blocks

By default, fenced code in **AI replies** is collapsed. The language header and
Copy stay visible; **Show · N** expands that block. Toggle in the popup or in
**Options → Chat**.

Export always contains the full Markdown.

### Scrollbar

arena.ai hides the Radix viewport scrollbar. The extension removes that rule so
the native scrollbar is visible again.

## Installation

1. Open `chrome://extensions`
2. Enable Developer mode
3. **Load unpacked** → this folder
4. Reload any open arena.ai tabs after updates

## Usage

- Toolbar icon: autoscroll, code collapse, export, article/video, prompts,
  bookmarks, debug profiling
- Right-click the extension → **Options** for templates, prompts, article/video
  templates, and codebase rules
- On a chat page, panels stack in the left column: **New chat**, **Prompts**,
  **Codebase**; **Messages** is top-right

## Permissions

- `downloads` — export Markdown files
- `storage`, `unlimitedStorage` — settings, prompts, bookmarks
- `offscreen` — build blob URLs so the service worker can trigger file downloads
- `scripting` — inject article / video extractors on demand
- `https://arena.ai/*` — content scripts on chat pages

Folder access for the Codebase panel uses the browser directory picker from the
arena.ai page itself, not an arbitrary filesystem path.

## Adding a language

1. Copy `_locales/en/` to `_locales/<code>/`.
2. Translate every `message` (keys stay the same).
3. Add a `languageCode` entry with the new code.
4. Reload the extension. Users with a matching browser locale get the new
   language automatically; everyone else falls back to `en`.

## Russian

См. [README.ru.md](README.ru.md).
