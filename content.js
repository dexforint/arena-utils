let exportInProgress = false;
let requestCounter = 0;
let panelCollapsed = true;
let newChatCollapsed = true;
let newChatCollapsedOverride = false;
let promptsCollapsed = true;
let collapseCodeBlocks = true;
let highlightTimer = 0;
let refreshTimer = 0;
let currentSyncTimer = 0;
let lastUrl = location.href;
let currentIndex = -1;
let pinnedUntil = 0;
let boundScroller = null;
let cachedMessages = [];
let panelRows = [];
let chatTemplates = [];
let prompts = [];
let pendingPromptInFlight = false;
let cachedBookmarkIds = new Set();
let lastCurrentIndexScan = { count: -1, at: 0 };
const SCROLL_PARENT_CACHE_MS = 500;
let scrollParentCache = new WeakMap();
let listObserver = null;
let listObserverTarget = null;
let codebaseCollapsed = true;
let codebaseSnapshot = null;
let codebaseDirHandle = null;
let codebaseGenerating = false;

// ВАЖНО: функции ниже объявлены как top-level function declarations.
// perfWrap.js находит их через globalThis и оборачивает для профилирования.
// Обернуть весь файл в IIFE нельзя без правки perfWrap.js — иначе
// профилирование молча покажет нули.

const pendingRequests = new Map();

const Shared = globalThis.ArenaShared;
const I18n = globalThis.ArenaI18n;
const t = (key, subs) => {
	if (!key) {
		return "";
	}
	if (I18n?.t) {
		return I18n.t(key, subs);
	}
	return key;
};

if (!Shared) {
	console.error("[arena-utils] shared.js is missing; using inline fallbacks");
}

const sanitizeFileName =
	Shared?.sanitizeFileName ||
	((value) =>
		String(value || "")
			.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
			.trim()
			.slice(0, 120) || "arena-dialog");

const normalizeMarkdown =
	Shared?.normalizeMarkdown ||
	((text) =>
		`${String(text ?? "")
			.replace(/\r\n/g, "\n")
			.trimEnd()}\n`);

const prefixListItem =
	Shared?.prefixListItem ||
	((block, marker, indent) =>
		String(block || "")
			.split("\n")
			.map((line, index) => (index === 0 ? `${marker}${line}` : line ? `${indent}${line}` : ""))
			.join("\n"));

const getBookmarks =
	Shared?.getBookmarks ||
	(async () => {
		const stored = await chrome.storage.local.get({ bookmarks: [] });
		return Array.isArray(stored.bookmarks) ? stored.bookmarks : [];
	});

const setBookmarks =
	Shared?.setBookmarks ||
	(async (bookmarks) => {
		await chrome.storage.local.set({
			bookmarks: Array.isArray(bookmarks) ? bookmarks : [],
		});
	});

const HOST_ID = "__arena_utils_host__";
const NEW_CHAT_HOST_ID = "__arena_utils_new_chat_host__";
const PROMPTS_HOST_ID = "__arena_utils_prompts_host__";
const PAGE_STYLE_ID = "__arena_utils_page_style__";
const AUTOSCROLL_KEY = "__arena_utils_disable_autoscroll";
const ALLOW_SCROLL_KEY = "__arena_utils_allow_scroll";
const PENDING_PROMPT_KEY = "__arena_utils_pending_prompt";
const EXPORT_ATTR = "data-arena-export-id";
const MESSAGE_SCROLL_OFFSET = 16;
const READING_LINE_OFFSET = 48;
const PREVIEW_CACHE_TTL_MS = 1500;
const BOOKMARK_TITLE_MAX = 80;
const CODE_TOGGLE_CLASS = "__arena-utils-code-toggle";
const CODE_COLLAPSED_CLASS = "__arena-utils-code-collapsed";
const HIGHLIGHT_CLASS = "__arena-utils-highlight";
const CODEBASE_HOST_ID = "__arena_utils_codebase_host__";

const MESSAGE_LIST_SELECTORS = ["main ol.flex-col-reverse", "ol.flex-col-reverse", "ol.mt-8.flex", "ol.mt-8"];

const PROSE_SELECTOR = ".prose";
const CODE_BLOCK_SELECTOR = "[data-code-block='true']";
const COMPOSER_SELECTORS = ['textarea[name="message"]', 'form textarea[name="message"]', "form textarea", 'textarea[placeholder*="Ask"]'];
const PORTAL_TARGET_SELECTOR = "#root-portal-target";
const SEND_BUTTON_SELECTOR = 'button[aria-label="Send message"]';
const PREFERRED_TITLE_SELECTOR = 'button[aria-label*=", model "]';

// Иконка Copy на arena.ai — узнаём по этим путям SVG.
const COPY_ICON_PATH_MARKERS = ["M19.4 20H9.6", "M15 9V4.6"];

const PANEL_SHARED_CSS = `
:host {
	all: initial;
	font-family: Inter,Inter Fallback,ui-sans-serif,system-ui,sans-serif;
	--header-primary: 60 3% 14%;
	--text-primary: 24 6% 17%;
	--text-secondary: 30 7% 24%;
	--text-muted: 37 5% 52%;
	--interactive-active: 60 4% 11%;
	--arena-bg: rgb(252, 250, 248);
	--arena-raised: rgb(240, 235, 229);
	--arena-border: rgb(225, 222, 219);
	--arena-border-faint: rgb(229, 231, 235);
	color: hsl(var(--text-primary));
}

:host([data-theme="dark"]) {
	--header-primary: 0 0% 100%;
	--text-primary: 33 31% 94%;
	--text-secondary: 35 20% 88%;
	--text-muted: 35 6% 38%;
	--interactive-active: 0 0% 100%;
	--arena-bg: rgb(22, 20, 18);
	--arena-raised: rgb(36, 32, 28);
	--arena-border: rgb(58, 52, 46);
	--arena-border-faint: rgb(48, 44, 40);
}

.panel {
	color: hsl(var(--text-primary));
	background: color-mix(in srgb, var(--arena-bg) 92%, transparent);
	border: 1px solid var(--arena-border);
	border-radius: 12px;
	box-shadow: 0 12px 40px rgb(46 43 41 / 10%);
	backdrop-filter: blur(16px);
	overflow: hidden;
}

.panel[data-collapsed="true"] {
	width: auto;
}

.toggle {
	display: flex;
	align-items: center;
	gap: 8px;
	flex: 1;
	min-width: 0;
	margin: 0;
	padding: 8px 10px;
	border: 0;
	background: transparent;
	color: inherit;
	cursor: pointer;
	font: inherit;
}

.toggle:hover {
	background: var(--arena-raised);
}

.title {
	font-size: 12px;
	font-weight: 650;
	letter-spacing: 0.02em;
	color: hsl(var(--header-primary));
}

.chevron {
	font-size: 11px;
	color: hsl(var(--text-muted));
}

.body {
	display: none;
	max-height: min(62vh, 520px);
	overflow: auto;
	border-top: 1px solid var(--arena-border-faint);
	background: var(--arena-bg);
}

.panel[data-collapsed="false"] .body {
	display: block;
}
`;

const PANEL_CSS = `
${PANEL_SHARED_CSS}

.panel {
	width: 280px;
}

.panel-head {
	display: flex;
	align-items: center;
}

.bookmark-btn {
	flex: none;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	margin: 0 6px 0 0;
	padding: 0;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: hsl(var(--text-muted));
	cursor: pointer;
	font: inherit;
	font-size: 15px;
	line-height: 1;
	transition: color 0.15s ease, background 0.15s ease;
}

.bookmark-btn:hover {
	background: var(--arena-raised);
	color: hsl(var(--text-primary));
}

.bookmark-btn[data-active="true"] {
	color: hsl(var(--interactive-active));
}

.bookmark-btn[hidden] {
	display: none;
}

.count {
	margin-left: auto;
	min-width: 18px;
	padding: 1px 6px;
	border-radius: 999px;
	border: 1px solid var(--arena-border-faint);
	background: var(--arena-raised);
	color: hsl(var(--text-secondary));
	font-size: 11px;
	text-align: center;
	font-variant-numeric: tabular-nums;
}

.nav {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 8px 8px 4px;
	position: sticky;
	top: 0;
	background: var(--arena-bg);
	z-index: 1;
}

.nav-btn {
	width: 28px;
	height: 28px;
	border: 1px solid var(--arena-border);
	border-radius: 8px;
	background: transparent;
	color: inherit;
	cursor: pointer;
	font: inherit;
	line-height: 1;
}

.nav-btn:hover:not(:disabled) {
	background: var(--arena-raised);
}

.nav-btn:disabled {
	opacity: 0.35;
	cursor: default;
}

.pos {
	flex: 1;
	text-align: center;
	font-size: 11px;
	color: hsl(var(--text-secondary));
	font-variant-numeric: tabular-nums;
}

.list {
	display: flex;
	flex-direction: column;
	padding: 6px;
	gap: 4px;
}

.empty {
	padding: 12px 10px 14px;
	color: hsl(var(--text-muted));
	font-size: 12px;
	line-height: 1.4;
}

.hint {
	padding: 2px 10px 10px;
	color: hsl(var(--text-muted));
	font-size: 10px;
}

.item {
	display: grid;
	grid-template-columns: 22px 42px 1fr;
	gap: 6px;
	align-items: start;
	width: 100%;
	padding: 7px 8px;
	border: 0;
	border-radius: 0 8px 8px 0;
	background: transparent;
	color: inherit;
	text-align: left;
	cursor: pointer;
	font: inherit;
}

.item:hover {
	background: var(--arena-raised);
}

.item.active {
	background: var(--arena-raised);
	box-shadow: inset 2px 0 0 hsl(var(--interactive-active));
}

.n {
	color: hsl(var(--text-muted));
	font-size: 11px;
	line-height: 1.4;
}

.role {
	font-size: 11px;
	font-weight: 700;
	line-height: 1.4;
	color: hsl(var(--text-secondary));
}

.preview {
	color: hsl(var(--text-secondary));
	font-size: 11px;
	line-height: 1.35;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}
`;

const NEW_CHAT_CSS = `
${PANEL_SHARED_CSS}

.panel {
	width: 260px;
}

.chevron {
	margin-left: auto;
}

.templates {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 8px;
}

.empty {
	padding: 12px 10px 8px;
	color: hsl(var(--text-muted));
	font-size: 12px;
	line-height: 1.4;
}

.template {
	width: 100%;
	padding: 8px 10px;
	border: 1px solid var(--arena-border-faint);
	border-radius: 8px;
	background: transparent;
	color: inherit;
	text-align: left;
	cursor: pointer;
	font: inherit;
}

.template:hover {
	background: var(--arena-raised);
}

.template-name {
	display: block;
	font-size: 12px;
	font-weight: 650;
	color: hsl(var(--text-primary));
}

.template-meta {
	display: block;
	margin-top: 2px;
	font-size: 10px;
	line-height: 1.35;
	color: hsl(var(--text-muted));
}

.edit {
	display: block;
	width: 100%;
	margin: 0;
	padding: 2px 10px 10px;
	border: 0;
	background: transparent;
	color: hsl(var(--text-muted));
	cursor: pointer;
	font: inherit;
	font-size: 10px;
	text-align: left;
}

.edit:hover {
	color: hsl(var(--text-secondary));
}
`;

const PROMPTS_CSS = `
${PANEL_SHARED_CSS}

.panel {
	width: 280px;
}

.chevron {
	margin-left: auto;
}

.prompts-list {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 8px;
}

.empty {
	padding: 12px 10px 8px;
	color: hsl(var(--text-muted));
	font-size: 12px;
	line-height: 1.4;
}

.prompt-item {
	width: 100%;
	padding: 8px 10px;
	border: 1px solid var(--arena-border-faint);
	border-radius: 8px;
	background: transparent;
	color: inherit;
	text-align: left;
	cursor: pointer;
	font: inherit;
}

.prompt-item:hover {
	background: var(--arena-raised);
}

.prompt-item-name {
	display: block;
	font-size: 12px;
	font-weight: 650;
	color: hsl(var(--text-primary));
}

.prompt-item-preview {
	display: block;
	margin-top: 2px;
	font-size: 10px;
	line-height: 1.35;
	color: hsl(var(--text-muted));
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.edit {
	display: block;
	width: 100%;
	margin: 0;
	padding: 2px 10px 10px;
	border: 0;
	background: transparent;
	color: hsl(var(--text-muted));
	cursor: pointer;
	font: inherit;
	font-size: 10px;
	text-align: left;
}

.edit:hover {
	color: hsl(var(--text-secondary));
}
`;

const CODEBASE_CSS = `
${PANEL_SHARED_CSS}

.panel {
	width: 300px;
}

.count {
	margin-left: auto;
	min-width: 18px;
	padding: 1px 6px;
	border-radius: 999px;
	border: 1px solid var(--arena-border-faint);
	background: var(--arena-raised);
	color: hsl(var(--text-secondary));
	font-size: 11px;
	text-align: center;
	font-variant-numeric: tabular-nums;
}

.folder-row {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 8px;
	border-bottom: 1px solid var(--arena-border-faint);
}

.folder-name {
	flex: 1;
	min-width: 0;
	font-size: 11px;
	color: hsl(var(--text-secondary));
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.folder-name.muted {
	color: hsl(var(--text-muted));
}

.folder-btn {
	flex: none;
	padding: 4px 8px;
	border: 1px solid var(--arena-border);
	border-radius: 6px;
	background: transparent;
	color: inherit;
	cursor: pointer;
	font: inherit;
	font-size: 11px;
	line-height: 1.2;
}

.folder-btn:hover:not(:disabled) {
	background: var(--arena-raised);
}

.folder-btn:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

.folder-btn[hidden] {
	display: none;
}

.status {
	padding: 6px 10px 0;
	color: hsl(var(--text-muted));
	font-size: 10px;
	line-height: 1.35;
	word-break: break-word;
}

.status:empty {
	display: none;
}

.chunk-list {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 8px;
}

.empty {
	padding: 12px 10px 8px;
	color: hsl(var(--text-muted));
	font-size: 12px;
	line-height: 1.4;
}

.chunk-item {
	width: 100%;
	padding: 8px 10px;
	border: 1px solid var(--arena-border-faint);
	border-radius: 8px;
	background: transparent;
	color: inherit;
	text-align: left;
	cursor: pointer;
	font: inherit;
}

.chunk-item:hover {
	background: var(--arena-raised);
}

.chunk-item-name {
	display: block;
	font-size: 12px;
	font-weight: 650;
	color: hsl(var(--text-primary));
}

.chunk-item-meta {
	display: block;
	margin-top: 2px;
	font-size: 10px;
	line-height: 1.35;
	color: hsl(var(--text-muted));
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.edit {
	display: block;
	width: 100%;
	margin: 0;
	padding: 2px 10px 10px;
	border: 0;
	background: transparent;
	color: hsl(var(--text-muted));
	cursor: pointer;
	font: inherit;
	font-size: 10px;
	text-align: left;
}

.edit:hover {
	color: hsl(var(--text-secondary));
}
`;

window.addEventListener("message", (event) => {
	if (event.source !== window) {
		return;
	}

	const data = event.data;
	if (!data || data.source !== "arena-export-page" || data.type !== "EXTRACT_REACT_MARKDOWN_RESULT") {
		return;
	}

	const pending = pendingRequests.get(data.requestId);
	if (!pending) {
		return;
	}

	pendingRequests.delete(data.requestId);
	pending.resolve(data.results || {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message?.type === "ARENA_EXPORT_START") {
		void runExport()
			.then(() => sendResponse({ ok: true }))
			.catch((error) => {
				sendResponse({
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				});
			});
		return true;
	}

	if (message?.type === "ARENA_INSERT_PROMPT") {
		try {
			insertPrompt(message.text || "");
			sendResponse({ ok: true });
		} catch (error) {
			sendResponse({
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		return;
	}

	if (message?.type === "ARENA_GET_STATUS") {
		sendResponse({
			ok: true,
			url: location.href,
			messageCount: collectMessages().length,
			theme: getPageTheme(),
		});
	}

	if (message?.type === "ARENA_PERF_DUMP") {
		try {
			const perf = globalThis.ArenaPerf;
			if (!perf) {
				sendResponse({ ok: false, error: "ArenaPerf is not loaded" });
				return;
			}
			const result = perf.report();
			sendResponse({ ok: true, rows: result.rows, stats: result.stats });
		} catch (error) {
			sendResponse({
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		return;
	}

	if (message?.type === "ARENA_PERF_RESET") {
		globalThis.ArenaPerf?.reset();
		sendResponse({ ok: true });
		return;
	}
});

function getConversationIdFromUrl() {
	const match = location.pathname.match(/\/c\/([^/]+)/i);
	if (match) {
		return match[1];
	}

	const parts = location.pathname.split("/").filter(Boolean);
	return parts[parts.length - 1] || "arena-dialog";
}

function isExistingChatPage() {
	return /\/c\/[^/]+/i.test(location.pathname);
}

function buildFolderName() {
	return sanitizeFileName(getConversationIdFromUrl());
}

function showToast(text) {
	let toast = document.getElementById("__arena_export_toast__");

	if (!toast) {
		toast = document.createElement("div");
		toast.id = "__arena_export_toast__";
		Object.assign(toast.style, {
			position: "fixed",
			right: "16px",
			bottom: "16px",
			zIndex: "2147483647",
			maxWidth: "420px",
			background: getComputedStyle(document.body).backgroundColor || "#fcfaf8",
			color: getComputedStyle(document.body).color || "#2e2b29",
			padding: "10px 14px",
			borderRadius: "10px",
			border: "1px solid rgb(225, 222, 219)",
			fontSize: "13px",
			lineHeight: "1.4",
			fontFamily: "ui-sans-serif, system-ui, sans-serif",
			boxShadow: "0 12px 40px rgb(46 43 41 / 12%)",
			transition: "opacity 0.2s ease",
			opacity: "0",
			pointerEvents: "none",
		});
		document.documentElement.appendChild(toast);
	}

	toast.textContent = text;
	toast.style.opacity = "1";
	window.clearTimeout(showToast._timer);
	showToast._timer = window.setTimeout(() => {
		toast.style.opacity = "0";
	}, 3000);
}

showToast._timer = 0;

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

function truncateTitle(text, max = BOOKMARK_TITLE_MAX) {
	const value = String(text || "")
		.replace(/\s+/g, " ")
		.trim();
	if (!value) {
		return "";
	}
	if (value.length <= max) {
		return value;
	}
	return `${value.slice(0, max - 1).trimEnd()}…`;
}

function readArenaTitleFromHeader() {
	try {
		const button = document.querySelector(PREFERRED_TITLE_SELECTOR);
		if (!button) {
			return "";
		}

		const label = button.getAttribute("aria-label") || "";
		const head = label.split(/,\s*model\s/i)[0];
		return head ? head.trim() : "";
	} catch (_error) {
		return "";
	}
}

function getChatTitle() {
	const messages = cachedMessages.length ? cachedMessages : collectMessages();
	const userEntry = messages.find((entry) => entry.role === "user");

	if (userEntry) {
		const truncated = truncateTitle(previewFromRoot(userEntry.root, { accurate: true }));
		if (truncated) {
			return truncated;
		}
	}

	const fromHeader = truncateTitle(readArenaTitleFromHeader());
	if (fromHeader) {
		return fromHeader;
	}

	return getConversationIdFromUrl();
}

// ---------------------------------------------------------------------------
// Message collection
// ---------------------------------------------------------------------------

function hasCopyIcon(button) {
	const paths = Array.from(button.querySelectorAll("svg path")).map((node) => node.getAttribute("d") || "");
	return COPY_ICON_PATH_MARKERS.every((marker) => paths.some((d) => d.includes(marker)));
}

function classifyMessageCopyButton(button) {
	if (button.closest("[data-code-block='true']") || !hasCopyIcon(button)) {
		return null;
	}

	const classText = button.getAttribute("class") || "";
	if (classText.includes("group-hover:opacity-100") || button.closest(".justify-end")) {
		return "user";
	}

	return "assistant";
}

function getMessageList() {
	for (const selector of MESSAGE_LIST_SELECTORS) {
		const element = document.querySelector(selector);
		if (element) {
			return element;
		}
	}

	return null;
}

function classifyMessageRoot(el) {
	if (!(el instanceof HTMLElement) || el.classList.contains("h-0") || !el.querySelector(".prose")) {
		return null;
	}

	const classText = `${el.className || ""}`;
	if (/\bjustify-end\b/.test(classText) || el.querySelector(":scope > .group, .self-end")) {
		return "user";
	}

	return "assistant";
}

function countMessageCopyButtonsInside(root) {
	let count = 0;
	for (const button of root.querySelectorAll("button")) {
		if (classifyMessageCopyButton(button)) {
			count += 1;
		}
	}
	return count;
}

function getNodeTextLength(node) {
	return String(node?.innerText || node?.textContent || "")
		.replace(/\s+/g, " ")
		.trim().length;
}

function findMessageContainer(button) {
	let node = button.parentElement;
	let best = null;

	while (node && node !== document.body && node !== document.documentElement) {
		const copyCount = countMessageCopyButtonsInside(node);
		const textLength = getNodeTextLength(node);

		if (copyCount === 1 && textLength > 0) {
			best = node;
		} else if (copyCount > 1 && best) {
			break;
		}

		node = node.parentElement;
	}

	return best;
}

function compareNodesInDocumentOrder(a, b) {
	if (a === b) {
		return 0;
	}

	const position = a.compareDocumentPosition(b);
	if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
		return -1;
	}
	if (position & Node.DOCUMENT_POSITION_PRECEDING) {
		return 1;
	}
	return 0;
}

function getVisualPosition(node) {
	const rect = node.getBoundingClientRect();
	return {
		top: rect.top + window.scrollY,
		left: rect.left + window.scrollX,
	};
}

function sortEntriesByVisualOrder(entries) {
	return entries.slice().sort((a, b) => {
		const aPos = getVisualPosition(a.root);
		const bPos = getVisualPosition(b.root);
		if (Math.abs(aPos.top - bPos.top) > 4) {
			return aPos.top - bPos.top;
		}
		if (Math.abs(aPos.left - bPos.left) > 4) {
			return aPos.left - bPos.left;
		}
		return compareNodesInDocumentOrder(a.root, b.root);
	});
}

function sortMessages(entries, list) {
	if (!list) {
		return sortEntriesByVisualOrder(entries);
	}

	const children = Array.from(list.children);
	const indexOf = (el) => {
		let node = el;
		while (node && node.parentElement !== list) {
			node = node.parentElement;
		}
		return node ? children.indexOf(node) : -1;
	};

	const reverse = window.getComputedStyle(list).flexDirection.includes("reverse");
	return entries.slice().sort((a, b) => {
		const delta = indexOf(a.root) - indexOf(b.root);
		return reverse ? -delta : delta;
	});
}

function collectMessagesFromList() {
	const list = getMessageList();
	if (!list) {
		return [];
	}

	const entries = [];
	for (const child of list.children) {
		const role = classifyMessageRoot(child);
		if (role) {
			entries.push({ root: child, role });
		}
	}

	return sortMessages(entries, list);
}

function collectMessagesFromCopyButtons() {
	const root = document.querySelector("main") || document.body;
	const entries = [];
	const usedRoots = new Set();

	for (const button of root.querySelectorAll("button")) {
		const role = classifyMessageCopyButton(button);
		if (!role) {
			continue;
		}

		const container = findMessageContainer(button);
		if (!container || usedRoots.has(container)) {
			continue;
		}

		usedRoots.add(container);
		entries.push({ root: container, role });
	}

	return sortMessages(entries, getMessageList());
}

function collectMessages() {
	const fromList = collectMessagesFromList();
	return fromList.length > 0 ? fromList : collectMessagesFromCopyButtons();
}

// ---------------------------------------------------------------------------
// DOM → Markdown
// ---------------------------------------------------------------------------

function languageFromClassName(value) {
	const text = String(value || "");
	const match = text.match(/language-([\w#+-]+)/i) || text.match(/lang(?:uage)?-([\w#+-]+)/i);
	return match ? match[1].toLowerCase() : "";
}

function domToMarkdown(root) {
	function serialize(node, context = "block") {
		if (!node) {
			return "";
		}

		if (node.nodeType === Node.TEXT_NODE) {
			return context === "pre" ? node.nodeValue || "" : String(node.nodeValue || "").replace(/\s+/g, " ");
		}

		if (node.nodeType !== Node.ELEMENT_NODE) {
			return "";
		}

		const tag = node.tagName.toLowerCase();
		const childContext = tag === "pre" || tag === "code" ? "pre" : context;
		const inner = () =>
			Array.from(node.childNodes)
				.map((child) => serialize(child, childContext))
				.join("");

		if (/^h[1-6]$/.test(tag)) {
			const text = inner().trim();
			return text ? `${"#".repeat(Number(tag.slice(1)))} ${text}\n\n` : "";
		}

		if (tag === "p") {
			const text = inner().trim();
			return text ? `${text}\n\n` : "";
		}

		if (tag === "br") {
			return "\n";
		}

		if (tag === "strong" || tag === "b") {
			const text = inner();
			return text ? `**${text}**` : "";
		}

		if (tag === "em" || tag === "i") {
			const text = inner();
			return text ? `*${text}*` : "";
		}

		if (tag === "code") {
			const text = inner().replace(/\n+$/, "");
			if (node.parentElement?.tagName === "PRE" || text.includes("\n")) {
				return text;
			}
			return text ? `\`${text}\`` : "";
		}

		if (tag === "pre") {
			const code = node.querySelector("code");
			const lang = languageFromClassName((code || node).className);
			const text = inner().replace(/\n+$/, "");
			return text ? `\`\`\`${lang}\n${text}\n\`\`\`\n\n` : "";
		}

		if (tag === "a") {
			const href = node.getAttribute("href") || "";
			const text = inner().trim();
			if (!href) {
				return text;
			}
			if (text.replace(/\/+$/, "") === href.replace(/\/+$/, "")) {
				return href;
			}
			return `[${text}](${href})`;
		}

		if (tag === "ul") {
			return `${Array.from(node.children)
				.map((item) => {
					const block = serialize(item).trim();
					return block ? `${prefixListItem(block, "- ", "  ")}\n` : "";
				})
				.join("")}\n`;
		}

		if (tag === "ol") {
			let index = 0;
			return `${Array.from(node.children)
				.map((item) => {
					const block = serialize(item).trim();
					if (!block) {
						return "";
					}

					index += 1;
					const marker = `${index}. `;
					return `${prefixListItem(block, marker, " ".repeat(marker.length))}\n`;
				})
				.join("")}\n`;
		}

		if (tag === "li") {
			const block = inner().trim();
			return block ? `${block}\n` : "";
		}

		if (tag === "blockquote") {
			const text = inner().trim();
			if (!text) {
				return "";
			}
			return `${text
				.split("\n")
				.map((line) => (line ? `> ${line}` : ">"))
				.join("\n")}\n\n`;
		}

		if (tag === "hr") {
			return "---\n\n";
		}

		return inner();
	}

	return `${serialize(root)
		.replace(/\n{3,}/g, "\n\n")
		.trim()}\n`;
}

function markdownFromDom(root) {
	const prose = root.querySelector(PROSE_SELECTOR) || root;
	const text = domToMarkdown(prose).trim();
	return text ? normalizeMarkdown(text) : "";
}

// ---------------------------------------------------------------------------
// Preview cache
// ---------------------------------------------------------------------------

const previewCache = new WeakMap();

function previewFromRoot(root, options = {}) {
	const accurate = options.accurate === true;
	const ttl = typeof options.ttl === "number" ? options.ttl : PREVIEW_CACHE_TTL_MS;
	const now = Date.now();
	const cached = previewCache.get(root);

	if (cached && now - cached.ts < ttl) {
		return cached.text;
	}

	const prose = root.querySelector(PROSE_SELECTOR) || root;
	// textContent дешевле innerText: не форсирует layout.
	const raw = accurate ? prose.innerText || prose.textContent || "" : prose.textContent || "";
	const text = String(raw).replace(/\s+/g, " ").trim();

	previewCache.set(root, { text, ts: now });
	return text;
}

function invalidatePreview(root) {
	previewCache.delete(root);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function requestReactMarkdown(items) {
	const requestId = `arena-export-${Date.now()}-${++requestCounter}`;

	return new Promise((resolve, reject) => {
		const timeoutId = window.setTimeout(() => {
			pendingRequests.delete(requestId);
			reject(new Error("Page bridge timeout"));
		}, 5000);

		pendingRequests.set(requestId, {
			resolve: (result) => {
				window.clearTimeout(timeoutId);
				resolve(result);
			},
		});

		window.postMessage(
			{
				source: "arena-export-content",
				type: "EXTRACT_REACT_MARKDOWN",
				requestId,
				items,
			},
			"*",
		);
	});
}

async function runExport() {
	if (exportInProgress) {
		showToast(t("contentToastExportAlready"));
		return;
	}

	exportInProgress = true;

	try {
		const orderedEntries = collectMessages();
		if (orderedEntries.length === 0) {
			throw new Error(t("contentErrorNoMessages"));
		}

		const requestItems = orderedEntries.map((entry, index) => {
			const id = `arena-export-msg-${index + 1}`;
			entry.root.setAttribute(EXPORT_ATTR, id);
			return { id };
		});

		showToast(t("contentToastExporting", [String(orderedEntries.length)]));

		let results = {};
		try {
			results = await requestReactMarkdown(requestItems);
		} catch (error) {
			console.warn("[arena-utils] React extract failed, using DOM fallback:", error);
		}

		const files = [];
		const debugRows = [];

		for (let i = 0; i < orderedEntries.length; i += 1) {
			const result = results[requestItems[i].id];
			const fallbackText = markdownFromDom(orderedEntries[i].root);
			const text = result?.ok && result.text ? normalizeMarkdown(result.text) : fallbackText;

			if (!text.trim()) {
				console.log("[arena-utils] Failed container:", orderedEntries[i].root);
				throw new Error(t("contentErrorNoMarkdown", [String(i + 1)]));
			}

			files.push({ name: `${i + 1}.md`, text });
			debugRows.push({
				n: i + 1,
				role: orderedEntries[i].role,
				source: result?.ok && result.text ? "react" : "dom",
				score: result?.score,
				path: result?.path,
				preview: String(text).slice(0, 140).replace(/\n/g, "\\n"),
			});
		}

		console.table(debugRows);

		const downloadResult = await chrome.runtime.sendMessage({
			type: "ARENA_EXPORT_DOWNLOAD",
			folderName: buildFolderName(),
			files,
		});

		if (!downloadResult?.ok) {
			const failed = Array.isArray(downloadResult?.failed) ? downloadResult.failed : [];
			const details = failed
				.slice(0, 3)
				.map((item) => `${item?.name || "?"}: ${item?.error || "unknown"}`)
				.join("; ");

			throw new Error(downloadResult?.error || details || t("contentErrorDownloadFailed"));
		}

		showToast(t("contentToastExportDone", [String(files.length)]));
	} catch (error) {
		console.error("[arena-utils]", error);
		showToast(t("contentToastError", [error instanceof Error ? error.message : String(error)]));
		throw error;
	} finally {
		for (const node of document.querySelectorAll(`[${EXPORT_ATTR}]`)) {
			node.removeAttribute(EXPORT_ATTR);
		}
		exportInProgress = false;
	}
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function getComposerTextarea() {
	for (const selector of COMPOSER_SELECTORS) {
		const element = document.querySelector(selector);
		if (element) {
			return element;
		}
	}

	return null;
}

function setTextareaValue(textarea, value) {
	const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
	const nativeSetter = descriptor && descriptor.set;

	if (textarea._valueTracker) {
		textarea._valueTracker.setValue("");
	}

	if (nativeSetter) {
		nativeSetter.call(textarea, value);
	} else {
		textarea.value = value;
	}

	textarea.dispatchEvent(
		new InputEvent("input", {
			bubbles: true,
			cancelable: true,
			inputType: "insertText",
			data: value,
		}),
	);
	textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

function resizeComposer(textarea) {
	textarea.style.height = "auto";
	textarea.style.height = `${Math.min(textarea.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
}

function fillComposer(text) {
	const value = String(text || "");
	const textarea = getComposerTextarea();
	if (!textarea) {
		throw new Error(t("contentComposerNotFound"));
	}

	setTextareaValue(textarea, value);
	textarea.focus();

	try {
		const cursor = value.length;
		textarea.setSelectionRange(cursor, cursor);
	} catch (_error) {
		/* ignore */
	}

	resizeComposer(textarea);
}

function insertPrompt(text) {
	const value = String(text || "");
	const textarea = getComposerTextarea();
	if (!textarea) {
		throw new Error(t("contentComposerNotFound"));
	}

	const start = textarea.selectionStart ?? textarea.value.length;
	const end = textarea.selectionEnd ?? textarea.value.length;
	setTextareaValue(textarea, `${textarea.value.slice(0, start)}${value}${textarea.value.slice(end)}`);
	textarea.focus();

	const cursor = start + value.length;
	try {
		textarea.setSelectionRange(cursor, cursor);
	} catch (_error) {
		/* ignore */
	}

	resizeComposer(textarea);
	showToast(t("contentToastPromptInserted"));
}

function sleep(ms) {
	return new Promise((resolve) => {
		window.setTimeout(resolve, ms);
	});
}

// ---------------------------------------------------------------------------
// Pending prompt / auto-send
// ---------------------------------------------------------------------------

function readPendingPrompt() {
	// без изменений
}

function writePendingPrompt(text, url = "") {
	// без изменений
}

function clearPendingPrompt() {
	try {
		sessionStorage.removeItem(PENDING_PROMPT_KEY);
	} catch (_error) {
		/* ignore */
	}

	void chrome.storage.local.remove(["pendingChatPrompt", "pendingChatMessages", "pendingChatUrl", "pendingChatAutoSend", "pendingChatAutoSendUntil"]);
}

// Очередь сообщений. Источников два:
//   1) sessionStorage — клик по шаблону в самой панели, та же вкладка;
//   2) chrome.storage.local — попап / service worker, новая вкладка.
async function readPendingMessages() {
	const pending = readPendingPrompt();
	if (pending?.text) {
		return { texts: [pending.text], url: pending.url || "", autoSend: false };
	}

	let stored = null;
	try {
		stored = await chrome.storage.local.get({
			pendingChatPrompt: "",
			pendingChatMessages: null,
			pendingChatUrl: "",
			pendingChatAutoSend: false,
			pendingChatAutoSendUntil: 0,
		});
	} catch (_error) {
		return { texts: [], url: "", autoSend: false };
	}

	const until = Number(stored.pendingChatAutoSendUntil || 0);
	const notExpired = !until || Date.now() < until;
	const autoSend = Boolean(stored.pendingChatAutoSend) && notExpired;

	if (Array.isArray(stored.pendingChatMessages) && stored.pendingChatMessages.length > 0) {
		return {
			texts: stored.pendingChatMessages.map((item) => String(item ?? "")).filter(Boolean),
			url: String(stored.pendingChatUrl || ""),
			autoSend,
		};
	}

	if (stored.pendingChatPrompt) {
		return {
			texts: [String(stored.pendingChatPrompt)],
			url: String(stored.pendingChatUrl || ""),
			autoSend,
		};
	}

	return { texts: [], url: "", autoSend: false };
}

function pendingPromptMatchesPage(pendingUrl) {
	// без изменений
}

async function waitForSendButton(timeoutMs = 8000) {
	// без изменений
}

async function clickSendButton() {
	// без изменений
}

function isSendButtonReady() {
	const button = document.querySelector(SEND_BUTTON_SELECTOR);
	if (!button) {
		return false;
	}
	if (button.disabled) {
		return false;
	}
	if (button.getAttribute("aria-disabled") === "true") {
		return false;
	}
	return true;
}

// Ждём, пока модель закончит отвечать на текущее сообщение: Send-кнопка
// снова доступна и список сообщений не меняется 700 мс. Без этого отправка
// следующего фрагмента либо отклонится фронтендом, либо «съест» ввод.
async function waitForGenerationComplete(timeoutMs = 180000) {
	const startedAt = Date.now();
	const list = getMessageList();
	let lastMutationAt = Date.now();
	let observer = null;

	if (list) {
		observer = new MutationObserver(() => {
			lastMutationAt = Date.now();
		});
		observer.observe(list, { childList: true, subtree: true, characterData: true });
	}

	try {
		// Даём странице время перевести Send в disabled после клика.
		await sleep(600);

		while (Date.now() - startedAt < timeoutMs) {
			if (isSendButtonReady() && Date.now() - lastMutationAt >= 700) {
				return true;
			}
			await sleep(150);
		}

		return false;
	} finally {
		observer?.disconnect();
	}
}

async function fillComposerWithRetry(text, attempts = 60) {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		try {
			fillComposer(text);
			await sleep(200);

			const textarea = getComposerTextarea();
			if (textarea && textarea.value !== text) {
				fillComposer(text);
				await sleep(100);
			}

			return true;
		} catch (_error) {
			await sleep(120);
		}
	}

	return false;
}

async function sendMessagesSequentially(texts) {
	const total = texts.length;
	if (total === 0) {
		return;
	}

	// Очередь чистим в самом начале: если пользователь обновит вкладку
	// посреди рассылки, повторного «с нулевого фрагмента» не будет.
	clearPendingPrompt();

	for (let index = 0; index < total; index += 1) {
		const text = texts[index];
		const isLast = index === total - 1;

		const filled = await fillComposerWithRetry(text);
		if (!filled) {
			showToast(t("contentComposerNotFound"));
			return;
		}

		if (total > 1) {
			showToast(t("contentToastFragmentProgress", [String(index + 1), String(total)]));
		}

		try {
			await clickSendButton();
		} catch (_error) {
			showToast(t("contentToastArticleManual"));
			return;
		}

		if (isLast) {
			showToast(t("contentToastArticleSent"));
			return;
		}

		const completed = await waitForGenerationComplete();
		if (!completed) {
			showToast(t("contentToastFragmentTimeout", [String(index + 2), String(total)]));
			return;
		}

		await sleep(300);
	}
}

async function insertPendingPrompt() {
	if (pendingPromptInFlight) {
		return;
	}

	const pending = await readPendingMessages();
	if (pending.texts.length === 0) {
		return;
	}

	if (!pendingPromptMatchesPage(pending.url)) {
		console.warn("[arena-utils] Pending prompt URL does not match the current page; skipping.", {
			expected: pending.url,
			current: location.href,
		});
		return;
	}

	// Одиночное сообщение без автоотправки — просто вставляем в поле ввода
	// (клик по шаблону из панели).
	const shouldAutoSend = pending.autoSend || pending.texts.length > 1;

	pendingPromptInFlight = true;

	try {
		if (!shouldAutoSend) {
			const filled = await fillComposerWithRetry(pending.texts[0]);
			if (!filled) {
				return;
			}

			clearPendingPrompt();
			showToast(t("contentToastPromptInserted"));
			return;
		}

		await sendMessagesSequentially(pending.texts);
	} finally {
		pendingPromptInFlight = false;
	}
}

function openChatTemplate(template) {
	const url = ArenaChatTemplates.buildUrl(template, location.origin);
	const prompt = String(template?.prompt || "");

	const next = new URL(url, location.origin);
	writePendingPrompt(prompt, next.href);

	if (next.pathname === location.pathname && next.search === location.search) {
		void insertPendingPrompt();
		return;
	}

	location.assign(next.href);
}

// ---------------------------------------------------------------------------
// Autoscroll flag
// ---------------------------------------------------------------------------

function writeAutoscrollFlag(disabled) {
	try {
		sessionStorage.setItem(AUTOSCROLL_KEY, disabled ? "1" : "0");
	} catch (_error) {
		/* ignore */
	}

	const root = document.documentElement;
	if (!root) {
		return;
	}

	if (disabled) {
		root.dataset.arenaUtilsNoAutoscroll = "1";
	} else {
		delete root.dataset.arenaUtilsNoAutoscroll;
	}
}

// ---------------------------------------------------------------------------
// Page style / theme
// ---------------------------------------------------------------------------

function ensurePageStyle() {
	if (document.getElementById(PAGE_STYLE_ID)) {
		return;
	}

	const style = document.createElement("style");
	style.id = PAGE_STYLE_ID;
	style.textContent = `
		.${HIGHLIGHT_CLASS} {
			outline: 1px solid rgb(225, 222, 219) !important;
			outline-offset: 4px !important;
			border-radius: 10px !important;
		}

		[data-code-block="true"].${CODE_COLLAPSED_CLASS} > :not(:first-child) {
			display: none !important;
		}

		.${CODE_TOGGLE_CLASS} {
			margin-left: 6px;
			border: 0;
			border-radius: 6px;
			padding: 4px 8px;
			background: transparent;
			color: inherit;
			cursor: pointer;
			font: inherit;
			font-size: 12px;
			line-height: 1.2;
			opacity: 0.78;
		}

		.${CODE_TOGGLE_CLASS}:hover {
			opacity: 1;
			background: rgba(255, 255, 255, 0.06);
		}
	`;
	document.documentElement.appendChild(style);
}

function getPageTheme() {
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

const pageThemeCache = {
	theme: "",
	vars: null,
	bg: "",
	raised: "",
	border: "",
};

function readPageThemeValues() {
	const theme = getPageTheme();

	if (pageThemeCache.vars && pageThemeCache.theme === theme) {
		return pageThemeCache;
	}

	const root = getComputedStyle(document.documentElement);
	const body = getComputedStyle(document.body);
	const readVar = (name) => root.getPropertyValue(name).trim();

	pageThemeCache.theme = theme;
	pageThemeCache.vars = {
		"--header-primary": readVar("--header-primary"),
		"--text-primary": readVar("--text-primary"),
		"--text-secondary": readVar("--text-secondary"),
		"--text-muted": readVar("--text-muted"),
		"--interactive-active": readVar("--interactive-active"),
	};
	pageThemeCache.bg = body.backgroundColor || "";

	const raised = document.querySelector(".bg-surface-raised");
	pageThemeCache.raised = raised ? getComputedStyle(raised).backgroundColor : "";

	const send = document.querySelector(SEND_BUTTON_SELECTOR);
	pageThemeCache.border = send ? getComputedStyle(send).borderTopColor : "";

	return pageThemeCache;
}

function applyThemeToHost(host, values) {
	if (!host) {
		return;
	}

	const cache = values || readPageThemeValues();
	host.dataset.theme = cache.theme;

	for (const [name, value] of Object.entries(cache.vars || {})) {
		if (value) {
			host.style.setProperty(name, value);
		}
	}

	if (cache.bg) host.style.setProperty("--arena-bg", cache.bg);
	if (cache.raised) host.style.setProperty("--arena-raised", cache.raised);
	if (cache.border) host.style.setProperty("--arena-border", cache.border);
}

function applyPageTheme() {
	const values = readPageThemeValues();
	applyThemeToHost(document.getElementById(HOST_ID), values);
	applyThemeToHost(document.getElementById(NEW_CHAT_HOST_ID), values);
	applyThemeToHost(document.getElementById(PROMPTS_HOST_ID), values);
	applyThemeToHost(document.getElementById(CODEBASE_HOST_ID), values);
}

// ---------------------------------------------------------------------------
// Code blocks
// ---------------------------------------------------------------------------

function getCodeHeader(block) {
	return block.querySelector(":scope > div") || block.firstElementChild;
}

function getCodeLanguage(block) {
	const header = getCodeHeader(block);
	const label = header?.querySelector("span.text-sm, span.font-medium");
	return String(label?.textContent || "code").trim() || "code";
}

const codeLineCache = new WeakMap();

function countCodeLines(block) {
	const code = block.querySelector("code") || block;
	// textContent не форсирует layout — в отличие от innerText.
	const text = String(code.textContent || "").replace(/\n+$/, "");

	// Кэш валиден только пока длина текста не изменилась. Во время
	// стрима содержимое блока дописывается — иначе в лейбле навсегда
	// застревает старое N.
	const cached = codeLineCache.get(block);
	if (cached && cached.textLength === text.length) {
		return cached.lines;
	}

	let lines = 0;

	if (text) {
		const newlines = (text.match(/\n/g) || []).length;
		if (newlines > 0) {
			lines = newlines + 1;
		} else {
			// Подсветка синтаксиса иногда рендерит каждую строку как <span class="line">,
			// без \n в тексте.
			const lineEls = code.querySelectorAll(":scope > span, :scope > [class~='line']");
			lines = Math.max(1, lineEls.length);
		}
	}

	codeLineCache.set(block, { textLength: text.length, lines });
	return lines;
}

function isCodeBlockExpanded(block) {
	return block.dataset.arenaUtilsExpanded === "1";
}

function updateCodeToggle(block) {
	const button = block.querySelector(`.${CODE_TOGGLE_CLASS}`);
	if (!button) {
		return;
	}

	const expanded = isCodeBlockExpanded(block);
	const lines = countCodeLines(block);
	const lang = getCodeLanguage(block);

	const label = expanded ? t("contentCodeHide") : lines ? t("contentCodeShow", [String(lines)]) : t("contentCodeShowNoCount");
	if (button.textContent !== label) {
		button.textContent = label;
	}

	const title = expanded ? t("contentCodeHideTitle", [lang]) : t("contentCodeShowTitle", [lang]);
	if (button.title !== title) {
		button.title = title;
	}

	const aria = expanded ? "true" : "false";
	if (button.getAttribute("aria-expanded") !== aria) {
		button.setAttribute("aria-expanded", aria);
	}
}

function setCodeBlockExpanded(block, expanded) {
	block.dataset.arenaUtilsExpanded = expanded ? "1" : "0";
	block.classList.toggle(CODE_COLLAPSED_CLASS, collapseCodeBlocks && !expanded);
	updateCodeToggle(block);
}

function onCodeToggleClick(event) {
	event.preventDefault();
	event.stopPropagation();

	const block = event.currentTarget.closest(CODE_BLOCK_SELECTOR);
	if (!block) {
		return;
	}

	setCodeBlockExpanded(block, !isCodeBlockExpanded(block));
}

function ensureCodeToggle(block) {
	if (block.querySelector(`.${CODE_TOGGLE_CLASS}`)) {
		return;
	}

	const header = getCodeHeader(block);
	if (!header) {
		return;
	}

	const button = document.createElement("button");
	button.type = "button";
	button.className = CODE_TOGGLE_CLASS;
	button.addEventListener("click", onCodeToggleClick);

	const copyButton = header.querySelector("button");
	if (copyButton) {
		copyButton.before(button);
	} else {
		header.appendChild(button);
	}
}

function teardownCodeBlock(block) {
	block.classList.remove(CODE_COLLAPSED_CLASS);
	delete block.dataset.arenaUtilsCode;
	delete block.dataset.arenaUtilsExpanded;
	block.querySelector(`.${CODE_TOGGLE_CLASS}`)?.remove();
}

function processCodeBlocks(force = false) {
	ensurePageStyle();

	const messages = cachedMessages.length ? cachedMessages : collectMessages();
	const seen = new Set();

	for (const message of messages) {
		if (message.role !== "assistant") {
			continue;
		}

		for (const block of message.root.querySelectorAll(CODE_BLOCK_SELECTOR)) {
			seen.add(block);

			const hasToggle = Boolean(block.querySelector(`.${CODE_TOGGLE_CLASS}`));
			const hasFlag = block.dataset.arenaUtilsCode === "1";
			const hasExpandedAttr = block.dataset.arenaUtilsExpanded === "0" || block.dataset.arenaUtilsExpanded === "1";

			if (!collapseCodeBlocks) {
				if (!hasToggle && !hasFlag) {
					continue;
				}
				teardownCodeBlock(block);
				continue;
			}

			// Быстрый путь: toggle уже на месте. Контент мог достримиться,
			// поэтому обновляем лейбл — countCodeLines сам проверит кэш.
			if (!force && hasToggle && hasFlag && hasExpandedAttr) {
				updateCodeToggle(block);
				continue;
			}

			ensureCodeToggle(block);
			block.dataset.arenaUtilsCode = "1";

			if (block.dataset.arenaUtilsExpanded !== "1") {
				block.dataset.arenaUtilsExpanded = "0";
			}

			setCodeBlockExpanded(block, isCodeBlockExpanded(block));
		}
	}

	if (!collapseCodeBlocks) {
		for (const block of document.querySelectorAll(`${CODE_BLOCK_SELECTOR}[data-arena-utils-code]`)) {
			if (!seen.has(block)) {
				teardownCodeBlock(block);
			}
		}

		for (const block of document.querySelectorAll(`${CODE_BLOCK_SELECTOR}.${CODE_COLLAPSED_CLASS}`)) {
			teardownCodeBlock(block);
		}
	}
}

// ---------------------------------------------------------------------------
// Panel (Messages)
// ---------------------------------------------------------------------------

function getPanelEls() {
	const host = document.getElementById(HOST_ID);
	if (!host?.shadowRoot) {
		return null;
	}

	return {
		host,
		panel: host.shadowRoot.querySelector(".panel"),
		count: host.shadowRoot.querySelector(".count"),
		list: host.shadowRoot.querySelector(".list"),
		body: host.shadowRoot.querySelector(".body"),
		pos: host.shadowRoot.querySelector(".pos"),
		prev: host.shadowRoot.querySelector('[data-dir="-1"]'),
		next: host.shadowRoot.querySelector('[data-dir="1"]'),
		chevron: host.shadowRoot.querySelector(".chevron"),
	};
}

function setPanelCollapsed(collapsed, persist = true) {
	panelCollapsed = Boolean(collapsed);
	const els = getPanelEls();
	if (els?.panel) {
		els.panel.dataset.collapsed = panelCollapsed ? "true" : "false";
		els.chevron.textContent = panelCollapsed ? "▾" : "▴";
	}

	if (!panelCollapsed) {
		updateActiveItem({ follow: true });
	}

	if (persist) {
		void chrome.storage.local.set({ panelCollapsed });
	}
}

// ---------------------------------------------------------------------------
// Bookmark button wiring
// ---------------------------------------------------------------------------

function getBookmarkButton() {
	const host = document.getElementById(HOST_ID);
	return host?.shadowRoot?.querySelector(".bookmark-btn") || null;
}

function updateBookmarkButton() {
	const button = getBookmarkButton();
	if (!button) {
		return;
	}

	if (!isExistingChatPage()) {
		button.hidden = true;
		return;
	}

	const id = getConversationIdFromUrl();
	const active = cachedBookmarkIds.has(id);

	button.hidden = false;
	button.dataset.active = active ? "true" : "false";
	button.textContent = active ? "★" : "☆";
	button.title = active ? t("contentBookmarkRemove") : t("contentBookmarkAdd");
	button.setAttribute("aria-pressed", active ? "true" : "false");
	button.setAttribute("aria-label", active ? t("contentBookmarkRemove") : t("contentBookmarkAdd"));
}

async function refreshBookmarkCache() {
	try {
		const bookmarks = await getBookmarks();
		cachedBookmarkIds = new Set(bookmarks.map((item) => item?.id).filter(Boolean));
	} catch (_error) {
		cachedBookmarkIds = new Set();
	}

	updateBookmarkButton();
}

async function toggleCurrentBookmark() {
	if (!isExistingChatPage()) {
		showToast(t("contentBookmarkNeedChat"));
		return;
	}

	const id = getConversationIdFromUrl();
	const url = location.href;
	const title = getChatTitle();

	const bookmarks = await getBookmarks();
	const exists = bookmarks.some((item) => item?.id === id);

	const next = exists
		? bookmarks.filter((item) => item?.id !== id)
		: [{ id, url, title, createdAt: Date.now() }, ...bookmarks.filter((item) => item?.id !== id)];

	await setBookmarks(next);
	await refreshBookmarkCache();

	showToast(exists ? t("contentBookmarkRemoved") : t("contentBookmarkAdded", [title]));
}

// ---------------------------------------------------------------------------
// Highlight
// ---------------------------------------------------------------------------

function highlightMessage(root) {
	ensurePageStyle();
	invalidatePreview(root);

	document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((node) => {
		node.classList.remove(HIGHLIGHT_CLASS);
	});

	root.classList.add(HIGHLIGHT_CLASS);
	window.clearTimeout(highlightTimer);
	highlightTimer = window.setTimeout(() => {
		root.classList.remove(HIGHLIGHT_CLASS);
	}, 1400);
}

// ---------------------------------------------------------------------------
// Scrolling
// ---------------------------------------------------------------------------

function getScrollParent(el) {
	const now = Date.now();

	if (el) {
		const cached = scrollParentCache.get(el);
		if (cached && now - cached.at < SCROLL_PARENT_CACHE_MS) {
			return cached.scroller;
		}
	}

	let node = el?.parentElement;
	let result = null;

	while (node && node !== document.body && node !== document.documentElement) {
		const overflowY = window.getComputedStyle(node).overflowY;
		const canScroll = overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
		if (canScroll && node.scrollHeight > node.clientHeight + 8) {
			result = node;
			break;
		}
		node = node.parentElement;
	}

	if (!result) {
		result = document.scrollingElement || document.documentElement;
	}

	if (el) {
		scrollParentCache.set(el, { at: now, scroller: result });
	}

	return result;
}

function isWindowScroller(scroller) {
	return !scroller || scroller === document.documentElement || scroller === document.body || scroller === document.scrollingElement;
}

function withAllowedScroll(fn) {
	const root = document.documentElement;

	try {
		sessionStorage.setItem(ALLOW_SCROLL_KEY, "1");
	} catch (_error) {
		/* ignore */
	}

	if (root) {
		root.dataset.arenaUtilsAllowScroll = "1";
	}

	try {
		fn();
	} finally {
		try {
			sessionStorage.removeItem(ALLOW_SCROLL_KEY);
		} catch (_error) {
			/* ignore */
		}

		if (root) {
			delete root.dataset.arenaUtilsAllowScroll;
		}
	}
}

function scrollToMessageStart(root) {
	const scroller = getScrollParent(root);
	const rootRect = root.getBoundingClientRect();

	withAllowedScroll(() => {
		if (isWindowScroller(scroller)) {
			window.scrollTo({
				top: Math.max(0, window.scrollY + rootRect.top - MESSAGE_SCROLL_OFFSET),
				behavior: "smooth",
			});
			return;
		}

		const scrollerRect = scroller.getBoundingClientRect();
		const top = Math.max(0, scroller.scrollTop + (rootRect.top - scrollerRect.top) - MESSAGE_SCROLL_OFFSET);
		if (typeof scroller.scrollTo === "function") {
			scroller.scrollTo({ top, behavior: "smooth" });
			return;
		}
		scroller.scrollTop = top;
	});
}

function getScrollerMaxTop(scroller) {
	if (isWindowScroller(scroller)) {
		const el = document.scrollingElement || document.documentElement;
		return Math.max(0, el.scrollHeight - window.innerHeight);
	}

	return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
}

function getBottomScrollTop(scroller) {
	if (isWindowScroller(scroller)) {
		return getScrollerMaxTop(scroller);
	}

	return window.getComputedStyle(scroller).flexDirection.includes("reverse") ? 0 : getScrollerMaxTop(scroller);
}

function scrollToChatBottom() {
	const list = getMessageList();
	const scroller = list ? getScrollParent(list) : document.scrollingElement || document.documentElement;
	const top = getBottomScrollTop(scroller);

	withAllowedScroll(() => {
		if (isWindowScroller(scroller)) {
			window.scrollTo({ top, behavior: "smooth" });
			return;
		}

		if (typeof scroller.scrollTo === "function") {
			scroller.scrollTo({ top, behavior: "smooth" });
			return;
		}

		scroller.scrollTop = top;
	});

	if (cachedMessages.length > 0) {
		currentIndex = cachedMessages.length - 1;
		pinnedUntil = Date.now() + 1000;
		updateActiveItem({ follow: true });
		highlightMessage(cachedMessages[currentIndex].root);
	}
}

function getViewportForMessages() {
	const list = getMessageList();
	const scroller = list ? getScrollParent(list) : null;

	if (isWindowScroller(scroller)) {
		return { top: 0, bottom: window.innerHeight, height: window.innerHeight };
	}

	const rect = scroller.getBoundingClientRect();
	return { top: rect.top, bottom: rect.bottom, height: rect.height };
}

function getCurrentMessageIndex(messages) {
	if (!messages.length) {
		return -1;
	}

	const view = getViewportForMessages();
	if (view.height <= 0) {
		return currentIndex;
	}

	const readingY = view.top + READING_LINE_OFFSET;

	// Бинарный поиск: последнее сообщение, у которого top <= readingY.
	// messages отсортированы визуально сверху вниз.
	let low = 0;
	let high = messages.length - 1;
	let candidate = -1;

	while (low <= high) {
		const mid = (low + high) >> 1;
		const rect = messages[mid].root.getBoundingClientRect();

		if (rect.top <= readingY) {
			candidate = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	if (candidate < 0) {
		candidate = 0;
	}

	const isVisible = (el) => {
		const r = el.getBoundingClientRect();
		return r.bottom > view.top + 8 && r.top < view.bottom - 8;
	};

	if (isVisible(messages[candidate].root)) {
		return candidate;
	}

	for (let i = candidate - 1; i >= 0 && i >= candidate - 3; i -= 1) {
		if (isVisible(messages[i].root)) {
			return i;
		}
	}

	for (let i = candidate + 1; i < messages.length && i <= candidate + 3; i += 1) {
		if (isVisible(messages[i].root)) {
			return i;
		}
	}

	return candidate;
}

function maybeRefreshCurrentIndex(messages) {
	const now = Date.now();

	if (now < pinnedUntil) {
		if (currentIndex >= messages.length) {
			currentIndex = messages.length - 1;
		}
		return;
	}

	const countChanged = messages.length !== lastCurrentIndexScan.count;
	const stale = now - lastCurrentIndexScan.at > 1500;
	const outOfRange = currentIndex < 0 || currentIndex >= messages.length;

	if (!countChanged && !stale && !outOfRange) {
		return;
	}

	lastCurrentIndexScan = { count: messages.length, at: now };
	currentIndex = getCurrentMessageIndex(messages);
}

function scrollChildIntoContainer(child, container) {
	if (!child || !container) {
		return;
	}

	const childRect = child.getBoundingClientRect();
	const boxRect = container.getBoundingClientRect();
	if (childRect.top < boxRect.top) {
		container.scrollTop -= boxRect.top - childRect.top;
	} else if (childRect.bottom > boxRect.bottom) {
		container.scrollTop += childRect.bottom - boxRect.bottom;
	}
}

function updateActiveItem(options = {}) {
	const els = getPanelEls();
	if (!els) {
		return;
	}

	const follow = Boolean(options.follow);
	const total = cachedMessages.length;
	const index = currentIndex >= 0 && currentIndex < total ? currentIndex : -1;
	const label = total === 0 ? "0" : `${index >= 0 ? index + 1 : "–"}/${total}`;

	els.count.textContent = label;
	if (els.pos) {
		els.pos.textContent =
			total === 0 ? t("contentPanelMessagesNoMessages") : t("contentPanelMessagesPosition", [String(index >= 0 ? index + 1 : "–"), String(total)]);
	}
	if (els.prev) {
		els.prev.disabled = total === 0 || index <= 0;
	}
	if (els.next) {
		els.next.disabled = total === 0 || index < 0 || index >= total - 1;
	}

	const items = els.list.querySelectorAll(".item");
	items.forEach((btn, i) => {
		btn.classList.toggle("active", i === index);
	});

	if (follow && index >= 0 && items[index] && els.body) {
		scrollChildIntoContainer(items[index], els.body);
	}
}

function jumpToMessage(root, index = null) {
	if (typeof index === "number") {
		currentIndex = index;
		pinnedUntil = Date.now() + 1000;
		updateActiveItem({ follow: true });
	}

	scrollToMessageStart(root);
	highlightMessage(root);
}

function stepMessage(delta) {
	const messages = collectMessages();
	cachedMessages = messages;
	if (messages.length === 0) {
		return false;
	}

	let index = currentIndex;
	if (index < 0 || index >= messages.length) {
		index = getCurrentMessageIndex(messages);
	}

	if (index < 0) {
		index = delta > 0 ? 0 : messages.length - 1;
	} else {
		index = Math.min(messages.length - 1, Math.max(0, index + delta));
	}

	jumpToMessage(messages[index].root, index);
	return true;
}

function syncCurrentFromViewport() {
	if (Date.now() < pinnedUntil || cachedMessages.length === 0) {
		return;
	}

	const nextIndex = getCurrentMessageIndex(cachedMessages);
	if (nextIndex === currentIndex) {
		return;
	}

	currentIndex = nextIndex;
	updateActiveItem();
}

function scheduleCurrentSync() {
	window.clearTimeout(currentSyncTimer);
	currentSyncTimer = window.setTimeout(syncCurrentFromViewport, 80);
}

function onScrollerScroll() {
	scheduleCurrentSync();
}

function ensureScrollWatch() {
	const list = getMessageList();
	const scroller = list ? getScrollParent(list) : document.scrollingElement || document.documentElement;
	if (boundScroller === scroller) {
		return;
	}

	if (boundScroller && !isWindowScroller(boundScroller)) {
		boundScroller.removeEventListener("scroll", onScrollerScroll);
	}

	boundScroller = scroller;

	// Для window/documentElement скролл уже ловится window-listener'ом
	// из init(). Дублировать обработчик на самом элементе нельзя —
	// onScrollerScroll будет вызван дважды на одно событие.
	if (scroller && !isWindowScroller(scroller)) {
		scroller.addEventListener("scroll", onScrollerScroll, { passive: true });
	}
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

function isTypingTarget(el) {
	if (!el || !(el instanceof Element)) {
		return false;
	}

	const tag = el.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) {
		return true;
	}

	return Boolean(el.closest?.("textarea, input, select, [contenteditable='true']"));
}

function isInteractiveTarget(el) {
	if (!el || !(el instanceof Element)) {
		return false;
	}

	return Boolean(
		el.closest?.(
			"button, a[href], input, select, textarea, summary, [role='button'], [role='link'], [role='menuitem'], [role='option'], [role='tab'], [role='switch'], [contenteditable='true']",
		),
	);
}

function onKeyDown(event) {
	if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
		return;
	}

	if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
		return;
	}

	// composedPath()[0] проходит сквозь Shadow DOM: иначе клик по нашим
	// панелям (Messages / New chat / Prompts) давал бы target = host и
	// стрелки внутри кнопок улетали бы в навигацию по сообщениям.
	const actualTarget = typeof event.composedPath === "function" ? event.composedPath()[0] : event.target;

	if (isTypingTarget(actualTarget) || isInteractiveTarget(actualTarget)) {
		return;
	}

	// Не мешаем обычному скроллу, пока достоверно не знаем, что на
	// странице есть сообщения.
	if (cachedMessages.length === 0 && collectMessages().length === 0) {
		return;
	}

	event.preventDefault();
	stepMessage(event.key === "ArrowDown" ? 1 : -1);
}

// ---------------------------------------------------------------------------
// Panel list rendering
// ---------------------------------------------------------------------------

function createPanelRow(root, role, index) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "item";

	const numberEl = document.createElement("span");
	numberEl.className = "n";
	numberEl.textContent = String(index + 1);

	const roleEl = document.createElement("span");
	roleEl.className = `role ${role}`;
	roleEl.textContent = role === "user" ? t("contentPanelRoleUser") : t("contentPanelRoleAI");

	const previewEl = document.createElement("span");
	previewEl.className = "preview";

	button.append(numberEl, roleEl, previewEl);

	const row = { root, role, button, numberEl, roleEl, previewEl };

	button.addEventListener("click", () => {
		const position = panelRows.indexOf(row);
		if (position >= 0) {
			jumpToMessage(row.root, position);
		}
	});

	return row;
}

function renderEmptyPanelList(list) {
	panelRows = [];
	list.replaceChildren();

	const empty = document.createElement("div");
	empty.className = "empty";
	empty.textContent = t("contentPanelMessagesEmpty");
	list.appendChild(empty);
}

function renderPanelList() {
	const els = getPanelEls();
	if (!els) {
		return;
	}

	cachedMessages = collectMessages();
	ensureScrollWatch();
	processCodeBlocks();

	const messages = cachedMessages;

	if (messages.length === 0) {
		renderEmptyPanelList(els.list);
		currentIndex = -1;
		updateActiveItem();
		return;
	}

	const staleEmpty = els.list.querySelector(":scope > .empty");
	if (staleEmpty) {
		staleEmpty.remove();
	}

	const byRoot = new Map();
	for (const row of panelRows) {
		byRoot.set(row.root, row);
	}

	const usedButtons = new Set();
	const nextRows = new Array(messages.length);

	for (let i = 0; i < messages.length; i += 1) {
		const { root, role } = messages[i];
		let row = byRoot.get(root);

		if (row && usedButtons.has(row.button)) {
			row = null;
		}

		if (!row) {
			row = createPanelRow(root, role, i);
		} else if (row.role !== role) {
			row.root = root;
			row.role = role;
			row.roleEl.className = `role ${role}`;
			row.roleEl.textContent = role === "user" ? t("contentPanelRoleUser") : t("contentPanelRoleAI");
		}

		usedButtons.add(row.button);
		nextRows[i] = row;
	}

	for (const row of panelRows) {
		if (!usedButtons.has(row.button)) {
			row.button.remove();
		}
	}

	panelRows = nextRows;

	let cursor = els.list.firstChild;
	for (const row of nextRows) {
		if (row.button === cursor) {
			cursor = cursor.nextSibling;
			continue;
		}

		els.list.insertBefore(row.button, cursor);
	}

	const lastIndex = nextRows.length - 1;
	for (let i = 0; i < nextRows.length; i += 1) {
		const row = nextRows[i];

		const number = String(i + 1);
		if (row.numberEl.textContent !== number) {
			row.numberEl.textContent = number;
		}

		const preview = previewFromRoot(row.root, i === lastIndex ? { accurate: true, ttl: 400 } : { ttl: 15000 }) || "(empty)";

		if (row.previewEl.textContent !== preview) {
			row.previewEl.textContent = preview;
		}
	}

	maybeRefreshCurrentIndex(messages);
	updateActiveItem();
}

function ensurePanel() {
	if (document.getElementById(HOST_ID)) {
		return;
	}

	const host = document.createElement("div");
	host.id = HOST_ID;
	host.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483646;";

	const shadow = host.attachShadow({ mode: "open" });
	shadow.innerHTML = `
		<style>${PANEL_CSS}</style>
		<div class="panel" data-collapsed="${panelCollapsed ? "true" : "false"}">
			<div class="panel-head">
				<button class="toggle" type="button" title="${t("contentPanelMessagesToggle")}">
					<span class="title">${t("contentPanelMessagesTitle")}</span>
					<span class="count">0</span>
					<span class="chevron">${panelCollapsed ? "▾" : "▴"}</span>
				</button>
				<button class="bookmark-btn" type="button" hidden aria-pressed="false">☆</button>
			</div>
			<div class="body">
				<div class="nav">
					<button class="nav-btn" type="button" data-dir="-1" title="${t("contentPanelMessagesPrev")}">↑</button>
					<span class="pos">–/–</span>
					<button class="nav-btn" type="button" data-dir="1" title="${t("contentPanelMessagesNext")}">↓</button>
					<button class="nav-btn" type="button" data-bottom title="${t("contentPanelMessagesBottom")}">⤓</button>
				</div>
				<div class="list"></div>
				<div class="hint">${t("contentPanelMessagesHint")}</div>
			</div>
		</div>
	`;

	shadow.querySelector(".toggle").addEventListener("click", () => {
		setPanelCollapsed(!panelCollapsed);
	});
	shadow.querySelector(".bookmark-btn").addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		void toggleCurrentBookmark();
	});
	shadow.querySelector('[data-dir="-1"]').addEventListener("click", (event) => {
		event.preventDefault();
		stepMessage(-1);
	});
	shadow.querySelector('[data-dir="1"]').addEventListener("click", (event) => {
		event.preventDefault();
		stepMessage(1);
	});
	shadow.querySelector("[data-bottom]").addEventListener("click", (event) => {
		event.preventDefault();
		scrollToChatBottom();
	});

	document.documentElement.appendChild(host);
	renderPanelList();
	applyPageTheme();
	updateBookmarkButton();
}

// ---------------------------------------------------------------------------
// New chat panel
// ---------------------------------------------------------------------------

function getNewChatPanelEls() {
	const host = document.getElementById(NEW_CHAT_HOST_ID);
	if (!host?.shadowRoot) {
		return null;
	}

	return {
		host,
		panel: host.shadowRoot.querySelector(".panel"),
		templates: host.shadowRoot.querySelector(".templates"),
		chevron: host.shadowRoot.querySelector(".chevron"),
	};
}

function positionNewChatPanel() {
	const host = document.getElementById(NEW_CHAT_HOST_ID);
	if (!host) {
		return;
	}

	const target = document.querySelector(PORTAL_TARGET_SELECTOR);
	if (!target) {
		host.style.top = "12px";
		host.style.left = "12px";
		return;
	}

	const rect = target.getBoundingClientRect();
	host.style.top = `${Math.max(8, Math.round(rect.top + 12))}px`;
	host.style.left = `${Math.max(8, Math.round(rect.left + 12))}px`;
}

function setNewChatCollapsed(collapsed, persist = false) {
	newChatCollapsed = Boolean(collapsed);
	const els = getNewChatPanelEls();
	if (els?.panel) {
		els.panel.dataset.collapsed = newChatCollapsed ? "true" : "false";
		els.chevron.textContent = newChatCollapsed ? "▾" : "▴";
	}

	positionPromptsPanel();

	if (persist) {
		newChatCollapsedOverride = true;
		void chrome.storage.local.set({ newChatCollapsed });
	}
}

function renderNewChatList() {
	const els = getNewChatPanelEls();
	if (!els) {
		return;
	}

	els.templates.replaceChildren();

	if (!Array.isArray(chatTemplates) || chatTemplates.length === 0) {
		const empty = document.createElement("div");
		empty.className = "empty";
		empty.textContent = t("contentPanelNewChatEmpty");
		els.templates.appendChild(empty);
		return;
	}

	for (const template of chatTemplates) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "template";
		button.innerHTML = `<span class="template-name"></span><span class="template-meta"></span>`;
		button.querySelector(".template-name").textContent = template.name || "Untitled";
		const meta = ArenaChatTemplates.summarize(template);
		button.querySelector(".template-meta").textContent = String(template.prompt || "").trim() ? `${meta} · prompt` : meta;
		button.addEventListener("click", () => openChatTemplate(template));
		els.templates.appendChild(button);
	}
}

function ensureNewChatPanel() {
	if (document.getElementById(NEW_CHAT_HOST_ID)) {
		positionNewChatPanel();
		return;
	}

	const host = document.createElement("div");
	host.id = NEW_CHAT_HOST_ID;
	host.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483646;";

	const shadow = host.attachShadow({ mode: "open" });
	shadow.innerHTML = `
		<style>${NEW_CHAT_CSS}</style>
		<div class="panel" data-collapsed="${newChatCollapsed ? "true" : "false"}">
			<button class="toggle" type="button" title="${t("contentPanelNewChatToggle")}">
				<span class="title">${t("contentPanelNewChatTitle")}</span>
				<span class="chevron">${newChatCollapsed ? "▾" : "▴"}</span>
			</button>
			<div class="body">
				<div class="templates"></div>
				<button class="edit" type="button">${t("contentPanelNewChatEdit")}</button>
			</div>
		</div>
	`;

	shadow.querySelector(".toggle").addEventListener("click", () => {
		setNewChatCollapsed(!newChatCollapsed, true);
	});
	shadow.querySelector(".edit").addEventListener("click", () => {
		void chrome.runtime.sendMessage({
			type: "ARENA_OPEN_OPTIONS",
			hash: "#chat-templates",
		});
	});

	document.documentElement.appendChild(host);
	renderNewChatList();
	positionNewChatPanel();
	applyPageTheme();
}

// ---------------------------------------------------------------------------
// Prompts panel
// ---------------------------------------------------------------------------

function getPromptsPanelEls() {
	const host = document.getElementById(PROMPTS_HOST_ID);
	if (!host?.shadowRoot) {
		return null;
	}

	return {
		host,
		panel: host.shadowRoot.querySelector(".panel"),
		list: host.shadowRoot.querySelector(".prompts-list"),
		chevron: host.shadowRoot.querySelector(".chevron"),
	};
}

function positionPromptsPanel() {
	const host = document.getElementById(PROMPTS_HOST_ID);
	if (!host) {
		return;
	}

	// Вычисляем отступ слева так же, как для New chat,
	// чтобы обе панели выстраивались по одной вертикальной оси.
	const target = document.querySelector(PORTAL_TARGET_SELECTOR);
	const leftVal = target ? `${Math.max(8, Math.round(target.getBoundingClientRect().left + 12))}px` : "12px";

	const newChatHost = document.getElementById(NEW_CHAT_HOST_ID);
	const newChatPanel = newChatHost?.shadowRoot?.querySelector(".panel");

	let top = 56;
	if (newChatHost && newChatPanel) {
		const rect = newChatPanel.getBoundingClientRect();
		if (rect.height > 0) {
			top = rect.bottom + 10;
		}
	}

	host.style.top = `${Math.max(8, Math.round(top))}px`;
	host.style.left = leftVal;

	// Codebase идёт третьим в левой колонке — позиция Prompts влияет на неё.
	positionCodebasePanel();
}

function setPromptsCollapsed(collapsed, persist = true) {
	promptsCollapsed = Boolean(collapsed);
	const els = getPromptsPanelEls();
	if (els?.panel) {
		els.panel.dataset.collapsed = promptsCollapsed ? "true" : "false";
		els.chevron.textContent = promptsCollapsed ? "▾" : "▴";
	}

	// Раскрытие/схлопывание Prompts сдвигает Codebase ниже.
	positionCodebasePanel();

	if (persist) {
		void chrome.storage.local.set({ promptsCollapsed });
	}
}

function renderPromptsList() {
	const els = getPromptsPanelEls();
	if (!els) {
		return;
	}

	els.list.replaceChildren();

	if (!Array.isArray(prompts) || prompts.length === 0) {
		const empty = document.createElement("div");
		empty.className = "empty";
		empty.textContent = t("contentPanelPromptsEmpty");
		els.list.appendChild(empty);
		return;
	}

	for (const prompt of prompts) {
		const name = String(prompt?.name || "").trim() || "Untitled";
		const preview = String(prompt?.text || "")
			.replace(/\s+/g, " ")
			.trim();

		const button = document.createElement("button");
		button.type = "button";
		button.className = "prompt-item";
		button.innerHTML = `<span class="prompt-item-name"></span><span class="prompt-item-preview"></span>`;
		button.querySelector(".prompt-item-name").textContent = name;
		button.querySelector(".prompt-item-preview").textContent = preview;
		button.title = preview || name;

		button.addEventListener("click", () => {
			try {
				insertPrompt(String(prompt?.text || ""));
			} catch (error) {
				showToast(t("contentToastError", [error instanceof Error ? error.message : String(error)]));
			}
		});

		els.list.appendChild(button);
	}
}

function ensurePromptsPanel() {
	if (document.getElementById(PROMPTS_HOST_ID)) {
		positionPromptsPanel();
		return;
	}

	const host = document.createElement("div");
	host.id = PROMPTS_HOST_ID;
	host.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483646;";

	const shadow = host.attachShadow({ mode: "open" });
	shadow.innerHTML = `
		<style>${PROMPTS_CSS}</style>
		<div class="panel" data-collapsed="${promptsCollapsed ? "true" : "false"}">
			<button class="toggle" type="button" title="${t("contentPanelPromptsToggle")}">
				<span class="title">${t("contentPanelPromptsTitle")}</span>
				<span class="chevron">${promptsCollapsed ? "▾" : "▴"}</span>
			</button>
			<div class="body">
				<div class="prompts-list"></div>
				<button class="edit" type="button">${t("contentPanelPromptsEdit")}</button>
			</div>
		</div>
	`;

	shadow.querySelector(".toggle").addEventListener("click", () => {
		setPromptsCollapsed(!promptsCollapsed);
	});
	shadow.querySelector(".edit").addEventListener("click", () => {
		void chrome.runtime.sendMessage({
			type: "ARENA_OPEN_OPTIONS",
			hash: "#prompts",
		});
	});

	document.documentElement.appendChild(host);
	renderPromptsList();
	positionPromptsPanel();
	applyPageTheme();
}

// ---------------------------------------------------------------------------
// Codebase panel
// ---------------------------------------------------------------------------

function getCodebasePanelEls() {
	const host = document.getElementById(CODEBASE_HOST_ID);
	if (!host?.shadowRoot) {
		return null;
	}

	const root = host.shadowRoot;

	return {
		host,
		panel: root.querySelector(".panel"),
		list: root.querySelector(".chunk-list"),
		count: root.querySelector(".count"),
		chevron: root.querySelector(".chevron"),
		folderName: root.querySelector(".folder-name"),
		generateBtn: root.querySelector('[data-action="generate"]'),
		pickBtn: root.querySelector('[data-action="pick"]'),
		status: root.querySelector(".status"),
	};
}

async function readCodebaseSettings() {
	// Настройки из Options → Codebase. Snapshot при этом не читаем:
	// он всегда генерируется из текущего handle в этом же табе.
	let stored = null;
	try {
		const result = await chrome.storage.local.get({ codebaseSettings: null });
		stored = result.codebaseSettings;
	} catch (_error) {
		return {};
	}

	if (!stored || typeof stored !== "object") {
		return {};
	}

	return {
		maxChars: Number(stored.maxChars) > 0 ? Number(stored.maxChars) : undefined,
		gitignore: Boolean(stored.gitignore),
		exclude: typeof stored.exclude === "string" || Array.isArray(stored.exclude) ? stored.exclude : undefined,
		contentExclude: typeof stored.contentExclude === "string" || Array.isArray(stored.contentExclude) ? stored.contentExclude : undefined,
	};
}

function updateCodebaseFolderLabel() {
	const els = getCodebasePanelEls();
	if (!els?.folderName) {
		return;
	}

	if (codebaseDirHandle?.name) {
		els.folderName.textContent = codebaseDirHandle.name;
		els.folderName.classList.remove("muted");
	} else {
		els.folderName.textContent = t("contentPanelCodebaseNoFolder");
		els.folderName.classList.add("muted");
	}

	if (els.generateBtn) {
		els.generateBtn.hidden = !codebaseDirHandle;
		els.generateBtn.textContent = t("contentPanelCodebaseRebuild");
	}

	if (els.pickBtn) {
		els.pickBtn.textContent = codebaseDirHandle ? t("contentPanelCodebaseChange") : t("contentPanelCodebaseSelect");
	}
}

function updateCodebaseButtonsDisabled(disabled) {
	const els = getCodebasePanelEls();
	if (!els) {
		return;
	}

	const buttons = els.host.shadowRoot.querySelectorAll(".folder-btn");
	for (const button of buttons) {
		button.disabled = disabled;
	}
}

function updateCodebaseProgress(text) {
	const els = getCodebasePanelEls();
	if (els?.status) {
		els.status.textContent = String(text || "");
	}
}

async function generateCodebaseSnapshot() {
	if (!codebaseDirHandle || codebaseGenerating) {
		return;
	}

	codebaseGenerating = true;
	updateCodebaseButtonsDisabled(true);
	updateCodebaseProgress(t("contentPanelCodebaseScanning"));

	try {
		const options = await readCodebaseSettings();
		const snapshot = await window.ArenaCodebase.generateSnapshot(codebaseDirHandle, options, (message) => updateCodebaseProgress(message));

		codebaseSnapshot = snapshot;
		updateCodebaseProgress("");
		renderCodebaseList();
	} catch (error) {
		console.error("[arena-utils] Codebase snapshot failed:", error);
		const message = error instanceof Error ? error.message : String(error);
		updateCodebaseProgress(`Error: ${message}`);
		showToast(t("contentPanelCodebaseError", [message]));
	} finally {
		codebaseGenerating = false;
		updateCodebaseFolderLabel();
		updateCodebaseButtonsDisabled(false);
	}
}

async function pickCodebaseFolder() {
	if (codebaseGenerating) {
		return;
	}

	if (typeof window.showDirectoryPicker !== "function") {
		showToast(t("contentPanelCodebasePickerUnavailable"));
		void chrome.runtime.sendMessage({ type: "ARENA_OPEN_OPTIONS", hash: "#codebase" });
		return;
	}

	let handle;
	try {
		// Требует user gesture — вызывается прямо из click-handler'а.
		handle = await window.showDirectoryPicker({ mode: "read" });
	} catch (error) {
		if (error?.name === "AbortError") {
			return;
		}

		showToast(t("contentPanelCodebaseError", [error instanceof Error ? error.message : String(error)]));
		return;
	}

	if (!handle) {
		return;
	}

	codebaseDirHandle = handle;
	codebaseSnapshot = null;
	updateCodebaseFolderLabel();
	renderCodebaseList();

	await generateCodebaseSnapshot();
}

function positionCodebasePanel() {
	const host = document.getElementById(CODEBASE_HOST_ID);
	if (!host) {
		return;
	}

	// Тот же левый отступ, что и у New chat / Prompts: вся левая колонка
	// выстраивается по одной вертикальной оси.
	const target = document.querySelector(PORTAL_TARGET_SELECTOR);
	const leftVal = target ? `${Math.max(8, Math.round(target.getBoundingClientRect().left + 12))}px` : "12px";

	const promptsHost = document.getElementById(PROMPTS_HOST_ID);
	const promptsPanel = promptsHost?.shadowRoot?.querySelector(".panel");

	let top = 96;
	if (promptsHost && promptsPanel) {
		const rect = promptsPanel.getBoundingClientRect();
		if (rect.height > 0) {
			top = rect.bottom + 10;
		}
	}

	host.style.top = `${Math.max(8, Math.round(top))}px`;
	host.style.left = leftVal;
}

function setCodebaseCollapsed(collapsed, persist = true) {
	codebaseCollapsed = Boolean(collapsed);
	const els = getCodebasePanelEls();
	if (els?.panel) {
		els.panel.dataset.collapsed = codebaseCollapsed ? "true" : "false";
		els.chevron.textContent = codebaseCollapsed ? "▾" : "▴";
	}

	if (persist) {
		void chrome.storage.local.set({ codebaseCollapsed });
	}
}

function insertCodebaseChunk(index) {
	const chunks = Array.isArray(codebaseSnapshot?.chunks) ? codebaseSnapshot.chunks : [];
	const total = chunks.length;
	const chunk = chunks[index];

	if (!chunk || typeof chunk.text !== "string") {
		throw new Error("Chunk is not available");
	}

	// Заголовок помогает и модели, и человеку понять, что перед ними
	// фрагмент n из N — части склеиваются по порядку имени.
	const header = `${t("contentFragmentHeader", [String(index + 1), String(total)])}\n\n`;
	insertPrompt(header + chunk.text);
}

function renderCodebaseList() {
	const els = getCodebasePanelEls();
	if (!els) {
		return;
	}

	const chunks = Array.isArray(codebaseSnapshot?.chunks) ? codebaseSnapshot.chunks : [];
	const total = chunks.length;

	if (els.count) {
		els.count.textContent = String(total);
	}

	if (total === 0) {
		const empty = document.createElement("div");
		empty.className = "empty";

		if (!codebaseDirHandle) {
			empty.textContent = t("contentPanelCodebaseEmptyNoFolder");
		} else {
			empty.textContent = t("contentPanelCodebaseEmptyNoFragments");
		}

		els.list.replaceChildren(empty);
		return;
	}

	const fragment = document.createDocumentFragment();

	for (let i = 0; i < total; i += 1) {
		const chunk = chunks[i];
		const name = String(chunk?.name || `chunk-${i + 1}`);
		const chars = Number(chunk?.chars || 0);

		const button = document.createElement("button");
		button.type = "button";
		button.className = "chunk-item";
		button.title = `${name} · ${t("contentFragmentHeader", [String(i + 1), String(total)])}`;

		const nameEl = document.createElement("span");
		nameEl.className = "chunk-item-name";
		nameEl.textContent = name;

		const metaEl = document.createElement("span");
		metaEl.className = "chunk-item-meta";
		metaEl.textContent = `${t("contentFragmentHeader", [String(i + 1), String(total)])} · ${chars.toLocaleString()} chars`;

		button.append(nameEl, metaEl);

		const index = i;
		button.addEventListener("click", () => {
			try {
				insertCodebaseChunk(index);
			} catch (error) {
				showToast(t("contentToastError", [error instanceof Error ? error.message : String(error)]));
			}
		});

		fragment.appendChild(button);
	}

	els.list.replaceChildren(fragment);
}

function ensureCodebasePanel() {
	if (document.getElementById(CODEBASE_HOST_ID)) {
		positionCodebasePanel();
		return;
	}

	const host = document.createElement("div");
	host.id = CODEBASE_HOST_ID;
	host.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483646;";

	const shadow = host.attachShadow({ mode: "open" });
	shadow.innerHTML = `
		<style>${CODEBASE_CSS}</style>
		<div class="panel" data-collapsed="${codebaseCollapsed ? "true" : "false"}">
			<button class="toggle" type="button" title="${t("contentPanelCodebaseToggle")}">
				<span class="title">${t("contentPanelCodebaseTitle")}</span>
				<span class="count">0</span>
				<span class="chevron">${codebaseCollapsed ? "▾" : "▴"}</span>
			</button>
			<div class="body">
				<div class="folder-row">
					<span class="folder-name muted">${t("contentPanelCodebaseNoFolder")}</span>
					<button class="folder-btn" type="button" data-action="generate" hidden>${t("contentPanelCodebaseRebuild")}</button>
					<button class="folder-btn" type="button" data-action="pick">${t("contentPanelCodebaseSelect")}</button>
				</div>
				<div class="status"></div>
				<div class="chunk-list"></div>
				<button class="edit" type="button">${t("contentPanelCodebaseSettings")}</button>
			</div>
		</div>
	`;

	shadow.querySelector(".toggle").addEventListener("click", () => {
		setCodebaseCollapsed(!codebaseCollapsed);
	});

	shadow.querySelector('[data-action="pick"]').addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		void pickCodebaseFolder();
	});

	shadow.querySelector('[data-action="generate"]').addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		void generateCodebaseSnapshot();
	});

	shadow.querySelector(".edit").addEventListener("click", () => {
		void chrome.runtime.sendMessage({
			type: "ARENA_OPEN_OPTIONS",
			hash: "#codebase",
		});
	});

	document.documentElement.appendChild(host);
	positionCodebasePanel();
	applyPageTheme();
	updateCodebaseFolderLabel();
	renderCodebaseList();
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

function isMutationInMessageList(records) {
	const list = getMessageList();
	if (!list) {
		return false;
	}

	for (const record of records) {
		const target = record.target;
		if (!(target instanceof Node)) {
			continue;
		}

		if (target === list || list.contains(target)) {
			return true;
		}
	}

	return false;
}

function ensureListObserver() {
	// Наблюдаем за <main>, а не за всем documentElement: на странице чата
	// весь живой контент (список сообщений, стрим ответа) лежит под main,
	// а header/sidebar/тосты нас не интересуют.
	const target = document.querySelector("main") || document.body || document.documentElement;
	if (!target || target === listObserverTarget) {
		return;
	}

	if (listObserver) {
		listObserver.disconnect();
	}

	listObserverTarget = target;
	listObserver = new MutationObserver((records) => {
		if (isMutationInMessageList(records)) {
			scheduleRefresh();
		}
	});
	listObserver.observe(target, { childList: true, subtree: true });
}

function scheduleRefresh() {
	window.clearTimeout(refreshTimer);
	refreshTimer = window.setTimeout(() => {
		if (document.hidden) {
			return;
		}

		if (location.href !== lastUrl) {
			lastUrl = location.href;
			currentIndex = -1;

			// Страница переехала — старые ссылки на DOM невалидны.
			scrollParentCache = new WeakMap();

			if (!newChatCollapsedOverride) {
				setNewChatCollapsed(isExistingChatPage(), false);
			}

			ensureListObserver();
			void insertPendingPrompt();
		}

		restoreNativeScrollbars();
		ensurePanel();
		ensureNewChatPanel();
		ensurePromptsPanel();
		ensureCodebasePanel();
		applyPageTheme();
		renderPanelList();
		positionNewChatPanel();
		positionPromptsPanel(); // каскадом двигает Codebase
		updateBookmarkButton();
	}, 200);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
	ensurePageStyle();
	restoreNativeScrollbars();

	const stored = await chrome.storage.local.get({
		disableAutoscroll: false,
		panelCollapsed: true,
		newChatCollapsed: null,
		promptsCollapsed: true,
		codebaseCollapsed: true,
		collapseCodeBlocks: true,
		chatTemplates: [],
		prompts: [],
		perfDebug: false,
	});

	panelCollapsed = Boolean(stored.panelCollapsed);
	collapseCodeBlocks = stored.collapseCodeBlocks !== false;
	chatTemplates = Array.isArray(stored.chatTemplates) ? stored.chatTemplates : [];
	prompts = Array.isArray(stored.prompts) ? stored.prompts : [];
	promptsCollapsed = stored.promptsCollapsed !== false;
	codebaseCollapsed = stored.codebaseCollapsed !== false;

	// codebaseDirHandle / codebaseSnapshot намеренно не восстанавливаются:
	// это per-tab состояние. Reload вкладки — чистое состояние.

	newChatCollapsedOverride = typeof stored.newChatCollapsed === "boolean";
	newChatCollapsed = newChatCollapsedOverride ? stored.newChatCollapsed : isExistingChatPage();

	writeAutoscrollFlag(Boolean(stored.disableAutoscroll));
	ensurePanel();
	ensureNewChatPanel();
	ensurePromptsPanel();
	ensureCodebasePanel();
	setPanelCollapsed(panelCollapsed, false);
	setNewChatCollapsed(newChatCollapsed, false);
	setPromptsCollapsed(promptsCollapsed, false);
	setCodebaseCollapsed(codebaseCollapsed, false);
	renderPanelList();
	renderNewChatList();
	renderPromptsList();
	void refreshBookmarkCache();
	void insertPendingPrompt();

	if (stored.perfDebug) {
		globalThis.ArenaPerf?.enable();
	}

	ensureListObserver();

	new MutationObserver(() => {
		pageThemeCache.vars = null;
		applyPageTheme();
	}).observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class"],
	});

	window.addEventListener("popstate", scheduleRefresh);
	window.addEventListener("scroll", onScrollerScroll, { passive: true });
	window.addEventListener("resize", () => {
		scheduleCurrentSync();
		positionNewChatPanel();
		positionPromptsPanel(); // каскадом двигает Codebase
	});
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) {
			scheduleRefresh();
		}
	});
	document.addEventListener("keydown", onKeyDown, true);
}

chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== "local") {
		return;
	}

	if (changes.disableAutoscroll) {
		writeAutoscrollFlag(Boolean(changes.disableAutoscroll.newValue));
	}

	if (changes.panelCollapsed && typeof changes.panelCollapsed.newValue === "boolean") {
		setPanelCollapsed(changes.panelCollapsed.newValue, false);
	}

	if (changes.collapseCodeBlocks) {
		collapseCodeBlocks = changes.collapseCodeBlocks.newValue !== false;
		processCodeBlocks(true);
	}

	if (changes.chatTemplates) {
		chatTemplates = Array.isArray(changes.chatTemplates.newValue) ? changes.chatTemplates.newValue : [];
		renderNewChatList();
	}

	if (changes.newChatCollapsed && typeof changes.newChatCollapsed.newValue === "boolean") {
		newChatCollapsedOverride = true;
		if (changes.newChatCollapsed.newValue !== newChatCollapsed) {
			setNewChatCollapsed(changes.newChatCollapsed.newValue, false);
		}
	}

	if (changes.prompts) {
		prompts = Array.isArray(changes.prompts.newValue) ? changes.prompts.newValue : [];
		renderPromptsList();
	}

	if (changes.promptsCollapsed && typeof changes.promptsCollapsed.newValue === "boolean") {
		promptsCollapsed = changes.promptsCollapsed.newValue;
		setPromptsCollapsed(promptsCollapsed, false);
	}

	if (changes.codebaseCollapsed && typeof changes.codebaseCollapsed.newValue === "boolean") {
		codebaseCollapsed = changes.codebaseCollapsed.newValue;
		setCodebaseCollapsed(codebaseCollapsed, false);
	}

	if (changes.bookmarks) {
		cachedBookmarkIds = new Set((Array.isArray(changes.bookmarks.newValue) ? changes.bookmarks.newValue : []).map((item) => item?.id).filter(Boolean));
		updateBookmarkButton();
	}

	if (changes.perfDebug) {
		if (changes.perfDebug.newValue) {
			globalThis.ArenaPerf?.enable();
		} else {
			globalThis.ArenaPerf?.disable();
		}
	}
});

void init();
