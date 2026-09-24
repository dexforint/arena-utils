(() => {
	const TYPES = [
		{ id: "battle", name: "Battle" },
		{ id: "agent", name: "Agent Mode" },
		{ id: "side-by-side", name: "Side by Side" },
		{ id: "direct", name: "Direct" },
	];

	const CATEGORIES = [
		{ id: "auto", name: "Auto", battleOnly: true },
		{ id: "text", name: "Text" },
		{ id: "code", name: "Code" },
		{ id: "image", name: "Image" },
		{ id: "search", name: "Search" },
		{ id: "video", name: "Video", battleOnly: true },
	];

	const DEFAULTS = [
		{
			id: "direct-text-gemini",
			name: "Gemini · Direct",
			chatType: "direct",
			category: "text",
			modelA: "gemini-3.8-flash-high",
			modelB: "",
			prompt: "",
		},
		{
			id: "direct-code-qwen",
			name: "Qwen · Code",
			chatType: "direct",
			category: "code",
			modelA: "qwen3.8-max",
			modelB: "",
			prompt: "",
		},
		{
			id: "battle-text",
			name: "Text Battle",
			chatType: "battle",
			category: "text",
			modelA: "",
			modelB: "",
			prompt: "",
		},
	];

	function typeLabel(id) {
		return TYPES.find((item) => item.id === id)?.name || id || "Direct";
	}

	function categoryLabel(id) {
		return CATEGORIES.find((item) => item.id === id)?.name || id || "Text";
	}

	function categoriesForType(type) {
		if (type === "agent") {
			return [];
		}

		if (type === "battle") {
			return CATEGORIES;
		}

		return CATEGORIES.filter((item) => !item.battleOnly);
	}

	function buildUrl(template, origin = "https://arena.ai") {
		const type = template?.chatType || "direct";
		const category = template?.category || "text";
		const base = String(origin || "https://arena.ai").replace(/\/+$/, "");

		if (type === "agent") {
			return `${base}/agent`;
		}

		if (type === "battle") {
			if (!category || category === "auto") {
				return `${base}/`;
			}

			return `${base}/${category}`;
		}

		const modePath = type === "side-by-side" ? "side-by-side" : "direct";
		const path = `${base}/${category}/${modePath}`;

		try {
			const url = new URL(path);

			if (template?.modelA) {
				url.searchParams.set("model_a", template.modelA);
			}

			if (type === "side-by-side" && template?.modelB) {
				url.searchParams.set("model_b", template.modelB);
			}

			return url.toString();
		} catch (_error) {
			return path;
		}
	}

	function summarize(template) {
		const type = typeLabel(template?.chatType);
		const category = categoryLabel(template?.category);

		if (template?.chatType === "agent") {
			return type;
		}

		if (template?.chatType === "battle") {
			return `${type} · ${category}`;
		}

		if (template?.chatType === "side-by-side") {
			return `${type} · ${category} · ${template.modelA || "?"} vs ${template.modelB || "?"}`;
		}

		return `${type} · ${category} · ${template?.modelA || "model"}`;
	}

	globalThis.ArenaChatTemplates = {
		TYPES,
		CATEGORIES,
		DEFAULTS,
		typeLabel,
		categoryLabel,
		categoriesForType,
		buildUrl,
		summarize,
	};
})();
