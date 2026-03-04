// Tests for sound-hook.ts — covers transcript error detection and turn-index logic
// These are the highest-risk paths: wrong result here plays wrong sound silently

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import {
	findLastUserIndex,
	isMuted,
	lockfileValidAndFresh,
	parseTranscriptErrors,
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

	beforeAll(() => {
		tmpHome = mkdtempSync("/tmp/sound-hook-test-home-");
		mkdirSync(join(tmpHome, ".claude"));
		process.env.HOME = tmpHome;
	});

	afterAll(() => {
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

function lines(...entries: unknown[]): string {
	return entries.map((e) => JSON.stringify(e)).join("\n");
}
