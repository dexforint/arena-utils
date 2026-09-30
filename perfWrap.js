// perfWrap.js — instruments content.js functions with ArenaPerf.
// Loads AFTER content.js. Wraps top-level function declarations only.
//
// Requires content.js to declare hot functions as top-level function
// declarations (i.e. not inside an IIFE) so they land on globalThis.
// If you ever wrap content.js in an IIFE, this file will log a warning
// and profiling will silently stay at zero.

(() => {
	const perf = globalThis.ArenaPerf;
	if (!perf) {
		return;
	}

	const HOT_FUNCTIONS = [
		// Refresh pipeline
		"scheduleRefresh",
		"renderPanelList",
		"collectMessages",
		"collectMessagesFromList",
		"collectMessagesFromCopyButtons",
		"processCodeBlocks",
		"applyPageTheme",
		"readPageThemeValues",
		"updateActiveItem",
		"maybeRefreshCurrentIndex",
		"getCurrentMessageIndex",

		// Side panels
		"renderNewChatList",
		"renderPromptsList",
		"positionNewChatPanel",
		"positionPromptsPanel",

		// Hot leaf functions
		"previewFromRoot",
		"getNodeTextLength",
		"countCodeLines",
		"countMessageCopyButtonsInside",
		"classifyMessageRoot",
		"classifyMessageCopyButton",
		"hasCopyIcon",
		"findMessageContainer",
		"sortMessages",
		"sortEntriesByVisualOrder",

		// Composer
		"insertPrompt",
		"fillComposer",
		"setTextareaValue",
		"resizeComposer",
		"getComposerTextarea",
		"waitForSendButton",
		"clickSendButton",
		"insertPendingPrompt",

		// Navigation
		"syncCurrentFromViewport",
		"scrollToMessageStart",
		"scrollChildIntoContainer",
		"highlightMessage",
	];

	let installed = false;

	function wrapOne(name) {
		const original = globalThis[name];
		if (typeof original !== "function" || original.__arenaPerfWrapped) {
			return false;
		}

		function wrapped(...args) {
			if (!perf.enabled) {
				return original.apply(this, args);
			}
			const t0 = performance.now();
			try {
				const result = original.apply(this, args);
				perf.record(name, performance.now() - t0);
				return result;
			} catch (error) {
				perf.record(name, performance.now() - t0);
				throw error;
			}
		}

		wrapped.__arenaPerfWrapped = true;
		wrapped.__arenaPerfOriginal = original;

		try {
			globalThis[name] = wrapped;
			return true;
		} catch (_error) {
			return false;
		}
	}

	if (installed) return;
	installed = true;

	let wrapped = 0;
	const missing = [];

	for (const name of HOT_FUNCTIONS) {
		if (wrapOne(name)) {
			wrapped += 1;
			continue;
		}

		// Возможные причины промаха:
		//  - функция уже обёрнута (нормально, второй проход);
		//  - функции нет на globalThis — обычно значит, что content.js
		//    обернули в IIFE и профилирование молча покажет нули.
		if (typeof globalThis[name] !== "function") {
			missing.push(name);
		}
	}

	if (missing.length > 0) {
		console.warn(`[arena-utils perf] ${missing.length} hot function(s) not on globalThis — likely content.js was wrapped in an IIFE. Missing:`, missing);
	}

	console.log(`[arena-utils perf] wrapped ${wrapped} of ${HOT_FUNCTIONS.length} function(s) for profiling`);
})();
