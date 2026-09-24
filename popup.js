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

async function init() {
	const tab = await getActiveTab();
	const stored = await chrome.storage.local.get({
		disableAutoscroll: false,
		collapseCodeBlocks: true,
		prompts: [],
		chatTemplates: [],
		codebaseSnapshot: null,
	});

	autoscroll.checked = Boolean(stored.disableAutoscroll);
	collapseCode.checked = stored.collapseCodeBlocks !== false;
	renderCodebase(stored.codebaseSnapshot, tab);

	pickFolderButton.addEventListener("click", async () => {
		await chrome.windows.create({
			url: chrome.runtime.getURL("options.html#codebase"),
			type: "popup",
			width: 560,
			height: 780,
			focused: true,
		});
	});

	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === "local" && changes.codebaseSnapshot) {
			renderCodebase(changes.codebaseSnapshot.newValue, tab);
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

void init();
