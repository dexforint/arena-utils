(() => {
	if (globalThis.ArenaShared) {
		return;
	}

	const WINDOWS_RESERVED = new Set([
		"con",
		"prn",
		"aux",
		"nul",
		"com1",
		"com2",
		"com3",
		"com4",
		"com5",
		"com6",
		"com7",
		"com8",
		"com9",
		"lpt1",
		"lpt2",
		"lpt3",
		"lpt4",
		"lpt5",
		"lpt6",
		"lpt7",
		"lpt8",
		"lpt9",
	]);

	function sanitizeFileName(value, fallback = "arena-export") {
		let name = String(value ?? "")
			.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
			.trim();

		// Windows не любит хвостовые точки и пробелы
		name = name.replace(/[.\s]+$/g, "").slice(0, 120);

		if (!name) {
			return fallback;
		}

		const base = name.includes(".") ? name.slice(0, name.indexOf(".")) : name;
		if (WINDOWS_RESERVED.has(base.toLowerCase())) {
			name = `_${name}`;
		}

		return name || fallback;
	}

	function prefixListItem(block, marker, indent) {
		const lines = String(block ?? "").split("\n");
		return lines
			.map((line, index) => {
				if (index === 0) {
					return `${marker}${line}`;
				}

				return line ? `${indent}${line}` : "";
			})
			.join("\n");
	}

	function normalizeMarkdown(text) {
		return `${String(text ?? "")
			.replace(/\r\n/g, "\n")
			.trimEnd()}\n`;
	}

	globalThis.ArenaShared = {
		sanitizeFileName,
		prefixListItem,
		normalizeMarkdown,
	};
})();
