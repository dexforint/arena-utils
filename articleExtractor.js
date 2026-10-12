// Извлекает содержимое страницы и конвертирует его в Markdown.
// Подключается через chrome.scripting.executeScript из popup.js.
//
// Экспортирует на globalThis:
//   __arenaExtractArticle()          — самый крупный <article>
//   __arenaExtractPage()             — вся страница без обвязки
//   __arenaExtractContent({ mode })  — article → Readability → страница
//
// Readability (vendor/readability.js) необязателен: если он подключён,
// используется для страниц без <article>. Иначе работает встроенная
// эвристика по <body>.

(() => {
	if (globalThis.__arenaArticleExtractorVersion >= 2) {
		return;
	}
	globalThis.__arenaArticleExtractorVersion = 2;

	const PAGE_MIN_CHARS = 200;
	const READABILITY_MIN_CHARS = 200;

	const SKIP_TAGS = new Set([
		"script",
		"style",
		"noscript",
		"template",
		"link",
		"meta",
		"svg",
		"canvas",
		"video",
		"audio",
		"iframe",
		"object",
		"embed",
		"form",
		"input",
		"textarea",
		"select",
		"option",
		"button",
		"nav",
		"aside",
	]);

	// Расширенный набор: применяется только при извлечении всей страницы.
	// Внутри <article> header/footer часто несут осмысленный контент,
	// на уровне страницы — это обвязка.
	const PAGE_SKIP_TAGS = new Set([...SKIP_TAGS, "header", "footer", "dialog", "menu", "marquee"]);

	const PAGE_SKIP_ROLES = new Set([
		"navigation",
		"banner",
		"contentinfo",
		"complementary",
		"search",
		"form",
		"dialog",
		"alertdialog",
		"menu",
		"menubar",
		"tablist",
		"toolbar",
	]);

	// Классы/идентификаторы обвязки. Границы токенов обязательны:
	// без них "uploads" или "padding" попали бы под "ad".
	const BOILERPLATE_HINT_RE =
		/(^|[-_\s])(nav|navbar|navigation|menu|sidebar|footer|header|masthead|breadcrumb|breadcrumbs|cookie|consent|banner|advert|ads|ad|promo|sponsor|social|share|sharing|comment|comments|related|recommend|subscribe|newsletter|pagination|pager|skip|toolbar|modal|popup|overlay|drawer|offcanvas|topbar|backdrop|utility)([-_\s]|$)/i;

	// Явные признаки контента перебивают эвристику выше:
	// "article-header" не должен быть вырезан как "header".
	const CONTENT_HINT_RE = /(^|[-_\s])(content|main|article|post|entry|markdown|prose|body|text|story|reader|paper|abstract)([-_\s]|$)/i;

	const PAGE_ROOT_SELECTORS = ["main", "[role='main']", ".markdown-body", ".prose", ".post-content", ".entry-content", ".article-content", "#main", "#content"];

	const BLOCK_TAGS = new Set([
		"address",
		"article",
		"blockquote",
		"details",
		"dialog",
		"dd",
		"div",
		"dl",
		"dt",
		"fieldset",
		"figcaption",
		"figure",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"header",
		"hgroup",
		"hr",
		"li",
		"main",
		"menu",
		"ol",
		"p",
		"pre",
		"section",
		"summary",
		"table",
		"tbody",
		"td",
		"tfoot",
		"th",
		"thead",
		"tr",
		"ul",
	]);

	function isHidden(node) {
		if (!node || node.nodeType !== Node.ELEMENT_NODE) {
			return false;
		}
		if (node.hidden) return true;
		if (node.getAttribute("aria-hidden") === "true") return true;
		return false;
	}

	function textLength(node) {
		return String(node?.textContent || "")
			.replace(/\s+/g, " ")
			.trim().length;
	}

	// ------------------------------------------------------------------
	// DOM → Markdown (используется и для <article>, и для всей страницы)
	// ------------------------------------------------------------------

	function inline(node) {
		if (!node) return "";

		if (node.nodeType === Node.TEXT_NODE) {
			return String(node.nodeValue || "").replace(/\s+/g, " ");
		}

		if (node.nodeType !== Node.ELEMENT_NODE) {
			return "";
		}

		const tag = node.tagName.toLowerCase();
		if (SKIP_TAGS.has(tag) || isHidden(node)) {
			return "";
		}

		if (tag === "br") return "\n";
		if (tag === "wbr") return "";
		if (tag === "img") {
			const alt = String(node.getAttribute("alt") || "").trim();
			const src = String(node.getAttribute("src") || node.getAttribute("data-src") || "").trim();
			return src ? `![${alt}](${src})` : "";
		}

		const children = () =>
			Array.from(node.childNodes)
				.map((child) => inline(child))
				.join("");

		if (tag === "strong" || tag === "b") {
			const text = children();
			return text ? `**${text}**` : "";
		}

		if (tag === "em" || tag === "i") {
			const text = children();
			return text ? `*${text}*` : "";
		}

		if (tag === "del" || tag === "s" || tag === "strike") {
			const text = children();
			return text ? `~~${text}~~` : "";
		}

		if (tag === "code") {
			const text = children().replace(/\n+$/, "");
			if (!text) return "";
			const runs = text.match(/`+/g);
			const longest = runs ? runs.reduce((max, run) => Math.max(max, run.length), 0) : 0;
			const fence = "`".repeat(Math.max(1, longest + 1));
			return `${fence}${text}${fence}`;
		}

		if (tag === "a") {
			const href = String(node.getAttribute("href") || "").trim();
			const text = children().trim();
			if (!href) return text;
			if (!text) return href;
			const strippedText = text.replace(/\/+$/, "");
			const strippedHref = href.replace(/\/+$/, "");
			return strippedText === strippedHref ? href : `[${text}](${href})`;
		}

		return children();
	}

	function hasBlockChild(node) {
		for (const child of node.children || []) {
			if (BLOCK_TAGS.has(child.tagName.toLowerCase())) {
				return true;
			}
		}
		return false;
	}

	function fencedCode(lang, text) {
		const runs = String(text).match(/`{3,}/g) || [];
		const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
		const fence = "`".repeat(Math.max(3, longest + 1));
		return `${fence}${lang}\n${text}\n${fence}`;
	}

	function serializePre(node) {
		const codeEl = node.querySelector("code");
		const target = codeEl || node;
		const className = String(target.className || "");
		const match = className.match(/language-([\w#+-]+)/i) || className.match(/lang(?:uage)?-([\w#+-]+)/i);
		const lang = match ? match[1].toLowerCase() : "";
		const text = String(target.textContent || "").replace(/\s+$/, "");
		if (!text) return "";
		return `${fencedCode(lang, text)}\n\n`;
	}

	function serializeListItem(item, marker) {
		const indent = " ".repeat(marker.length);
		const parts = [];
		const nested = [];

		for (const child of item.childNodes) {
			if (child.nodeType === Node.ELEMENT_NODE) {
				const tag = child.tagName.toLowerCase();

				if (tag === "ul" || tag === "ol") {
					nested.push(child);
					continue;
				}

				if (tag === "p") {
					const text = inline(child).trim();
					if (text) parts.push(text);
					continue;
				}

				if (SKIP_TAGS.has(tag) || isHidden(child)) {
					continue;
				}
			}

			const text = inline(child);
			if (text) parts.push(text);
		}

		const head = parts.join(" ").replace(/\s+/g, " ").trim();
		const lines = [head ? `${marker}${head}` : marker.trimEnd()];

		for (const sub of nested) {
			const rendered = serializeList(sub, sub.tagName.toLowerCase() === "ol");
			for (const line of rendered.split("\n")) {
				lines.push(`${indent}${line}`);
			}
		}

		return lines.join("\n");
	}

	function serializeList(list, ordered) {
		const items = Array.from(list.children).filter((child) => child.tagName.toLowerCase() === "li");

		const lines = [];
		for (let i = 0; i < items.length; i += 1) {
			const marker = ordered ? `${i + 1}. ` : "- ";
			lines.push(serializeListItem(items[i], marker));
		}

		return lines.join("\n");
	}

	function serializeTable(table) {
		const rows = Array.from(table.querySelectorAll("tr"));
		if (rows.length === 0) return "";

		const matrix = rows.map((row) =>
			Array.from(row.children)
				.filter((cell) => {
					const tag = cell.tagName.toLowerCase();
					return tag === "td" || tag === "th";
				})
				.map((cell) => inline(cell).replace(/\|/g, "\\|").trim()),
		);

		const maxCols = matrix.reduce((max, row) => Math.max(max, row.length), 0);
		if (maxCols === 0) return "";

		for (const row of matrix) {
			while (row.length < maxCols) row.push("");
		}

		const header = matrix[0];
		const separator = header.map(() => "---");
		const body = matrix.slice(1);

		const lines = [`| ${header.join(" | ")} |`, `| ${separator.join(" | ")} |`, ...body.map((row) => `| ${row.join(" | ")} |`)];

		return `${lines.join("\n")}\n\n`;
	}

	function serializeFigure(figure) {
		const parts = [];
		const img = figure.querySelector("img");

		if (img) {
			const alt = String(img.getAttribute("alt") || "").trim();
			const src = String(img.getAttribute("src") || img.getAttribute("data-src") || "").trim();
			if (src) parts.push(`![${alt}](${src})`);
		}

		const caption = figure.querySelector("figcaption");
		if (caption) {
			const text = inline(caption).trim();
			if (text) parts.push(`*${text}*`);
		}

		if (parts.length > 0) {
			return `${parts.join("\n\n")}\n\n`;
		}

		return serializeChildren(figure);
	}

	function serializeDefinitionList(dl) {
		const items = [];

		for (const child of dl.children) {
			const tag = child.tagName.toLowerCase();
			const text = inline(child).trim();
			if (!text) continue;

			if (tag === "dt") {
				items.push(`**${text}**`);
			} else if (tag === "dd") {
				items.push(text);
			}
		}

		return items.length > 0 ? `${items.join("\n\n")}\n\n` : "";
	}

	function serializeChildren(node) {
		const parts = [];
		let inlineBuffer = "";

		const flush = () => {
			const text = inlineBuffer.replace(/\s+/g, " ").trim();
			inlineBuffer = "";
			if (text) {
				parts.push(`${text}\n\n`);
			}
		};

		for (const child of node.childNodes) {
			if (child.nodeType === Node.TEXT_NODE) {
				const text = String(child.nodeValue || "");
				if (text.trim()) {
					inlineBuffer += text.replace(/\s+/g, " ");
				}
				continue;
			}

			if (child.nodeType !== Node.ELEMENT_NODE) {
				continue;
			}

			const tag = child.tagName.toLowerCase();
			if (SKIP_TAGS.has(tag) || isHidden(child)) {
				continue;
			}

			if (BLOCK_TAGS.has(tag)) {
				flush();
				const rendered = serializeBlock(child);
				if (rendered) parts.push(rendered);
			} else {
				inlineBuffer += inline(child);
			}
		}

		flush();

		return parts.join("").replace(/\n{3,}/g, "\n\n");
	}

	function serializeBlock(node) {
		if (!node) return "";
		if (node.nodeType === Node.TEXT_NODE) {
			return String(node.nodeValue || "").replace(/\s+/g, " ");
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return "";

		const tag = node.tagName.toLowerCase();
		if (SKIP_TAGS.has(tag) || isHidden(node)) return "";

		if (/^h[1-6]$/.test(tag)) {
			const text = inline(node).trim();
			if (!text) return "";
			return `${"#".repeat(Number(tag.slice(1)))} ${text}\n\n`;
		}

		if (tag === "p") {
			const text = inline(node).trim();
			return text ? `${text}\n\n` : "";
		}

		if (tag === "br") return "\n";
		if (tag === "hr") return "---\n\n";

		if (tag === "pre") return serializePre(node);

		if (tag === "blockquote") {
			const inner = serializeChildren(node).trim();
			if (!inner) return "";
			const quoted = inner
				.split("\n")
				.map((line) => (line ? `> ${line}` : ">"))
				.join("\n");
			return `${quoted}\n\n`;
		}

		if (tag === "ul") return `${serializeList(node, false)}\n\n`;
		if (tag === "ol") return `${serializeList(node, true)}\n\n`;

		if (tag === "table") return serializeTable(node);
		if (tag === "figure") return serializeFigure(node);
		if (tag === "dl") return serializeDefinitionList(node);

		if (tag === "img") {
			const alt = String(node.getAttribute("alt") || "").trim();
			const src = String(node.getAttribute("src") || node.getAttribute("data-src") || "").trim();
			return src ? `![${alt}](${src})\n\n` : "";
		}

		if (!hasBlockChild(node)) {
			const text = inline(node).trim();
			return text ? `${text}\n\n` : "";
		}

		return serializeChildren(node);
	}

	// ------------------------------------------------------------------
	// Заголовок
	// ------------------------------------------------------------------

	function pickTitle(root) {
		const scope = root && typeof root.querySelector === "function" ? root : document;

		const h1 = scope.querySelector("h1");
		if (h1) {
			const text = inline(h1).trim();
			if (text.length >= 3) return text;
		}

		const ogTitle = document.querySelector('meta[property="og:title"]');
		if (ogTitle) {
			const content = String(ogTitle.getAttribute("content") || "").trim();
			if (content.length >= 3) return content;
		}

		return String(document.title || "").trim();
	}

	// ------------------------------------------------------------------
	// <article>
	// ------------------------------------------------------------------

	function getArticleCandidates() {
		const nodes = Array.from(document.querySelectorAll("article"));
		const ranked = [];

		for (const el of nodes) {
			// Оставляем только самые внешние article: если внутри есть ещё один
			// <article>, берём внешний, он же включает всё содержимое.
			if (el.parentElement && el.parentElement.closest("article")) {
				continue;
			}

			const text = String(el.innerText || el.textContent || "").trim();
			if (text.length < PAGE_MIN_CHARS) {
				continue;
			}

			ranked.push({ element: el, length: text.length });
		}

		ranked.sort((a, b) => b.length - a.length);
		return ranked;
	}

	function extractArticle() {
		const candidates = getArticleCandidates();

		if (candidates.length === 0) {
			return { ok: false, reason: "No <article> element with enough text" };
		}

		const article = candidates[0].element;
		const markdown = serializeChildren(article).trim();

		if (!markdown) {
			return { ok: false, reason: "Article is empty after conversion" };
		}

		return {
			ok: true,
			markdown,
			title: pickTitle(article),
			url: location.href,
			chars: markdown.length,
			articleCount: candidates.length,
			source: "article",
		};
	}

	// ------------------------------------------------------------------
	// Вся страница
	// ------------------------------------------------------------------

	function pickPageRoot() {
		for (const selector of PAGE_ROOT_SELECTORS) {
			let node = null;

			try {
				node = document.querySelector(selector);
			} catch (_error) {
				continue;
			}

			if (node && textLength(node) >= PAGE_MIN_CHARS) {
				return node;
			}
		}

		return document.body;
	}

	function pruneWholePage(root) {
		const total = textLength(root) || 1;
		const elements = [root, ...root.querySelectorAll("*")];

		for (const element of elements) {
			// Родитель мог быть удалён раньше — тогда потомок уже не в дереве.
			if (element === root || !root.contains(element)) {
				continue;
			}

			const tag = element.tagName.toLowerCase();

			if (PAGE_SKIP_TAGS.has(tag)) {
				element.remove();
				continue;
			}

			if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") {
				element.remove();
				continue;
			}

			const role = String(element.getAttribute("role") || "")
				.trim()
				.toLowerCase();
			if (role && PAGE_SKIP_ROLES.has(role)) {
				element.remove();
				continue;
			}

			const hint = `${element.id || ""} ${typeof element.className === "string" ? element.className : ""}`.trim();
			if (!hint || CONTENT_HINT_RE.test(hint) || !BOILERPLATE_HINT_RE.test(hint)) {
				continue;
			}

			// Режем только то, что и правда похоже на обвязку:
			// маленькое само по себе или маленькое относительно страницы.
			const length = textLength(element);
			if (length < 400 || length < total * 0.1) {
				element.remove();
			}
		}
	}

	function extractPage() {
		const root = pickPageRoot();
		if (!root) {
			return { ok: false, reason: "No page content" };
		}

		const clone = root.cloneNode(true);
		pruneWholePage(clone);

		let markdown = serializeChildren(clone).trim();
		if (!markdown) {
			return { ok: false, reason: "Page is empty after conversion" };
		}

		const title = pickTitle(root);
		if (title) {
			markdown = `# ${title}\n\n${markdown}`;
		}

		return {
			ok: true,
			markdown,
			title,
			url: location.href,
			chars: markdown.length,
			source: "page",
		};
	}

	// ------------------------------------------------------------------
	// Readability (необязательный вендорный скрипт)
	// ------------------------------------------------------------------

	function extractReadable() {
		const Reader = globalThis.Readability;
		if (typeof Reader !== "function") {
			return null;
		}

		let parsed = null;

		try {
			parsed = new Reader(document.cloneNode(true), { charThreshold: PAGE_MIN_CHARS }).parse();
		} catch (_error) {
			return null;
		}

		if (!parsed || typeof parsed.content !== "string" || !parsed.content) {
			return null;
		}

		try {
			const container = new DOMParser().parseFromString(parsed.content, "text/html");
			let markdown = serializeChildren(container.body).trim();

			if (markdown.length < READABILITY_MIN_CHARS) {
				return null;
			}

			const title = String(parsed.title || "").trim() || pickTitle(document.body);
			if (title) {
				markdown = `# ${title}\n\n${markdown}`;
			}

			return {
				ok: true,
				markdown,
				title,
				url: location.href,
				chars: markdown.length,
				byline: String(parsed.byline || "").trim(),
				source: "readability",
			};
		} catch (_error) {
			return null;
		}
	}

	// ------------------------------------------------------------------
	// Диспетчер
	// ------------------------------------------------------------------

	function extractContent(options = {}) {
		const mode = String(options?.mode || "auto");

		if (mode !== "page") {
			const article = extractArticle();
			if (article.ok || mode === "article") {
				return article;
			}
		}

		const readable = extractReadable();
		if (readable) {
			return readable;
		}

		return extractPage();
	}

	globalThis.__arenaExtractArticle = extractArticle;
	globalThis.__arenaExtractPage = extractPage;
	globalThis.__arenaExtractContent = extractContent;
})();
