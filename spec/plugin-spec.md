# sound-notifications — Plugin Specification

**Version:** 2.0.0
**Source of truth:** `scripts/sound-hook.ts`, `scripts/sound-toggle.ts`, `hooks/hooks.json`

---

## 1. Purpose & Scope

Provides audible feedback for Claude Code lifecycle events by routing each event to a race-themed audio pool and spawning a fire-and-forget audio player process. Each agent session is deterministically assigned a StarCraft race (Terran, Zerg, or Protoss) based on its `session_id` — all sounds for that session play from that race's theme.

**In scope:**
- Playing one sound per triggered event (subject to rate-limiting and mute state)
- Selecting between a normal pool and an error pool based on transcript analysis
- Logging each dispatch to a rolling log file with race theme annotation
- Muting and unmuting via a sentinel file
- Deterministic per-session race assignment via djb2 hash

**Out of scope:**
- Queuing or serialising concurrent sounds
- Any Claude Code hook that controls execution flow (no `permissionDecision`, no blocking)
- Guaranteeing audio delivery (player absence or empty pool is a silent no-op)
- Supporting audio formats other than whatever `pw-play`/`aplay` accept (WAV assumed)

---

## 2. Dependencies

| Dependency | Purpose | Required |
|---|---|---|
| `bun` runtime | Script execution, `Bun.file`, `Bun.spawn`, `Bun.which`, `Bun.stdin` | Yes |
| `pw-play` (PipeWire) | Audio playback | One of these |
| `aplay` (ALSA) | Audio playback | One of these |
| `node:fs`, `node:fs/promises` | Directory listing, log rotation | Bundled with Bun |
| `arktype` | Stdin JSON validation | Bundled |

If neither `pw-play` nor `aplay` is found, the hook runs silently — all events become no-ops.

---

## 3. Entry Points

### `sound-hook.ts <EventName>`

Main hook invoked by Claude Code for each registered lifecycle event.

```
bun run <plugin-root>/scripts/sound-hook.ts <EventName>
```

**Startup side effect:** The `import.meta.main` guard calls `mkdirSync(LOG_DIR, { recursive: true })` before invoking `run()` — the log directory (`~/.claude/logs/`) is created on first invocation.

**Exit codes:** see §14.

### `sound-toggle.ts`

Toggles the mute sentinel. Running it mutes if currently unmuted, or unmutes and plays the `adjutant_online` confirmation sound if currently muted.

```
bun run <plugin-root>/scripts/sound-toggle.ts
```

No arguments. Prints `Sound notifications: MUTED` or `Sound notifications: UNMUTED` to stdout.

---

## 4. Audio Player Detection

`detectPlayer()` iterates `["pw-play", "aplay"]` and returns the first binary found via `Bun.which()`, or `null` if neither exists.

`detectPlayer` is **exported** and injected as a default parameter in both `run()` and `route()`, enabling callers and tests to substitute a fixed player path or `null` to suppress audio without touching `Bun.which`.

The `null` guard fires inside `playSound` — the deepest point in the call chain (`dispatch` → `playWithLogging` → `play` → `playSound`). A `null` player propagates silently through the chain and returns at `playSound` without spawning anything.

---

## 5. Stdin Contract

Claude Code pipes a JSON object to stdin on each hook invocation. The hook reads it via `Bun.stdin.text()`, trims whitespace, then validates with an ArkType two-stage morph:

```typescript
type("string.json.parse").to({
    "session_id?": "string",
    "transcript_path?": "string",
    "tool_result?": { "is_error?": "boolean" },
    "hook_event_name?": "string",
})
```

**All fields are optional.** The schema accepts any JSON object, including `{}`. It provides shape documentation, not discriminating validation.

**Silent fallback:** Empty stdin (after trim), whitespace-only stdin, and ArkType parse errors all return `{}`. The hook never exits non-zero due to malformed or absent stdin.

**`tool_result` in stdin vs. transcript:** The stdin `tool_result.is_error` field is parsed into `HookInput` but is **never consulted during error detection**. Error detection reads transcript file entries only (see §9). The two fields are structurally similar but entirely independent.

The inferred type `HookInput` is internal-only and not exported.

---

## 6. Dispatch Contract

`route(event, input, player)` guards dispatch in two sequential steps:

1. **`isClaudeEvent(event)`** — implemented as `CLAUDE_EVENT_SET.has(s)` against a static `Set<string>` of all 17 `ClaudeEvent` members. Events not in the set return silently (exit 0).

2. **`spec = THEMES[theme][event]`** — derives the active theme via `themeFor(session_id)`, then looks up the event in that theme's `ThemeSpec`. Returns early silently if the spec is `undefined` (event is unmapped in this theme).

Both guards return early silently with exit 0.

---

## 7. Race Theming

### Theme assignment

`themeFor(sessionId: string): ThemeName` implements a djb2 hash:

```typescript
let h = 5381;
for (let i = 0; i < sessionId.length; i++) {
    h = (((h << 5) + h) ^ sessionId.charCodeAt(i)) >>> 0;
}
return names[h % 3];  // names = ["terran", "zerg", "protoss"]
```

Properties:
- **Pure and deterministic** — same `session_id` always returns same race; no I/O
- **Stable fallback** — `"unknown"` (absent `session_id`) always maps to the same race
- **Even distribution** — roughly ⅓ of session IDs map to each race

`route()` derives the theme from `input.session_id ?? "unknown"` on every invocation.

### Theme contract

Each theme is a `Partial<Record<ClaudeEvent, SoundSpec>>`. The following events are **required** in every theme:

`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `SubagentStart`, `SubagentStop`, `Stop`, `SessionEnd`

All other events are optional — missing entries are silently skipped.

### Theme structure

```typescript
type ThemeName = "terran" | "zerg" | "protoss";
type ThemeSpec = Partial<Record<ClaudeEvent, SoundSpec>>;
const THEMES: Record<ThemeName, ThemeSpec> = { terran: {...}, zerg: {...}, protoss: {...} };
```

---

## 8. Event Catalogue

### Sound directory layout

```
sounds/
  terran/
    Advisor/        # adjutant lines (SessionStart, Stop, SessionEnd)
    SCV/            # tscyes, tscpss, tscrdy — UserPromptSubmit
    misc/           # scanner, getin, getout, liftoff, land
    Marine/         # tmardy, tmayes, tmapss — PreToolUse, SubagentStop, TeammateIdle
    Ghost/          # tghpss, tghrdy — PermissionRequest, SubagentStart
    Medic/          # tmdyes — TaskCompleted
    Battlecruiser/  # tbapss — PostToolUseFailure
  zerg/
    Advisor/        # zaderr, zadupd — PostToolUseFailure, TaskCompleted
    Drone/          # zdrrdy, zdryes, zdrpss, zdrwht, zdrerr — most events
    Hydralisk/      # zhypss, zhyrdy, zhywht, zhyyes — PermissionRequest, Stop
    Zergling/       # zzerdy, zzeyes, zzepss — PreToolUse, SubagentStart/Stop
    misc/           # burrowdn, burrowup (thematic; no event mapped)
  protoss/
    Advisor/        # paderr, padupd — PostToolUseFailure, TaskCompleted
    Probe/          # pprrdy, ppryes, pprpss, pprwht, pprerr — most events
    Zealot/         # pzerdy, pzeyes, pzepss — PreToolUse, SubagentStart/Stop
    DarkTemplar/    # pdtpss, pdtrdy, pdtwht, pdtyes — PermissionRequest, Stop, SessionEnd
```

### Terran event map (registered in `hooks.json`)

| Event | Dir | Pool | Error pool | Lockfile |
|---|---|---|---|---|
| `SessionStart` | Advisor | `adjutant_online` | — | — |
| `UserPromptSubmit` | SCV | `tscyes` | — | `write` |
| `PreToolUse` | Marine | `tmardy` | — | `consume` |
| `PermissionRequest` | Ghost | `tghpss` | — | — |
| `PostToolUseFailure` | Battlecruiser | `tbapss` | — | — |
| `Notification` | misc | `scanner` | — | — |
| `SubagentStart` | Ghost | `tghrdy` | — | — |
| `SubagentStop` | Marine | `tmayes` | `tmapss` | — |
| `Stop` | Advisor | `complete` | `need` | — |
| `TeammateIdle` | Marine | `tmapss` | — | — |
| `TaskCompleted` | Medic | `tmdyes` | — | — |
| `PreCompact` | misc | `getin` | — | — |
| `SessionEnd` | Advisor | `nuke_detected` | `landing` | — |

`—` in the lockfile column = `lockfile: undefined` — no lockfile interaction.
`—` in the error pool column = event always plays the normal pool regardless of transcript state.

### Handled but not registered (2 — in Terran THEMES, absent from `hooks.json`)

These entries are fully handled by the dispatch logic but will never be triggered until registered in `hooks.json`:

| Event | Dir | Pool |
|---|---|---|
| `WorktreeCreate` | misc | `liftoff` |
| `WorktreeRemove` | misc | `land` |

### Unrecognised events (2 — in `ClaudeEvent` type, unmapped in all themes)

These events pass `isClaudeEvent` (guard 1) but find no spec in any theme (guard 2) and are silently ignored:

- `PostToolUse`
- `ConfigChange`

### Three-way count summary

| Layer | Count |
|---|---|
| `ClaudeEvent` union type | 17 |
| `THEMES[terran]` entries | 15 |
| `hooks.json` registrations | 13 |

---

## 9. Lockfile Protocol

Lockfiles rate-limit sounds to one per user turn. Only two events use lockfiles: `UserPromptSubmit` (`write`) and `PreToolUse` (`consume`). Both are present in all three themes with the same `lockfile` semantics.

**Write** (`UserPromptSubmit`): On each `UserPromptSubmit` event, a lockfile is created at:

```
~/.claude/tmp/claude-sound-<session_id>
```

Content is empty. `session_id` defaults to `"unknown"` if absent from stdin.

**Consume** (`PreToolUse`): On each `PreToolUse` event, the lockfile is checked for freshness, then deleted if valid. Only the first `PreToolUse` within the TTL window plays audio; subsequent calls within the same turn find no lockfile and are silent.

**TTL:** 60 000 ms (60 s). Freshness is determined by `Bun.file(path).lastModified` — a synchronous property accessed after an async `exists()` check on the same `BunFile` instance.

**Directory creation side effect:** `lockfilePath()` calls `mkdirSync(~/.claude/tmp/, { recursive: true })` on every invocation, as a side effect of the path helper — separate from the protocol logic itself. The directory is created on first use.

**TOCTOU note:** A race exists between the freshness check and the delete in `consumeLockfile`. The impact is at most a duplicate sound play per turn, which is acceptable. An atomic rename-based protocol would eliminate the race.

---

## 10. Error Detection Algorithm

Invoked **only for events where `spec.errorPool` is set** (currently: `SubagentStop`, `Stop`, `SessionEnd` in Terran; analogues in Zerg/Protoss). All other events always use the normal pool.

**Algorithm:**

1. If `transcript_path` is absent from stdin → return `false` (use normal pool)
2. Read transcript file via `Bun.file(transcriptPath).text()`
   - If file is missing or unreadable → `catch` returns `false`
3. Split content by newline; parse each line with `tryParseJson` (raw `JSON.parse` inside a try/catch — not ArkType)
4. Find the index of the last entry with `role === "user"` (`findLastUserIndex`)
5. Check all entries **after** that index for `tool_result?.is_error === true` via `isToolError`
6. Return `true` if any such entry found → play `errorPool`; otherwise play normal `pool`

**Scope constraint:** Only entries after the last user-role entry are inspected. Errors from prior turns do not affect pool selection.

**`isToolError` vs stdin `tool_result`:** `isToolError` reads from transcript JSON-line entries. The `tool_result` field in `HookInput` (stdin) is completely separate and is never consulted during error detection.

---

## 11. Mute Sentinel

**Sentinel path:** `~/.claude/sound-muted` (resolved via `process.env.HOME ?? homedir()`)

**Check timing:** `isMuted()` is the first operation in `run()`, before stdin is read. When the sentinel exists, the hook returns immediately (exit 0) without processing the event.

**Mute:** `sound-toggle.ts` creates the sentinel via `Bun.write(sentinel, "")`.

**Unmute:** `sound-toggle.ts` deletes the sentinel via `unlink()` (with ENOENT guard for TOCTOU), then calls `route("SessionStart", { session_id: "toggle" })` directly — bypassing `run()` entirely. This means:
- No mute re-check on unmute
- `SessionStart` has `lockfile: undefined`, so no lockfile is written or consumed
- The `adjutant_online` (or race-equivalent) pool plays as an audible confirmation

---

## 12. Pool Resolution

`poolFor(dir, prefix)` lists the contents of `dir` using `node:fs readdirSync` (not a Bun API — Bun has no directory-listing equivalent), filters for entries whose filename starts with `prefix`, and maps to full absolute paths. No extension filter is applied.

`randomFrom(files)` selects one path uniformly at random. Returns `""` on an empty array (callers guard with `files.length === 0` before calling).

---

## 13. Playback

```typescript
Bun.spawn([player, filePath], { stdout: "ignore", stderr: "ignore" })
proc.unref()
```

Fire-and-forget: `proc.unref()` detaches the spawned process from Bun's event loop. The hook exits without waiting for audio completion. Player stdout and stderr are discarded.

---

## 14. Logging

**File:** `~/.claude/logs/sound-hook.log`

**Ordering:** `playWithLogging` calls `play()` (spawn + unref, synchronous) then `await log()`. The log entry is appended after the spawn is issued but before audio completes. Log entries appear even when the pool is empty and no sound plays.

**Line format:**

```
<ISO-8601-timestamp> [<theme>] <hook_event_name> → <pool-prefix>
```

- Column 2 is `[terran]`, `[zerg]`, or `[protoss]` — the race theme for this session
- Column 3 is `input.hook_event_name` from stdin with `"unknown"` fallback — **not** the CLI argument
- Column 4 is the pool prefix string (e.g., `tmardy`), not the resolved file path

Example:
```
2026-03-17T12:00:00.000Z [terran] PreToolUse → tmardy
2026-03-17T12:00:01.000Z [zerg] SessionStart → zdrrdy
```

**Rotation:** When `~/.claude/logs/sound-hook.log` exceeds 1 048 576 bytes (1 MB), the file is truncated in-place to the last 1 000 lines via `node:fs/promises writeFile` (not a file rename). Rotation runs before each log append.

**Fault tolerance:** All log operations are wrapped in a top-level `try/catch`. Logging failures never crash the hook.

---

## 15. Exit Codes

| Code | Condition |
|---|---|
| `0` | Normal completion, silent skip, unrecognised event, malformed/empty stdin, missing transcript file, muted |
| `1` | `process.argv[2]` is absent (missing event argument) |

Unrecognised event names are always silent no-ops (exit 0), not errors.

---

## 16. Out of Scope

- **PostToolUse, ConfigChange** — present in the `ClaudeEvent` type; not handled (no entry in any theme, no `hooks.json` registration)
- **WorktreeCreate, WorktreeRemove** — defined in Terran theme but not registered in `hooks.json`; never triggered unless explicitly added
- **Audio queuing** — concurrent hook invocations may spawn overlapping audio processes; no serialisation is performed
- **Player arguments** — the hook passes only `[player, filePath]`; no volume, device, or format flags
- **Sound file validation** — pool contents are not validated; missing or unreadable files produce no audio and no error
- **Multi-user / shared sessions** — lockfiles use `session_id` from stdin; behaviour with absent or colliding session IDs is not specified beyond the `"unknown"` fallback
- **Zerg/Protoss WorktreeCreate/WorktreeRemove** — Terran misc has `liftoff`/`land` sounds; Zerg and Protoss themes omit these events (no good analogues)
- **burrowdn/burrowup** — placed in `sounds/zerg/misc/` for thematic completeness; not mapped to any event in any theme

---

## 17. Type Notes (Informational)

These are observations about the TypeScript implementation, not behavioral contracts.

- **`isClaudeEvent` soundness** — annotated as `s is ClaudeEvent` and implemented against a static `Set<string>` of all 17 `ClaudeEvent` members. The set is verified at construction time via `satisfies ClaudeEvent[]`. Previously implemented as `s in EVENT_SOUNDS` (15-member keyset), which incorrectly returned `false` for `PostToolUse` and `ConfigChange`.

- **`isToolError` cast** — uses `as { tool_result?: { is_error?: boolean } }` inside the predicate body, after an explicit `typeof e !== "object" || e === null` guard. Structurally unsound (the cast asserts shape beyond what the guard confirms), but bounded: all fields are optional so no property access will crash regardless of actual shape.

- **`isUserEntry` cast** — uses `as Record<string, unknown>` with the same object/non-null guard pattern. Same unsoundness class as `isToolError`.

- **`randomFrom` return type** — declared as `string` but returns `""` on an empty array. All call sites guard with `files.length === 0` before calling, so the empty-return path is unreachable in practice.

- **`HookInput` type** — inferred from the ArkType schema via `typeof parseHookInput.infer`. Internal-only; not exported. Downstream callers of `route()` must provide the shape structurally.

- **Mixed I/O idioms** — `Bun.write()` is used for lockfile and sentinel writes; `node:fs/promises writeFile` is used for log rotation. Both are correct; the inconsistency is cosmetic.
