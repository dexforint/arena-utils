(() => {
	if (globalThis.ArenaI18n) {
		return;
	}

	function t(key, substitutions) {
		if (!key) {
			return "";
		}

		try {
			const list = Array.isArray(substitutions) ? substitutions.map((item) => String(item ?? "")) : substitutions != null ? [String(substitutions)] : undefined;

			const message = chrome.i18n.getMessage(key, list);
			return message || key;
		} catch (_error) {
			return key;
		}
	}

	function apply(root) {
		const scope = root && root.querySelectorAll ? root : document;

		for (const el of scope.querySelectorAll("[data-i18n]")) {
			const key = el.getAttribute("data-i18n");
			if (key) el.textContent = t(key);
		}

		for (const el of scope.querySelectorAll("[data-i18n-placeholder]")) {
			const key = el.getAttribute("data-i18n-placeholder");
			if (key) el.setAttribute("placeholder", t(key));
		}

		for (const el of scope.querySelectorAll("[data-i18n-title]")) {
			const key = el.getAttribute("data-i18n-title");
			if (key) el.setAttribute("title", t(key));
		}

		for (const el of scope.querySelectorAll("[data-i18n-aria-label]")) {
			const key = el.getAttribute("data-i18n-aria-label");
			if (key) el.setAttribute("aria-label", t(key));
		}

		const lang = t("languageCode");
		if (lang && lang !== "languageCode") {
			document.documentElement.setAttribute("lang", lang);
		}
	}

	globalThis.ArenaI18n = { t, apply };

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => apply(), { once: true });
	} else {
		apply();
	}
})();
