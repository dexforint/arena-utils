importScripts("shared.js", "chatTemplates.js");

const DEFAULT_PROMPTS = [
	{
		id: "explain-simply",
		name: "Объясни просто",
		text: "Объясни это простыми словами. Сначала суть в 2–3 предложениях, потом детали и короткий пример.",
	},
	{
		id: "critical",
		name: "Критический разбор",
		text: "Разбери это критически: что верно, что спорно, каких допущений не хватает и что стоит проверить отдельно.",
	},
	{
		id: "code-review",
		name: "Code review",
		text: "Сделай code review: баги, краевые случаи, читаемость и производительность. Предложи конкретные правки.",
	},
	{
		id: "translate-en",
		name: "Translate to English",
		text: "Translate the following into natural English. Keep meaning, tone, and technical terms. Do not add commentary.",
	},
	{
		id: "summarize",
		name: "Краткое резюме",
		text: "Суммируй ключевые тезисы списком. Отдельно укажи решения, открытые вопросы и следующие шаги.",
	},
];

const OFFSCREEN_PATH = "offscreen.html";
const OFFSCREEN_DOWNLOAD_TYPE = "ARENA_OFFSCREEN_DOWNLOAD";
const OFFSCREEN_IDLE_MS = 5000;
const OFFSCREEN_REPLY_TIMEOUT_MS = 120000;

let offscreenSetupPromise = null;
let offscreenCloseTimer = 0;

chrome.runtime.onInstalled.addListener(async () => {
	const current = await chrome.storage.local.get(["prompts", "disableAutoscroll", "panelCollapsed", "collapseCodeBlocks", "chatTemplates"]);

	const patch = {};

	if (!Array.isArray(current.prompts)) {
		patch.prompts = DEFAULT_PROMPTS;
	}

	if (!Array.isArray(current.chatTemplates)) {
		patch.chatTemplates = ArenaChatTemplates.DEFAULTS;
	}

	if (typeof current.disableAutoscroll !== "boolean") {
		patch.disableAutoscroll = false;
	}

	if (typeof current.panelCollapsed !== "boolean") {
		patch.panelCollapsed = true;
	}

	if (typeof current.collapseCodeBlocks !== "boolean") {
		patch.collapseCodeBlocks = true;
	}

	if (Object.keys(patch).length > 0) {
		await chrome.storage.local.set(patch);
	}
});

async function hasOffscreenDocument() {
	if (typeof chrome.runtime.getContexts !== "function") {
		return false;
	}

	try {
		const contexts = await chrome.runtime.getContexts({
			contextTypes: ["OFFSCREEN_DOCUMENT"],
			documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
		});

		return contexts.length > 0;
	} catch (_error) {
		return false;
	}
}

async function ensureOffscreenDocument() {
	if (await hasOffscreenDocument()) {
		return;
	}

	if (!offscreenSetupPromise) {
		offscreenSetupPromise = chrome.offscreen
			.createDocument({
				url: OFFSCREEN_PATH,
				reasons: ["BLOBS"],
				justification: "Create blob URLs to save exported chats as files.",
			})
			.catch((error) => {
				// Гонка: документ уже создан другим вызовом.
				if (!String(error?.message || error).includes("Only a single offscreen document")) {
					throw error;
				}
			})
			.finally(() => {
				offscreenSetupPromise = null;
			});
	}

	await offscreenSetupPromise;
}

async function closeOffscreenDocument() {
	try {
		if (!(await hasOffscreenDocument())) {
			return;
		}

		await chrome.offscreen.closeDocument();
	} catch (_error) {
		/* ignore */
	}
}

function scheduleOffscreenClose() {
	clearTimeout(offscreenCloseTimer);
	offscreenCloseTimer = setTimeout(() => {
		void closeOffscreenDocument();
	}, OFFSCREEN_IDLE_MS);
}

function sendMessageWithTimeout(message, timeoutMs = OFFSCREEN_REPLY_TIMEOUT_MS) {
	let timer = 0;

	return Promise.race([
		chrome.runtime.sendMessage(message).finally(() => clearTimeout(timer)),
		new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error("Offscreen response timeout")), timeoutMs);
		}),
	]);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message?.type === "ARENA_OPEN_OPTIONS") {
		const hash = typeof message.hash === "string" && message.hash.startsWith("#") ? message.hash : "";
		void chrome.tabs.create({
			url: chrome.runtime.getURL(`options.html${hash}`),
		});
		sendResponse({ ok: true });
		return;
	}

	if (message?.type !== "ARENA_EXPORT_DOWNLOAD") {
		return;
	}

	(async () => {
		const folderName = ArenaShared.sanitizeFileName(message.folderName || "arena-export");
		const files = Array.isArray(message.files) ? message.files : [];

		if (files.length === 0) {
			sendResponse({ ok: true, count: 0 });
			return;
		}

		const payload = files.map((file) => ({
			name: ArenaShared.sanitizeFileName(file.name || "file.md", "file.md"),
			text: String(file.text ?? "").replace(/\r\n/g, "\n"),
		}));

		await ensureOffscreenDocument();

		const result = await sendMessageWithTimeout({
			type: OFFSCREEN_DOWNLOAD_TYPE,
			folderName,
			files: payload,
		});

		scheduleOffscreenClose();

		sendResponse(result || { ok: false, error: "Empty response from offscreen" });
	})().catch((error) => {
		console.error("[arena-utils] Download error:", error);
		sendResponse({
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	});

	return true;
});
