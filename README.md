# Arena Utils

Chrome extension for arena.ai Direct chats.

## Features

- Export the current chat to a folder of Markdown files (`1.md`, `2.md`, ...)
- Disable autoscroll after the model replies
- Saved prompts: click in the popup to insert into the composer
- Message navigation panel in the top-right corner of the chat page

The export folder name is the chat id from the URL.

Odd files are user messages, even files are model replies — if the thread starts with a user message.

## Installation

1. Open `chrome://extensions`
2. Enable developer mode
3. Load the extension folder
4. Reload any open arena.ai tabs

## Usage

- Toolbar icon opens the popup: autoscroll toggle, export, prompts
- Right-click the extension → Options to edit prompts
- On a chat page, use the `Messages` chip in the top-right to jump between turns

## Codebase prompts

Chrome extensions cannot read a typed path like `C:\project`. Use Options → **Select folder**, then **Generate prompts**.

The snapshot uses the same format as the Python script:

- directory tree
- file contents
- split into `context-0001`, `context-0002`, … by character limit

Full exclude drops files from the snapshot. Content exclude keeps them in the tree but skips the body (`.env`, lockfiles, `*.json`, …).

Generated chunks appear in the popup and insert into the arena.ai composer.
