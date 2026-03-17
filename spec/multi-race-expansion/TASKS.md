# Multi-Race Expansion — Task List & Progress

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Phase 1 — Terran Unit Expansion

### Pre-flight
- [ ] List `Terran/Units/Marine/` and confirm `tmayes`, `tmapss`, `tmardy` prefixes exist
- [ ] List `Terran/Units/Ghost/` and confirm `tghyes`, `tghpss`, `tghwht`, `tghrdy` prefixes exist
- [ ] List `Terran/Units/Medic/` and confirm `tmdyes`, `tmdpss`, `tmdwht`, `tmdrdy` prefixes exist
- [ ] List `Terran/Units/Battlecruiser/` and confirm `tbayes`, `tbapss`, `tbawht`, `tbardy` prefixes exist

### Sound Assets
- [ ] Copy `sounds/Marine/` — `tmayes`, `tmapss`, `tmardy` WAVs only (skip `tmawht`, `tmasti`)
- [ ] Copy `sounds/Ghost/` — `tghyes`, `tghpss`, `tghwht`, `tghrdy` WAVs only
- [ ] Copy `sounds/Medic/` — `tmdyes`, `tmdpss`, `tmdwht`, `tmdrdy` WAVs only
- [ ] Copy `sounds/Battlecruiser/` — `tbayes`, `tbapss`, `tbawht`, `tbardy` WAVs only

### Code — `scripts/sound-hook.ts`
- [ ] Add `MARINE`, `GHOST`, `MEDIC`, `BATTLECRUISER` path constants
- [ ] Remap `PreToolUse` → `{ dir: MARINE, pool: "tmardy", lockfile: "consume" }`
- [ ] Remap `PermissionRequest` → `{ dir: GHOST, pool: "tghpss" }`
- [ ] Remap `SubagentStart` → `{ dir: GHOST, pool: "tghrdy" }`
- [ ] Remap `SubagentStop` → `{ dir: MARINE, pool: "tmayes", errorPool: "tmapss" }`
- [ ] Remap `TeammateIdle` → `{ dir: MARINE, pool: "tmapss" }`
- [ ] Remap `PostToolUseFailure` → `{ dir: BATTLECRUISER, pool: "tbapss" }`
- [ ] Remap `TaskCompleted` → `{ dir: MEDIC, pool: "tmdyes" }`

### Tests — `scripts/sound-hook.test.ts`
- [ ] Update any test assertions that pin old `dir` paths for the 7 remapped events
- [ ] Verify all 16 existing test suites still pass (`bun test`)
- [ ] `bunx tsc --noEmit` clean

### Manual Smoke
- [ ] `bun run scripts/sound-hook.ts PreToolUse <<< '{"session_id":"test"}'` → Marine tmardy sound
- [ ] `bun run scripts/sound-hook.ts PostToolUseFailure <<< '{"session_id":"test"}'` → Battlecruiser sound
- [ ] `bun run scripts/sound-hook.ts TaskCompleted <<< '{"session_id":"test"}'` → Medic sound

---

## Phase 2 — Multi-Race Theming Architecture

### Pre-flight: Verify Zerg Prefixes
- [ ] List `Zerg/Units/Advisor/` — record actual pool prefixes
- [ ] List `Zerg/Units/Drone/` — record actual pool prefixes
- [ ] List `Zerg/Units/Hydralisk/` — record actual pool prefixes
- [ ] List `Zerg/Units/Zergling/` — record actual prefixes (NOT `zzlyes` — that was a bad guess)
- [ ] Determine which Zerg units will cover required session events (SessionStart, Stop, SessionEnd) — Zerg Advisor has only error/update lines

### Pre-flight: Verify Protoss Prefixes
- [ ] List `Protoss/Units/Advisor/` — record actual pool prefixes
- [ ] List `Protoss/Units/Probe/` — record actual pool prefixes
- [ ] List `Protoss/Units/Zealot/` — record actual pool prefixes
- [ ] List `Protoss/Units/"Dark Templar"/` — record actual pool prefixes (note: space in source dir name)
- [ ] List `Protoss/Units/` warp/misc sounds — identify warp-in/warp-out candidates
- [ ] Determine which Protoss units will cover required session events

### Sound Assets: Terran Reorganization
- [ ] Create `sounds/terran/` directory
- [ ] Move `sounds/Advisor/` → `sounds/terran/Advisor/`
- [ ] Move `sounds/SCV/` → `sounds/terran/SCV/`
- [ ] Split `sounds/misc/` (order matters):
  - [ ] Create `sounds/zerg/misc/`
  - [ ] Move `burrowdn.wav`, `burrowup.wav` → `sounds/zerg/misc/`
  - [ ] Move remaining misc files → `sounds/terran/misc/`
- [ ] Move `sounds/Marine/` → `sounds/terran/Marine/`
- [ ] Move `sounds/Ghost/` → `sounds/terran/Ghost/`
- [ ] Move `sounds/Medic/` → `sounds/terran/Medic/`
- [ ] Move `sounds/Battlecruiser/` → `sounds/terran/Battlecruiser/`
- [ ] Verify `sounds/` root now contains only `terran/`, `zerg/`, `protoss/` (no orphan flat dirs)

### Sound Assets: Zerg
- [ ] Copy Zerg Advisor WAVs → `sounds/zerg/Advisor/`
- [ ] Copy Zerg Drone WAVs → `sounds/zerg/Drone/`
- [ ] Copy Zerg Hydralisk WAVs → `sounds/zerg/Hydralisk/`
- [ ] Copy Zerg Zergling WAVs → `sounds/zerg/Zergling/`
- [ ] Copy Zerg warp/misc WAVs → `sounds/zerg/misc/` (alongside burrow files)

### Sound Assets: Protoss
- [ ] Copy Protoss Advisor WAVs → `sounds/protoss/Advisor/`
- [ ] Copy Protoss Probe WAVs → `sounds/protoss/Probe/`
- [ ] Copy Protoss Zealot WAVs → `sounds/protoss/Zealot/`
- [ ] Copy Protoss Dark Templar WAVs → `sounds/protoss/DarkTemplar/` (note: no space in dest)
- [ ] Copy Protoss misc/warp WAVs → `sounds/protoss/misc/`

### Code — `scripts/sound-hook.ts`
- [ ] Add `ThemeName = "terran" | "zerg" | "protoss"` type
- [ ] Add `ThemeSpec = Partial<Record<ClaudeEvent, SoundSpec>>` type
- [ ] Replace `isClaudeEvent` with static-set implementation:
  ```typescript
  const CLAUDE_EVENT_SET = new Set<string>([...] satisfies ClaudeEvent[])
  ```
- [ ] Update all path constants to `join(PLUGIN_ROOT, "sounds", "terran", "<Unit>")`
- [ ] Build `THEMES: Record<ThemeName, ThemeSpec>` with terran, zerg, protoss entries
  - [ ] Terran theme: migrate current EVENT_SOUNDS + Phase 1 remaps
  - [ ] Zerg theme: all 7 required events mapped to verified Zerg unit sounds
  - [ ] Protoss theme: all 7 required events mapped to verified Protoss unit sounds
- [ ] Add `const activeTheme: ThemeName = "terran"` static constant
- [ ] Update `route()` to use `THEMES[activeTheme][event]`
- [ ] Remove `EVENT_SOUNDS` binding entirely

### Tests — `scripts/sound-hook.test.ts`
- [ ] Update dir-path assertions to `sounds/terran/` prefix
- [ ] Add test: each theme defines all 7 required events
- [ ] Expand `isClaudeEvent` suite to all 17 `ClaudeEvent` strings → true
- [ ] Update `route("PostToolUse", ...)` test comment: guard 2 (not guard 1) now catches it
- [ ] `bun test` all green; `bunx tsc --noEmit` clean

### Spec
- [ ] `spec/plugin-spec.md`: replace 9 `EVENT_SOUNDS` occurrences with `THEMES[activeTheme]`
- [ ] `spec/plugin-spec.md`: update `isClaudeEvent` description to static set
- [ ] `spec/plugin-spec.md`: add theme contract section (ThemeName, required events, ThemeSpec)

### Manual Smoke (switch `activeTheme` to each race)
- [ ] Terran: `SessionStart` plays Advisor `adjutant_online`
- [ ] Zerg: `SessionStart` plays appropriate Zerg unit sound
- [ ] Protoss: `SessionStart` plays appropriate Protoss unit sound

---

## Phase 3 — Session-Scoped Theme Assignment

### Code — `scripts/sound-hook.ts`
- [ ] Add `themeFor(sessionId: string): ThemeName` (djb2 hash mod 3)
- [ ] Remove `activeTheme` static constant
- [ ] Update `route()`: `const theme = themeFor(input.session_id ?? "unknown")`
- [ ] Add `theme: ThemeName` parameter to `dispatch()` (keep `input` alongside it)
- [ ] Add `theme: ThemeName` parameter to `playWithLogging()`
- [ ] Update `log()` signature: `log(event, pool, theme)` — new format: `<timestamp> [<theme>] <event> → <pool>`

### Tests — `scripts/sound-hook.test.ts`
- [ ] Pin tests: assert 3+ known session IDs → expected themes (e.g., `themeFor("abc123") === "terran"`)
- [ ] Distribution test: 300 varied IDs spread within ±10% across 3 themes
- [ ] Stability test: `themeFor("unknown")` returns same value on repeated calls
- [ ] New log-format test: logged line matches `/\[(terran|zerg|protoss)\]/`
- [ ] `bun test` all green; `bunx tsc --noEmit` clean

### Spec
- [ ] `spec/plugin-spec.md §13` (Logging): document new log line format with `[theme]` bracket
- [ ] `spec/plugin-spec.md`: add `themeFor()` to type notes / contract section

### Manual Smoke
- [ ] Same session ID fired twice → same race plays both times
- [ ] Two different session IDs → at least one plays a different race (probabilistic)
- [ ] `sound-hook.log` entries show `[terran]`/`[zerg]`/`[protoss]` bracket

---

## Progress Summary

| Phase | Status | Blocking on |
|-------|--------|-------------|
| Phase 1 — Terran Expansion | `[ ]` | — |
| Phase 2 — Multi-Race Architecture | `[ ]` | Phase 1 complete; Zerg/Protoss prefix verification |
| Phase 3 — Session Theming | `[ ]` | Phase 2 complete |
