importScripts("chatTemplates.js");

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

function sanitizeFileName(value) {
	return (
		String(value || "")
			.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
			.trim()
			.slice(0, 120) || "arena-export"
	);
}

function makeDataUrl(text) {
	return `data:text/markdown;charset=utf-8,${encodeURIComponent(text)}`;
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
		const folderName = sanitizeFileName(message.folderName || "arena-export");
		const files = Array.isArray(message.files) ? message.files : [];

		for (const file of files) {
			const fileName = sanitizeFileName(file.name || "file.md");
			const text = String(file.text ?? "").replace(/\r\n/g, "\n");

			await chrome.downloads.download({
				url: makeDataUrl(text),
				filename: `${folderName}/${fileName}`,
				saveAs: false,
				conflictAction: "uniquify",
			});
		}

		sendResponse({ ok: true, count: files.length });
	})().catch((error) => {
		console.error("[arena-utils] Download error:", error);
		sendResponse({
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	});

	return true;
});
