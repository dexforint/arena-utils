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
const OFFSCREEN_CREATE_BLOBS_TYPE = "ARENA_OFFSCREEN_CREATE_BLOBS";
const OFFSCREEN_REVOKE_BLOBS_TYPE = "ARENA_OFFSCREEN_REVOKE_BLOBS";
const OFFSCREEN_IDLE_MS = 5000;
const OFFSCREEN_REPLY_TIMEOUT_MS = 120000;
const DOWNLOAD_COMPLETE_TIMEOUT_MS = 60000;

let offscreenSetupPromise = null;
let offscreenCloseTimer = 0;

// ---------------------------------------------------------------------------
// Установка / миграция дефолтов
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Offscreen document lifecycle
// ---------------------------------------------------------------------------

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
				justification: "Create blob URLs so the service worker can save exported chats as files.",
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

// ---------------------------------------------------------------------------
// Blob URL создаётся в offscreen, скачивание — здесь, в SW.
// ---------------------------------------------------------------------------

async function createBlobUrlsInOffscreen(payload) {
	await ensureOffscreenDocument();

	const response = await sendMessageWithTimeout({
		type: OFFSCREEN_CREATE_BLOBS_TYPE,
		files: payload,
	});

	if (!response?.ok || !Array.isArray(response.files)) {
		throw new Error(response?.error || "Offscreen did not return blob URLs");
	}

	return response.files;
}

function revokeBlobUrlsInOffscreen(urls) {
	if (!Array.isArray(urls) || urls.length === 0) {
		return;
	}

	void sendMessageWithTimeout({
		type: OFFSCREEN_REVOKE_BLOBS_TYPE,
		urls,
	}).catch(() => {
		/* offscreen мог уже закрыться — тогда URL'ы освободятся сами */
	});
}

function waitForDownloadCompletion(downloadId, timeoutMs = DOWNLOAD_COMPLETE_TIMEOUT_MS) {
	return new Promise((resolve) => {
		let timer = 0;

		function listener(delta) {
			if (delta.id !== downloadId || !delta.state) {
				return;
			}

			const state = delta.state.current;
			if (state !== "complete" && state !== "interrupted") {
				return;
			}

			clearTimeout(timer);
			chrome.downloads.onChanged.removeListener(listener);
			resolve(state);
		}

		timer = setTimeout(() => {
			chrome.downloads.onChanged.removeListener(listener);
			resolve("timeout");
		}, timeoutMs);

		chrome.downloads.onChanged.addListener(listener);
	});
}

async function downloadOneViaBlobUrl(folderName, file, blobUrl) {
	try {
		const downloadId = await chrome.downloads.download({
			url: blobUrl,
			filename: `${folderName}/${file.name}`,
			saveAs: false,
			conflictAction: "uniquify",
		});

		const state = await waitForDownloadCompletion(downloadId);

		if (state === "interrupted") {
			return { ok: false, name: file.name, error: "Download interrupted" };
		}

		if (state === "timeout") {
			return { ok: false, name: file.name, error: "Download completion timeout" };
		}

		return { ok: true, name: file.name };
	} catch (error) {
		return {
			ok: false,
			name: file.name,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function downloadViaBlobUrls(folderName, payload) {
	let created;

	try {
		created = await createBlobUrlsInOffscreen(payload);
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	// Запускаем все download'ы сразу — Chrome сам выстроит их в очередь.
	// Параллельность важна: последовательные await удлиняли бы экспорт на ~N*100ms.
	const tasks = payload.map((file, index) => {
		const entry = created[index];
		if (!entry?.url) {
			return Promise.resolve({
				ok: false,
				name: file.name,
				error: "Missing blob URL from offscreen",
			});
		}

		return downloadOneViaBlobUrl(folderName, file, entry.url);
	});

	const results = await Promise.all(tasks);

	// Освобождаем blob URLs после завершения download'ов.
	revokeBlobUrlsInOffscreen(created.map((item) => item?.url).filter((url) => typeof url === "string"));

	const failed = results.filter((item) => !item.ok);
	const firstError = failed.length > 0 ? failed[0].error || "unknown error" : null;

	return {
		ok: failed.length === 0,
		count: results.length,
		failed,
		error: firstError ? `${failed.length} of ${results.length} downloads failed: ${firstError}` : null,
	};
}

// ---------------------------------------------------------------------------
// Fallback через data: URL (на случай, если offscreen недоступен).
// ---------------------------------------------------------------------------

async function downloadViaDataUrl(folderName, file) {
	try {
		const url = `data:text/markdown;charset=utf-8,${encodeURIComponent(file.text)}`;
		await chrome.downloads.download({
			url,
			filename: `${folderName}/${file.name}`,
			saveAs: false,
			conflictAction: "uniquify",
		});
		return { ok: true, name: file.name };
	} catch (error) {
		return {
			ok: false,
			name: file.name,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function downloadViaDataUrls(folderName, payload) {
	const results = await Promise.all(payload.map((file) => downloadViaDataUrl(folderName, file)));

	const failed = results.filter((item) => !item.ok);
	const firstError = failed.length > 0 ? failed[0].error || "unknown error" : null;

	return {
		ok: failed.length === 0,
		count: results.length,
		failed,
		error: firstError ? `${failed.length} of ${results.length} downloads failed: ${firstError}` : null,
	};
}

// ---------------------------------------------------------------------------
// Основной диспетчер: blob → fallback data: URL.
// ---------------------------------------------------------------------------

async function downloadAllFiles(folderName, files) {
	const payload = files.map((file) => ({
		name: ArenaShared.sanitizeFileName(file.name || "file.md", "file.md"),
		text: String(file.text ?? "").replace(/\r\n/g, "\n"),
	}));

	const blobResult = await downloadViaBlobUrls(folderName, payload);

	if (blobResult?.ok) {
		scheduleOffscreenClose();
		return { ok: true, count: payload.length };
	}

	console.warn("[arena-utils] Blob download failed, falling back to data: URL. Reason:", blobResult?.error || blobResult);

	// Повторяем только те файлы, что упали; если их список пуст —
	// значит, упало до download'ов, повторяем всё.
	let remaining = payload;

	if (Array.isArray(blobResult?.failed) && blobResult.failed.length > 0) {
		const failedNames = new Set(blobResult.failed.map((item) => item.name));
		remaining = payload.filter((file) => failedNames.has(file.name));
	}

	console.warn(`[arena-utils] Falling back to data: URL for ${remaining.length} of ${payload.length} file(s)`);

	const fallbackResult = await downloadViaDataUrls(folderName, remaining);
	scheduleOffscreenClose();

	if (!fallbackResult.ok) {
		return {
			ok: false,
			count: payload.length,
			failed: fallbackResult.failed,
			error: fallbackResult.error,
		};
	}

	return {
		ok: true,
		count: payload.length,
		viaFallback: remaining.length,
	};
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

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

		const result = await downloadAllFiles(folderName, files);
		sendResponse(result);
	})().catch((error) => {
		console.error("[arena-utils] Download error:", error);
		sendResponse({
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	});

	return true;
});
