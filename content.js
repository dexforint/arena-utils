let exportInProgress = false;
let requestCounter = 0;
let panelCollapsed = true;
let collapseCodeBlocks = true;
let highlightTimer = 0;
let refreshTimer = 0;
let currentSyncTimer = 0;
let lastUrl = location.href;
let lastSignature = "";
let currentIndex = -1;
let pinnedUntil = 0;
let boundScroller = null;
let cachedMessages = [];

const pendingRequests = new Map();
const HOST_ID = "__arena_utils_host__";
const PAGE_STYLE_ID = "__arena_utils_page_style__";
const AUTOSCROLL_KEY = "__arena_utils_disable_autoscroll";
const ALLOW_SCROLL_KEY = "__arena_utils_allow_scroll";
const MESSAGE_SCROLL_OFFSET = 16;
const CODE_TOGGLE_CLASS = "__arena-utils-code-toggle";
const CODE_COLLAPSED_CLASS = "__arena-utils-code-collapsed";

const PANEL_CSS = `
:host {
	all: initial;
	font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.panel {
	width: 280px;
	color: #e8eefc;
	background: rgba(15, 18, 28, 0.94);
	border: 1px solid rgba(255, 255, 255, 0.1);
	border-radius: 12px;
	box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
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
	width: 100%;
	margin: 0;
	padding: 8px 10px;
	border: 0;
	background: transparent;
	color: inherit;
	cursor: pointer;
	font: inherit;
}

.title {
	font-size: 12px;
	font-weight: 650;
	letter-spacing: 0.02em;
}

.count {
	margin-left: auto;
	min-width: 18px;
	padding: 1px 6px;
	border-radius: 999px;
	background: rgba(124, 156, 255, 0.2);
	color: #c5d4ff;
	font-size: 11px;
	text-align: center;
	font-variant-numeric: tabular-nums;
}

.chevron {
	font-size: 11px;
	opacity: 0.7;
}

.body {
	display: none;
	max-height: min(62vh, 520px);
	overflow: auto;
	border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.panel[data-collapsed="false"] .body {
	display: block;
}

.nav {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 8px 8px 4px;
	position: sticky;
	top: 0;
	background: rgba(15, 18, 28, 0.96);
	z-index: 1;
}

.nav-btn {
	width: 28px;
	height: 28px;
	border: 0;
	border-radius: 8px;
	background: rgba(255, 255, 255, 0.07);
	color: inherit;
	cursor: pointer;
	font: inherit;
	line-height: 1;
}

.nav-btn:hover:not(:disabled) {
	background: rgba(255, 255, 255, 0.14);
}

.nav-btn:disabled {
	opacity: 0.35;
	cursor: default;
}

.pos {
	flex: 1;
	text-align: center;
	font-size: 11px;
	color: rgba(232, 238, 252, 0.7);
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
	color: rgba(232, 238, 252, 0.55);
	font-size: 12px;
	line-height: 1.4;
}

.hint {
	padding: 2px 10px 10px;
	color: rgba(232, 238, 252, 0.38);
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
	border-radius: 8px;
	background: transparent;
	color: inherit;
	text-align: left;
	cursor: pointer;
	font: inherit;
}

.item:hover {
	background: rgba(255, 255, 255, 0.06);
}

.item.active {
	background: rgba(124, 156, 255, 0.18);
	box-shadow: inset 2px 0 0 #7c9cff;
}

.n {
	color: rgba(232, 238, 252, 0.45);
	font-size: 11px;
	line-height: 1.4;
}

.role {
	font-size: 11px;
	font-weight: 700;
	line-height: 1.4;
}

.role.user {
	color: #8ee4af;
}

.role.assistant {
	color: #9db7ff;
}

.preview {
	color: rgba(232, 238, 252, 0.78);
	font-size: 11px;
	line-height: 1.35;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
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
		});
	}
});

function sanitizeFileName(value) {
	return (
		String(value || "")
			.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
			.trim()
			.slice(0, 120) || "arena-dialog"
	);
}

function getConversationIdFromUrl() {
	const match = location.pathname.match(/\/c\/([^/]+)/i);
	if (match) {
		return match[1];
	}

	const parts = location.pathname.split("/").filter(Boolean);
	return parts[parts.length - 1] || "arena-dialog";
}

function buildFolderName() {
	return sanitizeFileName(getConversationIdFromUrl());
}

function normalizeMarkdown(text) {
	return `${String(text ?? "")
		.replace(/\r\n/g, "\n")
		.trimEnd()}\n`;
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
			background: "rgba(17, 24, 39, 0.95)",
			color: "#ffffff",
			padding: "10px 14px",
			borderRadius: "10px",
			fontSize: "13px",
			lineHeight: "1.4",
			fontFamily: "system-ui, sans-serif",
			boxShadow: "0 10px 30px rgba(0, 0, 0, 0.25)",
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

function hasCopyIcon(button) {
	const paths = Array.from(button.querySelectorAll("svg path")).map((node) => node.getAttribute("d") || "");
	return paths.some((d) => d.includes("M19.4 20H9.6")) && paths.some((d) => d.includes("M15 9V4.6"));
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
	return document.querySelector("main ol.flex-col-reverse") || document.querySelector("ol.flex-col-reverse") || document.querySelector("ol.mt-8.flex");
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
				.map((item) => serialize(item))
				.join("")}\n`;
		}

		if (tag === "ol") {
			return `${Array.from(node.children)
				.map((item, index) => {
					const block = serialize(item).trim();
					return block ? `${block.replace(/^[-*]\s/, `${index + 1}. `)}\n` : "";
				})
				.join("")}\n`;
		}

		if (tag === "li") {
			const block = inner().trim();
			if (!block) {
				return "";
			}
			const lines = block.split("\n");
			if (lines.length === 1) {
				return `- ${lines[0]}\n`;
			}
			return `- ${lines[0]}\n${lines
				.slice(1)
				.map((line) => (line ? `  ${line}` : ""))
				.join("\n")}\n`;
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
	const prose = root.querySelector(".prose") || root;
	const text = domToMarkdown(prose).trim();
	return text ? normalizeMarkdown(text) : "";
}

function previewFromRoot(root) {
	const prose = root.querySelector(".prose") || root;
	return String(prose.innerText || prose.textContent || "")
		.replace(/\s+/g, " ")
		.trim();
}

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
		showToast("Export is already underway");
		return;
	}

	exportInProgress = true;

	try {
		const orderedEntries = collectMessages();
		if (orderedEntries.length === 0) {
			throw new Error("Could not find messages");
		}

		const requestItems = orderedEntries.map((entry, index) => {
			const id = `arena-export-msg-${index + 1}`;
			entry.root.setAttribute("data-arena-export-id", id);
			return { id };
		});

		showToast(`Exporting ${orderedEntries.length} messages...`);

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
				throw new Error(`Didn't find Markdown for message ${i + 1}`);
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
			throw new Error(downloadResult?.error || "Failed to download files");
		}

		showToast(`Done: ${files.length} files`);
	} catch (error) {
		console.error("[arena-utils]", error);
		showToast(`Error: ${error instanceof Error ? error.message : String(error)}`);
		throw error;
	} finally {
		for (const node of document.querySelectorAll("[data-arena-export-id]")) {
			node.removeAttribute("data-arena-export-id");
		}
		exportInProgress = false;
	}
}

function getComposerTextarea() {
	return (
		document.querySelector('textarea[name="message"]') || document.querySelector("form textarea") || document.querySelector('textarea[placeholder*="Ask"]')
	);
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

function insertPrompt(text) {
	const value = String(text || "");
	const textarea = getComposerTextarea();
	if (!textarea) {
		throw new Error("Composer textarea not found");
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

	textarea.style.height = "auto";
	textarea.style.height = `${Math.min(textarea.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
	showToast("Prompt inserted");
}

function writeAutoscrollFlag(disabled) {
	try {
		sessionStorage.setItem(AUTOSCROLL_KEY, disabled ? "1" : "0");
	} catch (_error) {
		/* ignore */
	}
}

function isRadixScrollbarHideCss(text) {
	const value = String(text || "")
		.replace(/\s+/g, "")
		.toLowerCase();
	return value.includes("[data-radix-scroll-area-viewport]") && (value.includes("scrollbar-width:none") || value.includes("::-webkit-scrollbar{display:none"));
}

function stripScrollbarSheet(sheet) {
	let rules;
	try {
		rules = sheet.cssRules;
	} catch (_error) {
		return;
	}

	for (let i = rules.length - 1; i >= 0; i -= 1) {
		const rule = rules[i];
		const cssText = String(rule.cssText || "");
		const selector = String(rule.selectorText || "");
		if (selector.includes("[data-radix-scroll-area-viewport]") || isRadixScrollbarHideCss(cssText)) {
			try {
				sheet.deleteRule(i);
			} catch (_error) {
				/* ignore */
			}
		}
	}
}

function stripScrollbarRoot(root) {
	if (!root) {
		return;
	}

	if (root.styleSheets) {
		for (const sheet of Array.from(root.styleSheets)) {
			stripScrollbarSheet(sheet);
		}
	}

	if (root.adoptedStyleSheets) {
		for (const sheet of root.adoptedStyleSheets) {
			stripScrollbarSheet(sheet);
		}
	}

	const styleNodes = root.querySelectorAll ? root.querySelectorAll("style") : [];
	for (const styleEl of styleNodes) {
		if (!(styleEl instanceof HTMLStyleElement) || !isRadixScrollbarHideCss(styleEl.textContent)) {
			continue;
		}

		try {
			if (styleEl.sheet) {
				stripScrollbarSheet(styleEl.sheet);
			}
		} catch (_error) {
			/* ignore */
		}

		if (isRadixScrollbarHideCss(styleEl.textContent)) {
			styleEl.remove();
		}
	}

	const treeRoot = root.body || root.documentElement || root;
	if (!treeRoot?.querySelectorAll) {
		return;
	}

	for (const el of treeRoot.querySelectorAll("*")) {
		if (el.shadowRoot) {
			stripScrollbarRoot(el.shadowRoot);
		}
	}
}

function restoreNativeScrollbars() {
	stripScrollbarRoot(document);
}

function ensurePageStyle() {
	if (document.getElementById(PAGE_STYLE_ID)) {
		return;
	}

	const style = document.createElement("style");
	style.id = PAGE_STYLE_ID;
	style.textContent = `
		.__arena-utils-highlight {
			outline: 2px solid #7c9cff !important;
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
			background: rgba(127, 127, 127, 0.12);
		}
	`;
	document.documentElement.appendChild(style);
}

function getCodeHeader(block) {
	return block.querySelector(":scope > div") || block.firstElementChild;
}

function getCodeLanguage(block) {
	const header = getCodeHeader(block);
	const label = header?.querySelector("span.text-sm, span.font-medium");
	return String(label?.textContent || "code").trim() || "code";
}

function countCodeLines(block) {
	const code = block.querySelector("code");
	const text = String(code?.innerText || block.innerText || "").replace(/\n+$/, "");
	if (!text) {
		return 0;
	}

	return text.split("\n").length;
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
	button.textContent = expanded ? "Hide" : lines ? `Show · ${lines}` : "Show";
	button.title = expanded ? `Hide ${lang}` : `Show ${lang}`;
	button.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function setCodeBlockExpanded(block, expanded) {
	block.dataset.arenaUtilsExpanded = expanded ? "1" : "0";
	block.classList.toggle(CODE_COLLAPSED_CLASS, collapseCodeBlocks && !expanded);
	updateCodeToggle(block);
}

function onCodeToggleClick(event) {
	event.preventDefault();
	event.stopPropagation();

	const block = event.currentTarget.closest("[data-code-block='true']");
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

function processCodeBlocks() {
	ensurePageStyle();

	const messages = cachedMessages.length ? cachedMessages : collectMessages();
	const seen = new Set();

	for (const message of messages) {
		if (message.role !== "assistant") {
			continue;
		}

		for (const block of message.root.querySelectorAll("[data-code-block='true']")) {
			seen.add(block);

			if (!collapseCodeBlocks) {
				teardownCodeBlock(block);
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

	for (const block of document.querySelectorAll("[data-code-block='true'][data-arena-utils-code]")) {
		if (!seen.has(block) && !collapseCodeBlocks) {
			teardownCodeBlock(block);
		}
	}

	if (!collapseCodeBlocks) {
		for (const block of document.querySelectorAll(`[data-code-block="true"].${CODE_COLLAPSED_CLASS}`)) {
			teardownCodeBlock(block);
		}
	}
}

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

	if (persist) {
		void chrome.storage.local.set({ panelCollapsed });
	}
}

function highlightMessage(root) {
	ensurePageStyle();
	document.querySelectorAll(".__arena-utils-highlight").forEach((node) => {
		node.classList.remove("__arena-utils-highlight");
	});
	root.classList.add("__arena-utils-highlight");
	window.clearTimeout(highlightTimer);
	highlightTimer = window.setTimeout(() => {
		root.classList.remove("__arena-utils-highlight");
	}, 1400);
}

function getScrollParent(el) {
	let node = el?.parentElement;

	while (node && node !== document.body && node !== document.documentElement) {
		const overflowY = window.getComputedStyle(node).overflowY;
		const canScroll = overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
		if (canScroll && node.scrollHeight > node.clientHeight + 8) {
			return node;
		}
		node = node.parentElement;
	}

	return document.scrollingElement || document.documentElement;
}

function isWindowScroller(scroller) {
	return !scroller || scroller === document.documentElement || scroller === document.body || scroller === document.scrollingElement;
}

function withAllowedScroll(fn) {
	try {
		sessionStorage.setItem(ALLOW_SCROLL_KEY, "1");
	} catch (_error) {
		/* ignore */
	}

	try {
		fn();
	} finally {
		try {
			sessionStorage.removeItem(ALLOW_SCROLL_KEY);
		} catch (_error) {
			/* ignore */
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
		updateActiveItem();
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

	const readingY = view.top + 48;
	let current = -1;
	let best = -1;
	let bestDist = Infinity;

	for (let i = 0; i < messages.length; i += 1) {
		const rect = messages[i].root.getBoundingClientRect();
		const visible = rect.bottom > view.top + 8 && rect.top < view.bottom - 8;

		if (rect.top <= readingY && rect.bottom > view.top + 8) {
			current = i;
		}

		if (!visible) {
			continue;
		}

		const dist = Math.abs(rect.top - readingY);
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}

	if (current >= 0) {
		return current;
	}
	if (best >= 0) {
		return best;
	}
	return currentIndex >= 0 && currentIndex < messages.length ? currentIndex : -1;
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

function updateActiveItem() {
	const els = getPanelEls();
	if (!els) {
		return;
	}

	const total = cachedMessages.length;
	const index = currentIndex >= 0 && currentIndex < total ? currentIndex : -1;
	const label = total === 0 ? "0" : `${index >= 0 ? index + 1 : "–"}/${total}`;

	els.count.textContent = label;
	if (els.pos) {
		els.pos.textContent = total === 0 ? "No messages" : `Message ${index >= 0 ? index + 1 : "–"} of ${total}`;
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

	if (index >= 0 && items[index] && els.body) {
		scrollChildIntoContainer(items[index], els.body);
	}
}

function jumpToMessage(root, index = null) {
	if (typeof index === "number") {
		currentIndex = index;
		pinnedUntil = Date.now() + 1000;
		updateActiveItem();
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

	if (boundScroller && boundScroller !== window && boundScroller !== document) {
		boundScroller.removeEventListener("scroll", onScrollerScroll);
	}

	boundScroller = scroller;
	if (scroller && scroller !== document && scroller !== window) {
		scroller.addEventListener("scroll", onScrollerScroll, { passive: true });
	}
}

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

function onKeyDown(event) {
	if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
		return;
	}

	if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
		return;
	}

	if (isTypingTarget(event.target) || (cachedMessages.length === 0 && collectMessages().length === 0)) {
		return;
	}

	event.preventDefault();
	stepMessage(event.key === "ArrowDown" ? 1 : -1);
}

function renderPanelList() {
	const els = getPanelEls();
	if (!els) {
		return;
	}

	cachedMessages = collectMessages();
	ensureScrollWatch();
	processCodeBlocks();

	const signature = cachedMessages.map((item, index) => `${index}:${item.role}:${previewFromRoot(item.root).slice(0, 80)}`).join("|");

	if (signature !== lastSignature) {
		lastSignature = signature;
		els.list.replaceChildren();

		if (cachedMessages.length === 0) {
			const empty = document.createElement("div");
			empty.className = "empty";
			empty.textContent = "Open a Direct chat to see messages.";
			els.list.appendChild(empty);
			currentIndex = -1;
		} else {
			for (let i = 0; i < cachedMessages.length; i += 1) {
				const item = cachedMessages[i];
				const button = document.createElement("button");
				button.type = "button";
				button.className = "item";
				button.innerHTML = `
					<span class="n">${i + 1}</span>
					<span class="role ${item.role}">${item.role === "user" ? "You" : "AI"}</span>
					<span class="preview"></span>
				`;
				button.querySelector(".preview").textContent = previewFromRoot(item.root) || "(empty)";
				button.addEventListener("click", () => jumpToMessage(item.root, i));
				els.list.appendChild(button);
			}
		}
	}

	if (Date.now() >= pinnedUntil) {
		currentIndex = getCurrentMessageIndex(cachedMessages);
	} else if (currentIndex >= cachedMessages.length) {
		currentIndex = cachedMessages.length - 1;
	}

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
			<button class="toggle" type="button" title="Toggle message navigation">
				<span class="title">Messages</span>
				<span class="count">0</span>
				<span class="chevron">${panelCollapsed ? "▾" : "▴"}</span>
			</button>
			<div class="body">
				<div class="nav">
					<button class="nav-btn" type="button" data-dir="-1" title="Previous message (↑)">↑</button>
					<span class="pos">–/–</span>
					<button class="nav-btn" type="button" data-dir="1" title="Next message (↓)">↓</button>
					<button class="nav-btn" type="button" data-bottom title="Scroll to bottom">⤓</button>
				</div>
				<div class="list"></div>
				<div class="hint">↑ / ↓ jump between messages</div>
			</div>
		</div>
	`;

	shadow.querySelector(".toggle").addEventListener("click", () => {
		setPanelCollapsed(!panelCollapsed);
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
}

function scheduleRefresh() {
	window.clearTimeout(refreshTimer);
	refreshTimer = window.setTimeout(() => {
		if (location.href !== lastUrl) {
			lastUrl = location.href;
			lastSignature = "";
			currentIndex = -1;
		}

		restoreNativeScrollbars();
		ensurePanel();
		renderPanelList();
	}, 200);
}

async function init() {
	ensurePageStyle();
	restoreNativeScrollbars();

	const stored = await chrome.storage.local.get({
		disableAutoscroll: false,
		panelCollapsed: true,
		collapseCodeBlocks: true,
	});

	panelCollapsed = Boolean(stored.panelCollapsed);
	collapseCodeBlocks = stored.collapseCodeBlocks !== false;
	writeAutoscrollFlag(Boolean(stored.disableAutoscroll));
	ensurePanel();
	setPanelCollapsed(panelCollapsed, false);
	renderPanelList();

	new MutationObserver(() => {
		scheduleRefresh();
	}).observe(document.documentElement, {
		childList: true,
		subtree: true,
	});

	window.addEventListener("popstate", scheduleRefresh);
	window.addEventListener("scroll", onScrollerScroll, { passive: true });
	window.addEventListener("resize", scheduleCurrentSync);
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
		processCodeBlocks();
	}
});

void init();
