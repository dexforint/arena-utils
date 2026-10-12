const t = (key, subs) => globalThis.ArenaI18n?.t(key, subs) || key;

const list = document.getElementById("list");
const addButton = document.getElementById("add");
const collapseCodeInput = document.getElementById("collapse-code");
const templateList = document.getElementById("template-list");
const addTemplateButton = document.getElementById("add-template");
const maxCharsInput = document.getElementById("max-chars");
const gitignoreInput = document.getElementById("use-gitignore");
const excludeInput = document.getElementById("exclude");
const contentExcludeInput = document.getElementById("content-exclude");
const codebaseStatusEl = document.getElementById("codebase-status");
const articleModelInput = document.getElementById("article-model");
const articleTemplateInput = document.getElementById("article-template");
const resetArticleTemplateButton = document.getElementById("reset-article-template");
const videoModelInput = document.getElementById("video-model");
const videoTemplateInput = document.getElementById("video-template");
const resetVideoTemplateButton = document.getElementById("reset-video-template");
const promptMaxCharsInput = document.getElementById("prompt-max-chars");

let prompts = [];
let chatTemplates = [];

function uid() {
	if (crypto.randomUUID) {
		return crypto.randomUUID();
	}

	return `prompt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createDebounced(fn, delayMs) {
	let timer = 0;

	function schedule() {
		window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			timer = 0;
			fn();
		}, delayMs);
	}

	schedule.flush = () => {
		if (!timer) {
			return;
		}
		window.clearTimeout(timer);
		timer = 0;
		fn();
	};

	return schedule;
}

const scheduleSave = createDebounced(() => {
	void chrome.storage.local.set({ prompts });
}, 200);

const scheduleTemplateSave = createDebounced(() => {
	void chrome.storage.local.set({ chatTemplates });
}, 200);

const scheduleArticleSave = createDebounced(() => {
	const model = String(articleModelInput.value || "").trim() || ArenaShared.DEFAULT_ARTICLE_MODEL;
	const template = String(articleTemplateInput.value || "");
	const maxChars = ArenaShared.clampPromptChars(Number(promptMaxCharsInput.value));

	void chrome.storage.local.set({
		articleModel: model,
		articleTemplate: template,
		promptMaxChars: maxChars,
	});
}, 300);

const scheduleVideoSave = createDebounced(() => {
	const model = String(videoModelInput.value || "").trim() || ArenaShared.DEFAULT_VIDEO_MODEL;
	const template = String(videoTemplateInput.value || "");

	void chrome.storage.local.set({
		videoModel: model,
		videoTemplate: template,
	});
}, 300);

const scheduleCodebaseSave = createDebounced(() => {
	void chrome.storage.local.set({
		codebaseSettings: readCodebaseSettings(),
	});

	if (codebaseStatusEl) {
		codebaseStatusEl.textContent = t("optionsCodebaseSaved");
		window.setTimeout(() => {
			if (codebaseStatusEl.textContent === t("optionsCodebaseSaved")) {
				codebaseStatusEl.textContent = "";
			}
		}, 1500);
	}
}, 250);

window.addEventListener("pagehide", () => {
	scheduleSave.flush();
	scheduleTemplateSave.flush();
	scheduleArticleSave.flush();
	scheduleVideoSave.flush();
	scheduleCodebaseSave.flush();
});

function readCodebaseSettings() {
	return {
		maxChars: Number(maxCharsInput.value) || 100000,
		gitignore: gitignoreInput.checked,
		exclude: excludeInput.value,
		contentExclude: contentExcludeInput.value,
	};
}

function applyCodebaseSettings(settings) {
	maxCharsInput.value = String(settings.maxChars ?? 100000);
	gitignoreInput.checked = Boolean(settings.gitignore);
	excludeInput.value = settings.exclude ?? window.ArenaCodebase.DEFAULT_FULL_EXCLUDE.join("\n");
	contentExcludeInput.value = settings.contentExclude ?? window.ArenaCodebase.DEFAULT_CONTENT_EXCLUDE.join("\n");
}

function renderPrompts() {
	list.replaceChildren();

	if (prompts.length === 0) {
		const empty = document.createElement("div");
		empty.className = "empty";
		empty.textContent = t("optionsPromptsEmpty");
		list.appendChild(empty);
		return;
	}

	for (const prompt of prompts) {
		const card = document.createElement("article");
		card.className = "card";
		card.innerHTML = `
			<input class="name" type="text" />
			<textarea class="text"></textarea>
			<div class="card-actions">
				<button class="delete" type="button"></button>
			</div>
		`;

		const nameInput = card.querySelector(".name");
		const textInput = card.querySelector(".text");
		const deleteButton = card.querySelector(".delete");

		nameInput.placeholder = t("optionsNamePlaceholder");
		textInput.placeholder = t("optionsPromptTextPlaceholder");
		deleteButton.textContent = t("optionsDeleteButton");

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

		deleteButton.addEventListener("click", () => {
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
		empty.textContent = t("optionsTemplatesEmpty");
		templateList.appendChild(empty);
		return;
	}

	for (const template of chatTemplates) {
		const card = document.createElement("article");
		card.className = "card";
		card.innerHTML = `
			<input class="name" type="text" />
			<div class="template-grid">
				<label class="field">
					<span class="label-chat-type"></span>
					<select class="chat-type"></select>
				</label>
				<label class="field category-field">
					<span class="label-category"></span>
					<select class="category"></select>
				</label>
				<label class="field model-a-field">
					<span class="label-model-a"></span>
					<input class="model-a" type="text" placeholder="gemini-3.8-flash-high" spellcheck="false" />
				</label>
				<label class="field model-b-field">
					<span class="label-model-b"></span>
					<input class="model-b" type="text" placeholder="claude-sonnet-4-6-search" spellcheck="false" />
				</label>
			</div>
			<label class="field">
				<span class="label-initial-prompt"></span>
				<textarea class="prompt-text"></textarea>
			</label>
			<p class="url-preview"></p>
			<div class="card-actions">
				<button class="delete" type="button"></button>
			</div>
		`;

		const nameInput = card.querySelector(".name");
		const typeSelect = card.querySelector(".chat-type");
		const categorySelect = card.querySelector(".category");
		const modelAInput = card.querySelector(".model-a");
		const modelBInput = card.querySelector(".model-b");
		const promptInput = card.querySelector(".prompt-text");
		const deleteButton = card.querySelector(".delete");

		card.querySelector(".label-chat-type").textContent = t("optionsChatTypeLabel");
		card.querySelector(".label-category").textContent = t("optionsCategoryLabel");
		card.querySelector(".label-model-a").textContent = t("optionsModelALabel");
		card.querySelector(".label-model-b").textContent = t("optionsModelBLabel");
		card.querySelector(".label-initial-prompt").textContent = t("optionsInitialPromptLabel");
		nameInput.placeholder = t("optionsTemplateNamePlaceholder");
		promptInput.placeholder = t("optionsTemplatePromptPlaceholder");
		deleteButton.textContent = t("optionsDeleteButton");

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

		deleteButton.addEventListener("click", () => {
			chatTemplates = chatTemplates.filter((item) => item.id !== template.id);
			scheduleTemplateSave();
			renderTemplates();
		});

		templateList.appendChild(card);
	}
}

function applyOptionsTheme() {
	const mode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
	document.documentElement.dataset.theme = mode;
	document.documentElement.style.colorScheme = mode;
}

addButton.addEventListener("click", () => {
	prompts.push({
		id: uid(),
		name: t("optionsNewPromptName"),
		text: "",
	});
	scheduleSave();
	renderPrompts();
});

addTemplateButton.addEventListener("click", () => {
	chatTemplates.push({
		id: uid(),
		name: t("optionsNewTemplateName"),
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

for (const input of [maxCharsInput, gitignoreInput, excludeInput, contentExcludeInput]) {
	input.addEventListener("input", scheduleCodebaseSave);
	input.addEventListener("change", scheduleCodebaseSave);
}

articleModelInput.addEventListener("input", scheduleArticleSave);
articleTemplateInput.addEventListener("input", scheduleArticleSave);

resetArticleTemplateButton.addEventListener("click", () => {
	articleModelInput.value = ArenaShared.DEFAULT_ARTICLE_MODEL;
	articleTemplateInput.value = ArenaShared.DEFAULT_ARTICLE_TEMPLATE;
	scheduleArticleSave();
});

videoModelInput.addEventListener("input", scheduleVideoSave);
videoTemplateInput.addEventListener("input", scheduleVideoSave);

resetVideoTemplateButton.addEventListener("click", () => {
	videoModelInput.value = ArenaShared.DEFAULT_VIDEO_MODEL;
	videoTemplateInput.value = ArenaShared.DEFAULT_VIDEO_TEMPLATE;
	scheduleVideoSave();
});

promptMaxCharsInput.addEventListener("input", scheduleArticleSave);
promptMaxCharsInput.addEventListener("change", scheduleArticleSave);

async function init() {
	globalThis.ArenaI18n?.apply();
	applyOptionsTheme();
	window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyOptionsTheme);

	const stored = await chrome.storage.local.get({
		prompts: [],
		collapseCodeBlocks: true,
		chatTemplates: ArenaChatTemplates.DEFAULTS,
		codebaseSettings: null,
		articleModel: ArenaShared.DEFAULT_ARTICLE_MODEL,
		articleTemplate: ArenaShared.DEFAULT_ARTICLE_TEMPLATE,
		videoModel: ArenaShared.DEFAULT_VIDEO_MODEL,
		videoTemplate: ArenaShared.DEFAULT_VIDEO_TEMPLATE,
		promptMaxChars: ArenaShared.DEFAULT_PROMPT_MAX_CHARS,
	});

	prompts = Array.isArray(stored.prompts) ? stored.prompts : [];
	chatTemplates = Array.isArray(stored.chatTemplates) ? stored.chatTemplates : [];
	renderPrompts();
	renderTemplates();

	collapseCodeInput.checked = stored.collapseCodeBlocks !== false;

	articleModelInput.value = String(stored.articleModel || ArenaShared.DEFAULT_ARTICLE_MODEL);
	articleTemplateInput.value = String(stored.articleTemplate || ArenaShared.DEFAULT_ARTICLE_TEMPLATE);
	videoModelInput.value = String(stored.videoModel || ArenaShared.DEFAULT_VIDEO_MODEL);
	videoTemplateInput.value = String(stored.videoTemplate || ArenaShared.DEFAULT_VIDEO_TEMPLATE);
	promptMaxCharsInput.value = String(ArenaShared.clampPromptChars(stored.promptMaxChars));

	applyCodebaseSettings(
		stored.codebaseSettings || {
			maxChars: 100000,
			gitignore: false,
			exclude: window.ArenaCodebase.DEFAULT_FULL_EXCLUDE.join("\n"),
			contentExclude: window.ArenaCodebase.DEFAULT_CONTENT_EXCLUDE.join("\n"),
		},
	);

	if (location.hash === "#codebase") {
		document.getElementById("codebase")?.scrollIntoView();
	} else if (location.hash === "#chat-templates") {
		document.getElementById("chat-templates")?.scrollIntoView();
	} else if (location.hash === "#prompts") {
		document.getElementById("prompts")?.scrollIntoView();
	}
}

void init();
