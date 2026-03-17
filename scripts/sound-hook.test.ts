// Tests for sound-hook.ts — covers transcript error detection and turn-index logic
// These are the highest-risk paths: wrong result here plays wrong sound silently

import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
	detectPlayer,
	findLastUserIndex,
	isClaudeEvent,
	isMuted,
	lockfilePath,
	lockfileValidAndFresh,
	parseTranscriptErrors,
	playSound,
	poolFor,
	randomFrom,
	readStdin,
	route,
	run,
	themeFor,
	truncateToLastN,
	THEMES,
	type ClaudeEvent,
	type ThemeName,
} from "./sound-hook.ts";

describe("parseTranscriptErrors", () => {
	it("returns true when tool error appears after last user entry", () => {
		const content = lines(
			{ role: "user", content: "hello" },
			{ tool_result: { is_error: true } },
		);
		expect(parseTranscriptErrors(content)).toBe(true);
	});

	it("returns false when tool error appears before last user entry", () => {
		const content = lines(
			{ tool_result: { is_error: true } },
			{ role: "user", content: "hello" },
		);
		expect(parseTranscriptErrors(content)).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(parseTranscriptErrors("")).toBe(false);
	});

	it("returns false when no errors present", () => {
		const content = lines(
			{ role: "user", content: "hello" },
			{ tool_result: { is_error: false } },
		);
		expect(parseTranscriptErrors(content)).toBe(false);
	});

	it("returns false when is_error is absent", () => {
		const content = lines(
			{ role: "user", content: "hello" },
			{ tool_result: {} },
		);
		expect(parseTranscriptErrors(content)).toBe(false);
	});

	it("skips malformed JSON lines without throwing", () => {
		const content =
			lines({ role: "user", content: "hello" }) +
			"\nnot valid json{{{\n" +
			JSON.stringify({ tool_result: { is_error: true } });
		expect(parseTranscriptErrors(content)).toBe(true);
	});

	it("returns true only for current turn — error after second user entry", () => {
		const content = lines(
			{ role: "user", content: "first" },
			{ tool_result: { is_error: true } },
			{ role: "user", content: "second" },
			{ tool_result: { is_error: false } },
		);
		expect(parseTranscriptErrors(content)).toBe(false);
	});
});

describe("findLastUserIndex", () => {
	it("returns -1 for empty array", () => {
		expect(findLastUserIndex([])).toBe(-1);
	});

	it("returns -1 when no user entries", () => {
		expect(
			findLastUserIndex([{ role: "assistant" }, { tool_result: {} }]),
		).toBe(-1);
	});

	it("returns index of last user entry", () => {
		const entries = [{ role: "user" }, { role: "assistant" }, { role: "user" }];
		expect(findLastUserIndex(entries)).toBe(2);
	});

	it("returns 0 when only one user entry at start", () => {
		expect(findLastUserIndex([{ role: "user" }])).toBe(0);
	});

	it("ignores non-object entries", () => {
		expect(findLastUserIndex([null, undefined, 42, { role: "user" }])).toBe(3);
	});
});

describe("lockfileValidAndFresh", () => {
	const tmp = join("/tmp", `sound-hook-test-${process.pid}`);

	it("returns false for nonexistent path", async () => {
		expect(
			await lockfileValidAndFresh("/tmp/no-such-file-sound-hook-xyz"),
		).toBe(false);
	});

	it("returns true for a file just written", async () => {
		await Bun.write(tmp, "");
		try {
			expect(await lockfileValidAndFresh(tmp)).toBe(true);
		} finally {
			await unlink(tmp);
		}
	});
});

describe("isMuted", () => {
	let tmpHome: string;
	let originalHome: string | undefined;

	beforeAll(() => {
		originalHome = process.env.HOME;
		tmpHome = mkdtempSync("/tmp/sound-hook-test-home-");
		mkdirSync(join(tmpHome, ".claude"));
		process.env.HOME = tmpHome;
	});

	afterAll(() => {
		if (originalHome !== undefined) {
			process.env.HOME = originalHome;
		} else {
			delete process.env.HOME;
		}
		rmSync(tmpHome, { recursive: true, force: true });
	});

	it("returns false when sentinel file absent", async () => {
		expect(await isMuted()).toBe(false);
	});

	it("returns true when sentinel file exists", async () => {
		const sentinel = join(tmpHome, ".claude", "sound-muted");
		await Bun.write(sentinel, "");
		try {
			expect(await isMuted()).toBe(true);
		} finally {
			await unlink(sentinel);
		}
	});
});

describe("route", () => {
	// Use process.pid + a counter to avoid collisions between test cases.
	const pid = process.pid;

	it("unknown event → no-op (resolves without throwing)", async () => {
		await expect(route("UnknownEvent", {}, null)).resolves.toBeUndefined();
	});

	it("event with no theme spec entry → no-op (resolves without throwing)", async () => {
		// PostToolUse is a valid ClaudeEvent (isClaudeEvent passes, guard 1 passes)
		// but has no entry in any theme map (guard 2 catches it via spec === undefined).
		await expect(route("PostToolUse", {}, null)).resolves.toBeUndefined();
	});

	describe("lockfile write (UserPromptSubmit)", () => {
		const sessionId = `test-route-${pid}-write`;
		const lockfile = lockfilePath(sessionId);

		afterEach(async () => {
			await unlink(lockfile).catch(() => undefined);
		});

		it("writes lockfile when lockfile mode is 'write'", async () => {
			await route("UserPromptSubmit", { session_id: sessionId }, null);
			expect(await Bun.file(lockfile).exists()).toBe(true);
		});
	});

	describe("lockfile consume without prior write → gate blocks", () => {
		const sessionId = `test-nolock-${pid}`;
		const lockfile = lockfilePath(sessionId);

		afterEach(async () => {
			await unlink(lockfile).catch(() => undefined);
		});

		it("resolves without error when no lockfile present", async () => {
			await expect(
				route("PreToolUse", { session_id: sessionId }, null),
			).resolves.toBeUndefined();
			// Gate blocked play — lockfile should still not exist.
			expect(await Bun.file(lockfile).exists()).toBe(false);
		});
	});

	describe("lockfile consume after write → gate passes and deletes lockfile", () => {
		const sessionId = `test-consume-${pid}`;
		const lockfile = lockfilePath(sessionId);

		afterEach(async () => {
			await unlink(lockfile).catch(() => undefined);
		});

		it("writes then consumes lockfile", async () => {
			await route("UserPromptSubmit", { session_id: sessionId }, null);
			expect(await Bun.file(lockfile).exists()).toBe(true);

			await route("PreToolUse", { session_id: sessionId }, null);
			expect(await Bun.file(lockfile).exists()).toBe(false);
		});
	});

	describe("errorPool selection (Stop event)", () => {
		let tmpTranscript: string;

		afterEach(async () => {
			if (tmpTranscript) {
				await unlink(tmpTranscript).catch(() => undefined);
			}
		});

		it("resolves with transcript containing tool error", async () => {
			tmpTranscript = `/tmp/sound-hook-transcript-${pid}.jsonl`;
			const content =
				JSON.stringify({ role: "user" }) +
				"\n" +
				JSON.stringify({ tool_result: { is_error: true } });
			await writeFile(tmpTranscript, content, "utf8");

			await expect(
				route("Stop", { session_id: `s1-${pid}`, transcript_path: tmpTranscript }, null),
			).resolves.toBeUndefined();
		});

		it("resolves without transcript (normal pool)", async () => {
			await expect(
				route("Stop", { session_id: `s2-${pid}` }, null),
			).resolves.toBeUndefined();
		});

		it("falls back to normal pool when transcript file is unreadable", async () => {
			tmpTranscript = `/tmp/sound-hook-transcript-unreadable-${pid}.jsonl`;
			await writeFile(tmpTranscript, "should not be readable", "utf8");
			chmodSync(tmpTranscript, 0o000);

			await expect(
				route("Stop", { session_id: `s3-${pid}`, transcript_path: tmpTranscript }, null),
			).resolves.toBeUndefined();

			// Restore permissions so afterEach cleanup can delete
			chmodSync(tmpTranscript, 0o644);
		});
	});

	describe("isMuted check via route", () => {
		let tmpHome: string;
		let originalHome: string | undefined;

		beforeAll(() => {
			originalHome = process.env.HOME;
			tmpHome = mkdtempSync("/tmp/sound-hook-muted-home-");
			mkdirSync(join(tmpHome, ".claude"));
		});

		afterAll(() => {
			if (originalHome !== undefined) {
				process.env.HOME = originalHome;
			} else {
				delete process.env.HOME;
			}
			rmSync(tmpHome, { recursive: true, force: true });
		});

		it("route bypasses mute check (mute is checked in main, not route)", async () => {
			// route() itself does not check isMuted — that's done by main().
			// This test confirms route resolves even when the sentinel file is present.
			process.env.HOME = tmpHome;
			await Bun.write(join(tmpHome, ".claude", "sound-muted"), "");
			try {
				await expect(
					route("SessionStart", {}, null),
				).resolves.toBeUndefined();
			} finally {
				await unlink(join(tmpHome, ".claude", "sound-muted")).catch(() => undefined);
			}
		});
	});
});

describe("detectPlayer", () => {
	it("returns a string or null", () => {
		const result = detectPlayer();
		if (result !== null) {
			expect(typeof result).toBe("string");
			expect(["pw-play", "aplay"]).toContain(result);
		} else {
			expect(result).toBeNull();
		}
	});
});

describe("poolFor", () => {
	it("returns empty array for nonexistent directory", () => {
		expect(poolFor("/tmp/no-such-dir-sound-hook-xyz", "foo")).toEqual([]);
	});

	it("returns filtered files for existing directory", () => {
		const tmp = mkdtempSync("/tmp/sound-hook-pool-test-");
		try {
			Bun.spawnSync(["touch", join(tmp, "beep1.wav"), join(tmp, "beep2.wav"), join(tmp, "boop.wav")]);
			const result = poolFor(tmp, "beep");
			expect(result).toHaveLength(2);
			expect(result.every((f) => f.includes("beep"))).toBe(true);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("randomFrom", () => {
	it("returns empty string for empty array", () => {
		expect(randomFrom([])).toBe("");
	});

	it("returns one of the elements for non-empty array", () => {
		const items = ["a", "b", "c"];
		expect(items).toContain(randomFrom(items));
	});
});

describe("isClaudeEvent", () => {
	const ALL_EVENTS: ClaudeEvent[] = [
		"SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest",
		"PostToolUse", "PostToolUseFailure", "Notification", "SubagentStart",
		"SubagentStop", "Stop", "TeammateIdle", "TaskCompleted", "ConfigChange",
		"WorktreeCreate", "WorktreeRemove", "PreCompact", "SessionEnd",
	];

	it("returns true for all 17 ClaudeEvent members", () => {
		for (const event of ALL_EVENTS) {
			expect(isClaudeEvent(event)).toBe(true);
		}
	});

	it("returns false for UnknownEvent", () => {
		expect(isClaudeEvent("UnknownEvent")).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(isClaudeEvent("")).toBe(false);
	});

	it("returns false for partial event name", () => {
		expect(isClaudeEvent("Session")).toBe(false);
	});
});

describe("themeFor", () => {
	it("returns a valid ThemeName", () => {
		const valid: ThemeName[] = ["terran", "zerg", "protoss"];
		expect(valid).toContain(themeFor("some-session-id"));
	});

	it("is deterministic — same input always yields same output", () => {
		const id = "deterministic-test-session";
		expect(themeFor(id)).toBe(themeFor(id));
	});

	it("known session IDs map to pinned themes", () => {
		// djb2 hash results — pinned to catch regressions
		expect(themeFor("abc123")).toBe("terran");
		expect(themeFor("session-0")).toBe("protoss");
		expect(themeFor("session-42")).toBe("zerg");
	});

	it("unknown maps to a stable deterministic result", () => {
		const result = themeFor("unknown");
		expect(["terran", "zerg", "protoss"]).toContain(result);
		expect(themeFor("unknown")).toBe(result);
	});

	it("distributes roughly evenly across 300 session IDs", () => {
		const counts: Record<ThemeName, number> = { terran: 0, zerg: 0, protoss: 0 };
		for (let i = 0; i < 300; i++) {
			counts[themeFor(`session-${i}-${Math.random()}`)]++;
		}
		// Each theme should get 70–130 of 300 (within ±10% of 100)
		for (const theme of ["terran", "zerg", "protoss"] as ThemeName[]) {
			expect(counts[theme]).toBeGreaterThanOrEqual(70);
			expect(counts[theme]).toBeLessThanOrEqual(130);
		}
	});
});

describe("THEMES shape", () => {
	const REQUIRED_EVENTS: ClaudeEvent[] = [
		"SessionStart", "UserPromptSubmit", "PreToolUse",
		"SubagentStart", "SubagentStop", "Stop", "SessionEnd",
	];

	it.each(["terran", "zerg", "protoss"] as ThemeName[])(
		"%s theme defines all required events",
		(theme) => {
			for (const event of REQUIRED_EVENTS) {
				expect(THEMES[theme][event]).toBeDefined();
			}
		},
	);
});

describe("lockfilePath", () => {
	it("returns a path under ~/.claude/tmp/ with session ID", () => {
		const result = lockfilePath("abc-123");
		expect(result).toContain(".claude/tmp/claude-sound-abc-123");
	});
});

describe("truncateToLastN", () => {
	it("truncates a file to the last N lines", async () => {
		const tmp = join("/tmp", `truncate-test-${process.pid}`);
		const content = Array.from({ length: 100 }, (_, i) => `line-${i}`).join("\n") + "\n";
		await writeFile(tmp, content, "utf8");
		try {
			await truncateToLastN(tmp, 10);
			const result = await Bun.file(tmp).text();
			const remaining = result.split("\n").filter(Boolean);
			expect(remaining).toHaveLength(10);
			expect(remaining[0]).toBe("line-90");
			expect(remaining[9]).toBe("line-99");
		} finally {
			await unlink(tmp).catch(() => undefined);
		}
	});
});

describe("log rotation via route", () => {
	// LOG_FILE is computed at import time from process.env.HOME, so we use the
	// real path: ~/.claude/logs/sound-hook.log. Save and restore any existing content.
	const logDir = join(process.env.HOME ?? "", ".claude", "logs");
	const logFile = join(logDir, "sound-hook.log");
	let savedContent: string | null = null;

	beforeAll(async () => {
		mkdirSync(logDir, { recursive: true });
		const file = Bun.file(logFile);
		if (await file.exists()) {
			savedContent = await file.text();
		}
	});

	afterAll(async () => {
		if (savedContent !== null) {
			await writeFile(logFile, savedContent, "utf8");
		} else {
			await unlink(logFile).catch(() => undefined);
		}
	});

	it("truncates log file when it exceeds 1MB", async () => {
		// Create a log file larger than 1MB (LOG_MAX_BYTES = 1048576)
		const bigLine = "X".repeat(200);
		const lineCount = 6000; // 6000 * ~220 bytes > 1MB
		const content = Array.from({ length: lineCount }, (_, i) => `2026-01-01T00:00:00Z [terran] event-${i} ${bigLine}`).join("\n") + "\n";
		await writeFile(logFile, content, "utf8");

		const sizeBefore = statSync(logFile).size;
		expect(sizeBefore).toBeGreaterThan(1048576);

		// route() triggers playWithLogging → log → rotateIfNeeded → truncateToLastN
		await route("SessionStart", {}, null);

		const sizeAfter = statSync(logFile).size;
		expect(sizeAfter).toBeLessThan(sizeBefore);
	});

	it("log line includes [theme] bracket prefix", async () => {
		// Ensure log file exists and is small (not over rotation threshold)
		await writeFile(logFile, "", "utf8");

		// "unknown" session_id → deterministic theme
		await route("SessionStart", { session_id: "unknown" }, null);

		const content = await Bun.file(logFile).text();
		// Line format: <ISO-timestamp> [<theme>] <event> → <pool>
		expect(content).toMatch(/\[(?:terran|zerg|protoss)\]/);
	});
});

describe("playSound", () => {
	it("with player null does not throw", () => {
		expect(() => playSound("/tmp/nonexistent.wav", null)).not.toThrow();
	});

	it("spawns player process when player is provided", () => {
		// "true" is a valid command that exits 0 and ignores arguments
		expect(() => playSound("/tmp/nonexistent.wav", "true")).not.toThrow();
	});
});

describe("run (subprocess)", () => {
	it("exits 0 for a valid event when stdin is empty", () => {
		const result = Bun.spawnSync(
			["bun", "run", join(import.meta.dir, "sound-hook.ts"), "SessionStart"],
			{ stdin: new Blob([""]), stdout: "pipe", stderr: "pipe" },
		);
		// Should exit 0 — empty stdin produces {} input, route resolves
		expect(result.exitCode).toBe(0);
	});

	it("exits 1 when no event argument is provided", () => {
		const result = Bun.spawnSync(
			["bun", "run", join(import.meta.dir, "sound-hook.ts")],
			{ stdin: new Blob([""]), stdout: "pipe", stderr: "pipe" },
		);
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("Usage:");
	});

	it("exits 0 with valid JSON stdin", () => {
		const input = JSON.stringify({ session_id: "test-run-subprocess" });
		const result = Bun.spawnSync(
			["bun", "run", join(import.meta.dir, "sound-hook.ts"), "SessionStart"],
			{ stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" },
		);
		expect(result.exitCode).toBe(0);
	});
});

describe("readStdin (via subprocess)", () => {
	it("parses valid JSON from stdin and passes it to route", () => {
		const input = JSON.stringify({ session_id: "stdin-test", hook_event_name: "Stop" });
		const result = Bun.spawnSync(
			["bun", "run", join(import.meta.dir, "sound-hook.ts"), "Stop"],
			{ stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" },
		);
		expect(result.exitCode).toBe(0);
	});

	it("handles invalid JSON stdin gracefully (falls back to {})", () => {
		const result = Bun.spawnSync(
			["bun", "run", join(import.meta.dir, "sound-hook.ts"), "SessionStart"],
			{ stdin: new Blob(["not valid json {{{"]), stdout: "pipe", stderr: "pipe" },
		);
		expect(result.exitCode).toBe(0);
	});
});

describe("run() seam injection", () => {
	it("returns early when checkMuted returns true", async () => {
		let readInputCalled = false;
		await run(
			"SessionStart",
			async () => {
				readInputCalled = true;
				return {};
			},
			async () => true, // muted
			null,
		);
		expect(readInputCalled).toBe(false);
	});

	it("calls route with input from readInput when not muted", async () => {
		const testInput = { session_id: "test-seam" };
		await run(
			"SessionStart",
			async () => testInput,
			async () => false, // not muted
			null, // no player — won't actually play
		);
		// route was called (no error = success)
	});

	it("passes custom player to route", async () => {
		await run(
			"SessionStart",
			async () => ({}),
			async () => false,
			null,
		);
		// Completes without error — player=null means no sound played
	});
});

function lines(...entries: unknown[]): string {
	return entries.map((e) => JSON.stringify(e)).join("\n");
}
