(() => {
	const DEFAULT_FULL_EXCLUDE = [".git/", ".venv/", "__pycache__/", "node_modules/", "last_bugs.md"];

	const DEFAULT_CONTENT_EXCLUDE = [
		".env",
		".env.*",
		"!.env.example",
		"*.pem",
		"*.key",
		"package-lock.json",
		"poetry.lock",
		"uv.lock",
		"docs/generated/",
		"*.dae",
		"*.ps1",
		".gitignore",
		"*.wbt",
		"*.json",
		"*.proto",
	];

	function quoted(value) {
		return JSON.stringify(String(value ?? ""), (key, item) => item);
	}

	function splitPatternLines(value) {
		if (Array.isArray(value)) {
			return value.flatMap((item) => splitPatternLines(item));
		}

		return String(value || "")
			.split(/\r?\n/)
			.map((line) => line.trimEnd())
			.filter((line) => line.trim() && !line.trim().startsWith("#"));
	}

	function escapeRegex(char) {
		return /[\\^$+()|{}.[\]]/.test(char) ? `\\${char}` : char;
	}

	function globToRegexSource(pattern) {
		let source = "";
		let index = 0;

		while (index < pattern.length) {
			const char = pattern[index];

			if (char === "*" && pattern[index + 1] === "*") {
				if (pattern[index + 2] === "/") {
					source += "(?:.*/)?";
					index += 3;
					continue;
				}

				source += ".*";
				index += 2;
				continue;
			}

			if (char === "*") {
				source += "[^/]*";
				index += 1;
				continue;
			}

			if (char === "?") {
				source += "[^/]";
				index += 1;
				continue;
			}

			if (char === "[") {
				const end = pattern.indexOf("]", index + 1);
				if (end === -1) {
					source += "\\[";
					index += 1;
					continue;
				}

				source += pattern.slice(index, end + 1);
				index = end + 1;
				continue;
			}

			source += escapeRegex(char);
			index += 1;
		}

		return source;
	}

	function compileRule(rawLine) {
		let pattern = rawLine;
		let negation = false;

		if (pattern.startsWith("!")) {
			negation = true;
			pattern = pattern.slice(1);
		}

		let dirOnly = false;
		if (pattern.endsWith("/") && pattern !== "/") {
			dirOnly = true;
			pattern = pattern.slice(0, -1);
		}

		let anchored = pattern.startsWith("/") || pattern.slice(0, -1).includes("/");
		if (pattern.startsWith("/")) {
			anchored = true;
			pattern = pattern.slice(1);
		}

		const glob = globToRegexSource(pattern);
		let source;

		if (dirOnly) {
			source = anchored ? `^${glob}(?:/.*)?$` : `^(?:.*/)?${glob}(?:/.*)?$`;
		} else if (anchored) {
			source = `^${glob}$`;
		} else {
			source = `^(?:.*/)?${glob}$`;
		}

		return {
			negation,
			dirOnly,
			regex: new RegExp(source),
		};
	}

	function createIgnoreSpec(lines) {
		const rules = splitPatternLines(lines).map(compileRule);

		return {
			empty: rules.length === 0,
			matches(relPath, isDirectory) {
				if (rules.length === 0) {
					return false;
				}

				const path = String(relPath || "")
					.replaceAll("\\", "/")
					.replace(/^\/+/, "");

				let ignored = false;

				for (const rule of rules) {
					if (rule.dirOnly && !isDirectory) {
						continue;
					}

					if (rule.regex.test(path)) {
						ignored = !rule.negation;
					}
				}

				return ignored;
			},
		};
	}

	function isContentSkipped(spec, relPath) {
		if (!spec || spec.empty) {
			return false;
		}

		if (spec.matches(relPath, false)) {
			return true;
		}

		const parts = String(relPath || "")
			.split("/")
			.filter(Boolean);
		let acc = "";

		for (let i = 0; i < parts.length - 1; i += 1) {
			acc = acc ? `${acc}/${parts[i]}` : parts[i];
			if (spec.matches(acc, true)) {
				return true;
			}
		}

		return false;
	}

	function looksLikeText(text) {
		if (text.includes("\u0000")) {
			return false;
		}

		if (!text) {
			return true;
		}

		let suspicious = 0;
		for (const char of text) {
			const code = char.codePointAt(0);
			if ((code < 32 && char !== "\t" && char !== "\n" && char !== "\r" && char !== "\f") || code === 127) {
				suspicious += 1;
			}
		}

		return suspicious / text.length <= 0.01;
	}

	function decodeText(bytes) {
		const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

		const trials = [];
		if (view.length >= 3 && view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) {
			trials.push("utf-8");
		} else if (view.length >= 2 && view[0] === 0xff && view[1] === 0xfe) {
			trials.push("utf-16le");
		} else if (view.length >= 2 && view[0] === 0xfe && view[1] === 0xff) {
			trials.push("utf-16be");
		} else {
			trials.push("utf-8");
		}

		for (const encoding of trials) {
			try {
				const text = new TextDecoder(encoding, { fatal: true }).decode(view);
				if (looksLikeText(text)) {
					return { text, encoding };
				}
			} catch (_error) {
				/* try next */
			}
		}

		return null;
	}

	function sortChildren(children) {
		children.sort((a, b) => {
			if (a.kind !== b.kind) {
				return a.kind === "directory" ? -1 : 1;
			}

			return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
		});
	}

	function nodeLabel(node) {
		let label = quoted(node.name);

		if (node.kind === "directory") {
			label += "/";
		}

		if (node.error) {
			label += ` [ERROR: ${quoted(node.error)}]`;
		}

		return label;
	}

	function* treeLines(node, prefix = "") {
		for (let index = 0; index < node.children.length; index += 1) {
			const child = node.children[index];
			const last = index === node.children.length - 1;
			const connector = last ? "└── " : "├── ";
			yield `${prefix}${connector}${nodeLabel(child)}\n`;

			if (child.kind === "directory") {
				const continuation = last ? "    " : "│   ";
				yield* treeLines(child, prefix + continuation);
			}
		}
	}

	function* walkFiles(node) {
		for (const child of node.children) {
			if (child.kind === "file") {
				yield child;
			} else if (child.kind === "directory") {
				yield* walkFiles(child);
			}
		}
	}

	async function scanDirectory(dirHandle, rel, fullIgnore, onProgress) {
		const node = {
			kind: "directory",
			name: rel ? rel.split("/").at(-1) : dirHandle.name,
			rel,
			children: [],
			error: null,
		};

		let entries;

		try {
			entries = [];
			for await (const [name, handle] of dirHandle.entries()) {
				entries.push([name, handle]);
			}
		} catch (error) {
			node.error = error instanceof Error ? error.message : String(error);
			return node;
		}

		for (const [name, handle] of entries) {
			const childRel = rel ? `${rel}/${name}` : name;

			if (handle.kind === "directory") {
				if (fullIgnore.matches(childRel, true)) {
					continue;
				}

				node.children.push(await scanDirectory(handle, childRel, fullIgnore, onProgress));
				continue;
			}

			if (fullIgnore.matches(childRel, false)) {
				continue;
			}

			onProgress?.(`Scanning ${childRel}`);
			node.children.push({
				kind: "file",
				name,
				rel: childRel,
				handle,
				error: null,
			});
		}

		sortChildren(node.children);
		return node;
	}

	async function readTextFile(fileHandle, maxFileBytes) {
		try {
			const file = await fileHandle.getFile();

			if (maxFileBytes && file.size > maxFileBytes) {
				return { text: null, encoding: null, reason: `larger than ${maxFileBytes} bytes` };
			}

			const buffer = await file.arrayBuffer();
			if (maxFileBytes && buffer.byteLength > maxFileBytes) {
				return { text: null, encoding: null, reason: `larger than ${maxFileBytes} bytes` };
			}

			const decoded = decodeText(buffer);
			if (!decoded) {
				return { text: null, encoding: null, reason: "binary file or unsupported text encoding" };
			}

			return { text: decoded.text, encoding: decoded.encoding, reason: null };
		} catch (error) {
			return {
				text: null,
				encoding: null,
				reason: `read error: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	class ChunkWriter {
		constructor(maxChars) {
			this.maxChars = Math.max(0, Number(maxChars) || 0);
			this.parts = [];
			this.current = "";
			this.totalChars = 0;
		}

		write(text) {
			let position = 0;
			const value = String(text ?? "");

			while (position < value.length) {
				if (!this.current && this.parts.length === 0) {
					this.current = "";
				}

				if (this.maxChars && this.current.length === this.maxChars) {
					this.parts.push(this.current);
					this.current = "";
				}

				const available = this.maxChars ? this.maxChars - this.current.length : value.length - position;
				const end = position + Math.min(available, value.length - position);
				const fragment = value.slice(position, end);
				this.current += fragment;
				this.totalChars += fragment.length;
				position = end;
			}
		}

		finish() {
			if (this.current || this.parts.length === 0) {
				this.parts.push(this.current);
			}

			return this.parts.map((text, index) => ({
				name: `context-${String(index + 1).padStart(4, "0")}`,
				chars: text.length,
				text,
			}));
		}
	}

	async function generateSnapshot(rootHandle, options = {}, onProgress = () => {}) {
		const maxChars = Number(options.maxChars ?? 100000);
		const maxFileBytes = Number(options.maxFileBytes ?? 0);
		const fullIgnore = createIgnoreSpec(options.exclude ?? DEFAULT_FULL_EXCLUDE);
		const contentIgnore = createIgnoreSpec(options.contentExclude ?? DEFAULT_CONTENT_EXCLUDE);

		if (options.gitignore) {
			try {
				const gitignoreHandle = await rootHandle.getFileHandle(".gitignore");
				const gitignoreFile = await gitignoreHandle.getFile();
				const gitignoreText = await gitignoreFile.text();
				const merged = createIgnoreSpec([...splitPatternLines(gitignoreText), ...(options.exclude ?? DEFAULT_FULL_EXCLUDE)]);
				Object.assign(fullIgnore, merged);
			} catch (_error) {
				/* no .gitignore */
			}
		}

		onProgress("Scanning folder…");
		const tree = await scanDirectory(rootHandle, "", fullIgnore, onProgress);
		tree.name = rootHandle.name;

		const writer = new ChunkWriter(maxChars);
		writer.write(
			"SOURCE CODE SNAPSHOT\n" +
				"Paths are relative to the source directory.\n" +
				"Concatenate numbered parts in numeric order.\n\n" +
				"=== DIRECTORY TREE ===\n",
		);
		writer.write(`${nodeLabel(tree)}\n`);

		for (const line of treeLines(tree)) {
			writer.write(line);
		}

		writer.write("\n=== FILE CONTENTS ===\n");

		let textCount = 0;
		let skippedCount = 0;

		for (const node of walkFiles(tree)) {
			onProgress(`Reading ${node.rel}`);
			writer.write(`\n--- BEGIN FILE ${quoted(node.rel)} ---\n`);

			if (isContentSkipped(contentIgnore, node.rel)) {
				skippedCount += 1;
				writer.write("[SKIPPED: content excluded by pattern]\n");
			} else {
				const result = await readTextFile(node.handle, maxFileBytes);
				if (result.text == null) {
					skippedCount += 1;
					writer.write(`[SKIPPED: ${quoted(result.reason)}]\n`);
				} else {
					textCount += 1;
					writer.write(`[encoding=${result.encoding}; characters=${result.text.length}]\n--- CONTENT ---\n`);
					writer.write(result.text);
					if (result.text && !result.text.endsWith("\n")) {
						writer.write("\n");
					}
				}
			}

			writer.write(`--- END FILE ${quoted(node.rel)} ---\n`);
		}

		const chunks = writer.finish();
		onProgress("Done");

		return {
			folderName: rootHandle.name,
			generatedAt: Date.now(),
			stats: {
				parts: chunks.length,
				characters: writer.totalChars,
				textFiles: textCount,
				skipped: skippedCount,
			},
			chunks,
		};
	}

	window.ArenaCodebase = {
		DEFAULT_FULL_EXCLUDE,
		DEFAULT_CONTENT_EXCLUDE,
		createIgnoreSpec,
		generateSnapshot,
	};
})();
