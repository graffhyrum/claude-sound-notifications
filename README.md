# sound-notifications

Audible lifecycle feedback for Claude Code using StarCraft audio pools.

Each agent session is deterministically assigned one of three races (Terran, Zerg, Protoss) via a hash of its `session_id`. All sounds for that session play from that race's theme.

## Race themes

| Race | Session lifecycle | Action events | Error/failure |
|------|------------------|---------------|---------------|
| **Terran** | Adjutant (Advisor) | Marine / Ghost / SCV | Battlecruiser |
| **Zerg** | Drone | Zergling / Hydralisk | Zerg Advisor |
| **Protoss** | Probe | Zealot / Dark Templar | Protoss Advisor |

## Event mapping (Terran example)

| Event | Unit | Pool | Notes |
|-------|------|------|-------|
| `SessionStart` | Advisor | `adjutant_online` | |
| `UserPromptSubmit` | SCV | `tscyes` | Writes lockfile |
| `PreToolUse` | Marine | `tmardy` | First tool per turn only (consumes lockfile) |
| `PermissionRequest` | Ghost | `tghpss` | |
| `PostToolUseFailure` | Battlecruiser | `tbapss` | |
| `Notification` | misc | `scanner` | |
| `SubagentStart` | Ghost | `tghrdy` | |
| `SubagentStop` | Marine | `tmayes` / `tmapss` | Error pool if transcript has errors |
| `Stop` | Advisor | `complete` / `need` | Error pool if transcript has errors |
| `TeammateIdle` | Marine | `tmapss` | |
| `TaskCompleted` | Medic | `tmdyes` | |
| `WorktreeCreate` | misc | `liftoff` | Not registered in hooks.json |
| `WorktreeRemove` | misc | `land` | Not registered in hooks.json |
| `PreCompact` | misc | `getin` | |
| `SessionEnd` | Advisor | `nuke_detected` / `landing` | Error pool if transcript has errors |

Zerg and Protoss have analogous mappings using their own unit voices. See `spec/plugin-spec.md` §8 for full details.

## Audio pools

Each pool is a directory of WAV files sharing a filename prefix. One is picked at random per event.

```
sounds/
  terran/   Advisor/  SCV/  misc/  Marine/  Ghost/  Medic/  Battlecruiser/
  zerg/     Advisor/  Drone/  Hydralisk/  Zergling/  misc/
  protoss/  Advisor/  Probe/  Zealot/  DarkTemplar/
```

To add a variant to a pool, drop a WAV named `<prefix><nn>.wav` into the appropriate directory.

## Remapping sounds

Edit `THEMES` in `scripts/sound-hook.ts`. Each theme entry is:

```typescript
EventName: { dir: UNIT_PATH, pool: "prefix", errorPool?: "prefix", lockfile?: "write" | "consume" }
```

Remove a line to silence that event. Add a line for any `ClaudeEvent` not currently mapped.

## Toggling

A sentinel file at `~/.claude/sound-muted` silences all sounds immediately. All concurrent Claude Code sessions share this state.

```bash
bun run ~/.claude/plugins/sound-notifications/scripts/sound-toggle.ts
# → "Sound notifications: MUTED"
# → "Sound notifications: UNMUTED"  (plays race-appropriate online sound)
```

**Direct control:**

```bash
touch ~/.claude/sound-muted   # mute
rm ~/.claude/sound-muted      # unmute
```

## Installation

```bash
# Already done if you cloned dotclaude — the submodule is at:
~/.claude/plugins/sound-notifications
```

## Requirements

- `pw-play` (PipeWire) or `aplay` (ALSA) on `$PATH`
- Bun runtime

## Development

```bash
cd ~/.claude/plugins/sound-notifications
bun test                   # 56 tests

# Smoke test an event directly:
echo '{"session_id":"t1"}' | bun run scripts/sound-hook.ts SessionStart
```

Logs write to `~/.claude/logs/sound-hook.log` in the format:
```
2026-03-17T12:00:00.000Z [terran] PreToolUse → tmardy
```
