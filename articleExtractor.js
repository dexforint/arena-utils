// Извлекает содержимое <article> со страницы и конвертирует его в Markdown.
// Подключается через chrome.scripting.executeScript из popup.js.
// Экспортирует globalThis.__arenaExtractArticle().

(() => {
	if (globalThis.__arenaExtractArticle) {
		return;
	}

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
			if (text.length < 200) {
				continue;
			}

			ranked.push({ element: el, length: text.length });
		}

		ranked.sort((a, b) => b.length - a.length);
		return ranked;
	}

	function readTitle(article) {
		const h1 = article.querySelector("h1");
		if (h1) {
			const text = inline(h1).trim();
			if (text.length >= 3) return text;
		}

		const ogTitle = document.querySelector('meta[property="og:title"]');
		if (ogTitle) {
			const content = String(ogTitle.getAttribute("content") || "").trim();
			if (content.length >= 3) return content;
		}

		const pageTitle = String(document.title || "").trim();
		if (pageTitle) return pageTitle;

		return "";
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
			title: readTitle(article),
			url: location.href,
			chars: markdown.length,
			articleCount: candidates.length,
		};
	}

	globalThis.__arenaExtractArticle = extractArticle;
})();
