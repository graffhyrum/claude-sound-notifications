# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Claude Code plugin that plays StarCraft sound effects for lifecycle events (SessionStart, PreToolUse, Stop, etc.). Each session is deterministically assigned a race (Terran/Zerg/Protoss) via djb2 hash of `session_id`, and all sounds for that session come from that race's theme.

## Commands

```bash
bun test                   # 56 tests, all in scripts/sound-hook.test.ts
bun test --watch           # watch mode

# Smoke test a single event:
echo '{"session_id":"t1"}' | bun run scripts/sound-hook.ts SessionStart
```

No build step, no linting, no package.json scripts — the plugin is a single TypeScript file run directly by Bun.

## Architecture

**Single-file core**: `scripts/sound-hook.ts` handles everything — event routing, theme selection, audio pool resolution, lockfile turn-gating, transcript error detection, log rotation, and playback.

**Flow**: `import.meta.main` → `run()` → `route()` → `dispatch()` → `playWithLogging()`

- `run()`: reads stdin (JSON with `session_id`, `transcript_path`, etc.), checks mute sentinel, delegates to `route()`
- `route()`: validates event name, resolves theme from session ID, looks up `SoundSpec` in `THEMES`
- `dispatch()`: manages lockfile write/consume for turn-gating, then plays
- `playWithLogging()`: resolves normal vs error pool (by parsing transcript for `tool_result.is_error`), spawns `pw-play`/`aplay`, appends to log

**Turn-gating via lockfile**: `UserPromptSubmit` writes a lockfile; `PreToolUse` consumes it. This ensures only the *first* tool call per user turn plays a sound, not every tool call.

**Mute sentinel**: `~/.claude/sound-muted` — presence silences all sounds. Toggle with `scripts/sound-toggle.ts`.

**Plugin registration**: `.claude-plugin/plugin.json` declares the plugin; `hooks/hooks.json` maps Claude events to `bun run scripts/sound-hook.ts <EventName>`. Not all events in `THEMES` are in `hooks.json` (WorktreeCreate/WorktreeRemove are intentionally unregistered — see distilled rule about `WorktreeCreate` being a delegation hook).

## Key Design Decisions

- **`run()` uses seam injection** (function params for `readInput`, `checkMuted`, `player`) to enable testing without mocks
- **`THEMES` is the single source of truth** for event→sound mapping across all three races. Edit it to remap, add, or remove sounds
- **Audio pools**: a directory of WAV files sharing a filename prefix. `poolFor(dir, prefix)` globs for matching files; `randomFrom()` picks one
- **Error pools**: events with `errorPool` in their `SoundSpec` check the transcript for `tool_result.is_error` entries after the last user message. If errors found, the error pool plays instead
- **Log rotation**: `~/.claude/logs/sound-hook.log` auto-truncates to last 1000 lines when it exceeds 1 MB

## Sound Directory Layout

```
sounds/{terran,zerg,protoss}/{UnitName}/  — WAV files named {pool_prefix}{nn}.wav
```

Add variants by dropping a WAV with the matching prefix into the appropriate unit directory.

## Git / Submodule Workflow

This repo is a **git submodule** of the parent at `~/.claude`. This has one hard constraint:

**Never run `git add` on files in this repo from the parent context.** The following will always fail with exit 128:

```bash
# WRONG — fatal: Pathspec '...' is in submodule 'plugins/sound-notifications'
git -C ~/.claude add plugins/sound-notifications/scripts/sound-hook.ts
```

Commit files here from inside the submodule, then update the parent pointer separately:

```bash
# 1. Commit inside the submodule (this repo)
git add scripts/sound-hook.ts
git commit -m "..."

# 2. Update the parent pointer
git -C ~/.claude add plugins/sound-notifications
git -C ~/.claude commit -m "chore: update sound-notifications pointer"
```

The parent pointer only needs updating if a downstream agent or CI needs the new commits visible from `~/.claude`'s history.

## Testing Notes

- Tests use seam injection on `run()` and pass `player: null` to avoid actual audio playback
- Subprocess tests (`Bun.spawnSync`) cover the `import.meta.main` entry point
- `isMuted` tests swap `process.env.HOME` to a temp dir — always restore in `afterAll`
- Lockfile tests use `process.pid` in session IDs to avoid collisions between parallel test runs
