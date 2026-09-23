function isRadixScrollbarHideCss(text) {
	const value = String(text || "")
		.replace(/\s+/g, "")
		.toLowerCase();
	return value.includes("[data-radix-scroll-area-viewport]") && (value.includes("scrollbar-width:none") || value.includes("::-webkit-scrollbar{display:none"));
}

function stripScrollbarSheet(sheet) {
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
		if (!(styleEl instanceof HTMLStyleElement) || !isRadixScrollbarHideCss(styleEl.textContent)) {
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
	stripScrollbarRoot(document);
}
