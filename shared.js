(() => {
	if (globalThis.ArenaShared) {
		return;
	}

	const WINDOWS_RESERVED = new Set([
		"con",
		"prn",
		"aux",
		"nul",
		"com1",
		"com2",
		"com3",
		"com4",
		"com5",
		"com6",
		"com7",
		"com8",
		"com9",
		"lpt1",
		"lpt2",
		"lpt3",
		"lpt4",
		"lpt5",
		"lpt6",
		"lpt7",
		"lpt8",
		"lpt9",
	]);

	const DEFAULT_PROMPT_MAX_CHARS = 100000;
	const MIN_PROMPT_MAX_CHARS = 1000;
	const FRAGMENT_FENCE_MIN = 4;
	const MAX_SPLIT_ITERATIONS = 100000;

	// ------------------------------------------------------------------
	// i18n (работает и в SW, и в popup, и в content script)
	// ------------------------------------------------------------------

	function t(key, subs) {
		if (!key) {
			return "";
		}

		try {
			if (typeof chrome === "undefined" || !chrome?.i18n?.getMessage) {
				return key;
			}

			const list = Array.isArray(subs) ? subs.map((item) => String(item ?? "")) : subs != null ? [String(subs)] : undefined;

			return chrome.i18n.getMessage(key, list) || key;
		} catch (_error) {
			return key;
		}
	}

	// ------------------------------------------------------------------
	// Базовые утилиты
	// ------------------------------------------------------------------

	function sanitizeFileName(value, fallback = "arena-export") {
		let name = String(value ?? "")
			.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
			.trim();

		name = name.replace(/[.\s]+$/g, "").slice(0, 120);

		if (!name) {
			return fallback;
		}

		const base = name.includes(".") ? name.slice(0, name.indexOf(".")) : name;
		if (WINDOWS_RESERVED.has(base.toLowerCase())) {
			name = `_${name}`;
		}

		return name || fallback;
	}

	function prefixListItem(block, marker, indent) {
		const lines = String(block ?? "").split("\n");
		return lines
			.map((line, index) => {
				if (index === 0) {
					return `${marker}${line}`;
				}

				return line ? `${indent}${line}` : "";
			})
			.join("\n");
	}

	function normalizeMarkdown(text) {
		return `${String(text ?? "")
			.replace(/\r\n/g, "\n")
			.trimEnd()}\n`;
	}

	// ------------------------------------------------------------------
	// Вырезание ссылок
	// ------------------------------------------------------------------
	//
	// Ссылки в промпте — лишний объём: они не помогают модели понять текст,
	// но заметно увеличивают размер сообщения. Текст ссылки сохраняем,
	// URL выкидываем вместе с синтаксисом.

	const MARKDOWN_LINK_RE = /(!?)\[([^\]]*)\]\(\s*(?:<[^>]*>|[^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\s*\)/g;
	const AUTOLINK_RE = /<https?:\/\/[^>\s]+>/gi;
	const BARE_URL_RE = /https?:\/\/[^\s<>()[\]{}"'`]+/gi;

	function stripUrls(markdown) {
		let text = String(markdown ?? "");
		if (!text) {
			return "";
		}

		// [текст](url) → текст; ![alt](url) → alt
		text = text.replace(MARKDOWN_LINK_RE, (_match, _bang, label) => String(label || "").trim());

		// <https://…> → пусто
		text = text.replace(AUTOLINK_RE, "");

		// Голые URL → пусто
		text = text.replace(BARE_URL_RE, "");

		// Подчистка осиротевших скобок/пробелов/пустых строк
		text = text.replace(/\(\s*\)/g, "");
		text = text.replace(/[ \t]{2,}/g, " ");
		text = text.replace(/[ \t]+([.,;:!?])/g, "$1");
		text = text.replace(/^[ \t]+/gm, "");
		text = text.replace(/\n{3,}/g, "\n\n");

		return text.trim();
	}

	// ------------------------------------------------------------------
	// Лимит и нарезка текста
	// ------------------------------------------------------------------

	function clampPromptChars(value) {
		const number = Number(value);

		if (!Number.isFinite(number) || number <= 0) {
			return DEFAULT_PROMPT_MAX_CHARS;
		}

		return Math.max(MIN_PROMPT_MAX_CHARS, Math.floor(number));
	}

	function safeCutIndex(text, size) {
		if (size <= 0 || size >= text.length) {
			return text.length;
		}

		// Не разрываем суррогатную пару.
		const code = text.charCodeAt(size - 1);
		if (code >= 0xd800 && code <= 0xdbff) {
			return size - 1;
		}

		return size;
	}

	function hardSplit(text, size) {
		const result = [];
		let rest = String(text ?? "");
		let guard = 0;

		while (rest.length > size && guard < MAX_SPLIT_ITERATIONS) {
			guard += 1;

			let cut = rest.lastIndexOf(" ", size);
			if (cut < size * 0.5) {
				cut = safeCutIndex(rest, size);
			}

			result.push(rest.slice(0, cut).trimEnd());
			rest = rest.slice(cut).trimStart();
		}

		if (rest) {
			result.push(rest);
		}

		return result;
	}

	function splitParagraph(paragraph, size) {
		const result = [];
		const lines = String(paragraph).split("\n");
		let buffer = "";

		const flush = () => {
			const value = buffer.trimEnd();
			if (value) {
				result.push(value);
			}
			buffer = "";
		};

		for (const line of lines) {
			if (line.length > size) {
				flush();

				for (const piece of hardSplit(line, size)) {
					result.push(piece);
				}
				continue;
			}

			if (!buffer) {
				buffer = line;
			} else if (buffer.length + 1 + line.length <= size) {
				buffer += `\n${line}`;
			} else {
				flush();
				buffer = line;
			}
		}

		flush();
		return result;
	}

	function splitTextIntoChunks(text, maxChars) {
		const value = String(text ?? "");
		const size = clampPromptChars(maxChars);

		if (value.length <= size) {
			return [value];
		}

		const chunks = [];
		const paragraphs = value.split(/\n{2,}/);
		let buffer = "";

		const flush = () => {
			const part = buffer.trimEnd();
			if (part) {
				chunks.push(part);
			}
			buffer = "";
		};

		for (const paragraph of paragraphs) {
			if (paragraph.length > size) {
				flush();

				for (const piece of splitParagraph(paragraph, size)) {
					chunks.push(piece);
				}
				continue;
			}

			if (!buffer) {
				buffer = paragraph;
			} else if (buffer.length + 2 + paragraph.length <= size) {
				buffer += `\n\n${paragraph}`;
			} else {
				flush();
				buffer = paragraph;
			}
		}

		flush();

		return chunks.length > 0 ? chunks : [value.slice(0, size)];
	}

	// ------------------------------------------------------------------
	// Сборка промптов
	// ------------------------------------------------------------------

	function fillTemplate(source, values) {
		let result = String(source ?? "");

		for (const [key, value] of Object.entries(values || {})) {
			result = result.replaceAll(`{${key}}`, String(value ?? ""));
		}

		return result;
	}

	// {article} / {subtitles} подставляется последним: если сам текст
	// содержит {title} или {url}, они не должны быть перезаписаны.
	function renderArticlePrompt(template, document) {
		const source = String(template || "");
		const text = String(document?.markdown || "");
		const title = String(document?.title || "").trim();
		const url = String(document?.url || "").trim();
		const head = fillTemplate(source, { title, url });

		if (source.includes("{article}")) {
			return fillTemplate(head, { article: text });
		}

		return `${head}\n\n\`\`\`\n${text}\n\`\`\``;
	}

	function renderVideoPrompt(template, video) {
		const source = String(template || "");
		const subtitles = String(video?.subtitles || "");
		const title = String(video?.title || "").trim();
		const url = String(video?.url || "").trim();
		const head = fillTemplate(source, { title, url });

		if (source.includes("{subtitles}")) {
			return fillTemplate(head, { subtitles });
		}

		return `${head}\n\n\`\`\`\n${subtitles}\n\`\`\``;
	}

	function fenceFor(text) {
		const runs = String(text ?? "").match(/`{3,}/g) || [];
		const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
		return "`".repeat(Math.max(FRAGMENT_FENCE_MIN, longest + 1));
	}

	// Достаёт «задание» из шаблона: текст без плейсхолдера и без обёртки
	// в фенсы, но с подставленными {title} / {url}.
	function buildTaskTemplate(template, placeholder, document) {
		let text = String(template ?? "");

		text = text.replaceAll("{title}", String(document?.title || "").trim());
		text = text.replaceAll("{url}", String(document?.url || "").trim());

		// ```…{placeholder}…``` — снимаем вместе с обёрткой.
		const fenced = new RegExp("`{3,}[^\\n]*\\n[\\s\\S]*?\\{" + placeholder + "\\}[\\s\\S]*?\\n`{3,}", "g");
		text = text.replace(fenced, "");

		// Оставшиеся вхождения (например, без фенсов).
		text = text.replaceAll(`{${placeholder}}`, "");

		return text.replace(/\n{3,}/g, "\n\n").trim();
	}

	function buildFragmentMessages(text, task, maxChars) {
		const chunks = splitTextIntoChunks(text, maxChars);
		const total = chunks.length;

		if (total <= 1) {
			return null;
		}

		const messages = [];

		for (let index = 0; index < total; index += 1) {
			const header = t("promptFragmentHeader", [String(index + 1), String(total)]);
			const fence = fenceFor(chunks[index]);
			let message = `${header}\n${fence}\n${chunks[index]}\n${fence}`;

			if (index === 0) {
				message = `${t("promptFragmentIntro")}\n\n${message}`;
			}

			if (index === total - 1 && task) {
				message = `${message}\n\n${t("promptFragmentTask")}\n${task}`;
			}

			messages.push(message);
		}

		return messages;
	}

	// Возвращают МАССИВ сообщений: короткий текст — одно, длинный — N.
	function buildArticleMessages(document, template, maxChars) {
		const clean = {
			...(document || {}),
			markdown: stripUrls(String(document?.markdown || "")),
		};
		const limit = clampPromptChars(maxChars);

		if (clean.markdown.length <= limit) {
			return [renderArticlePrompt(template, clean)];
		}

		const task = buildTaskTemplate(template, "article", clean);
		const fragments = buildFragmentMessages(clean.markdown, task, limit);

		return fragments || [renderArticlePrompt(template, clean)];
	}

	function buildVideoMessages(video, template, maxChars) {
		const clean = {
			...(video || {}),
			subtitles: stripUrls(String(video?.subtitles || "")),
		};
		const limit = clampPromptChars(maxChars);

		if (clean.subtitles.length <= limit) {
			return [renderVideoPrompt(template, clean)];
		}

		const task = buildTaskTemplate(template, "subtitles", clean);
		const fragments = buildFragmentMessages(clean.subtitles, task, limit);

		return fragments || [renderVideoPrompt(template, clean)];
	}

	function buildDirectChatUrl(model, fallbackModel) {
		const id = String(model || "").trim() || String(fallbackModel || "").trim();
		const url = new URL("https://arena.ai/text/direct");

		if (id) {
			url.searchParams.set("model_a", id);
		}

		return url.toString();
	}

	function buildArticleChatUrl(model) {
		return buildDirectChatUrl(model, DEFAULT_ARTICLE_MODEL);
	}

	function buildVideoChatUrl(model) {
		return buildDirectChatUrl(model, DEFAULT_VIDEO_MODEL);
	}

	// ------------------------------------------------------------------
	// Закладки
	// ------------------------------------------------------------------

	const BOOKMARKS_KEY = "bookmarks";

	async function getBookmarks() {
		const stored = await chrome.storage.local.get({ [BOOKMARKS_KEY]: [] });
		return Array.isArray(stored[BOOKMARKS_KEY]) ? stored[BOOKMARKS_KEY] : [];
	}

	async function setBookmarks(bookmarks) {
		await chrome.storage.local.set({
			[BOOKMARKS_KEY]: Array.isArray(bookmarks) ? bookmarks : [],
		});
	}

	// ------------------------------------------------------------------
	// Дефолты
	// ------------------------------------------------------------------

	const DEFAULT_ARTICLE_MODEL = "gemini-3.8-flash-high";
	const DEFAULT_VIDEO_MODEL = "gemini-3.8-flash-high";

	const DEFAULT_VIDEO_TEMPLATE = [
		"Понятно объясни видео со следующими субтитрами. Не упусти важные и интересные детали. Если считаешь нужным, то дай свой комментарии как специалист в данной области.",
		"```",
		"{subtitles}",
		"```",
	].join("\n");

	const DEFAULT_ARTICLE_TEMPLATE = [
		"Понятно объясни следующую статью. Не упусти важные и интересные детали. Если считаешь нужным, то ты можешь дать свои комментарии к статье как специалист в данной теме.",
		"````markdown",
		"{article}",
		"````",
	].join("\n");

	globalThis.ArenaShared = {
		sanitizeFileName,
		prefixListItem,
		normalizeMarkdown,

		stripUrls,

		clampPromptChars,
		splitTextIntoChunks,
		fillTemplate,
		renderArticlePrompt,
		renderVideoPrompt,
		buildArticleMessages,
		buildVideoMessages,
		buildDirectChatUrl,
		buildArticleChatUrl,
		buildVideoChatUrl,

		BOOKMARKS_KEY,
		getBookmarks,
		setBookmarks,

		DEFAULT_PROMPT_MAX_CHARS,
		MIN_PROMPT_MAX_CHARS,
		DEFAULT_ARTICLE_MODEL,
		DEFAULT_ARTICLE_TEMPLATE,
		DEFAULT_VIDEO_MODEL,
		DEFAULT_VIDEO_TEMPLATE,
	};
})();
