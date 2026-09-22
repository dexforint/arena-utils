(() => {
	const KEY = "__arena_utils_disable_autoscroll";

	function apply(disabled) {
		try {
			sessionStorage.setItem(KEY, disabled ? "1" : "0");
		} catch (_error) {
			/* ignore */
		}
	}

	chrome.storage.local.get({ disableAutoscroll: false }, (result) => {
		apply(Boolean(result.disableAutoscroll));
	});

	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== "local" || !changes.disableAutoscroll) {
			return;
		}

		apply(Boolean(changes.disableAutoscroll.newValue));
	});
})();
