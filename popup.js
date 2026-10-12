const t = (key, subs) => globalThis.ArenaI18n?.t(key, subs) || key;

const autoscroll = document.getElementById("autoscroll");
const collapseCode = document.getElementById("collapse-code");
const exportButton = document.getElementById("export");
const openOptionsButton = document.getElementById("open-options");
const newChatSection = document.getElementById("new-chat-section");
const newChatTitle = document.getElementById("new-chat-title");
const newChatEdit = document.getElementById("new-chat-edit");
const newChatTemplates = document.getElementById("new-chat-templates");
const statusEl = document.getElementById("status");
const bookmarksRoot = document.getElementById("bookmarks");
const bookmarksCount = document.getElementById("bookmarks-count");
const articleSection = document.getElementById("article-section");
const articleTitleEl = articleSection?.querySelector("h2") || null;
const articleMeta = document.getElementById("article-meta");
const explainArticleButton = document.getElementById("explain-article");
const videoSection = document.getElementById("video-section");
const videoMeta = document.getElementById("video-meta");
const explainVideoButton = document.getElementById("explain-video");
const perfDebugInput = document.getElementById("perf-debug");
const perfDumpButton = document.getElementById("perf-dump");
const perfResetButton = document.getElementById("perf-reset");

// Состояние секции Article на момент открытия попапа:
//   { kind: "article" | "page" | "pdf", tabId, url, origin?, granted? }
let articleState = null;

// ---------------------------------------------------------------------------
// Theme / tab helpers
// ---------------------------------------------------------------------------

function applyTheme(theme) {
	const mode = theme === "dark" ? "dark" : "light";
	document.documentElement.dataset.theme = mode;
	document.documentElement.style.colorScheme = mode;
}

async function getActiveTab() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	return tab;
}

function isArenaTab(tab) {
	return Boolean(tab?.url && /^https:\/\/([^/]+\.)?arena\.ai\//.test(tab.url));
}

function isArenaUrl(url) {
	return /^https:\/\/([^/]+\.)?arena\.ai\//i.test(String(url || ""));
}

function isHttpTab(tab) {
	return Boolean(tab?.url && /^https?:\/\//i.test(tab.url));
}

function isYouTubeHost(hostname) {
	return /(^|\.)youtube\.com$/i.test(hostname) || /(^|\.)youtube-nocookie\.com$/i.test(hostname);
}

function isYouTubeVideoUrl(url) {
	try {
		const parsed = new URL(String(url || ""));
		if (!isYouTubeHost(parsed.hostname)) {
			return false;
		}

		if (parsed.pathname === "/watch" && parsed.searchParams.get("v")) {
			return true;
		}

		if (parsed.pathname.startsWith("/shorts/")) {
			return true;
		}

		if (parsed.pathname.startsWith("/embed/")) {
			return true;
		}

		return false;
	} catch (_error) {
		return false;
	}
}

async function sendToTab(tabId, message) {
	try {
		return await chrome.tabs.sendMessage(tabId, message);
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

// ---------------------------------------------------------------------------
// Queue helpers
// ---------------------------------------------------------------------------

async function getPromptMaxChars() {
	const stored = await chrome.storage.local.get({
		promptMaxChars: ArenaShared.DEFAULT_PROMPT_MAX_CHARS,
	});

	return ArenaShared.clampPromptChars(stored.promptMaxChars);
}

// Очередь сообщений: content script читает её после открытия чата и
// рассылает последовательно.
async function queueChatMessages(messages, url) {
	await chrome.storage.local.set({
		pendingChatMessages: Array.isArray(messages) ? messages : [String(messages || "")],
		pendingChatUrl: url,
		pendingChatAutoSend: true,
		pendingChatAutoSendUntil: Date.now() + 15 * 60 * 1000,
	});
}

function describeQueuedMessages(messages) {
	if (!Array.isArray(messages) || messages.length <= 1) {
		return "";
	}

	return ` · ${t("popupMessagesQueued", [String(messages.length)])}`;
}

// ---------------------------------------------------------------------------
// Article / Page / PDF
// ---------------------------------------------------------------------------

function originPatternFromUrl(url) {
	try {
		const parsed = new URL(String(url || ""));
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
			return "";
		}
		return `${parsed.protocol}//${parsed.host}/*`;
	} catch (_error) {
		return "";
	}
}

async function hasOriginAccess(origin) {
	if (!origin) {
		return false;
	}

	try {
		return Boolean(await chrome.permissions.contains({ origins: [origin] }));
	} catch (_error) {
		return false;
	}
}

// Вызывать строго синхронно из обработчика клика: chrome.permissions.request
// требует активного user gesture, а любое await до него жест «съедает».
function requestOriginAccess(origin) {
	if (!origin) {
		return Promise.resolve(false);
	}

	try {
		return chrome.permissions.request({ origins: [origin] }).catch(() => false);
	} catch (_error) {
		return Promise.resolve(false);
	}
}

function setArticleTitle(text) {
	if (!articleTitleEl) {
		return;
	}

	// data-i18n снимаем: дальше заголовок меняется динамически
	// (Article / Page / PDF) и повторный apply() не должен его перезатирать.
	articleTitleEl.removeAttribute("data-i18n");
	articleTitleEl.textContent = text;
}

async function detectPageKind(tab) {
	try {
		const [result] = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: () => {
				const articles = Array.from(document.querySelectorAll("article"));
				let articleChars = 0;

				for (const el of articles) {
					const length = String(el.innerText || el.textContent || "").trim().length;
					if (length > articleChars) {
						articleChars = length;
					}
				}

				return {
					contentType: String(document.contentType || "").toLowerCase(),
					articles: articles.length,
					articleChars,
					bodyChars: String(document.body?.innerText || "").trim().length,
				};
			},
		});

		const info = result?.result || {};

		// Иногда инжект всё-таки проходит во встроенный PDF-вьюер, и тогда
		// contentType честно говорит, что это PDF — не трактуем как HTML.
		if (info.contentType === "application/pdf") {
			return { kind: "pdf" };
		}

		if (Number(info.articleChars) >= 200) {
			return {
				kind: "article",
				articles: Number(info.articles) || 0,
				articleChars: Number(info.articleChars) || 0,
				bodyChars: Number(info.bodyChars) || 0,
			};
		}

		return {
			kind: "page",
			articles: Number(info.articles) || 0,
			articleChars: Number(info.articleChars) || 0,
			bodyChars: Number(info.bodyChars) || 0,
		};
	} catch (_error) {
		// executeScript не отработал: почти наверняка PDF во встроенном
		// вьюере Chrome — туда content scripts не инжектятся.
		return { kind: "pdf", articles: 0, articleChars: 0, bodyChars: 0 };
	}
}

async function extractContentFromTab(tabId) {
	// Readability заметно лучше вычищает обвязку, но он необязателен:
	// articleExtractor умеет работать и без него (своя эвристика).
	try {
		await chrome.scripting.executeScript({
			target: { tabId },
			files: ["vendor/readability.js"],
		});
	} catch (_error) {
		/* библиотека не установлена — это нормально */
	}

	await chrome.scripting.executeScript({
		target: { tabId },
		files: ["articleExtractor.js"],
	});

	const [result] = await chrome.scripting.executeScript({
		target: { tabId },
		func: () => {
			if (typeof globalThis.__arenaExtractContent !== "function") {
				return { ok: false, reason: "Extractor is not available" };
			}
			return globalThis.__arenaExtractContent({ mode: "auto" });
		},
	});

	return result?.result || { ok: false, reason: "Empty extraction result" };
}

async function startArticleChat(extracted) {
	const stored = await chrome.storage.local.get({
		articleTemplate: ArenaShared.DEFAULT_ARTICLE_TEMPLATE,
		articleModel: ArenaShared.DEFAULT_ARTICLE_MODEL,
	});

	const template = String(stored.articleTemplate || ArenaShared.DEFAULT_ARTICLE_TEMPLATE);
	const model = String(stored.articleModel || ArenaShared.DEFAULT_ARTICLE_MODEL).trim();
	const maxChars = await getPromptMaxChars();

	const messages = ArenaShared.buildArticleMessages(extracted, template, maxChars);
	const url = ArenaShared.buildArticleChatUrl(model);

	await queueChatMessages(messages, url);
	await chrome.tabs.create({ url, active: true });
}

async function renderArticleSection(tab) {
	if (!articleSection || !explainArticleButton) {
		return;
	}

	if (!isHttpTab(tab) || isArenaUrl(tab.url) || isYouTubeVideoUrl(tab.url)) {
		articleSection.hidden = true;
		articleState = null;
		return;
	}

	articleSection.hidden = false;
	articleState = null;
	explainArticleButton.disabled = true;
	explainArticleButton.textContent = t("popupArticleButton");
	articleMeta.textContent = t("popupArticleChecking");

	const detected = await detectPageKind(tab);

	if (detected.kind === "pdf") {
		const origin = originPatternFromUrl(tab.url);
		const granted = await hasOriginAccess(origin);

		articleState = { kind: "pdf", tabId: tab.id, url: tab.url, origin, granted };
		setArticleTitle(t("popupPdfTitle"));
		articleMeta.textContent = granted ? t("popupPdfMeta") : t("popupPdfMetaNoAccess");
		explainArticleButton.textContent = t("popupPdfButton");
		explainArticleButton.disabled = false;
		return;
	}

	if (detected.kind === "article") {
		articleState = { kind: "article", tabId: tab.id, url: tab.url };
		setArticleTitle(t("popupArticleTitle"));
		articleMeta.textContent = t("popupArticleCount", [String(detected.articles), Number(detected.articleChars || 0).toLocaleString()]);
		explainArticleButton.textContent = t("popupArticleButton");
		explainArticleButton.disabled = false;
		return;
	}

	articleState = { kind: "page", tabId: tab.id, url: tab.url };
	setArticleTitle(t("popupPageTitle"));

	if (detected.bodyChars < 200) {
		articleMeta.textContent = t("popupArticleNone");
		explainArticleButton.disabled = true;
		return;
	}

	articleMeta.textContent = t("popupPageMeta", [Number(detected.bodyChars || 0).toLocaleString()]);
	explainArticleButton.textContent = t("popupPageButton");
	explainArticleButton.disabled = false;
}

async function handleExplainArticleClick() {
	const state = articleState;

	if (!state || explainArticleButton.disabled) {
		return;
	}

	explainArticleButton.disabled = true;

	try {
		if (state.kind === "pdf") {
			if (!state.granted) {
				// Строго синхронно, до первого await — иначе Chrome отклонит
				// запрос как «не из user gesture».
				state.granted = await requestOriginAccess(state.origin);

				if (!state.granted) {
					throw new Error(t("popupArticleNoPermission"));
				}
			}

			articleMeta.textContent = t("popupPdfExtracting");

			// Разбор PDF идёт в service worker: попап может закрыться раньше,
			// чем он закончится, и результат не должен потеряться.
			const result = await chrome.runtime.sendMessage({
				type: "ARENA_OPEN_DOCUMENT_CHAT",
				url: state.url,
			});

			if (!result?.ok) {
				throw new Error(result?.error || t("popupArticleExtractFailed"));
			}

			window.close();
			return;
		}

		articleMeta.textContent = t("popupArticleExtracting");

		const extracted = await extractContentFromTab(state.tabId);
		if (!extracted?.ok) {
			throw new Error(extracted?.reason || t("popupArticleExtractFailed"));
		}

		const maxChars = await getPromptMaxChars();
		const stored = await chrome.storage.local.get({
			articleTemplate: ArenaShared.DEFAULT_ARTICLE_TEMPLATE,
		});
		const template = String(stored.articleTemplate || ArenaShared.DEFAULT_ARTICLE_TEMPLATE);
		const messages = ArenaShared.buildArticleMessages(extracted, template, maxChars);

		if (messages.length > 1) {
			articleMeta.textContent = t("popupMessagesQueued", [String(messages.length)]);
		}

		await startArticleChat(extracted);
		window.close();
	} catch (error) {
		articleMeta.textContent = error instanceof Error ? error.message : String(error);
		explainArticleButton.disabled = false;
	}
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

async function checkVideoSubtitles(tabId) {
	try {
		const [result] = await chrome.scripting.executeScript({
			target: { tabId },
			world: "MAIN",
			func: () => {
				const app = document.querySelector("ytd-app");
				const player = document.querySelector("#movie_player");

				let response = app?.data?.playerResponse || null;

				if (!response && typeof player?.getPlayerResponse === "function") {
					try {
						response = player.getPlayerResponse();
					} catch (_error) {
						/* ignore */
					}
				}

				if (!response && globalThis.ytInitialPlayerResponse) {
					response = globalThis.ytInitialPlayerResponse;
				}

				const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
				const title = String(response?.videoDetails?.title || document.title || "");

				return {
					hasCaptions: Array.isArray(tracks) && tracks.length > 0,
					count: Array.isArray(tracks) ? tracks.length : 0,
					languages: Array.isArray(tracks) ? Array.from(new Set(tracks.map((track) => String(track.languageCode || "")).filter(Boolean))).slice(0, 6) : [],
					title,
				};
			},
		});

		return result?.result || { hasCaptions: false, count: 0, languages: [] };
	} catch (_error) {
		return { hasCaptions: false, count: 0, languages: [] };
	}
}

async function extractVideoFromTab(tabId) {
	await chrome.scripting.executeScript({
		target: { tabId },
		world: "MAIN",
		files: ["youtubeExtractor.js"],
	});

	const [result] = await chrome.scripting.executeScript({
		target: { tabId },
		world: "MAIN",
		func: () => {
			if (typeof globalThis.__arenaExtractYouTube !== "function") {
				return { ok: false, reason: "Extractor is not available" };
			}
			return globalThis.__arenaExtractYouTube();
		},
	});

	return result?.result || { ok: false, reason: "Empty extraction result" };
}

async function renderVideoSection(tab) {
	if (!videoSection) {
		return;
	}

	if (!isYouTubeVideoUrl(tab?.url || "")) {
		videoSection.hidden = true;
		return;
	}

	videoSection.hidden = false;
	explainVideoButton.disabled = true;
	explainVideoButton.textContent = t("popupVideoButton");
	videoMeta.textContent = t("popupVideoChecking");

	const info = await checkVideoSubtitles(tab.id);

	if (!info?.hasCaptions) {
		videoMeta.textContent = t("popupVideoNone");
		explainVideoButton.disabled = true;
		explainVideoButton.removeAttribute("data-tab-id");
		return;
	}

	const languages = Array.isArray(info.languages) && info.languages.length > 0 ? ` · ${info.languages.join(", ")}` : "";
	videoMeta.textContent = t("popupVideoTracks", [String(Number(info.count) || 0), languages]);
	explainVideoButton.disabled = false;
	explainVideoButton.dataset.tabId = String(tab.id);
}

async function handleExplainVideoClick() {
	const tabId = Number(explainVideoButton.dataset.tabId || 0);
	if (!tabId) {
		videoMeta.textContent = t("popupVideoNoTarget");
		return;
	}

	explainVideoButton.disabled = true;
	videoMeta.textContent = t("popupVideoExtracting");

	try {
		const extracted = await extractVideoFromTab(tabId);
		if (!extracted?.ok) {
			const dbg = Array.isArray(extracted?.debug) ? ` | steps: ${extracted.debug.join("; ")}` : "";
			throw new Error((extracted?.reason || "Failed to extract subtitles") + dbg);
		}

		const stored = await chrome.storage.local.get({
			videoTemplate: ArenaShared.DEFAULT_VIDEO_TEMPLATE,
			videoModel: ArenaShared.DEFAULT_VIDEO_MODEL,
		});

		const template = String(stored.videoTemplate || ArenaShared.DEFAULT_VIDEO_TEMPLATE);
		const model = String(stored.videoModel || ArenaShared.DEFAULT_VIDEO_MODEL).trim();
		const maxChars = await getPromptMaxChars();

		const messages = ArenaShared.buildVideoMessages(extracted, template, maxChars);
		const url = ArenaShared.buildVideoChatUrl(model);

		if (messages.length > 1) {
			videoMeta.textContent = t("popupMessagesQueued", [String(messages.length)]);
		}

		await queueChatMessages(messages, url);
		await chrome.tabs.create({ url, active: true });
		window.close();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		videoMeta.textContent = message;
		explainVideoButton.disabled = false;
		console.warn("[arena-utils] YouTube extraction failed:", error);
	}
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

async function readBookmarks() {
	if (ArenaShared?.getBookmarks) {
		return ArenaShared.getBookmarks();
	}

	const stored = await chrome.storage.local.get({ bookmarks: [] });
	return Array.isArray(stored.bookmarks) ? stored.bookmarks : [];
}

async function writeBookmarks(bookmarks) {
	if (ArenaShared?.setBookmarks) {
		return ArenaShared.setBookmarks(bookmarks);
	}

	await chrome.storage.local.set({
		bookmarks: Array.isArray(bookmarks) ? bookmarks : [],
	});
}

function renderBookmarks(bookmarks) {
	if (!bookmarksRoot) {
		return;
	}

	bookmarksRoot.replaceChildren();

	if (!Array.isArray(bookmarks) || bookmarks.length === 0) {
		const empty = document.createElement("div");
		empty.className = "empty";
		empty.textContent = t("popupBookmarksEmpty");
		bookmarksRoot.appendChild(empty);
		if (bookmarksCount) {
			bookmarksCount.textContent = "";
		}
		return;
	}

	if (bookmarksCount) {
		bookmarksCount.textContent = String(bookmarks.length);
	}

	for (const bookmark of bookmarks) {
		const row = document.createElement("div");
		row.className = "bookmark-row";

		const title = bookmark.title || bookmark.id || t("popupBookmarkUntitled");

		const openBtn = document.createElement("button");
		openBtn.type = "button";
		openBtn.className = "bookmark-open";
		openBtn.title = bookmark.url || "";
		openBtn.setAttribute("aria-label", t("popupBookmarkOpen", [String(title)]));

		const titleEl = document.createElement("span");
		titleEl.className = "bookmark-title";
		titleEl.textContent = title;
		openBtn.appendChild(titleEl);

		openBtn.addEventListener("click", async () => {
			if (!bookmark.url) {
				statusEl.textContent = t("popupBookmarkNoUrl");
				return;
			}

			await chrome.tabs.create({ url: bookmark.url, active: true });
			window.close();
		});

		const deleteBtn = document.createElement("button");
		deleteBtn.type = "button";
		deleteBtn.className = "bookmark-delete";
		deleteBtn.title = t("popupBookmarkRemove");
		deleteBtn.setAttribute("aria-label", t("popupBookmarkRemove"));
		deleteBtn.textContent = "×";

		deleteBtn.addEventListener("click", async () => {
			const all = await readBookmarks();
			const next = all.filter((item) => item?.id !== bookmark.id);
			await writeBookmarks(next);
		});

		row.append(openBtn, deleteBtn);
		bookmarksRoot.appendChild(row);
	}
}

// ---------------------------------------------------------------------------
// New chat templates
// ---------------------------------------------------------------------------

async function openChatTemplate(template) {
	const url = ArenaChatTemplates.buildUrl(template);
	const prompt = String(template?.prompt || "");

	if (prompt) {
		await chrome.storage.local.set({
			pendingChatMessages: [prompt],
			pendingChatUrl: url,
		});
	} else {
		await chrome.storage.local.remove(["pendingChatPrompt", "pendingChatMessages", "pendingChatUrl"]);
	}

	await chrome.tabs.create({ url });
	window.close();
}

function renderChatTemplates(templates) {
	newChatSection.hidden = false;
	newChatTitle.textContent = t("popupNewChatTitle");
	newChatEdit.href = "options.html#chat-templates";
	newChatTemplates.replaceChildren();

	if (!Array.isArray(templates) || templates.length === 0) {
		const empty = document.createElement("div");
		empty.className = "empty";
		empty.textContent = t("popupNewChatEmpty");
		newChatTemplates.appendChild(empty);
		return;
	}

	for (const template of templates) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "prompt";
		button.innerHTML = `<span class="template-name"></span><span class="template-meta"></span>`;
		button.querySelector(".template-name").textContent = template.name || "Untitled";
		const meta = ArenaChatTemplates.summarize(template);
		button.querySelector(".template-meta").textContent = String(template.prompt || "").trim() ? `${meta} · prompt` : meta;
		button.addEventListener("click", () => {
			void openChatTemplate(template);
		});
		newChatTemplates.appendChild(button);
	}
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
	globalThis.ArenaI18n?.apply();

	const tab = await getActiveTab();
	const stored = await chrome.storage.local.get({
		disableAutoscroll: false,
		collapseCodeBlocks: true,
		chatTemplates: [],
		bookmarks: [],
		perfDebug: false,
	});

	autoscroll.checked = Boolean(stored.disableAutoscroll);
	perfDebugInput.checked = Boolean(stored.perfDebug);
	collapseCode.checked = stored.collapseCodeBlocks !== false;
	renderBookmarks(stored.bookmarks);
	void renderArticleSection(tab);
	void renderVideoSection(tab);

	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== "local") {
			return;
		}

		if (changes.chatTemplates && !isArenaTab(tab)) {
			renderChatTemplates(changes.chatTemplates.newValue || []);
		}

		if (changes.bookmarks) {
			renderBookmarks(changes.bookmarks.newValue || []);
		}
	});

	autoscroll.addEventListener("change", async () => {
		await chrome.storage.local.set({
			disableAutoscroll: autoscroll.checked,
		});
	});

	perfDebugInput.addEventListener("change", async () => {
		await chrome.storage.local.set({ perfDebug: perfDebugInput.checked });
		statusEl.textContent = perfDebugInput.checked ? t("popupPerfEnabledStatus") : t("popupPerfDisabledStatus");
	});

	perfDumpButton.addEventListener("click", async () => {
		if (!isArenaTab(tab)) {
			statusEl.textContent = t("popupOpenArenaFirst");
			return;
		}

		const result = await sendToTab(tab.id, { type: "ARENA_PERF_DUMP" });
		if (!result?.ok) {
			statusEl.textContent = result?.error || t("popupPerfDumpFailed");
			return;
		}

		statusEl.textContent = t("popupPerfDumpDone", [String(result.rows?.length || 0)]);
	});

	perfResetButton.addEventListener("click", async () => {
		if (!isArenaTab(tab)) {
			statusEl.textContent = t("popupOpenArenaFirst");
			return;
		}

		await sendToTab(tab.id, { type: "ARENA_PERF_RESET" });
		statusEl.textContent = t("popupPerfResetDone");
	});

	collapseCode.addEventListener("change", async () => {
		await chrome.storage.local.set({
			collapseCodeBlocks: collapseCode.checked,
		});
	});

	if (!isArenaTab(tab)) {
		applyTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
		statusEl.textContent = t("popupOpenTemplateFirst");
		exportButton.disabled = true;
		exportButton.textContent = t("popupExportButton");
		renderChatTemplates(stored.chatTemplates);
		return;
	}

	const status = await sendToTab(tab.id, { type: "ARENA_GET_STATUS" });
	applyTheme(status?.theme === "dark" ? "dark" : "light");
	statusEl.textContent = status?.ok ? t("popupMessagesCount", [String(status.messageCount || 0)]) : t("popupReloadTab");
	exportButton.disabled = false;
	exportButton.textContent = t("popupExportButton");

	exportButton.addEventListener("click", async () => {
		exportButton.disabled = true;
		statusEl.textContent = t("popupExporting");
		const result = await sendToTab(tab.id, { type: "ARENA_EXPORT_START" });
		if (!result?.ok) {
			statusEl.textContent = result?.error || t("popupExportFailed");
			exportButton.disabled = false;
			return;
		}
		window.close();
	});
}

// ---------------------------------------------------------------------------
// Top-level event wiring
// ---------------------------------------------------------------------------

openOptionsButton?.addEventListener("click", () => {
	chrome.runtime.openOptionsPage();
});

explainArticleButton?.addEventListener("click", () => {
	void handleExplainArticleClick();
});

explainVideoButton?.addEventListener("click", () => {
	void handleExplainVideoClick();
});

void init();
