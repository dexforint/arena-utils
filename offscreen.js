const CREATE_BLOBS_TYPE = "ARENA_OFFSCREEN_CREATE_BLOBS";
const REVOKE_BLOBS_TYPE = "ARENA_OFFSCREEN_REVOKE_BLOBS";
const PARSE_PDF_TYPE = "ARENA_OFFSCREEN_PARSE_PDF";

const MAX_PDF_CHARS = 200000;
const PDF_MAGIC = "%PDF-";

// Строки короче этого не приклеиваются к предыдущей: так заголовки
// вида "3.2 Experimental Setup" не слипаются с абзацем.
const MIN_MERGE_LENGTH = 40;

// URL'ы, созданные этим offscreen-документом. Живём до отзыва.
const activeUrls = new Set();

// ---------------------------------------------------------------------------
// Blob URLs
// ---------------------------------------------------------------------------

function createBlobUrl(text) {
	const blob = new Blob([String(text ?? "")], {
		type: "text/markdown;charset=utf-8",
	});
	const url = URL.createObjectURL(blob);
	activeUrls.add(url);
	return url;
}

function revokeBlobUrl(url) {
	if (!activeUrls.has(url)) {
		return;
	}

	URL.revokeObjectURL(url);
	activeUrls.delete(url);
}

function revokeAll() {
	for (const url of Array.from(activeUrls)) {
		URL.revokeObjectURL(url);
	}
	activeUrls.clear();
}

window.addEventListener("pagehide", revokeAll);
window.addEventListener("unload", revokeAll);

// ---------------------------------------------------------------------------
// PDF → текст
// ---------------------------------------------------------------------------

function getPdfLibrary() {
	const library = globalThis.pdfjsLib;

	if (!library || typeof library.getDocument !== "function") {
		return null;
	}

	if (!library.__arenaWorkerConfigured) {
		try {
			library.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.js");
		} catch (_error) {
			/* ignore */
		}

		library.__arenaWorkerConfigured = true;
	}

	return library;
}

function readPdfMagic(buffer) {
	if (!buffer || buffer.byteLength < PDF_MAGIC.length) {
		return false;
	}

	const head = new Uint8Array(buffer, 0, PDF_MAGIC.length);

	for (let index = 0; index < PDF_MAGIC.length; index += 1) {
		if (head[index] !== PDF_MAGIC.charCodeAt(index)) {
			return false;
		}
	}

	return true;
}

// Скачиваем заново, а не читаем из вкладки: во встроенный PDF-вьюер Chrome
// content scripts не инжектятся, а по расширению файла судить нельзя
// (arxiv.org/pdf/… отдаёт PDF без ".pdf" в конце пути).
async function fetchPdfBuffer(url) {
	const response = await fetch(url, { credentials: "include", redirect: "follow" });

	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ${response.statusText || ""}`.trim());
	}

	const buffer = await response.arrayBuffer();

	if (!readPdfMagic(buffer)) {
		const contentType = String(response.headers.get("content-type") || "unknown content type");
		throw new Error(`The link returned ${contentType}, not a PDF`);
	}

	return buffer;
}

const HYPHEN_END_RE = /[\p{L}]-$/u;
const OPEN_END_RE = /[^\s.!?:;,)\]}"'»”’…]$/u;
const LOWER_START_RE = /^[\p{Ll},;:)\]]/u;

function joinWrappedLines(lines) {
	const result = [];

	for (const line of lines) {
		const previous = result[result.length - 1];

		if (previous === undefined) {
			result.push(line);
			continue;
		}

		if (LOWER_START_RE.test(line)) {
			if (HYPHEN_END_RE.test(previous)) {
				result[result.length - 1] = previous.slice(0, -1) + line;
				continue;
			}

			if (OPEN_END_RE.test(previous) && previous.length >= MIN_MERGE_LENGTH) {
				result[result.length - 1] = `${previous} ${line}`;
				continue;
			}
		}

		result.push(line);
	}

	return result;
}

function assemblePageText(items) {
	const lines = [];
	let current = null;

	for (const item of items) {
		const text = String(item?.str ?? "");
		if (!text) {
			continue;
		}

		const transform = Array.isArray(item.transform) ? item.transform : null;
		const x = transform ? Number(transform[4]) || 0 : 0;
		const y = transform ? Number(transform[5]) || 0 : 0;
		const height = Math.abs(Number(item.height)) || 10;
		const width = Number(item.width) || 0;

		if (!current || current.closed || Math.abs(y - current.y) > 2) {
			current = { y, parts: [text], lastRight: x + width, closed: false };
			lines.push(current);
		} else {
			const previous = current.parts[current.parts.length - 1] || "";
			const gap = x - current.lastRight;
			const needsSpace = gap > height * 0.22 && !/\s$/.test(previous) && !/^\s/.test(text);

			current.parts.push(needsSpace ? ` ${text}` : text);
			current.lastRight = Math.max(current.lastRight, x + width);
		}

		if (item.hasEOL) {
			current.closed = true;
		}
	}

	const rawLines = lines
		.map((line) =>
			line.parts
				.join("")
				.replace(/[ \t]+/g, " ")
				.trim(),
		)
		.filter(Boolean);

	return joinWrappedLines(rawLines).join("\n");
}

async function parsePdfFromUrl(url) {
	const library = getPdfLibrary();

	if (!library) {
		return { ok: false, error: "PDF library is not loaded (vendor/pdf.min.js is missing)" };
	}

	let buffer;

	try {
		buffer = await fetchPdfBuffer(url);
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}

	let pdf = null;

	try {
		pdf = await library.getDocument({
			// isEvalSupported: false — MV3 запрещает eval/new Function,
			// а pdf.js использует их при разборе PostScript-функций шрифтов.
			data: new Uint8Array(buffer),
			isEvalSupported: false,
			disableFontFace: true,
			useSystemFonts: false,
		}).promise;
	} catch (error) {
		return {
			ok: false,
			error: `Could not read the PDF: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	try {
		const pages = [];
		let chars = 0;
		let truncated = false;
		let lastPage = 0;

		for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
			lastPage = pageNumber;

			const page = await pdf.getPage(pageNumber);

			try {
				const content = await page.getTextContent();
				const text = assemblePageText(content.items);
				const block = pdf.numPages > 1 ? `[page ${pageNumber}]\n${text}` : text;

				pages.push(block);
				chars += block.length + 2;
			} finally {
				page.cleanup();
			}

			if (chars >= MAX_PDF_CHARS) {
				truncated = pageNumber < pdf.numPages;
				break;
			}
		}

		let markdown = pages.join("\n\n").trim();

		if (!markdown) {
			return { ok: false, error: "The PDF has no extractable text (it may be a scanned image)" };
		}

		if (truncated) {
			markdown += `\n\n[... truncated after page ${lastPage} of ${pdf.numPages} ...]`;
		}

		let title = "";
		try {
			const metadata = await pdf.getMetadata();
			title = String(metadata?.info?.Title || "").trim();
		} catch (_error) {
			/* метаданные необязательны */
		}

		return {
			ok: true,
			markdown,
			title,
			url,
			pages: pdf.numPages,
			chars: markdown.length,
			truncated,
			source: "pdf",
		};
	} finally {
		try {
			await pdf.destroy();
		} catch (_error) {
			/* ignore */
		}
	}
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message?.type === CREATE_BLOBS_TYPE) {
		try {
			const files = Array.isArray(message.files) ? message.files : [];
			const created = files.map((file) => ({
				name: String(file?.name || "file.md"),
				url: createBlobUrl(file?.text),
			}));

			sendResponse({ ok: true, files: created });
		} catch (error) {
			sendResponse({
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		return;
	}

	if (message?.type === REVOKE_BLOBS_TYPE) {
		const urls = Array.isArray(message.urls) ? message.urls : [];

		for (const url of urls) {
			revokeBlobUrl(url);
		}

		sendResponse({ ok: true });
		return;
	}

	if (message?.type === PARSE_PDF_TYPE) {
		parsePdfFromUrl(String(message.url || ""))
			.then((result) => sendResponse(result))
			.catch((error) =>
				sendResponse({
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		return true;
	}
});
