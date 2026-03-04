# sound-notifications

Audible lifecycle feedback for Claude Code using StarCraft audio pools.

Main agent events play SCV voices. Session-level outcomes play the Advisor.

## Sound mapping

| Event | Pool | Sound |
|-------|------|-------|
| `SessionStart` | `adjutant_online` | Advisor online |
| `UserPromptSubmit` | `tscyes` | SCV acknowledging |
| `PreToolUse` | `tscyes` | First tool per turn only |
| `PermissionRequest` | `tscpss` | Frustrated — being asked for permission |
| `PostToolUseFailure` | `need` | Advisor — needs attention |
| `Notification` | `scanner` | Scanner ping |
| `SubagentStart` | `tscrdy` | SCV ready |
| `SubagentStop` | `tadupd` / `tscpss` | Advisor update (or annoyed if errors) |
| `Stop` | `complete` / `need` | Advisor — success or error based on transcript |
| `TeammateIdle` | `tscpss` | Frustrated |
| `TaskCompleted` | `tadupd` | Advisor update |
| `WorktreeCreate` | `liftoff` | Liftoff |
| `WorktreeRemove` | `land` | Landing |
| `PreCompact` | `getin` | Get in — compaction underway |
| `SessionEnd` | `complete` / `landing` | Advisor — success or error |

`PreToolUse` uses a 60-second lockfile written at `UserPromptSubmit` so only the first tool call per turn plays `tscyes`, not every subsequent one.

## Audio pools

Each pool is a set of WAV files sharing a filename prefix. One is picked at random per event.

```
Advisor/   adjutant_online*.wav   complete*.wav   landing*.wav   need*.wav   tadupd*.wav
SCV/       tscpss*.wav   tscrdy*.wav   tscyes*.wav
misc/      getin*.wav   land*.wav   liftoff*.wav   scanner*.wav
```

To add a new variant to a pool, drop a file named `<prefix><nn>.wav` into the appropriate directory.

## Remapping sounds

Edit `EVENT_SOUNDS` in `scripts/sound-hook.ts`. Each entry is:

```typescript
EventName: { dir: SCV | ADVISOR | MISC, pool: "prefix", errorPool?: "prefix", lockfile?: "write" | "consume" }
```

Remove a line to silence that event. Add a line for any `ClaudeEvent` not currently mapped.

## Toggling

A sentinel file at `~/.claude/sound-muted` silences all sounds immediately — no restart required. All concurrent Claude Code sessions share this state.

**Toggle script:**

```bash
bun run ~/.claude/plugins/sound-notifications/scripts/sound-toggle.ts
# → "Sound notifications: MUTED"   (silent from this point)
# → "Sound notifications: UNMUTED" (plays adjutant_online confirmation)
```

**Suggested shell alias:**

```bash
alias sound-toggle='bun run ~/.claude/plugins/sound-notifications/scripts/sound-toggle.ts'
```

**Direct control:**

```bash
touch ~/.claude/sound-muted   # mute
rm ~/.claude/sound-muted      # unmute
```

## Installation

### Permanent (registered)

```bash
# Already done if you cloned dotclaude — the submodule is at:
~/.claude/plugins/sound-notifications

# Register in installed_plugins.json + settings.json (see dotclaude setup)
```

### Per-session (alias)

```bash
# Add to ~/.zshrc:
alias claude="claude --plugin-dir ~/.claude/plugins/sound-notifications"
```

## Requirements

- `pw-play` (PipeWire) or `aplay` (ALSA) on `$PATH`
- Bun runtime

## Development

```bash
cd ~/.claude/plugins/sound-notifications
bun test scripts/sound-hook.test.ts   # 16 tests

# Smoke test an event directly:
echo '{"session_id":"t1"}' | bun run scripts/sound-hook.ts SessionStart
```

Logs write to `~/.claude/logs/sound-hook.log`.
