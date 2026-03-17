// Sound notification hook for Claude Code lifecycle events
// Edit THEMES to add, remove, or remap audio pools per event and race
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
const LOCKFILE_TTL_MS = 60000;
const LOG_DIR = join(process.env.HOME ?? homedir(), ".claude", "logs");
const LOG_FILE = join(LOG_DIR, "sound-hook.log");
const LOG_MAX_BYTES = 1048576; // 1 MB
const LOG_KEEP_LINES = 1000;
// ── Terran paths ──────────────────────────────────────────────────────────────
const TERRAN_ADVISOR = join(PLUGIN_ROOT, "sounds", "terran", "Advisor");
const TERRAN_SCV = join(PLUGIN_ROOT, "sounds", "terran", "SCV");
const TERRAN_MISC = join(PLUGIN_ROOT, "sounds", "terran", "misc");
const TERRAN_MARINE = join(PLUGIN_ROOT, "sounds", "terran", "Marine");
const TERRAN_GHOST = join(PLUGIN_ROOT, "sounds", "terran", "Ghost");
const TERRAN_MEDIC = join(PLUGIN_ROOT, "sounds", "terran", "Medic");
const TERRAN_BC = join(PLUGIN_ROOT, "sounds", "terran", "Battlecruiser");
// ── Zerg paths ────────────────────────────────────────────────────────────────
const ZERG_ADVISOR = join(PLUGIN_ROOT, "sounds", "zerg", "Advisor");
const ZERG_DRONE = join(PLUGIN_ROOT, "sounds", "zerg", "Drone");
const ZERG_HYDRALISK = join(PLUGIN_ROOT, "sounds", "zerg", "Hydralisk");
const ZERG_ZERGLING = join(PLUGIN_ROOT, "sounds", "zerg", "Zergling");
// ── Protoss paths ─────────────────────────────────────────────────────────────
const PROTOSS_ADVISOR = join(PLUGIN_ROOT, "sounds", "protoss", "Advisor");
const PROTOSS_PROBE = join(PLUGIN_ROOT, "sounds", "protoss", "Probe");
const PROTOSS_ZEALOT = join(PLUGIN_ROOT, "sounds", "protoss", "Zealot");
const PROTOSS_DT = join(PLUGIN_ROOT, "sounds", "protoss", "DarkTemplar");
export type ClaudeEvent = "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PermissionRequest" | "PostToolUse" | "PostToolUseFailure" | "Notification" | "SubagentStart" | "SubagentStop" | "Stop" | "TeammateIdle" | "TaskCompleted" | "ConfigChange" | "WorktreeCreate" | "WorktreeRemove" | "PreCompact" | "SessionEnd";
export type ThemeName = "terran" | "zerg" | "protoss";
type SoundSpec = {
    dir: string;
    pool: string;
    errorPool?: string;
    // "write" marks turn start; "consume" plays only once per turn, not per tool call
    lockfile?: "write" | "consume";
};
type ThemeSpec = Partial<Record<ClaudeEvent, SoundSpec>>;
type HookInput = typeof parseHookInput.infer;
const CLAUDE_EVENT_SET = new Set<string>([
    "SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest",
    "PostToolUse", "PostToolUseFailure", "Notification", "SubagentStart",
    "SubagentStop", "Stop", "TeammateIdle", "TaskCompleted", "ConfigChange",
    "WorktreeCreate", "WorktreeRemove", "PreCompact", "SessionEnd",
] satisfies ClaudeEvent[]);
export const THEMES: Record<ThemeName, ThemeSpec> = {
    terran: {
        SessionStart: { dir: TERRAN_ADVISOR, pool: "adjutant_online" },
        UserPromptSubmit: { dir: TERRAN_SCV, pool: "tscyes", lockfile: "write" },
        PreToolUse: { dir: TERRAN_MARINE, pool: "tmardy", lockfile: "consume" },
        PermissionRequest: { dir: TERRAN_GHOST, pool: "tghpss" },
        PostToolUseFailure: { dir: TERRAN_BC, pool: "tbapss" },
        Notification: { dir: TERRAN_MISC, pool: "scanner" },
        SubagentStart: { dir: TERRAN_GHOST, pool: "tghrdy" },
        SubagentStop: { dir: TERRAN_MARINE, pool: "tmayes", errorPool: "tmapss" },
        Stop: { dir: TERRAN_ADVISOR, pool: "complete", errorPool: "need" },
        TeammateIdle: { dir: TERRAN_MARINE, pool: "tmapss" },
        TaskCompleted: { dir: TERRAN_MEDIC, pool: "tmdyes" },
        WorktreeCreate: { dir: TERRAN_MISC, pool: "liftoff" },
        WorktreeRemove: { dir: TERRAN_MISC, pool: "land" },
        PreCompact: { dir: TERRAN_MISC, pool: "getin" },
        SessionEnd: { dir: TERRAN_ADVISOR, pool: "nuke_detected", errorPool: "landing" },
    },
    zerg: {
        // Session lifecycle: Drone (no Advisor equivalents for these)
        SessionStart: { dir: ZERG_DRONE, pool: "zdrrdy" },
        UserPromptSubmit: { dir: ZERG_DRONE, pool: "zdryes", lockfile: "write" },
        PreToolUse: { dir: ZERG_ZERGLING, pool: "zzerdy", lockfile: "consume" },
        PermissionRequest: { dir: ZERG_HYDRALISK, pool: "zhypss" },
        PostToolUseFailure: { dir: ZERG_ADVISOR, pool: "zaderr" },
        Notification: { dir: ZERG_DRONE, pool: "zdrerr" },
        SubagentStart: { dir: ZERG_ZERGLING, pool: "zzerdy" },
        SubagentStop: { dir: ZERG_ZERGLING, pool: "zzeyes", errorPool: "zzepss" },
        Stop: { dir: ZERG_HYDRALISK, pool: "zhyyes", errorPool: "zhypss" },
        TeammateIdle: { dir: ZERG_DRONE, pool: "zdrpss" },
        TaskCompleted: { dir: ZERG_ADVISOR, pool: "zadupd" },
        PreCompact: { dir: ZERG_DRONE, pool: "zdrwht" },
        SessionEnd: { dir: ZERG_DRONE, pool: "zdryes", errorPool: "zdrerr" },
    },
    protoss: {
        // Session lifecycle: Probe (no Advisor equivalents for these)
        SessionStart: { dir: PROTOSS_PROBE, pool: "pprrdy" },
        UserPromptSubmit: { dir: PROTOSS_PROBE, pool: "ppryes", lockfile: "write" },
        PreToolUse: { dir: PROTOSS_ZEALOT, pool: "pzerdy", lockfile: "consume" },
        PermissionRequest: { dir: PROTOSS_DT, pool: "pdtpss" },
        PostToolUseFailure: { dir: PROTOSS_ADVISOR, pool: "paderr" },
        Notification: { dir: PROTOSS_PROBE, pool: "pprerr" },
        SubagentStart: { dir: PROTOSS_ZEALOT, pool: "pzerdy" },
        SubagentStop: { dir: PROTOSS_ZEALOT, pool: "pzeyes", errorPool: "pzepss" },
        Stop: { dir: PROTOSS_DT, pool: "pdtyes", errorPool: "pdtpss" },
        TeammateIdle: { dir: PROTOSS_PROBE, pool: "pprpss" },
        TaskCompleted: { dir: PROTOSS_ADVISOR, pool: "padupd" },
        PreCompact: { dir: PROTOSS_PROBE, pool: "pprwht" },
        SessionEnd: { dir: PROTOSS_PROBE, pool: "ppryes", errorPool: "pprerr" },
    },
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
    const theme = themeFor(input.session_id ?? "unknown");
    const spec = THEMES[theme][event];
    if (!spec)
        return;
    await dispatch(spec, input, player, theme);
}
async function dispatch(spec: SoundSpec, input: HookInput, player: string | null, theme: ThemeName): Promise<void> {
    const sessionId = input.session_id ?? "unknown";
    await writeLockfileIfNeeded(spec.lockfile, sessionId);
    if (!(await passesTurnGate(spec.lockfile, sessionId)))
        return;
    await playWithLogging(spec, player, input.transcript_path, input.hook_event_name, theme);
}
async function playWithLogging(spec: SoundSpec, player: string | null, transcriptPath?: string, eventName?: string, theme?: ThemeName): Promise<void> {
    const pool = await resolvePool(spec, transcriptPath);
    play(spec.dir, pool, player);
    await log(eventName ?? "unknown", pool, theme ?? "terran");
}
async function log(event: string, pool: string, theme: ThemeName): Promise<void> {
    try {
        await rotateIfNeeded();
        await appendFile(LOG_FILE, `${new Date().toISOString()} [${theme}] ${event} → ${pool}\n`);
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
// TOCTOU race: another process could consume the lockfile between the freshness
// check and the delete. Impact is limited to a duplicate sound play, which is
// acceptable. An atomic rename-based protocol would eliminate the race but adds
// complexity disproportionate to the risk.
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
    return CLAUDE_EVENT_SET.has(s);
}
// djb2 hash → unsigned 32-bit → mod 3 — pure, deterministic, no I/O
export function themeFor(sessionId: string): ThemeName {
    const names: ThemeName[] = ["terran", "zerg", "protoss"];
    let h = 5381;
    for (let i = 0; i < sessionId.length; i++) {
        h = (((h << 5) + h) ^ sessionId.charCodeAt(i)) >>> 0;
    }
    const name = names[h % names.length];
    if (name === undefined) throw new Error("themeFor: index out of bounds");
    return name;
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
    const dir = join(process.env.HOME ?? homedir(), ".claude", "tmp");
    mkdirSync(dir, { recursive: true });
    return join(dir, `claude-sound-${sessionId}`);
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
