(() => {
	const KEY = "__arena_utils_disable_autoscroll";

	function applyAutoscrollFlag(disabled) {
		try {
			sessionStorage.setItem(KEY, disabled ? "1" : "0");
		} catch (_error) {
			/* ignore */
		}
	}

	restoreNativeScrollbars();

	const observer = new MutationObserver(() => {
		restoreNativeScrollbars();
	});

	observer.observe(document.documentElement, {
		childList: true,
		subtree: true,
	});

	chrome.storage.local.get({ disableAutoscroll: false }, (result) => {
		applyAutoscrollFlag(Boolean(result.disableAutoscroll));
	});

	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== "local" || !changes.disableAutoscroll) {
			return;
		}

		applyAutoscrollFlag(Boolean(changes.disableAutoscroll.newValue));
	});
})();
