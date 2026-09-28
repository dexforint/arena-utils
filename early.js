(() => {
	const AUTOSCROLL_ATTR = "arenaUtilsNoAutoscroll";
	const AUTOSCROLL_KEY = "__arena_utils_disable_autoscroll";

	function applyAutoscrollFlag(disabled) {
		try {
			sessionStorage.setItem(AUTOSCROLL_KEY, disabled ? "1" : "0");
		} catch (_error) {
			/* ignore */
		}

		const root = document.documentElement;
		if (!root) {
			return;
		}

		if (disabled) {
			root.dataset[AUTOSCROLL_ATTR] = "1";
		} else {
			delete root.dataset[AUTOSCROLL_ATTR];
		}
	}

	function isStyleRelatedNode(node) {
		if (!node || node.nodeType !== Node.ELEMENT_NODE) {
			return false;
		}

		const tag = node.tagName;
		if (tag === "STYLE" || tag === "LINK") {
			return true;
		}

		if (node.shadowRoot) {
			return true;
		}

		if (node.querySelector && node.querySelector("style, link[rel='stylesheet'], link[rel=\"stylesheet\"]")) {
			return true;
		}

		return false;
	}

	restoreNativeScrollbars();

	const observer = new MutationObserver((records) => {
		for (const record of records) {
			for (const node of record.addedNodes) {
				if (isStyleRelatedNode(node)) {
					globalThis.invalidateScrollbarClean?.();
					return;
				}
			}
		}
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
