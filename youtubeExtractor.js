(() => {
	if (globalThis.__arenaExtractYouTube) {
		return;
	}

	const FETCH_TIMEOUT_MS = 15000;
	const MIN_SEGMENT_LEN = 4;

	// ------------------------------------------------------------------
	// Small utils
	// ------------------------------------------------------------------

	function sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	function getVideoIdFromUrl(url = location.href) {
		try {
			const parsed = new URL(url, location.origin);
			const v = parsed.searchParams.get("v");
			if (v) return v;
			const shorts = parsed.pathname.match(/^\/shorts\/([^/?#]+)/);
			if (shorts) return shorts[1];
			const embed = parsed.pathname.match(/^\/embed\/([^/?#]+)/);
			if (embed) return embed[1];
		} catch (_error) {
			/* ignore */
		}
		return "";
	}

	function formatTime(ms) {
		const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
		const hours = Math.floor(total / 3600);
		const minutes = Math.floor((total % 3600) / 60);
		const seconds = total % 60;
		const pad = (value) => String(value).padStart(2, "0");
		return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
	}

	function parseTimestamp(value) {
		const parts = String(value || "")
			.trim()
			.split(":")
			.map((part) => Number(part));

		if (parts.length === 0 || parts.some((part) => Number.isNaN(part))) {
			return 0;
		}

		let seconds = 0;
		for (const part of parts) {
			seconds = seconds * 60 + part;
		}

		return seconds * 1000;
	}

	function pickBestTrack(tracks) {
		const userLang = String(navigator.language || "en")
			.split("-")[0]
			.toLowerCase();
		const manual = tracks.filter((track) => track.kind !== "asr");
		const auto = tracks.filter((track) => track.kind === "asr");

		function bestFrom(list) {
			if (!Array.isArray(list) || list.length === 0) return null;
			const byLang = (code) =>
				list.find((track) =>
					String(track.languageCode || "")
						.toLowerCase()
						.startsWith(code),
				);
			return byLang(userLang) || byLang("ru") || byLang("en") || list[0];
		}

		return bestFrom(manual) || bestFrom(auto) || tracks[0] || null;
	}

	async function fetchWithTimeout(url, options = {}) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		try {
			return await fetch(url, { ...options, signal: controller.signal });
		} finally {
			clearTimeout(timer);
		}
	}

	// ------------------------------------------------------------------
	// Player response sources
	// ------------------------------------------------------------------

	function readPlayerResponseFromPage() {
		const app = document.querySelector("ytd-app");
		if (app?.data?.playerResponse) return app.data.playerResponse;

		const player = document.querySelector("#movie_player");
		if (typeof player?.getPlayerResponse === "function") {
			try {
				const response = player.getPlayerResponse();
				if (response) return response;
			} catch (_error) {
				/* ignore */
			}
		}

		if (globalThis.ytInitialPlayerResponse) {
			return globalThis.ytInitialPlayerResponse;
		}

		return null;
	}

	function parseBalancedJson(text, startIndex) {
		let depth = 0;
		let inString = false;
		let escape = false;
		let stringChar = "";

		for (let i = startIndex; i < text.length; i += 1) {
			const ch = text[i];

			if (inString) {
				if (escape) {
					escape = false;
					continue;
				}
				if (ch === "\\") {
					escape = true;
					continue;
				}
				if (ch === stringChar) {
					inString = false;
				}
				continue;
			}

			if (ch === '"' || ch === "'") {
				inString = true;
				stringChar = ch;
				continue;
			}

			if (ch === "{") depth += 1;
			else if (ch === "}") {
				depth -= 1;
				if (depth === 0) return text.slice(startIndex, i + 1);
			}
		}

		return null;
	}

	function extractPlayerResponseFromHtml(html) {
		const marker = "ytInitialPlayerResponse";
		let cursor = 0;

		while (true) {
			const idx = html.indexOf(marker, cursor);
			if (idx === -1) return null;
			cursor = idx + marker.length;

			const braceIdx = html.indexOf("{", idx);
			if (braceIdx === -1 || braceIdx - idx > 40) continue;

			const json = parseBalancedJson(html, braceIdx);
			if (!json) continue;

			try {
				const parsed = JSON.parse(json);
				if (parsed?.videoDetails || parsed?.captions) return parsed;
			} catch (_error) {
				/* try next */
			}
		}
	}

	async function refetchPlayerResponse(videoId) {
		try {
			const response = await fetchWithTimeout(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`, { credentials: "include" });
			if (!response.ok) return null;
			const html = await response.text();
			return extractPlayerResponseFromHtml(html);
		} catch (_error) {
			return null;
		}
	}

	// ------------------------------------------------------------------
	// Parsers
	// ------------------------------------------------------------------

	function parseJson3(data) {
		const events = Array.isArray(data?.events) ? data.events : [];
		const segments = [];

		for (const event of events) {
			if (!Array.isArray(event?.segs)) continue;

			const text = event.segs
				.map((seg) => String(seg?.utf8 || ""))
				.join("")
				.replace(/\n/g, " ")
				.replace(/\s+/g, " ")
				.trim();

			if (text) segments.push({ ms: Number(event.tStartMs || 0), text });
		}

		return segments;
	}

	function parseXml(text) {
		try {
			const parser = new DOMParser();
			const doc = parser.parseFromString(text, "text/xml");
			const nodes = Array.from(doc.querySelectorAll("text"));
			const segments = [];

			for (const node of nodes) {
				const value = String(node.textContent || "")
					.replace(/\n/g, " ")
					.replace(/\s+/g, " ")
					.trim();

				if (value) {
					segments.push({
						ms: Math.round(Number(node.getAttribute("start") || 0) * 1000),
						text: value,
					});
				}
			}

			return segments;
		} catch (_error) {
			return [];
		}
	}

	function parseVtt(text) {
		const segments = [];
		const blocks = String(text).split(/\r?\n\r?\n/);

		for (const block of blocks) {
			const lines = block.split(/\r?\n/).filter(Boolean);
			let timeLine = "";
			const textLines = [];

			for (const line of lines) {
				if (line.includes("-->")) {
					timeLine = line;
				} else if (timeLine && !/^(WEBVTT|NOTE|STYLE|REGION)/i.test(line)) {
					textLines.push(line.replace(/<[^>]+>/g, "").trim());
				}
			}

			if (!timeLine) continue;

			const match = timeLine.match(/(\d+):(\d+):(\d+)[.,](\d+)/);
			if (!match) continue;

			const text = textLines.join(" ").replace(/\s+/g, " ").trim();
			if (!text) continue;

			segments.push({
				ms: Number(match[1]) * 3600000 + Number(match[2]) * 60000 + Number(match[3]) * 1000 + Number(match[4]),
				text,
			});
		}

		return segments;
	}

	function parseSubtitles(text) {
		if (!text) return [];
		const trimmed = String(text).trim();
		if (!trimmed) return [];

		if (trimmed.startsWith("{")) {
			try {
				const segments = parseJson3(JSON.parse(trimmed));
				if (segments.length) return segments;
			} catch (_error) {
				/* fallthrough */
			}
		}

		if (trimmed.startsWith("<")) {
			const segments = parseXml(trimmed);
			if (segments.length) return segments;
		}

		if (/WEBVTT/i.test(trimmed)) {
			const segments = parseVtt(trimmed);
			if (segments.length) return segments;
		}

		return [];
	}

	// ------------------------------------------------------------------
	// Step 1: timedtext (может не работать без POT — но пробуем)
	// ------------------------------------------------------------------

	function buildTimedTextUrls(baseUrl, fmt) {
		const cleaned = String(baseUrl || "").replace(/[?&]fmt=[^&]*/g, "");
		const withoutVariant = cleaned.replace(/[?&]variant=[^&]*/g, "");

		function addFmt(url, f) {
			if (!f) return url;
			const sep = url.includes("?") ? "&" : "?";
			return `${url}${sep}fmt=${f}`;
		}

		const urls = new Set();
		urls.add(addFmt(cleaned, fmt));
		urls.add(addFmt(withoutVariant, fmt));
		urls.add(addFmt(cleaned, null));
		urls.add(addFmt(withoutVariant, null));

		return Array.from(urls);
	}

	async function fetchTimedText(url) {
		try {
			const response = await fetchWithTimeout(url, { credentials: "include" });
			if (!response.ok) return null;
			const text = await response.text();
			return text || null;
		} catch (_error) {
			return null;
		}
	}

	async function fetchSegmentsFromTrack(track) {
		const formats = ["json3", "vtt", "srv3", "srv1", null];
		for (const fmt of formats) {
			const urls = buildTimedTextUrls(track.baseUrl, fmt);
			for (const url of urls) {
				const text = await fetchTimedText(url);
				if (!text) continue;
				const segments = parseSubtitles(text);
				if (segments.length > 0) {
					return { segments, format: fmt || "xml" };
				}
			}
		}
		return { segments: [], format: null };
	}

	// ------------------------------------------------------------------
	// Step 2: InnerTube clients
	// ------------------------------------------------------------------

	const INNERTUBE_CLIENTS = [
		{
			name: "web",
			apiKey: null, // возьмём из ytcfg
			contextFrom: "ytcfg",
			headers: {},
		},
		{
			name: "tv-embedded",
			apiKey: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
			context: {
				client: {
					clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
					clientVersion: "2.0",
					hl: "en",
					gl: "US",
				},
				thirdParty: { embedUrl: "https://www.youtube.com/" },
			},
			headers: {},
		},
		{
			name: "android-vr",
			apiKey: "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w",
			context: {
				client: {
					clientName: "ANDROID_VR",
					clientVersion: "1.60.19",
					deviceMake: "Oculus",
					deviceModel: "Quest 3",
					androidSdkVersion: 32,
					userAgent: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; GB) gzip",
					hl: "en",
					gl: "US",
					timeZone: "UTC",
					utcOffsetMinutes: 0,
				},
			},
			headers: {
				"X-Youtube-Client-Name": "28",
				"X-Youtube-Client-Version": "1.60.19",
			},
		},
		{
			name: "android",
			apiKey: "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w",
			context: {
				client: {
					clientName: "ANDROID",
					clientVersion: "19.44.38",
					androidSdkVersion: 30,
					userAgent: "com.google.android.youtube/19.44.38 (Linux; U; Android 11) gzip",
					hl: "en",
					gl: "US",
					timeZone: "UTC",
					utcOffsetMinutes: 0,
				},
			},
			headers: {
				"X-Youtube-Client-Name": "3",
				"X-Youtube-Client-Version": "19.44.38",
			},
		},
	];

	function getWebContext() {
		try {
			const ytcfg = globalThis.ytcfg;
			if (!ytcfg || typeof ytcfg.get !== "function") return null;
			const apiKey = ytcfg.get("INNERTUBE_API_KEY");
			const context = ytcfg.get("INNERTUBE_CONTEXT");
			const visitorData = ytcfg.get("VISITOR_DATA");
			if (!apiKey || !context) return null;
			return {
				apiKey,
				context,
				headers: visitorData ? { "X-Goog-Visitor-Id": visitorData } : {},
			};
		} catch (_error) {
			return null;
		}
	}

	async function fetchViaInnertube(videoId, client) {
		let apiKey = client.apiKey;
		let context = client.context;
		let extraHeaders = { ...(client.headers || {}) };

		if (client.contextFrom === "ytcfg") {
			const web = getWebContext();
			if (!web) return null;
			apiKey = web.apiKey;
			context = web.context;
			extraHeaders = { ...extraHeaders, ...web.headers };
		}

		try {
			const url = `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey || "")}&prettyPrint=false`;
			const response = await fetchWithTimeout(url, {
				method: "POST",
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
					"X-Origin": "https://www.youtube.com",
					...extraHeaders,
				},
				body: JSON.stringify({ videoId, context }),
			});

			if (!response.ok) return null;
			return await response.json();
		} catch (_error) {
			return null;
		}
	}

	// ------------------------------------------------------------------
	// Step 3: DOM transcript panel — самый надёжный путь
	// ------------------------------------------------------------------

	async function ensureDescriptionExpanded() {
		const expander = document.querySelector("ytd-text-inline-expander");
		if (!expander) return;

		const button = expander.querySelector("tp-yt-paper-button#expand, #expand");
		if (!button) return;

		// Кнопка невидима, если описание уже развёрнуто.
		if (button.offsetParent === null) return;

		button.click();
		await sleep(250);
	}

	function findTranscriptButton() {
		const selectors = [
			"ytd-video-description-transcript-section-renderer button",
			"ytd-video-description-transcript-section-renderer .yt-spec-button-shape-next",
			'button[aria-label*="transcript" i]',
			'button[aria-label*="расшифров" i]',
			'button[aria-label*="субтит" i]',
		];

		for (const selector of selectors) {
			const el = document.querySelector(selector);
			if (el) return el;
		}

		return null;
	}

	async function waitForTranscriptSegments(timeoutMs) {
		const startedAt = Date.now();
		while (Date.now() - startedAt < timeoutMs) {
			const segments = document.querySelectorAll("ytd-transcript-segment-renderer");
			if (segments.length > 0) return Array.from(segments);
			await sleep(150);
		}
		return [];
	}

	async function loadAllTranscriptSegments() {
		let lastCount = 0;
		let stableRounds = 0;

		for (let i = 0; i < 400; i += 1) {
			const segments = document.querySelectorAll("ytd-transcript-segment-renderer");
			const count = segments.length;

			if (count === lastCount) {
				stableRounds += 1;
				if (stableRounds >= 5) return;
			} else {
				stableRounds = 0;
				lastCount = count;
			}

			const last = segments[count - 1];
			if (last) {
				try {
					last.scrollIntoView({ block: "end" });
				} catch (_error) {
					/* ignore */
				}
			}

			await sleep(150);
		}
	}

	function readTranscriptSegments() {
		const nodes = document.querySelectorAll("ytd-transcript-segment-renderer");
		const result = [];

		for (const node of nodes) {
			const tsEl = node.querySelector(".segment-timestamp");
			const textEl = node.querySelector(".segment-text");

			const timestamp = tsEl?.textContent?.trim() || "";
			const text = textEl?.textContent?.trim() || "";

			if (!text) continue;

			result.push({
				ms: parseTimestamp(timestamp),
				text,
			});
		}

		return result;
	}

	function closeTranscriptPanel() {
		// Приоритет — кнопка закрытия внутри самой панели.
		const panel = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id*="transcript"]');
		if (panel) {
			const closeBtn = panel.querySelector('#visibility-button button, button[aria-label*="Close" i], button[aria-label*="Закры" i]');
			if (closeBtn) {
				try {
					closeBtn.click();
					return;
				} catch (_error) {
					/* fallthrough */
				}
			}
		}

		// Фолбэк — повторный клик по «Show transcript».
		const toggle = document.querySelector('ytd-video-description-transcript-section-renderer button[aria-expanded="true"]');
		if (toggle) {
			try {
				toggle.click();
			} catch (_error) {
				/* ignore */
			}
		}
	}

	async function extractFromTranscriptPanel() {
		const alreadyOpen = document.querySelectorAll("ytd-transcript-segment-renderer").length > 0;

		if (!alreadyOpen) {
			await ensureDescriptionExpanded();

			const button = findTranscriptButton();
			if (!button) return null;

			button.click();
		}

		const waitMs = alreadyOpen ? 200 : 8000;
		const initial = await waitForTranscriptSegments(waitMs);
		if (initial.length === 0) {
			if (!alreadyOpen) closeTranscriptPanel();
			return null;
		}

		await loadAllTranscriptSegments();

		const segments = readTranscriptSegments();

		if (!alreadyOpen) {
			closeTranscriptPanel();
		}

		return segments.length > 0 ? segments : null;
	}

	// ------------------------------------------------------------------
	// Segment merging
	// ------------------------------------------------------------------

	function mergeSegments(segments) {
		const result = [];
		for (const segment of segments) {
			const text = String(segment?.text || "").trim();
			if (!text) continue;

			if (text.length <= MIN_SEGMENT_LEN && result.length > 0) {
				result[result.length - 1].text = `${result[result.length - 1].text} ${text}`;
				continue;
			}

			result.push({ ms: segment.ms, text });
		}
		return result;
	}

	function formatSegments(segments) {
		return segments.map((seg) => `[${formatTime(seg.ms)}] ${seg.text}`).join("\n");
	}

	// ------------------------------------------------------------------
	// Orchestration
	// ------------------------------------------------------------------

	function buildResult(result, playerResponse, videoId, videoUrl, fallbackTitle, debug) {
		const subtitles = formatSegments(result.segments);

		return {
			ok: true,
			subtitles,
			title: String(playerResponse?.videoDetails?.title || fallbackTitle || document.title || ""),
			author: String(playerResponse?.videoDetails?.author || ""),
			videoId: String(playerResponse?.videoDetails?.videoId || videoId),
			url: videoUrl,
			language: String(result.track?.languageCode || ""),
			autoGenerated: result.track?.kind === "asr",
			chars: subtitles.length,
			segmentCount: result.segments.length,
			format: result.format || null,
			source: result.source,
			debug,
		};
	}

	async function extract() {
		const videoId = getVideoIdFromUrl();
		if (!videoId) {
			return { ok: false, reason: "Not a YouTube video page" };
		}

		const debug = [];

		let playerResponse = readPlayerResponseFromPage();
		debug.push(playerResponse ? "playerResponse: from page" : "playerResponse: empty");

		if (!playerResponse) {
			playerResponse = await refetchPlayerResponse(videoId);
			debug.push(playerResponse ? "playerResponse: refetched" : "playerResponse: unavailable");
		}

		const fallbackTitle = String(playerResponse?.videoDetails?.title || document.title || "");
		const videoUrl = `https://www.youtube.com/watch?v=${playerResponse?.videoDetails?.videoId || videoId}`;

		// --- Step 1: существующий player response -------------------------
		let tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

		if (tracks.length > 0) {
			const track = pickBestTrack(tracks);
			if (track?.baseUrl) {
				const { segments, format } = await fetchSegmentsFromTrack(track);
				if (segments.length > 0) {
					debug.push(`page timedtext: ok (${format})`);
					return buildResult(
						{
							segments: mergeSegments(segments),
							track,
							format,
							source: "page timedtext",
						},
						playerResponse,
						videoId,
						videoUrl,
						fallbackTitle,
						debug,
					);
				}
				debug.push("page timedtext: empty");
			}
		} else {
			debug.push("page response: no tracks");
		}

		// --- Step 2: fresh refetch ---------------------------------------
		const freshResponse = await refetchPlayerResponse(videoId);
		if (freshResponse) {
			const freshTracks = freshResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

			if (freshTracks.length > 0) {
				const track = pickBestTrack(freshTracks);
				if (track?.baseUrl) {
					const { segments, format } = await fetchSegmentsFromTrack(track);
					if (segments.length > 0) {
						debug.push(`fresh timedtext: ok (${format})`);
						return buildResult(
							{
								segments: mergeSegments(segments),
								track,
								format,
								source: "fresh timedtext",
							},
							freshResponse,
							videoId,
							videoUrl,
							fallbackTitle,
							debug,
						);
					}
					debug.push("fresh timedtext: empty");
				}
			}

			tracks = freshTracks.length > 0 ? freshTracks : tracks;
			playerResponse = freshResponse;
		}

		// --- Step 3: InnerTube с несколькими клиентами -------------------
		for (const client of INNERTUBE_CLIENTS) {
			const response = await fetchViaInnertube(videoId, client);
			const clientTracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

			if (clientTracks.length === 0) {
				debug.push(`innertube ${client.name}: no tracks`);
				continue;
			}

			const track = pickBestTrack(clientTracks);
			if (!track?.baseUrl) {
				debug.push(`innertube ${client.name}: no baseUrl`);
				continue;
			}

			const { segments, format } = await fetchSegmentsFromTrack(track);
			if (segments.length === 0) {
				debug.push(`innertube ${client.name}: timedtext empty`);
				continue;
			}

			debug.push(`innertube ${client.name}: ok`);
			return buildResult(
				{
					segments: mergeSegments(segments),
					track,
					format,
					source: `innertube ${client.name}`,
				},
				response,
				videoId,
				videoUrl,
				fallbackTitle,
				debug,
			);
		}

		// --- Step 4: DOM transcript panel --------------------------------
		// Пробуем даже если tracks пусто — иногда панель рендерит сегменты
		// без tracks в playerResponse (например, из-за AI-вариантов).
		// Раньше здесь стоял `if (tracks.length > 0 || true)` — то же самое,
		// что просто блок; убрали, чтобы не сбивать с толку.
		{
			const segments = await extractFromTranscriptPanel();
			if (segments && segments.length > 0) {
				debug.push(`transcript panel: ok (${segments.length} segments)`);
				return buildResult(
					{
						segments: mergeSegments(segments),
						track: tracks.length > 0 ? pickBestTrack(tracks) : null,
						format: "transcript-panel",
						source: "transcript panel",
					},
					playerResponse,
					videoId,
					videoUrl,
					fallbackTitle,
					debug,
				);
			}
			debug.push("transcript panel: empty");
		}

		return {
			ok: false,
			reason:
				"Could not extract subtitles by any method. YouTube likely restricted the timedtext endpoint for this session, and no transcript panel is available.",
			title: fallbackTitle,
			debug,
		};
	}

	globalThis.__arenaExtractYouTube = extract;
})();
