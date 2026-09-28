(() => {
	if (typeof globalThis.restoreNativeScrollbars === "function") {
		return;
	}

	const processedSheets = new WeakSet();
	let pendingRestoreHandle = 0;
	let isClean = false;

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
			return false;
		}

		processedSheets.add(sheet);

		let rules;
		try {
			rules = sheet.cssRules;
		} catch (_error) {
			return false;
		}

		let touched = false;
		for (let i = rules.length - 1; i >= 0; i -= 1) {
			const rule = rules[i];
			const cssText = String(rule.cssText || "");
			const selector = String(rule.selectorText || "");

			if (!selector.includes("[data-radix-scroll-area-viewport]") && !isRadixScrollbarHideCss(cssText)) {
				continue;
			}

			try {
				sheet.deleteRule(i);
				touched = true;
			} catch (_error) {
				/* ignore */
			}
		}

		return touched;
	}

	function stripScrollbarRoot(root) {
		if (!root) {
			return false;
		}

		let touched = false;

		if (root.styleSheets) {
			for (const sheet of Array.from(root.styleSheets)) {
				if (stripScrollbarSheet(sheet)) {
					touched = true;
				}
			}
		}

		if (root.adoptedStyleSheets) {
			for (const sheet of root.adoptedStyleSheets) {
				if (stripScrollbarSheet(sheet)) {
					touched = true;
				}
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
				if (styleEl.sheet && stripScrollbarSheet(styleEl.sheet)) {
					touched = true;
				}
			} catch (_error) {
				/* ignore */
			}

			if (isRadixScrollbarHideCss(styleEl.textContent)) {
				styleEl.remove();
				touched = true;
			}
		}

		const treeRoot = root.body || root.documentElement || root;
		if (!treeRoot?.querySelectorAll) {
			return touched;
		}

		for (const el of treeRoot.querySelectorAll("*")) {
			if (el.shadowRoot && stripScrollbarRoot(el.shadowRoot)) {
				touched = true;
			}
		}

		return touched;
	}

	function runRestore() {
		const touched = stripScrollbarRoot(document);
		if (!touched && !document.hidden) {
			// Если ничего не нашли — состояние «чисто». Дальше обходим
			// DOM только когда появится новый <style>/<link>/shadow root.
			isClean = true;
		}
	}

	function restoreNativeScrollbars() {
		if (isClean) {
			return;
		}

		if (pendingRestoreHandle) {
			return;
		}

		pendingRestoreHandle = requestAnimationFrame(() => {
			pendingRestoreHandle = 0;
			runRestore();
		});
	}

	function invalidateScrollbarClean() {
		isClean = false;
		restoreNativeScrollbars();
	}

	globalThis.restoreNativeScrollbars = restoreNativeScrollbars;
	globalThis.invalidateScrollbarClean = invalidateScrollbarClean;
})();
