const t = (key, subs) => globalThis.ArenaI18n?.t(key, subs) || key;

const autoscroll = document.getElementById("autoscroll");
const collapseCode = document.getElementById("collapse-code");
const exportButton = document.getElementById("export");
const newChatSection = document.getElementById("new-chat-section");
const newChatTitle = document.getElementById("new-chat-title");
const newChatEdit = document.getElementById("new-chat-edit");
const newChatTemplates = document.getElementById("new-chat-templates");
const statusEl = document.getElementById("status");
const bookmarksRoot = document.getElementById("bookmarks");
const bookmarksCount = document.getElementById("bookmarks-count");
const articleSection = document.getElementById("article-section");
const articleMeta = document.getElementById("article-meta");
const explainArticleButton = document.getElementById("explain-article");
const videoSection = document.getElementById("video-section");
const videoMeta = document.getElementById("video-meta");
const explainVideoButton = document.getElementById("explain-video");
const perfDebugInput = document.getElementById("perf-debug");
const perfDumpButton = document.getElementById("perf-dump");
const perfResetButton = document.getElementById("perf-reset");

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

function isArenaUrl(url) {
	return /^https:\/\/([^/]+\.)?arena\.ai\//i.test(String(url || ""));
}

async function checkArticlePresence(tabId) {
	try {
		const [result] = await chrome.scripting.executeScript({
			target: { tabId },
			func: () => {
				const articles = document.querySelectorAll("article");
				let largest = 0;

				for (const el of articles) {
					const text = String(el.innerText || el.textContent || "").trim();
					if (text.length > largest) {
						largest = text.length;
					}
				}

				return { count: articles.length, chars: largest };
			},
		});

		return result?.result || { count: 0, chars: 0 };
	} catch (_error) {
		return { count: 0, chars: 0 };
	}
}

async function extractArticleFromTab(tabId) {
	await chrome.scripting.executeScript({
		target: { tabId },
		files: ["articleExtractor.js"],
	});

	const [result] = await chrome.scripting.executeScript({
		target: { tabId },
		func: () => {
			if (typeof globalThis.__arenaExtractArticle !== "function") {
				return { ok: false, reason: "Extractor is not available" };
			}
			return globalThis.__arenaExtractArticle();
		},
	});

	return result?.result || { ok: false, reason: "Empty extraction result" };
}

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

function renderArticlePrompt(template, article) {
	const source = String(template || "");
	const text = String(article?.markdown || "");
	const title = String(article?.title || "").trim();
	const url = String(article?.url || "").trim();

	const hasArticleSlot = source.includes("{article}");
	const head = source.replaceAll("{title}", title).replaceAll("{url}", url).replaceAll("{article}", text);

	return hasArticleSlot ? head : `${head}\n\n\`\`\`\n${text}\n\`\`\``;
}

function buildArticleChatUrl(model) {
	const id = String(model || "").trim() || ArenaShared.DEFAULT_ARTICLE_MODEL;
	const url = new URL("https://arena.ai/text/direct");
	url.searchParams.set("model_a", id);
	return url.toString();
}

function renderVideoPrompt(template, video) {
	const source = String(template || "");
	const subtitles = String(video?.subtitles || "");
	const title = String(video?.title || "").trim();
	const url = String(video?.url || "").trim();

	const hasSlot = source.includes("{subtitles}");
	const head = source.replaceAll("{title}", title).replaceAll("{url}", url).replaceAll("{subtitles}", subtitles);

	return hasSlot ? head : `${head}\n\n\`\`\`\n${subtitles}\n\`\`\``;
}

function buildVideoChatUrl(model) {
	const id = String(model || "").trim() || ArenaShared.DEFAULT_VIDEO_MODEL;
	const url = new URL("https://arena.ai/text/direct");
	url.searchParams.set("model_a", id);
	return url.toString();
}

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

function renderButtonList(root, items, tab, emptyText) {
	root.replaceChildren();

	if (!Array.isArray(items) || items.length === 0) {
		const empty = document.createElement("div");
		empty.className = "empty";
		empty.textContent = emptyText;
		root.appendChild(empty);
		return;
	}

	for (const item of items) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "prompt";
		button.textContent = item.name || "Untitled";
		button.disabled = !isArenaTab(tab);
		button.addEventListener("click", async () => {
			const result = await sendToTab(tab.id, {
				type: "ARENA_INSERT_PROMPT",
				text: item.text || "",
			});

			if (!result?.ok) {
				statusEl.textContent = result?.error || t("popupInsertPromptFailed");
				return;
			}

			window.close();
		});
		root.appendChild(button);
	}
}

async function openChatTemplate(template) {
	const url = ArenaChatTemplates.buildUrl(template);
	const prompt = String(template?.prompt || "");

	if (prompt) {
		await chrome.storage.local.set({
			pendingChatPrompt: prompt,
			pendingChatUrl: url,
		});
	} else {
		await chrome.storage.local.remove(["pendingChatPrompt", "pendingChatUrl"]);
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

async function renderArticleSection(tab) {
	if (!articleSection) {
		return;
	}

	if (!isHttpTab(tab) || isArenaUrl(tab.url) || isYouTubeVideoUrl(tab.url)) {
		articleSection.hidden = true;
		return;
	}

	articleSection.hidden = false;
	explainArticleButton.disabled = true;
	explainArticleButton.textContent = t("popupArticleButton");
	articleMeta.textContent = t("popupArticleChecking");

	const info = await checkArticlePresence(tab.id);

	if (!info || info.count === 0) {
		articleMeta.textContent = t("popupArticleNone");
		explainArticleButton.disabled = true;
		return;
	}

	articleMeta.textContent = t("popupArticleCount", [String(info.count), Number(info.chars || 0).toLocaleString()]);
	explainArticleButton.disabled = false;
	explainArticleButton.dataset.tabId = String(tab.id);
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

if (explainArticleButton) {
	explainArticleButton.addEventListener("click", async () => {
		const tabId = Number(explainArticleButton.dataset.tabId || 0);
		if (!tabId) {
			articleMeta.textContent = t("popupArticleNoTarget");
			return;
		}

		explainArticleButton.disabled = true;
		articleMeta.textContent = t("popupArticleExtracting");

		try {
			const extracted = await extractArticleFromTab(tabId);
			if (!extracted?.ok) {
				throw new Error(extracted?.reason || "Failed to extract article");
			}

			const stored = await chrome.storage.local.get({
				articleTemplate: ArenaShared.DEFAULT_ARTICLE_TEMPLATE,
				articleModel: ArenaShared.DEFAULT_ARTICLE_MODEL,
			});

			const template = String(stored.articleTemplate || ArenaShared.DEFAULT_ARTICLE_TEMPLATE);
			const model = String(stored.articleModel || ArenaShared.DEFAULT_ARTICLE_MODEL).trim();

			const prompt = renderArticlePrompt(template, extracted);
			const url = buildArticleChatUrl(model);

			await chrome.storage.local.set({
				pendingChatPrompt: prompt,
				pendingChatUrl: url,
				pendingChatAutoSend: true,
				pendingChatAutoSendUntil: Date.now() + 5 * 60 * 1000,
			});

			await chrome.tabs.create({ url, active: true });
			window.close();
		} catch (error) {
			articleMeta.textContent = error instanceof Error ? error.message : String(error);
			explainArticleButton.disabled = false;
		}
	});
}

if (explainVideoButton) {
	explainVideoButton.addEventListener("click", async () => {
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

			const prompt = renderVideoPrompt(template, extracted);
			const url = buildVideoChatUrl(model);

			await chrome.storage.local.set({
				pendingChatPrompt: prompt,
				pendingChatUrl: url,
				pendingChatAutoSend: true,
				pendingChatAutoSendUntil: Date.now() + 5 * 60 * 1000,
			});

			await chrome.tabs.create({ url, active: true });
			window.close();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			videoMeta.textContent = message;
			explainVideoButton.disabled = false;
			console.warn("[arena-utils] YouTube extraction failed:", error);
		}
	});
}

void init();
