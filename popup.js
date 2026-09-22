const autoscroll = document.getElementById("autoscroll");
const exportButton = document.getElementById("export");
const promptsRoot = document.getElementById("prompts");
const codebaseRoot = document.getElementById("codebase");
const codebaseMeta = document.getElementById("codebase-meta");
const statusEl = document.getElementById("status");

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

async function init() {
	const tab = await getActiveTab();
	const stored = await chrome.storage.local.get({
		disableAutoscroll: false,
		prompts: [],
		codebaseSnapshot: null,
	});

	autoscroll.checked = Boolean(stored.disableAutoscroll);
	renderButtonList(promptsRoot, stored.prompts, tab, "No prompts yet. Open Edit to add some.");

	const snapshot = stored.codebaseSnapshot;
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
	} else {
		codebaseMeta.textContent = "";
		renderButtonList(codebaseRoot, [], tab, "No snapshot yet. Open Prepare and select a folder.");
	}

	if (!isArenaTab(tab)) {
		statusEl.textContent = "Open an arena.ai chat first";
		exportButton.disabled = true;
		return;
	}

	const status = await sendToTab(tab.id, { type: "ARENA_GET_STATUS" });
	statusEl.textContent = status?.ok ? `${status.messageCount || 0} messages on this page` : "Reload the arena.ai tab after updating the extension";
	exportButton.disabled = false;

	autoscroll.addEventListener("change", async () => {
		await chrome.storage.local.set({
			disableAutoscroll: autoscroll.checked,
		});
	});

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
