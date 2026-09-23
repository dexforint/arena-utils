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
	const current = await chrome.storage.local.get(["prompts", "disableAutoscroll", "panelCollapsed", "collapseCodeBlocks"]);

	const patch = {};

	if (!Array.isArray(current.prompts)) {
		patch.prompts = DEFAULT_PROMPTS;
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

function waitForDownload(downloadId) {
	return new Promise((resolve, reject) => {
		let settled = false;

		const finish = (ok, error) => {
			if (settled) {
				return;
			}

			settled = true;
			chrome.downloads.onChanged.removeListener(onChanged);

			if (ok) {
				resolve();
			} else {
				reject(new Error(error || "Download interrupted"));
			}
		};

		const onChanged = (delta) => {
			if (delta.id !== downloadId) {
				return;
			}

			if (delta.state?.current === "complete") {
				finish(true);
			} else if (delta.state?.current === "interrupted") {
				finish(false, delta.error?.current);
			}
		};

		chrome.downloads.onChanged.addListener(onChanged);

		void chrome.downloads.search({ id: downloadId }).then(([item]) => {
			if (item?.state === "complete") {
				finish(true);
			} else if (item?.state === "interrupted") {
				finish(false, item.error);
			}
		});
	});
}

async function downloadMarkdown(filename, text) {
	const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
	const url = URL.createObjectURL(blob);

	try {
		const downloadId = await chrome.downloads.download({
			url,
			filename,
			saveAs: false,
			conflictAction: "uniquify",
		});

		await waitForDownload(downloadId);
	} finally {
		URL.revokeObjectURL(url);
	}
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message?.type !== "ARENA_EXPORT_DOWNLOAD") {
		return;
	}

	(async () => {
		const folderName = sanitizeFileName(message.folderName || "arena-export");
		const files = Array.isArray(message.files) ? message.files : [];

		for (const file of files) {
			const fileName = sanitizeFileName(file.name || "file.md");
			const text = String(file.text ?? "").replace(/\r\n/g, "\n");
			await downloadMarkdown(`${folderName}/${fileName}`, text);
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
