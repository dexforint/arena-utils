// perf.js — lightweight in-extension profiler for the content script.
// Enabled via chrome.storage.local: perfDebug = true (see popup checkbox).
// When disabled, measure()/record() are cheap: one boolean check.

(() => {
	if (globalThis.ArenaPerf) {
		return;
	}

	const state = {
		enabled: false,
		stats: new Map(),
		longTasks: [],
		rafFrames: [],
	};

	const SAMPLE_CAP = 4000;
	const LONG_TASK_KEEP = 300;
	const FRAME_KEEP = 600;

	function emptyStat() {
		return { count: 0, total: 0, min: Infinity, max: 0, samples: [] };
	}

	function record(name, duration) {
		if (!state.enabled || !name) return;
		if (!Number.isFinite(duration) || duration < 0) return;

		let s = state.stats.get(name);
		if (!s) {
			s = emptyStat();
			state.stats.set(name, s);
		}

		s.count += 1;
		s.total += duration;
		if (duration < s.min) s.min = duration;
		if (duration > s.max) s.max = duration;
		if (s.samples.length < SAMPLE_CAP) s.samples.push(duration);
	}

	function measure(name, fn) {
		if (!state.enabled) return fn();
		const t0 = performance.now();
		try {
			const result = fn();
			record(name, performance.now() - t0);
			return result;
		} catch (error) {
			record(name, performance.now() - t0);
			throw error;
		}
	}

	async function measureAsync(name, fn) {
		if (!state.enabled) return fn();
		const t0 = performance.now();
		try {
			const result = await fn();
			record(name, performance.now() - t0);
			return result;
		} catch (error) {
			record(name, performance.now() - t0);
			throw error;
		}
	}

	function percentile(sorted, p) {
		if (!sorted.length) return 0;
		const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
		return sorted[idx];
	}

	function summarize() {
		const rows = [];
		for (const [name, s] of state.stats) {
			const sorted = s.samples.slice().sort((a, b) => a - b);
			rows.push({
				name,
				calls: s.count,
				avg_ms: +(s.total / s.count).toFixed(3),
				p50_ms: +percentile(sorted, 50).toFixed(3),
				p95_ms: +percentile(sorted, 95).toFixed(3),
				max_ms: +s.max.toFixed(3),
				total_ms: +s.total.toFixed(1),
			});
		}
		rows.sort((a, b) => b.total_ms - a.total_ms);
		return rows;
	}

	function report() {
		const rows = summarize();

		// eslint-disable-next-line no-console
		console.log("%c[arena-utils perf] function-level stats (sorted by total time)", "color:#4285f4;font-weight:bold");
		console.table(rows);

		const longSorted = state.longTasks.slice().sort((a, b) => a - b);
		if (longSorted.length) {
			console.log(
				`[arena-utils perf] long tasks: count=${longSorted.length}, p50=${percentile(longSorted, 50).toFixed(1)}ms, p95=${percentile(longSorted, 95).toFixed(1)}ms, max=${longSorted[longSorted.length - 1].toFixed(1)}ms`,
			);
		}

		if (state.rafFrames.length) {
			const frameSorted = state.rafFrames.slice().sort((a, b) => a - b);
			console.log(
				`[arena-utils perf] rAF intervals: samples=${frameSorted.length}, p50=${percentile(frameSorted, 50).toFixed(1)}ms, p95=${percentile(frameSorted, 95).toFixed(1)}ms, max=${frameSorted[frameSorted.length - 1].toFixed(1)}ms`,
			);
		}

		return {
			rows,
			stats: {
				longTasks: longSorted,
				rafFrames: state.rafFrames.slice(),
			},
		};
	}

	function reset() {
		state.stats.clear();
		state.longTasks = [];
		state.rafFrames = [];
	}

	// --- longtask observer (main-thread block > 50ms) ---
	let longTaskObserver = null;

	function startLongTaskObserver() {
		if (longTaskObserver) return;
		try {
			longTaskObserver = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					if (entry.duration >= 50) {
						state.longTasks.push(entry.duration);
						if (state.longTasks.length > LONG_TASK_KEEP) {
							state.longTasks.shift();
						}
					}
				}
			});
			longTaskObserver.observe({ type: "longtask", buffered: false });
		} catch (_error) {
			longTaskObserver = null;
		}
	}

	// --- rAF interval sampler: показывает пропущенные кадры ---
	let rafSamplerId = 0;
	let rafLastTs = 0;

	function startRafSampler() {
		if (rafSamplerId) return;

		function tick(ts) {
			if (!state.enabled) {
				rafSamplerId = 0;
				return;
			}
			if (rafLastTs) {
				const delta = ts - rafLastTs;
				if (delta > 0) {
					state.rafFrames.push(delta);
					if (state.rafFrames.length > FRAME_KEEP) {
						state.rafFrames.shift();
					}
				}
			}
			rafLastTs = ts;
			rafSamplerId = requestAnimationFrame(tick);
		}

		rafSamplerId = requestAnimationFrame(tick);
	}

	function stopRafSampler() {
		if (rafSamplerId) {
			cancelAnimationFrame(rafSamplerId);
			rafSamplerId = 0;
		}
		rafLastTs = 0;
	}

	function enable() {
		if (state.enabled) return;
		state.enabled = true;
		reset();
		startLongTaskObserver();
		startRafSampler();
		console.log("[arena-utils perf] profiling enabled");
	}

	function disable() {
		if (!state.enabled) return;
		state.enabled = false;
		stopRafSampler();
		console.log("[arena-utils perf] profiling disabled");
	}

	globalThis.ArenaPerf = {
		enable,
		disable,
		reset,
		report,
		measure,
		measureAsync,
		record,
		get enabled() {
			return state.enabled;
		},
	};
})();
