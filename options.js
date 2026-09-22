const list = document.getElementById("list");
const addButton = document.getElementById("add");
const pickFolderButton = document.getElementById("pick-folder");
const generateButton = document.getElementById("generate");
const clearButton = document.getElementById("clear-codebase");
const folderNameEl = document.getElementById("folder-name");
const maxCharsInput = document.getElementById("max-chars");
const gitignoreInput = document.getElementById("use-gitignore");
const excludeInput = document.getElementById("exclude");
const contentExcludeInput = document.getElementById("content-exclude");
const statusEl = document.getElementById("codebase-status");
const chunkList = document.getElementById("chunk-list");

const IDB_NAME = "arena-utils";
const IDB_STORE = "handles";

let saveTimer = 0;
let prompts = [];
let dirHandle = null;
let generating = false;

function uid() {
	if (crypto.randomUUID) {
		return crypto.randomUUID();
	}

	return `prompt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function scheduleSave() {
	window.clearTimeout(saveTimer);
	saveTimer = window.setTimeout(() => {
		void chrome.storage.local.set({ prompts });
	}, 200);
}

function renderPrompts() {
	list.replaceChildren();

	if (prompts.length === 0) {
		const empty = document.createElement("div");
		empty.className = "empty";
		empty.textContent = "No prompts yet. Add one and it will show up in the popup.";
		list.appendChild(empty);
		return;
	}

	for (const prompt of prompts) {
		const card = document.createElement("article");
		card.className = "card";
		card.innerHTML = `
			<input class="name" type="text" placeholder="Name" />
			<textarea class="text" placeholder="Prompt text"></textarea>
			<div class="card-actions">
				<button class="delete" type="button">Delete</button>
			</div>
		`;

		const nameInput = card.querySelector(".name");
		const textInput = card.querySelector(".text");
		nameInput.value = prompt.name || "";
		textInput.value = prompt.text || "";

		nameInput.addEventListener("input", () => {
			prompt.name = nameInput.value;
			scheduleSave();
		});

		textInput.addEventListener("input", () => {
			prompt.text = textInput.value;
			scheduleSave();
		});

		card.querySelector(".delete").addEventListener("click", () => {
			prompts = prompts.filter((item) => item.id !== prompt.id);
			scheduleSave();
			renderPrompts();
		});

		list.appendChild(card);
	}
}

function formatChars(value) {
	return new Intl.NumberFormat().format(value);
}

function setStatus(text) {
	statusEl.textContent = text;
}

function renderSnapshot(snapshot) {
	chunkList.replaceChildren();

	if (!snapshot?.chunks?.length) {
		return;
	}

	for (const chunk of snapshot.chunks) {
		const row = document.createElement("div");
		row.className = "chunk";
		row.innerHTML = `<strong></strong><span class="muted"></span>`;
		row.querySelector("strong").textContent = chunk.name;
		row.querySelector("span").textContent = `${formatChars(chunk.chars)} characters`;
		chunkList.appendChild(row);
	}
}

function currentSettings() {
	return {
		maxChars: Number(maxCharsInput.value) || 100000,
		gitignore: gitignoreInput.checked,
		exclude: excludeInput.value,
		contentExclude: contentExcludeInput.value,
	};
}

function applySettings(settings) {
	maxCharsInput.value = String(settings.maxChars ?? 100000);
	gitignoreInput.checked = Boolean(settings.gitignore);
	excludeInput.value = settings.exclude ?? window.ArenaCodebase.DEFAULT_FULL_EXCLUDE.join("\n");
	contentExcludeInput.value = settings.contentExclude ?? window.ArenaCodebase.DEFAULT_CONTENT_EXCLUDE.join("\n");
}

async function saveSettings() {
	await chrome.storage.local.set({
		codebaseSettings: currentSettings(),
	});
}

function openHandlesDb() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(IDB_NAME, 1);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(IDB_STORE)) {
				request.result.createObjectStore(IDB_STORE);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function saveDirHandle(handle) {
	const db = await openHandlesDb();
	await new Promise((resolve, reject) => {
		const tx = db.transaction(IDB_STORE, "readwrite");
		tx.objectStore(IDB_STORE).put(handle, "codebaseDir");
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

async function loadDirHandle() {
	const db = await openHandlesDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(IDB_STORE, "readonly");
		const request = tx.objectStore(IDB_STORE).get("codebaseDir");
		request.onsuccess = () => resolve(request.result || null);
		request.onerror = () => reject(request.error);
	});
}

async function ensurePermission(handle) {
	const options = { mode: "read" };
	if ((await handle.queryPermission(options)) === "granted") {
		return true;
	}

	return (await handle.requestPermission(options)) === "granted";
}

function updateFolderLabel() {
	folderNameEl.textContent = dirHandle ? dirHandle.name : "No folder selected";
}

addButton.addEventListener("click", () => {
	prompts.push({
		id: uid(),
		name: "New prompt",
		text: "",
	});
	scheduleSave();
	renderPrompts();
});

pickFolderButton.addEventListener("click", async () => {
	try {
		const handle = await window.showDirectoryPicker({
			mode: "read",
		});
		dirHandle = handle;
		await saveDirHandle(handle);
		updateFolderLabel();
		setStatus(`Folder selected: ${handle.name}`);
	} catch (error) {
		if (error?.name !== "AbortError") {
			setStatus(error instanceof Error ? error.message : String(error));
		}
	}
});

for (const input of [maxCharsInput, gitignoreInput, excludeInput, contentExcludeInput]) {
	input.addEventListener("change", () => {
		void saveSettings();
	});
}

generateButton.addEventListener("click", async () => {
	if (generating) {
		return;
	}

	if (!dirHandle) {
		setStatus("Select a folder first.");
		return;
	}

	generating = true;
	generateButton.disabled = true;
	pickFolderButton.disabled = true;

	try {
		if (!(await ensurePermission(dirHandle))) {
			throw new Error("Folder permission was not granted");
		}

		await saveSettings();
		const settings = currentSettings();
		const snapshot = await window.ArenaCodebase.generateSnapshot(
			dirHandle,
			{
				maxChars: settings.maxChars,
				gitignore: settings.gitignore,
				exclude: settings.exclude,
				contentExclude: settings.contentExclude,
			},
			(message) => setStatus(message),
		);

		await chrome.storage.local.set({ codebaseSnapshot: snapshot });
		renderSnapshot(snapshot);
		setStatus(
			`Output: ${snapshot.folderName}\n` +
				`Parts: ${snapshot.stats.parts}; characters: ${formatChars(snapshot.stats.characters)}; ` +
				`text files: ${snapshot.stats.textFiles}; skipped regular files: ${snapshot.stats.skipped}`,
		);
	} catch (error) {
		setStatus(error instanceof Error ? error.message : String(error));
	} finally {
		generating = false;
		generateButton.disabled = false;
		pickFolderButton.disabled = false;
	}
});

clearButton.addEventListener("click", async () => {
	await chrome.storage.local.remove("codebaseSnapshot");
	chunkList.replaceChildren();
	setStatus("Generated codebase prompts cleared.");
});

async function init() {
	const stored = await chrome.storage.local.get({
		prompts: [],
		codebaseSettings: null,
		codebaseSnapshot: null,
	});

	prompts = Array.isArray(stored.prompts) ? stored.prompts : [];
	renderPrompts();

	applySettings(
		stored.codebaseSettings || {
			maxChars: 100000,
			gitignore: false,
			exclude: window.ArenaCodebase.DEFAULT_FULL_EXCLUDE.join("\n"),
			contentExclude: window.ArenaCodebase.DEFAULT_CONTENT_EXCLUDE.join("\n"),
		},
	);

	if (stored.codebaseSnapshot) {
		renderSnapshot(stored.codebaseSnapshot);
		setStatus(stored.codebaseSnapshot.folderName ? `Last snapshot: ${stored.codebaseSnapshot.folderName} · ${stored.codebaseSnapshot.stats.parts} parts` : "");
	}

	try {
		dirHandle = await loadDirHandle();
		if (dirHandle && !(await ensurePermission(dirHandle))) {
			dirHandle = null;
		}
	} catch (_error) {
		dirHandle = null;
	}

	updateFolderLabel();
}

void init();
