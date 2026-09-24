const list = document.getElementById("list");
const addButton = document.getElementById("add");
const collapseCodeInput = document.getElementById("collapse-code");
const templateList = document.getElementById("template-list");
const addTemplateButton = document.getElementById("add-template");
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
let templateSaveTimer = 0;
let prompts = [];
let chatTemplates = [];
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

function scheduleTemplateSave() {
	window.clearTimeout(templateSaveTimer);
	templateSaveTimer = window.setTimeout(() => {
		void chrome.storage.local.set({ chatTemplates });
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

function fillSelect(select, items, value) {
	select.replaceChildren();

	for (const item of items) {
		const option = document.createElement("option");
		option.value = item.id;
		option.textContent = item.name;
		select.appendChild(option);
	}

	if (value && items.some((item) => item.id === value)) {
		select.value = value;
	} else if (items[0]) {
		select.value = items[0].id;
	}
}

function syncTemplateCardFields(card, template) {
	const categoryWrap = card.querySelector(".category-field");
	const modelAWrap = card.querySelector(".model-a-field");
	const modelBWrap = card.querySelector(".model-b-field");
	const categorySelect = card.querySelector(".category");
	const preview = card.querySelector(".url-preview");
	const type = template.chatType || "direct";
	const cats = ArenaChatTemplates.categoriesForType(type);

	categoryWrap.hidden = cats.length === 0;
	modelAWrap.hidden = type === "battle" || type === "agent";
	modelBWrap.hidden = type !== "side-by-side";

	if (cats.length) {
		fillSelect(categorySelect, cats, template.category);
		template.category = categorySelect.value;
	}

	preview.textContent = ArenaChatTemplates.buildUrl(template);
}

function renderTemplates() {
	templateList.replaceChildren();

	if (chatTemplates.length === 0) {
		const empty = document.createElement("div");
		empty.className = "empty";
		empty.textContent = "No chat templates yet. Add one and it will show up in the New chat panel.";
		templateList.appendChild(empty);
		return;
	}

	for (const template of chatTemplates) {
		const card = document.createElement("article");
		card.className = "card";
		card.innerHTML = `
			<input class="name" type="text" placeholder="Button name" />
			<div class="template-grid">
				<label class="field">
					<span>Chat type</span>
					<select class="chat-type"></select>
				</label>
				<label class="field category-field">
					<span>Category</span>
					<select class="category"></select>
				</label>
				<label class="field model-a-field">
					<span>Model A</span>
					<input class="model-a" type="text" placeholder="gemini-3.8-flash-high" spellcheck="false" />
				</label>
				<label class="field model-b-field">
					<span>Model B</span>
					<input class="model-b" type="text" placeholder="claude-sonnet-4-6-search" spellcheck="false" />
				</label>
			</div>
			<label class="field">
				<span>Initial prompt (optional)</span>
				<textarea class="prompt-text" placeholder="Leave empty to open an empty composer"></textarea>
			</label>
			<p class="url-preview"></p>
			<div class="card-actions">
				<button class="delete" type="button">Delete</button>
			</div>
		`;

		const nameInput = card.querySelector(".name");
		const typeSelect = card.querySelector(".chat-type");
		const categorySelect = card.querySelector(".category");
		const modelAInput = card.querySelector(".model-a");
		const modelBInput = card.querySelector(".model-b");
		const promptInput = card.querySelector(".prompt-text");

		nameInput.value = template.name || "";
		modelAInput.value = template.modelA || "";
		modelBInput.value = template.modelB || "";
		promptInput.value = template.prompt || "";
		fillSelect(typeSelect, ArenaChatTemplates.TYPES, template.chatType || "direct");
		template.chatType = typeSelect.value;
		syncTemplateCardFields(card, template);

		nameInput.addEventListener("input", () => {
			template.name = nameInput.value;
			scheduleTemplateSave();
		});

		typeSelect.addEventListener("change", () => {
			template.chatType = typeSelect.value;
			if (template.chatType !== "side-by-side") {
				template.modelB = "";
				modelBInput.value = "";
			}
			syncTemplateCardFields(card, template);
			scheduleTemplateSave();
		});

		categorySelect.addEventListener("change", () => {
			template.category = categorySelect.value;
			syncTemplateCardFields(card, template);
			scheduleTemplateSave();
		});

		modelAInput.addEventListener("input", () => {
			template.modelA = modelAInput.value.trim();
			syncTemplateCardFields(card, template);
			scheduleTemplateSave();
		});

		modelBInput.addEventListener("input", () => {
			template.modelB = modelBInput.value.trim();
			syncTemplateCardFields(card, template);
			scheduleTemplateSave();
		});

		promptInput.addEventListener("input", () => {
			template.prompt = promptInput.value;
			scheduleTemplateSave();
		});

		card.querySelector(".delete").addEventListener("click", () => {
			chatTemplates = chatTemplates.filter((item) => item.id !== template.id);
			scheduleTemplateSave();
			renderTemplates();
		});

		templateList.appendChild(card);
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

function applyOptionsTheme() {
	const mode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
	document.documentElement.dataset.theme = mode;
	document.documentElement.style.colorScheme = mode;
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

addTemplateButton.addEventListener("click", () => {
	chatTemplates.push({
		id: uid(),
		name: "New template",
		chatType: "direct",
		category: "text",
		modelA: "",
		modelB: "",
		prompt: "",
	});
	scheduleTemplateSave();
	renderTemplates();
});

collapseCodeInput.addEventListener("change", async () => {
	await chrome.storage.local.set({
		collapseCodeBlocks: collapseCodeInput.checked,
	});
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
	applyOptionsTheme();
	window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyOptionsTheme);

	const stored = await chrome.storage.local.get({
		prompts: [],
		collapseCodeBlocks: true,
		chatTemplates: ArenaChatTemplates.DEFAULTS,
		codebaseSettings: null,
		codebaseSnapshot: null,
	});

	prompts = Array.isArray(stored.prompts) ? stored.prompts : [];
	chatTemplates = Array.isArray(stored.chatTemplates) ? stored.chatTemplates : [];
	renderPrompts();
	renderTemplates();

	collapseCodeInput.checked = stored.collapseCodeBlocks !== false;

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

	if (location.hash === "#codebase") {
		document.getElementById("codebase")?.scrollIntoView();
	}

	if (location.hash === "#chat-templates") {
		document.getElementById("chat-templates")?.scrollIntoView();
	}
}

void init();
