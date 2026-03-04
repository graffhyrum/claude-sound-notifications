// Sound notification hook for Claude Code lifecycle events
// Edit EVENT_SOUNDS to add, remove, or remap audio pools per event

import { mkdirSync, readdirSync } from "node:fs";
import { appendFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const PLUGIN_ROOT =
	process.env.CLAUDE_PLUGIN_ROOT ?? join(import.meta.dir, "..");
const SCV = join(PLUGIN_ROOT, "sounds", "SCV");
const ADVISOR = join(PLUGIN_ROOT, "sounds", "Advisor");
const MISC = join(PLUGIN_ROOT, "sounds", "misc");
const LOCKFILE_TTL_MS = 60_000;
const LOG_DIR = join(process.env.HOME ?? homedir(), ".claude", "logs");
const LOG_FILE = join(LOG_DIR, "sound-hook.log");
const PLAYER = detectPlayer();

type ClaudeEvent =
	| "SessionStart"
	| "UserPromptSubmit"
	| "PreToolUse"
	| "PermissionRequest"
	| "PostToolUse"
	| "PostToolUseFailure"
	| "Notification"
	| "SubagentStart"
	| "SubagentStop"
	| "Stop"
	| "TeammateIdle"
	| "TaskCompleted"
	| "ConfigChange"
	| "WorktreeCreate"
	| "WorktreeRemove"
	| "PreCompact"
	| "SessionEnd";

type SoundSpec = {
	dir: string;
	pool: string;
	errorPool?: string;
	// "write" marks turn start; "consume" plays only once per turn, not per tool call
	lockfile?: "write" | "consume";
};

type HookInput = {
	session_id?: string;
	transcript_path?: string;
	tool_result?: { is_error?: boolean };
	hook_event_name?: string;
};

const EVENT_SOUNDS: Partial<Record<ClaudeEvent, SoundSpec>> = {
	SessionStart: { dir: ADVISOR, pool: "adjutant_online" },
	UserPromptSubmit: { dir: SCV, pool: "tscyes", lockfile: "write" },
	PreToolUse: { dir: SCV, pool: "tscyes", lockfile: "consume" },
	PermissionRequest: { dir: SCV, pool: "tscpss" },
	PostToolUseFailure: { dir: ADVISOR, pool: "need" },
	Notification: { dir: MISC, pool: "scanner" },
	SubagentStart: { dir: SCV, pool: "tscrdy" },
	SubagentStop: { dir: SCV, pool: "tadupd", errorPool: "tscpss" },
	Stop: { dir: ADVISOR, pool: "complete", errorPool: "need" },
	TeammateIdle: { dir: SCV, pool: "tscpss" },
	TaskCompleted: { dir: ADVISOR, pool: "tadupd" },
	WorktreeCreate: { dir: MISC, pool: "liftoff" },
	WorktreeRemove: { dir: MISC, pool: "land" },
	PreCompact: { dir: MISC, pool: "getin" },
	SessionEnd: { dir: ADVISOR, pool: "complete", errorPool: "landing" },
};

async function main(event: string): Promise<void> {
	if (await isMuted()) return;
	const input = await readStdin();
	await route(event, input);
}

export async function isMuted(): Promise<boolean> {
	const home = process.env.HOME ?? homedir();
	return Bun.file(`${home}/.claude/sound-muted`).exists();
}

export async function route(event: string, input: HookInput): Promise<void> {
	const spec = EVENT_SOUNDS[event as ClaudeEvent];
	if (!spec) return;
	await dispatch(spec, input);
}

async function dispatch(spec: SoundSpec, input: HookInput): Promise<void> {
	const sessionId = input.session_id ?? "unknown";
	await writeLockfileIfNeeded(spec.lockfile, sessionId);
	if (!(await passesTurnGate(spec.lockfile, sessionId))) return;
	await playWithLogging(spec, input.transcript_path, input.hook_event_name);
}

async function writeLockfileIfNeeded(
	lockfile: SoundSpec["lockfile"],
	sessionId: string,
): Promise<void> {
	if (lockfile === "write") await Bun.write(lockfilePath(sessionId), "");
}

async function passesTurnGate(
	lockfile: SoundSpec["lockfile"],
	sessionId: string,
): Promise<boolean> {
	if (lockfile !== "consume") return true;
	return consumeLockfile(sessionId);
}

async function playWithLogging(
	spec: SoundSpec,
	transcriptPath?: string,
	eventName?: string,
): Promise<void> {
	const pool = await resolvePool(spec, transcriptPath);
	play(spec.dir, pool);
	await log(eventName ?? "unknown", pool);
}

async function consumeLockfile(sessionId: string): Promise<boolean> {
	const path = lockfilePath(sessionId);
	if (!(await lockfileValidAndFresh(path))) return false;
	await deleteLockfile(path);
	return true;
}

async function resolvePool(
	spec: SoundSpec,
	transcriptPath?: string,
): Promise<string> {
	if (!spec.errorPool) return spec.pool;
	return (await hasErrors(transcriptPath)) ? spec.errorPool : spec.pool;
}

async function hasErrors(transcriptPath?: string): Promise<boolean> {
	if (!transcriptPath) return false;
	try {
		return parseTranscriptErrors(await Bun.file(transcriptPath).text());
	} catch {
		return false;
	}
}

export function parseTranscriptErrors(content: string): boolean {
	const entries = content.split("\n").filter(Boolean).flatMap(tryParseJson);
	const lastUserIndex = findLastUserIndex(entries);
	return entries.slice(lastUserIndex + 1).some(isToolError);
}

function tryParseJson(line: string): unknown[] {
	try {
		return [JSON.parse(line)];
	} catch {
		return [];
	}
}

function isToolError(e: unknown): boolean {
	if (typeof e !== "object" || e === null) return false;
	const entry = e as { tool_result?: { is_error?: boolean } };
	return entry.tool_result?.is_error === true;
}

function play(dir: string, pool: string): void {
	const files = poolFor(dir, pool);
	if (files.length === 0) return;
	playSound(randomFrom(files));
}

function playSound(path: string): void {
	if (!PLAYER) return;
	const proc = Bun.spawn([PLAYER, path], {
		stdout: "ignore",
		stderr: "ignore",
	});
	proc.unref();
}

function detectPlayer(): string | null {
	for (const cmd of ["pw-play", "aplay"]) {
		if (Bun.which(cmd)) return cmd;
	}
	return null;
}

function poolFor(dir: string, prefix: string): string[] {
	try {
		return readdirSync(dir)
			.filter((f) => f.startsWith(prefix))
			.map((f) => join(dir, f));
	} catch {
		return [];
	}
}

function randomFrom(files: string[]): string {
	return files[Math.floor(Math.random() * files.length)] ?? "";
}

export function findLastUserIndex(entries: unknown[]): number {
	for (let i = entries.length - 1; i >= 0; i--) {
		if (isUserEntry(entries[i])) return i;
	}
	return -1;
}

function isUserEntry(e: unknown): boolean {
	return (
		typeof e === "object" &&
		e !== null &&
		(e as Record<string, unknown>).role === "user"
	);
}

function lockfilePath(sessionId: string): string {
	return `/tmp/claude-sound-${sessionId}`;
}

export async function lockfileValidAndFresh(path: string): Promise<boolean> {
	const file = Bun.file(path);
	if (!(await file.exists())) return false;
	return Date.now() - file.lastModified < LOCKFILE_TTL_MS;
}

async function deleteLockfile(path: string): Promise<void> {
	try {
		await unlink(path);
	} catch {
		// already gone
	}
}

async function readStdin(): Promise<HookInput> {
	const raw = (await Bun.stdin.text()).trim();
	if (!raw) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
			return {};
		return parsed as HookInput;
	} catch {
		return {};
	}
}

async function log(event: string, pool: string): Promise<void> {
	try {
		await appendFile(
			LOG_FILE,
			`${new Date().toISOString()} ${event} ${pool}\n`,
		);
	} catch {
		// non-fatal: logging must never crash the hook
	}
}

if (import.meta.main) {
	mkdirSync(LOG_DIR, { recursive: true });
	const event = process.argv[2];
	if (!event) {
		console.error("Usage: sound-hook.ts <ClaudeEventName>");
		process.exit(1);
	}
	await main(event);
}
