# Plan: Create spec/ folder with plugin specification

## Context

The sound-notifications plugin is a mature, well-tested Claude Code hook that provides audible feedback for lifecycle events. There is no machine-readable or formal specification document — only a README and inline code comments. A `spec/` folder with a canonical spec enables contributors and future work to reason about behavior contracts independently of the implementation.

## Approach

Create `spec/` at the project root with a single `plugin-spec.md` file documenting the complete behavioral specification of the plugin as it exists today.

## Spec document structure

`spec/plugin-spec.md` will cover:

1. **Purpose & scope** — what the plugin does and doesn't do
2. **Dependencies** — runtime requirements (`bun`, `pw-play`/`aplay`)
3. **Entry points** — `sound-hook.ts <EventName>` CLI contract, `sound-toggle.ts`; note `import.meta.main` guard calls `mkdirSync(LOG_DIR, { recursive: true })` at startup before `run()` — log directory created on first invocation
4. **Audio player detection** — `Bun.which("pw-play")` → `Bun.which("aplay")` → `null`; `detectPlayer` is exported and injected as default parameter in both `run()` and `route()` — callers and tests can pass `null` to suppress audio; the `null` guard fires inside `playSound` (deepest in the call chain: `dispatch` → `playWithLogging` → `play` → `playSound`), returning silently with no spawn
5. **Stdin contract** — JSON shape (ArkType two-stage morph: `type("string.json.parse").to(schema)`); `Bun.stdin.text()` result is `.trim()`-ed before parse — whitespace-only stdin treated as empty; all fields optional (`session_id?`, `transcript_path?`, `tool_result?: { is_error?: boolean }`, `hook_event_name?`); empty or parse-error stdin silently returns `{}` — the hook never exits non-zero due to malformed stdin
6. **Dispatch contract** — `route()` has two sequential guards: (1) `isClaudeEvent(event)` = `event in EVENT_SOUNDS` — events absent from `EVENT_SOUNDS` fail here (note: type annotation is `s is ClaudeEvent` but the predicate only covers the 15-member `EVENT_SOUNDS` keyset — see type notes); (2) `spec = EVENT_SOUNDS[event]` guard — defends against `Partial<Record<...>>` undefined slots; both guards return early silently (exit 0)
7. **Event catalogue** — all 15 `EVENT_SOUNDS` entries as a table: event name, pool dir, pool prefix, errorPool (if any), lockfile column (`"write"` / `"consume"` / `—` where `—` = `lockfile: undefined` — no lockfile interaction); sub-section for the 2 `ClaudeEvent` union members that fail guard 1 (`PostToolUse`, `ConfigChange`)
8. **Lockfile protocol** — write/consume semantics, TTL (60 s), path `~/.claude/tmp/claude-sound-<session_id>`; note `lockfilePath()` calls `mkdirSync(~/.claude/tmp/, { recursive: true })` on every invocation (side effect of path helper, separate from protocol logic)
9. **Error detection algorithm** — *invoked only for events where `spec.errorPool` is set*; algorithm: reads `transcript_path` via `Bun.file().text()` (throws on missing file — `catch` silently returns `false`); parses JSON lines via `tryParseJson` (uses raw `JSON.parse`, not ArkType); scopes to entries after the last `role:"user"` entry only; `isToolError` checks transcript entry fields (not stdin's `tool_result` — those are distinct unrelated fields)
10. **Mute sentinel** — path (`~/.claude/sound-muted`), check timing (before stdin read, in `run()`); `sound-toggle.ts` unmute calls `route("SessionStart", { session_id: "toggle" })` directly — bypassing `run()`, no mute re-check, no lockfile side effects (SessionStart has `lockfile: undefined`)
11. **Pool resolution** — `poolFor(dir, prefix)` uses `node:fs readdirSync` (not Bun API) and returns full file paths for all `dir` entries whose filename starts with `prefix` (no extension filter); `randomFrom` selects one uniformly at random
12. **Playback** — `Bun.spawn([player, filePath])` then `proc.unref()` — fire-and-forget; the hook exits without waiting for audio playback to complete
13. **Logging** — path (`~/.claude/logs/sound-hook.log`), written *after* spawn is initiated but before audio completes (fire-and-forget means log order is: spawn issued → `log()` awaited); log entry appears even if pool is empty and no audio plays; line format `<ISO-timestamp> <hook_event_name|"unknown"> <pool-prefix>`; column 2 is `input.hook_event_name` from stdin with `"unknown"` fallback; rotation: `node:fs/promises writeFile` truncates in-place to last 1000 lines when file exceeds 1 MB
14. **Exit codes** — 0 (ok, silent skip, unrecognized event, malformed stdin, missing transcript); 1 (only when `process.argv[2]` is absent)
15. **Out-of-scope** — what the plugin explicitly does NOT handle
16. **Type notes** (informational) — `isClaudeEvent` annotates `s is ClaudeEvent` but checks `s in EVENT_SOUNDS` (15-member subset — predicate is unsound for `PostToolUse`/`ConfigChange`); `isToolError` uses `as { tool_result?: { is_error?: boolean } }` cast inside a predicate — structurally unsound but bounded by a prior object/non-null guard; `isUserEntry` uses `as Record<string, unknown>` cast with the same pattern — both rely on `as T` rather than property-existence narrowing; `randomFrom` return type is `string` but returns `""` on empty array (callers guard before calling); `HookInput` is internal-only (not exported); mixed I/O: `Bun.write()` for lockfile/sentinel, `node:fs/promises writeFile` for log rotation

## Critical files to read before writing

- `/home/graff/.claude/plugins/sound-notifications/scripts/sound-hook.ts` — source of truth for all behavioral details
- `/home/graff/.claude/plugins/sound-notifications/hooks/hooks.json` — registered event list
- `/home/graff/.claude/plugins/sound-notifications/.claude-plugin/plugin.json` — version / metadata
- `/home/graff/.claude/plugins/sound-notifications/README.md` — existing prose to reconcile

## Files to create

- `spec/plugin-spec.md` — the spec document (no other files)

## Notes on event registration vs. handling gap

Three-way relationship:
- `ClaudeEvent` union type: **17** members
- `EVENT_SOUNDS` map: **15** entries (`isClaudeEvent` = `s in EVENT_SOUNDS`)
- `hooks.json` registrations: **13** events

Gaps:
- `WorktreeCreate` and `WorktreeRemove` — in `EVENT_SOUNDS` (handled) but **not** registered in `hooks.json` (never triggered in practice)
- `PostToolUse` and `ConfigChange` — in `ClaudeEvent` type but absent from `EVENT_SOUNDS`; `isClaudeEvent` returns `false` for them → `route()` rejects them at the first guard as unrecognized events
- The spec must document all three counts and both gaps explicitly

## Verification

- All 13 events in `hooks.json` appear in the spec event catalogue
- All 15 `EVENT_SOUNDS` entries in `sound-hook.ts` are reflected accurately as a table with lockfile column
- `PostToolUse` and `ConfigChange` documented as failing `isClaudeEvent` = `s in EVENT_SOUNDS` (guard 1)
- Both `route()` guards documented in dispatch contract section
- Error detection section states it is `errorPool`-gated only
- `tryParseJson` raw `JSON.parse` usage noted in error detection section
- Lockfile TTL (60 s), log rotation threshold (1 MB / 1000 lines), sentinel path all verified against source
- Log line format matches source; note that log precedes playback
- `proc.unref()` fire-and-forget contract documented
- `Bun.stdin.text().trim()` behavior documented
- Unmute confirmation sound + no-lockfile-side-effect documented
- No new code written — spec only
