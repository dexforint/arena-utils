const DOWNLOAD_TYPE = "ARENA_OFFSCREEN_DOWNLOAD";
const DOWNLOAD_TIMEOUT_MS = 60000;

function waitForDownload(downloadId, timeoutMs = DOWNLOAD_TIMEOUT_MS) {
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			chrome.downloads.onChanged.removeListener(listener);
			resolve("timeout");
		}, timeoutMs);

		function listener(delta) {
			if (delta.id !== downloadId || !delta.state) {
				return;
			}

			const state = delta.state.current;
			if (state !== "complete" && state !== "interrupted") {
				return;
			}

			clearTimeout(timer);
			chrome.downloads.onChanged.removeListener(listener);
			resolve(state);
		}

		chrome.downloads.onChanged.addListener(listener);
	});
}

async function downloadOne(folderName, file) {
	const blob = new Blob([String(file.text ?? "")], {
		type: "text/markdown;charset=utf-8",
	});
	const url = URL.createObjectURL(blob);

	try {
		const downloadId = await chrome.downloads.download({
			url,
			filename: `${folderName}/${file.name}`,
			saveAs: false,
			conflictAction: "uniquify",
		});

		const state = await waitForDownload(downloadId);
		if (state === "interrupted") {
			return { ok: false, name: file.name, error: "Download interrupted" };
		}

		return { ok: true, name: file.name };
	} catch (error) {
		return {
			ok: false,
			name: file.name,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		URL.revokeObjectURL(url);
	}
}

async function handleDownload(message) {
	const folderName = String(message.folderName || "arena-export");
	const files = Array.isArray(message.files) ? message.files : [];

	const results = await Promise.all(files.map((file) => downloadOne(folderName, file)));

	const failed = results.filter((item) => !item.ok);

	return {
		ok: failed.length === 0,
		count: results.length,
		failed,
	};
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message?.type !== DOWNLOAD_TYPE) {
		return;
	}

	handleDownload(message)
		.then(sendResponse)
		.catch((error) => {
			sendResponse({
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
		});

	return true;
});
