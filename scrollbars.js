(() => {
	if (typeof globalThis.restoreNativeScrollbars === "function") {
		return;
	}

	const processedSheets = new WeakSet();
	let pendingRestoreHandle = 0;

	function isRadixScrollbarHideCss(text) {
		const raw = String(text || "");
		if (!raw.includes("data-radix-scroll-area-viewport")) {
			return false;
		}

		const value = raw.replace(/\s+/g, "").toLowerCase();
		return value.includes("scrollbar-width:none") || value.includes("::-webkit-scrollbar{display:none");
	}

	function stripScrollbarSheet(sheet) {
		if (!sheet || processedSheets.has(sheet)) {
			return;
		}

		processedSheets.add(sheet);

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

			if (!selector.includes("[data-radix-scroll-area-viewport]") && !isRadixScrollbarHideCss(cssText)) {
				continue;
			}

			try {
				sheet.deleteRule(i);
			} catch (_error) {
				/* ignore */
			}
		}
	}

	function stripScrollbarRoot(root) {
		if (!root) {
			return;
		}

		if (root.styleSheets) {
			for (const sheet of Array.from(root.styleSheets)) {
				stripScrollbarSheet(sheet);
			}
		}

		if (root.adoptedStyleSheets) {
			for (const sheet of root.adoptedStyleSheets) {
				stripScrollbarSheet(sheet);
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
					stripScrollbarSheet(styleEl.sheet);
				}
			} catch (_error) {
				/* ignore */
			}

			if (isRadixScrollbarHideCss(styleEl.textContent)) {
				styleEl.remove();
			}
		}

		const treeRoot = root.body || root.documentElement || root;
		if (!treeRoot?.querySelectorAll) {
			return;
		}

		for (const el of treeRoot.querySelectorAll("*")) {
			if (el.shadowRoot) {
				stripScrollbarRoot(el.shadowRoot);
			}
		}
	}

	function restoreNativeScrollbars() {
		if (pendingRestoreHandle) {
			return;
		}

		pendingRestoreHandle = requestAnimationFrame(() => {
			pendingRestoreHandle = 0;
			stripScrollbarRoot(document);
		});
	}

	globalThis.restoreNativeScrollbars = restoreNativeScrollbars;
})();
