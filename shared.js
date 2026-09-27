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

	function sanitizeFileName(value, fallback = "arena-export") {
		let name = String(value ?? "")
			.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
			.trim();

		// Windows не любит хвостовые точки и пробелы
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

	const DEFAULT_ARTICLE_MODEL = "gemini-3.8-flash-high";

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
		BOOKMARKS_KEY,
		getBookmarks,
		setBookmarks,
		DEFAULT_ARTICLE_MODEL,
		DEFAULT_ARTICLE_TEMPLATE,
	};
})();
