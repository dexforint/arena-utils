const CREATE_BLOBS_TYPE = "ARENA_OFFSCREEN_CREATE_BLOBS";
const REVOKE_BLOBS_TYPE = "ARENA_OFFSCREEN_REVOKE_BLOBS";

// URL'ы, созданные этим offscreen-документом. Живём до отзыва.
const activeUrls = new Set();

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

// При закрытии документа браузер сам освободит URL'ы, но подчистимся явно.
window.addEventListener("pagehide", revokeAll);
window.addEventListener("unload", revokeAll);

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
});
