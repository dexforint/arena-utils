const autoscroll = document.getElementById("autoscroll");
const collapseCode = document.getElementById("collapse-code");
const exportButton = document.getElementById("export");
const pickFolderButton = document.getElementById("pick-folder");
const promptsRoot = document.getElementById("prompts");
const promptsTitle = document.getElementById("prompts-title");
const promptsEdit = document.getElementById("prompts-edit");
const codebaseRoot = document.getElementById("codebase");
const codebaseMeta = document.getElementById("codebase-meta");
const statusEl = document.getElementById("status");
const bookmarksRoot = document.getElementById("bookmarks");
const bookmarksCount = document.getElementById("bookmarks-count");
const articleSection = document.getElementById("article-section");
const articleMeta = document.getElementById("article-meta");
const explainArticleButton = document.getElementById("explain-article");

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

				return {
					count: articles.length,
					chars: largest,
				};
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
				statusEl.textContent = result?.error || "Could not insert prompt";
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
	promptsTitle.textContent = "New chat";
	promptsEdit.href = "options.html#chat-templates";
	promptsRoot.replaceChildren();

	if (!Array.isArray(templates) || templates.length === 0) {
		const empty = document.createElement("div");
		empty.className = "empty";
		empty.textContent = "No templates yet. Open Edit to add some.";
		promptsRoot.appendChild(empty);
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
		promptsRoot.appendChild(button);
	}
}

function renderCodebase(snapshot, tab) {
	if (snapshot?.chunks?.length) {
		codebaseMeta.textContent = `${snapshot.folderName} · ${snapshot.stats.parts} parts · ${snapshot.stats.characters} chars`;
		renderButtonList(
			codebaseRoot,
			snapshot.chunks.map((chunk) => ({
				name: `${chunk.name} (${chunk.chars})`,
				text: chunk.text,
			})),
			tab,
			"",
		);
		return;
	}

	codebaseMeta.textContent = "";
	renderButtonList(codebaseRoot, [], tab, "No snapshot yet. Click Select folder…");
}

function renderBookmarks(bookmarks) {
	if (!bookmarksRoot) {
		return;
	}

	bookmarksRoot.replaceChildren();

	if (!Array.isArray(bookmarks) || bookmarks.length === 0) {
		const empty = document.createElement("div");
		empty.className = "empty";
		empty.textContent = "No bookmarks yet. Open a chat and click ☆.";
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

		const openBtn = document.createElement("button");
		openBtn.type = "button";
		openBtn.className = "bookmark-open";
		openBtn.title = bookmark.url || "";
		openBtn.setAttribute("aria-label", `Open chat ${bookmark.title || bookmark.id || ""}`);

		const titleEl = document.createElement("span");
		titleEl.className = "bookmark-title";
		titleEl.textContent = bookmark.title || bookmark.id || "Untitled";
		openBtn.appendChild(titleEl);

		openBtn.addEventListener("click", async () => {
			if (!bookmark.url) {
				statusEl.textContent = "Bookmark has no URL";
				return;
			}

			await chrome.tabs.create({ url: bookmark.url, active: true });
			window.close();
		});

		const deleteBtn = document.createElement("button");
		deleteBtn.type = "button";
		deleteBtn.className = "bookmark-delete";
		deleteBtn.title = "Remove bookmark";
		deleteBtn.setAttribute("aria-label", "Remove bookmark");
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

	if (!isHttpTab(tab) || isArenaUrl(tab.url)) {
		articleSection.hidden = true;
		return;
	}

	articleSection.hidden = false;
	explainArticleButton.disabled = true;
	articleMeta.textContent = "Checking page…";

	const info = await checkArticlePresence(tab.id);

	if (!info || info.count === 0) {
		articleMeta.textContent = "No <article> element on this page";
		explainArticleButton.disabled = true;
		return;
	}

	const count = info.count;
	const chars = info.chars || 0;
	articleMeta.textContent = `${count} article${count > 1 ? "s" : ""} · ~${chars.toLocaleString()} characters`;
	explainArticleButton.disabled = false;
	explainArticleButton.dataset.tabId = String(tab.id);
}

async function init() {
	const tab = await getActiveTab();
	const stored = await chrome.storage.local.get({
		disableAutoscroll: false,
		collapseCodeBlocks: true,
		prompts: [],
		chatTemplates: [],
		codebaseSnapshot: null,
		bookmarks: [],
	});

	autoscroll.checked = Boolean(stored.disableAutoscroll);
	collapseCode.checked = stored.collapseCodeBlocks !== false;
	renderCodebase(stored.codebaseSnapshot, tab);
	renderBookmarks(stored.bookmarks);
	void renderArticleSection(tab);

	pickFolderButton.addEventListener("click", async () => {
		await chrome.tabs.create({
			url: chrome.runtime.getURL("options.html#codebase"),
			active: true,
		});
		window.close();
	});

	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== "local") {
			return;
		}

		if (changes.codebaseSnapshot) {
			renderCodebase(changes.codebaseSnapshot.newValue, tab);
		}

		if (changes.prompts && isArenaTab(tab)) {
			renderButtonList(promptsRoot, changes.prompts.newValue || [], tab, "No prompts yet. Open Edit to add some.");
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

	collapseCode.addEventListener("change", async () => {
		await chrome.storage.local.set({
			collapseCodeBlocks: collapseCode.checked,
		});
	});

	if (!isArenaTab(tab)) {
		applyTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
		statusEl.textContent = "Open a template to start a chat";
		exportButton.disabled = true;
		renderChatTemplates(stored.chatTemplates);
		return;
	}

	renderButtonList(promptsRoot, stored.prompts, tab, "No prompts yet. Open Edit to add some.");

	const status = await sendToTab(tab.id, { type: "ARENA_GET_STATUS" });
	applyTheme(status?.theme === "dark" ? "dark" : "light");
	statusEl.textContent = status?.ok ? `${status.messageCount || 0} messages on this page` : "Reload the arena.ai tab after updating the extension";
	exportButton.disabled = false;

	exportButton.addEventListener("click", async () => {
		exportButton.disabled = true;
		statusEl.textContent = "Exporting…";
		const result = await sendToTab(tab.id, { type: "ARENA_EXPORT_START" });
		if (!result?.ok) {
			statusEl.textContent = result?.error || "Export failed";
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
			articleMeta.textContent = "No target tab";
			return;
		}

		explainArticleButton.disabled = true;
		articleMeta.textContent = "Extracting article…";

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

void init();
