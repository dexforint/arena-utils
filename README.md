# Arena Utils

Chrome extension for [arena.ai](https://arena.ai) Direct chats.

It exports conversations, inserts saved prompts, builds codebase snapshots, restores a normal scrollbar, can disable autoscroll, collapse code blocks, and jump between messages.

## Features

### Export

Toolbar popup → **Export chat**.

Each turn becomes a Markdown file in a folder named after the chat id from the URL:

- `1.md`, `3.md`, `5.md`, … — user messages
- `2.md`, `4.md`, `6.md`, … — model replies

(If the thread starts with a user message.)

Markdown is taken from React props when possible, with a DOM fallback.

### Autoscroll

Popup checkbox **Disable autoscroll after AI replies**.

Stops the page from jumping to the bottom after a model answer. Your own scrolling is unchanged. Navigation buttons still work.

### Prompts

Saved snippets (name + text) in **Options**. They appear in the popup; a click inserts the text into the composer (`textarea[name="message"]`) without sending.

### Codebase prompts

Chrome cannot read a typed path such as `C:\project`.

1. Popup → **Select folder…** (or Options → Codebase)
2. Choose a folder and **Generate prompts**
3. Chunks `context-0001`, `context-0002`, … appear in the popup and insert like normal prompts

Snapshot format matches the Python helper:

- directory tree
- file contents
- split by character limit

**Full exclude** drops paths entirely (`.git/`, `node_modules/`, …).  
**Content exclude** keeps them in the tree but skips bodies (`.env`, lockfiles, `*.json`, …).  
Optional: apply the folder’s root `.gitignore`.

### Message panel

Collapsed chip in the top-right of a chat page. Click to expand.

- Current position, e.g. `3/12`
- Active row in the list
- **↑ / ↓** — previous / next message (also keyboard arrows when the composer is not focused)
- **⤓** — jump to the bottom of the thread
- Click a row to scroll to the **start** of that message

### Code blocks

By default, fenced code in **AI replies** is collapsed. The language header and Copy stay visible; **Show · N** expands that block.

Toggle **Collapse code blocks in AI replies** in the popup or Options.

Export still contains the full Markdown.

### Scrollbar

arena.ai hides the Radix viewport scrollbar. The extension removes that rule so the native scrollbar is visible again.

## Installation

1. Open `chrome://extensions`
2. Enable Developer mode
3. **Load unpacked** → this folder
4. Reload any open arena.ai tabs after updates

## Usage

- Toolbar icon: autoscroll, code collapse, export, prompts, codebase chunks
- Right-click the extension → **Options** for prompts, chat flags, and snapshot settings
- On a chat page, use the **Messages** chip in the top-right

## Permissions

- `activeTab`, `downloads` — export Markdown
- `storage`, `unlimitedStorage` — settings, prompts, snapshots
- `https://arena.ai/*` — content scripts on chat pages

Folder access uses the browser directory picker, not an arbitrary filesystem path.

## Russian

See [README.ru.md](README.ru.md).
