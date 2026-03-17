# Sound Notifications — StarCraft Multi-Race Expansion

## Context

The plugin currently plays Terran sounds (Advisor + SCV + misc). The full StarCraft sound pack at `/media/graff/Storage/StarCraft_Sound_Pack` has ~1,590 WAV files across Terran (21 unit types), Zerg (19), and Protoss (22). The three-phase plan expands coverage, adds race theming, and finally ties each agent session deterministically to one race.

---

## Phase 1 — Terran Unit Expansion

### Goal
Richer event coverage using additional Terran unit voices. Different events feel more distinct.

### Sound Assets to Copy
From `/media/graff/Storage/StarCraft_Sound_Pack/Terran/Units/<Unit>/` → `sounds/<Unit>/`

| New dir            | Source unit      | Key pools (prefix → files match `<prefix>*.wav`)   | Events using it |
|--------------------|------------------|----------------------------------------------------|-----------------|
| `sounds/Marine/`   | Marine           | `tmayes`, `tmapss`, `tmardy` (`tmawht` — unused, skip) | PreToolUse, SubagentStop, TeammateIdle |
| `sounds/Ghost/`    | Ghost            | `tghyes`, `tghpss`, `tghwht`, `tghrdy`            | PermissionRequest, SubagentStart |
| `sounds/Medic/`    | Medic            | `tmdyes`, `tmdpss`, `tmdwht`, `tmdrdy`            | TaskCompleted |
| `sounds/Battlecruiser/` | Battlecruiser | `tbayes`, `tbapss`, `tbawht`, `tbardy`         | PostToolUseFailure |

Copy only WAV files matching the pool prefixes above (response lines, not weapon/ability SFX).

> **Note**: Verify actual file prefixes before copying — list each unit dir with `ls /media/graff/Storage/StarCraft_Sound_Pack/Terran/Units/<Unit>/` and confirm prefixes match. Zerg/Protoss prefixes in Phase 2 must also be verified empirically (they cannot be assumed from Terran naming patterns).

### Code Changes — `scripts/sound-hook.ts`

Add constants below the existing three:
```typescript
const MARINE     = join(PLUGIN_ROOT, "sounds", "Marine");
const GHOST      = join(PLUGIN_ROOT, "sounds", "Ghost");
const MEDIC      = join(PLUGIN_ROOT, "sounds", "Medic");
const BATTLECRUISER = join(PLUGIN_ROOT, "sounds", "Battlecruiser");
```

Update `EVENT_SOUNDS` for richer unit assignment:

| Event             | New mapping                                                 | Rationale                           |
|-------------------|-------------------------------------------------------------|-------------------------------------|
| `PreToolUse`      | `{ dir: MARINE, pool: "tmardy", lockfile: "consume" }`     | Marine ready — action starts (distinct from SubagentStop) |
| `PermissionRequest` | `{ dir: GHOST, pool: "tghpss" }`                         | Ghost — tense/wary                  |
| `SubagentStart`   | `{ dir: GHOST, pool: "tghrdy" }`                           | Ghost spawning into action          |
| `SubagentStop`    | `{ dir: MARINE, pool: "tmayes", errorPool: "tmapss" }`     | Marine reports back (yes/annoyed)   |
| `TeammateIdle`    | `{ dir: MARINE, pool: "tmapss" }`                          | Marine frustrated at standing by    |
| `PostToolUseFailure` | `{ dir: BATTLECRUISER, pool: "tbapss" }`                | BC captain annoyed at failure       |
| `TaskCompleted`   | `{ dir: MEDIC, pool: "tmdyes" }`                           | Medic — task successfully completed |

All other events stay on existing `ADVISOR`/`SCV`/`MISC` pools.

> **Existing silent bug fixed by this phase**: `SubagentStop` and `TaskCompleted` currently reference the `tadupd` prefix which has no matching files in either `Advisor/` or `SCV/` — both events are silent today. Phase 1 resolves this.

### Verification
```bash
bun test                    # all 16 suites green
bunx tsc --noEmit           # no type errors
# manual: bun run scripts/sound-hook.ts PreToolUse <<< '{"session_id":"test"}'
# → should play a Marine tmardy sound (ready line)
```

---

## Phase 2 — Multi-Race Theming Architecture

### Goal
Restructure so Terran, Zerg, Protoss each have a complete event-sound mapping. No session routing yet — theme is a build-time constant for testing.

### Sound Assets to Copy
From `/media/graff/Storage/StarCraft_Sound_Pack/Zerg/Units/` and `Protoss/Units/`:

**Terran reorganization** (Phase 2 also migrates Phase 1 additions into `sounds/terran/`):
Move existing flat dirs into a `sounds/terran/` namespace to match the new race-namespaced layout:
- `sounds/Advisor/` → `sounds/terran/Advisor/`
- `sounds/SCV/` → `sounds/terran/SCV/`
- `sounds/misc/` splits across two destinations — do this in order to avoid a naive `mv` moving everything to one place:
    1. Create `sounds/zerg/misc/` first
    2. Move only `burrowdn.wav` and `burrowup.wav` → `sounds/zerg/misc/`
    3. Move remaining `sounds/misc/` (`scanner`, `getin`, `getout`, `liftoff`, `land`) → `sounds/terran/misc/`
- `sounds/Marine/`, `sounds/Ghost/`, `sounds/Medic/`, `sounds/Battlecruiser/` → each into `sounds/terran/<Unit>/`

Update all path constants to `join(PLUGIN_ROOT, "sounds", "terran", "<Unit>")`.

**Zerg** (`sounds/zerg/<Unit>/`):

> **⚠ Verify all prefixes empirically** — run `ls /media/graff/Storage/StarCraft_Sound_Pack/Zerg/Units/<Unit>/` before writing constants. Prefixes listed below are best-guess approximations only.

| New dir              | Source unit    | Approximate pools (VERIFY)                          |
|----------------------|----------------|-----------------------------------------------------|
| `sounds/zerg/Advisor/` | Zerg Advisor | list dir to find actual prefixes                    |
| `sounds/zerg/Drone/`   | Drone        | list dir to find actual prefixes                    |
| `sounds/zerg/Hydralisk/` | Hydralisk  | list dir to find actual prefixes                    |
| `sounds/zerg/Zergling/`  | Zergling   | list dir — previous guess `zzlyes` is likely wrong  |
| `sounds/zerg/misc/`    | (move from terran misc) | `burrowdn`, `burrowup`               |

**Protoss** (`sounds/protoss/<Unit>/`):

> **⚠ Verify all prefixes empirically** — run `ls /media/graff/Storage/StarCraft_Sound_Pack/Protoss/Units/<Unit>/` before writing constants.

| New dir               | Source unit      | Approximate pools (VERIFY)                         |
|-----------------------|------------------|----------------------------------------------------|
| `sounds/protoss/Advisor/` | Protoss Advisor | list dir to find actual prefixes               |
| `sounds/protoss/Probe/`   | Probe           | list dir to find actual prefixes            |
| `sounds/protoss/Zealot/`  | Zealot          | list dir to find actual prefixes            |
| `sounds/protoss/DarkTemplar/` | Dark Templar | list dir (`Dark Templar/` has a space in source) |
| `sounds/protoss/misc/`    | (warp effects)  | list dir — warp-in/warp-out sounds          |

### Code Architecture Changes — `scripts/sound-hook.ts`

1. **Add types:**
```typescript
type ThemeName = "terran" | "zerg" | "protoss";
type ThemeSpec = Partial<Record<ClaudeEvent, SoundSpec>>;
```

2. **Replace `isClaudeEvent` implementation** — current implementation is `s in EVENT_SOUNDS` which will break when `EVENT_SOUNDS` is removed. Replace with a static set:
```typescript
const CLAUDE_EVENT_SET = new Set<string>([
  "SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest",
  "PostToolUse", "PostToolUseFailure", "Notification", "SubagentStart",
  "SubagentStop", "Stop", "TeammateIdle", "TaskCompleted", "ConfigChange",
  "WorktreeCreate", "WorktreeRemove", "PreCompact", "SessionEnd",
] satisfies ClaudeEvent[]);
export function isClaudeEvent(s: string): s is ClaudeEvent {
  return CLAUDE_EVENT_SET.has(s);
}
```

3. **Replace single `EVENT_SOUNDS` with `THEMES`:**
```typescript
const THEMES: Record<ThemeName, ThemeSpec> = {
  terran: { /* current EVENT_SOUNDS + Phase 1 additions, updated paths */ },
  zerg:   { /* zerg equivalents */ },
  protoss: { /* protoss equivalents */ },
};
```

4. **Required events per theme** — all three themes must define these events (others optional):
    - `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `SubagentStart`, `SubagentStop`, `Stop`, `SessionEnd`

   > **Zerg/Protoss Advisor gap**: The sound pack's Zerg and Protoss Advisor dirs contain only error/update lines (`zaderr`, `zadupd`, `paderr`, `padupd`) — no equivalents for `SessionStart`, `Stop`, `SessionEnd`. These required events must be covered by primary unit sounds (Drone/Hydralisk for Zerg; Zealot/Probe for Protoss) rather than Advisor sounds. Plan the Zerg and Protoss theme maps accordingly: Advisor sounds cover only `PostToolUseFailure`/`TaskCompleted`-style events; session lifecycle events use frontline unit voices.

5. **Add `activeTheme` constant (Phase 2 uses static value for testing):**
```typescript
const activeTheme: ThemeName = "terran"; // Phase 3 makes this dynamic
```

6. **Update `route()` to read from `THEMES[activeTheme]`:**
```typescript
export async function route(event: string, input: HookInput, player: string | null): Promise<void> {
  if (!isClaudeEvent(event)) return;
  const spec = THEMES[activeTheme][event];
  if (!spec) return;
  await dispatch(spec, input, player);
}
```

7. **Update tests:**
    - Each theme must have all required events mapped (test against the required list above)
    - Update path expectations to use `sounds/terran/` prefix
    - `isClaudeEvent` behavioral flip: `PostToolUse` and `ConfigChange` are in the `ClaudeEvent` union but absent from `EVENT_SOUNDS` — so current `isClaudeEvent("PostToolUse")` returns `false`. After switching to the static set it returns `true`. There is no direct `isClaudeEvent("PostToolUse") === false` assertion to invert. Instead: (a) update the comment in the `route("PostToolUse", ...)` test (it currently says "no EVENT_SOUNDS entry" / "guard 1 catches this" — after Phase 2, guard 1 passes and guard 2 catches it via `THEMES[activeTheme]["PostToolUse"] === undefined`); (b) expand the `isClaudeEvent` test suite to assert all 17 `ClaudeEvent` strings return true.
    - Test all 17 ClaudeEvent strings pass; non-event strings fail (existing suite only covers 2 cases — expand it)

8. **Update `spec/plugin-spec.md`:**
    - Replace `EVENT_SOUNDS` references (9 occurrences) with `THEMES[activeTheme]`
    - Update `isClaudeEvent` description to static set
    - Add section describing the theme contract

### Verification
```bash
bun test
bunx tsc --noEmit
# switch activeTheme to "zerg", run manually:
# bun run scripts/sound-hook.ts SessionStart <<< '{"session_id":"test"}'
# → should play zerg advisor online sound
```

---

## Phase 3 — Session-Scoped Theme Assignment

### Goal
Each agent session deterministically plays only one race's sounds, based on `session_id` hash.

### New Function
```typescript
export function themeFor(sessionId: string): ThemeName {
  const names: ThemeName[] = ["terran", "zerg", "protoss"];
  // djb2 hash → unsigned 32-bit → mod 3
  let h = 5381;
  for (let i = 0; i < sessionId.length; i++) {
    h = (((h << 5) + h) ^ sessionId.charCodeAt(i)) >>> 0;
  }
  return names[h % names.length];
}
```

- Pure function, no I/O, deterministic — same session always gets same race
- "unknown" sessions → consistent hash → always same fallback theme (won't vary)

### Code Changes

1. **Remove static `activeTheme` constant** (from Phase 2).

2. **Update `route()` to derive theme from `input.session_id`:**
```typescript
export async function route(event: string, input: HookInput, player: string | null): Promise<void> {
  if (!isClaudeEvent(event)) return;
  const theme = themeFor(input.session_id ?? "unknown");
  const spec = THEMES[theme][event];
  if (!spec) return;
  await dispatch(spec, input, player);
}
```

3. **Thread theme through the call chain for logging.** Full signature update chain:
    - `dispatch(spec, input, player)` → `dispatch(spec, input, player, theme: ThemeName)` — `route()` already has `theme` in scope; pass it here
    - `playWithLogging(spec, player, transcriptPath, eventName)` → add `theme: ThemeName` parameter
    - `log(event, pool)` → `log(event, pool, theme: ThemeName)` — new log format: `<timestamp> [<theme>] <event> → <pool>`
    - Note: `dispatch()` still receives `input` for session_id (lockfile) and transcript_path (error detection) — `theme` is an additional parameter, not a replacement for `input`
    - Update `spec/plugin-spec.md §13` (Logging) to document the new log line format
    - The log rotation test only asserts on file size (not line format) — no change needed there. Write a **new** test asserting the log line includes `[terran]`/`[zerg]`/`[protoss]` bracket prefix.

4. **Tests for `themeFor()`:**
    - Known input → known output (pin 3+ session IDs to expected themes)
    - Distribution test: 300 random-looking IDs should spread ±10% across three themes
    - `"unknown"` → stable deterministic result

### Verification
```bash
bun test
bunx tsc --noEmit
# Two different real session IDs → two different races (probabilistically)
# Same session ID across two invocations → same race
bun run scripts/sound-hook.ts SessionStart <<< '{"session_id":"abc123"}'
bun run scripts/sound-hook.ts SessionStart <<< '{"session_id":"abc123"}'
# → same sound plays both times
bun run scripts/sound-hook.ts SessionStart <<< '{"session_id":"xyz789"}'
# → may play different race
```

---

## Critical Files

| File | Changes |
|------|---------|
| `scripts/sound-hook.ts` | All three phases — constants, types, EVENT_SOUNDS→THEMES, themeFor() |
| `scripts/sound-hook.test.ts` | Phase 1: update dir expectations; Phase 2-3: THEMES shape + themeFor() tests |
| `sounds/Marine/`, `sounds/Ghost/`, etc. | Phase 1: new dirs from sound pack copy |
| `sounds/zerg/`, `sounds/protoss/` | Phase 2: new dirs from sound pack copy |
| `spec/plugin-spec.md` | Update spec to describe theming contract |

## Out of Scope

- Sound pack path (`/media/graff/Storage/StarCraft_Sound_Pack`) is read-only — we only _copy_ files into the plugin
- `burrowdn`/`burrowup` move to `sounds/zerg/misc/` in Phase 2 as organizational placement; they are not mapped to any event in any theme (no hook fires burrow events). Kept for thematic completeness, not functionality.
- No UI, config file, or runtime theme override (Phase 3 is hash-only)
