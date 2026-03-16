// Sound notification hook for Claude Code lifecycle events
// Edit EVENT_SOUNDS to add, remove, or remap audio pools per event
import { type } from "arktype";
import { mkdirSync, readdirSync } from "node:fs";
import { appendFile, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
const parseHookInput = type("string.json.parse").to({
    "session_id?": "string",
    "transcript_path?": "string",
    "tool_result?": { "is_error?": "boolean" },
    "hook_event_name?": "string",
});
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? join(import.meta.dir, "..");
const SCV = join(PLUGIN_ROOT, "sounds", "SCV");
const ADVISOR = join(PLUGIN_ROOT, "sounds", "Advisor");
const MISC = join(PLUGIN_ROOT, "sounds", "misc");
const LOCKFILE_TTL_MS = 60000;
const LOG_DIR = join(process.env.HOME ?? homedir(), ".claude", "logs");
const LOG_FILE = join(LOG_DIR, "sound-hook.log");
const LOG_MAX_BYTES = 1048576; // 1 MB
const LOG_KEEP_LINES = 1000;
export type ClaudeEvent = "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PermissionRequest" | "PostToolUse" | "PostToolUseFailure" | "Notification" | "SubagentStart" | "SubagentStop" | "Stop" | "TeammateIdle" | "TaskCompleted" | "ConfigChange" | "WorktreeCreate" | "WorktreeRemove" | "PreCompact" | "SessionEnd";
type SoundSpec = {
    dir: string;
    pool: string;
    errorPool?: string;
    // "write" marks turn start; "consume" plays only once per turn, not per tool call
    lockfile?: "write" | "consume";
};
type HookInput = typeof parseHookInput.infer;
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
    SessionEnd: { dir: ADVISOR, pool: "nuke_detected", errorPool: "landing" },
};
export async function run(
    event: string,
    readInput: () => Promise<HookInput> = readStdin,
    checkMuted: () => Promise<boolean> = isMuted,
    player: string | null = detectPlayer(),
): Promise<void> {
    if (await checkMuted())
        return;
    const input = await readInput();
    await route(event, input, player);
}
export async function route(event: string, input: HookInput, player: string | null = detectPlayer()): Promise<void> {
    if (!isClaudeEvent(event))
        return;
    const spec = EVENT_SOUNDS[event];
    if (!spec)
        return;
    await dispatch(spec, input, player);
}
async function dispatch(spec: SoundSpec, input: HookInput, player: string | null): Promise<void> {
    const sessionId = input.session_id ?? "unknown";
    await writeLockfileIfNeeded(spec.lockfile, sessionId);
    if (!(await passesTurnGate(spec.lockfile, sessionId)))
        return;
    await playWithLogging(spec, player, input.transcript_path, input.hook_event_name);
}
async function playWithLogging(spec: SoundSpec, player: string | null, transcriptPath?: string, eventName?: string): Promise<void> {
    const pool = await resolvePool(spec, transcriptPath);
    play(spec.dir, pool, player);
    await log(eventName ?? "unknown", pool);
}
async function log(event: string, pool: string): Promise<void> {
    try {
        await rotateIfNeeded();
        await appendFile(LOG_FILE, `${new Date().toISOString()} ${event} ${pool}\n`);
    }
    catch {
        // non-fatal: logging must never crash the hook
    }
}
async function rotateIfNeeded(): Promise<void> {
    const info = await stat(LOG_FILE).catch(() => null);
    if (!info || info.size < LOG_MAX_BYTES)
        return;
    await truncateToLastN(LOG_FILE, LOG_KEEP_LINES);
}
function play(dir: string, pool: string, player: string | null): void {
    const files = poolFor(dir, pool);
    if (files.length === 0)
        return;
    playSound(randomFrom(files), player);
}
async function resolvePool(spec: SoundSpec, transcriptPath?: string): Promise<string> {
    if (!spec.errorPool)
        return spec.pool;
    return (await hasErrors(transcriptPath)) ? spec.errorPool : spec.pool;
}
async function hasErrors(transcriptPath?: string): Promise<boolean> {
    if (!transcriptPath)
        return false;
    try {
        return parseTranscriptErrors(await Bun.file(transcriptPath).text());
    }
    catch {
        return false;
    }
}
export function parseTranscriptErrors(content: string): boolean {
    const entries = content.split("\n").filter(Boolean).flatMap(tryParseJson);
    const lastUserIndex = findLastUserIndex(entries);
    return entries.slice(lastUserIndex + 1).some(isToolError);
}
export function findLastUserIndex(entries: unknown[]): number {
    for (let i = entries.length - 1; i >= 0; i--) {
        if (isUserEntry(entries[i]))
            return i;
    }
    return -1;
}
async function passesTurnGate(lockfile: SoundSpec["lockfile"], sessionId: string): Promise<boolean> {
    if (lockfile !== "consume")
        return true;
    return consumeLockfile(sessionId);
}
async function consumeLockfile(sessionId: string): Promise<boolean> {
    const path = lockfilePath(sessionId);
    if (!(await lockfileValidAndFresh(path)))
        return false;
    await deleteLockfile(path);
    return true;
}
async function writeLockfileIfNeeded(lockfile: SoundSpec["lockfile"], sessionId: string): Promise<void> {
    if (lockfile === "write")
        await Bun.write(lockfilePath(sessionId), "");
}
export async function isMuted(): Promise<boolean> {
    const home = process.env.HOME ?? homedir();
    return Bun.file(`${home}/.claude/sound-muted`).exists();
}
export function isClaudeEvent(s: string): s is ClaudeEvent {
    return s in EVENT_SOUNDS;
}
function tryParseJson(line: string): unknown[] {
    try {
        return [JSON.parse(line)];
    }
    catch {
        return [];
    }
}
function isToolError(e: unknown): boolean {
    if (typeof e !== "object" || e === null)
        return false;
    const entry = e as {
        tool_result?: {
            is_error?: boolean;
        };
    };
    return entry.tool_result?.is_error === true;
}
export function playSound(path: string, player: string | null): void {
    if (!player)
        return;
    const proc = Bun.spawn([player, path], {
        stdout: "ignore",
        stderr: "ignore",
    });
    proc.unref();
}
export function detectPlayer(): string | null {
    for (const cmd of ["pw-play", "aplay"]) {
        if (Bun.which(cmd))
            return cmd;
    }
    return null;
}
export function poolFor(dir: string, prefix: string): string[] {
    try {
        return readdirSync(dir)
            .filter((f) => f.startsWith(prefix))
            .map((f) => join(dir, f));
    }
    catch {
        return [];
    }
}
export function randomFrom(files: string[]): string {
    return files[Math.floor(Math.random() * files.length)] ?? "";
}
function isUserEntry(e: unknown): boolean {
    return (typeof e === "object" &&
        e !== null &&
        (e as Record<string, unknown>).role === "user");
}
export function lockfilePath(sessionId: string): string {
    return `/tmp/claude-sound-${sessionId}`;
}
export async function lockfileValidAndFresh(path: string): Promise<boolean> {
    const file = Bun.file(path);
    if (!(await file.exists()))
        return false;
    return Date.now() - file.lastModified < LOCKFILE_TTL_MS;
}
async function deleteLockfile(path: string): Promise<void> {
    try {
        await unlink(path);
    }
    catch {
        // already gone
    }
}
export async function readStdin(): Promise<HookInput> {
    const raw = (await Bun.stdin.text()).trim();
    if (!raw)
        return {};
    const result = parseHookInput(raw);
    if (result instanceof type.errors)
        return {};
    return result;
}
export async function truncateToLastN(path: string, n: number): Promise<void> {
    const text = await Bun.file(path).text();
    const lines = text.split("\n").filter(Boolean);
    const kept = `${lines.slice(-n).join("\n")}\n`;
    await writeFile(path, kept, "utf8");
}
/* v8 ignore next 9 */
if (import.meta.main) {
    mkdirSync(LOG_DIR, { recursive: true });
    const event = process.argv[2];
    if (!event) {
        console.error("Usage: sound-hook.ts <ClaudeEventName>");
        process.exit(1);
    }
    await run(event);
}
