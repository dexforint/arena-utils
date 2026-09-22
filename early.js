(() => {
	const KEY = "__arena_utils_disable_autoscroll";

	function applyAutoscrollFlag(disabled) {
		try {
			sessionStorage.setItem(KEY, disabled ? "1" : "0");
		} catch (_error) {
			/* ignore */
		}
	}

	function isRadixScrollbarHideCss(text) {
		const value = String(text || "")
			.replace(/\s+/g, "")
			.toLowerCase();
		return (
			value.includes("[data-radix-scroll-area-viewport]") && (value.includes("scrollbar-width:none") || value.includes("::-webkit-scrollbar{display:none"))
		);
	}

	function stripSheet(sheet) {
		let rules;

		try {
			rules = sheet.cssRules;
		} catch (_error) {
			return;
		}

		for (let i = rules.length - 1; i >= 0; i -= 1) {
			const rule = rules[i];
			const cssText = String(rule.cssText || "");
			const selector = String(rule.selectorText || "");

			if (selector.includes("[data-radix-scroll-area-viewport]") || isRadixScrollbarHideCss(cssText)) {
				try {
					sheet.deleteRule(i);
				} catch (_error) {
					/* ignore */
				}
			}
		}
	}

	function stripRoot(root) {
		if (!root) {
			return;
		}

		if (root.styleSheets) {
			for (const sheet of Array.from(root.styleSheets)) {
				stripSheet(sheet);
			}
		}

		if (root.adoptedStyleSheets) {
			for (const sheet of root.adoptedStyleSheets) {
				stripSheet(sheet);
			}
		}

		const styleNodes = root.querySelectorAll ? root.querySelectorAll("style") : [];

		for (const styleEl of styleNodes) {
			if (!(styleEl instanceof HTMLStyleElement)) {
				continue;
			}

			if (!isRadixScrollbarHideCss(styleEl.textContent)) {
				continue;
			}

			try {
				if (styleEl.sheet) {
					stripSheet(styleEl.sheet);
				}
			} catch (_error) {
				/* ignore */
			}

			if (isRadixScrollbarHideCss(styleEl.textContent)) {
				styleEl.remove();
			}
		}

		const treeRoot = root.body || root.documentElement || root;
		if (!treeRoot || !treeRoot.querySelectorAll) {
			return;
		}

		for (const el of treeRoot.querySelectorAll("*")) {
			if (el.shadowRoot) {
				stripRoot(el.shadowRoot);
			}
		}
	}

	function restoreNativeScrollbars() {
		stripRoot(document);
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
