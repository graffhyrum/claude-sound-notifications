# sound-notifications

Audible lifecycle feedback for Claude Code using StarCraft audio pools.

Main agent events play SCV voices. Session-level outcomes play the Advisor.

## Sound mapping

| Event | Pool | Sound |
|-------|------|-------|
| `SessionStart` | `tscrdy` | SCV ready |
| `UserPromptSubmit` | `tscwht` | "What?" — acknowledging the order |
| `PreToolUse` | `tsctra` | Transporting — first tool per turn only |
| `PermissionRequest` | `tscpss` | Frustrated — being asked for permission |
| `PostToolUseFailure` | `tscerr` | SCV error |
| `Notification` | `tscupd` | Status update |
| `SubagentStart` | `edrrep` | Building / repairing |
| `SubagentStop` | `tscpss` / `tscerr` | Annoyed (or error if transcript has failures) |
| `Stop` | `tadupd` / `taderr` | Advisor — success or error based on transcript |
| `TeammateIdle` | `tscpss` | Frustrated |
| `TaskCompleted` | `tadupd` | Advisor update |
| `WorktreeCreate` | `edrrep` | Building something |
| `WorktreeRemove` | `tscdth` | SCV death |
| `PreCompact` | `tscmin` | Mining in the background |
| `SessionEnd` | `tadupd` / `taderr` | Advisor — success or error |

`PreToolUse` uses a 60-second lockfile written at `UserPromptSubmit` so only the first tool call per turn plays `tsctra`, not every subsequent one.

## Audio pools

Each pool is a set of WAV files sharing a filename prefix. One is picked at random per event.

```
Advisor/   taderr*.wav   tadupd*.wav
SCV/       edrrep*.wav   tscdth*.wav   tscerr*.wav   tscmin*.wav
           tscpss*.wav   tscrdy*.wav   tsctra*.wav   tscupd*.wav
           tscwht*.wav   tscyes*.wav
```

To add a new variant to a pool, drop a file named `<prefix><nn>.wav` into the appropriate directory.

## Remapping sounds

Edit `EVENT_SOUNDS` in `scripts/sound-hook.ts`. Each entry is:

```typescript
EventName: { dir: SCV | ADVISOR, pool: "prefix", errorPool?: "prefix", lockfile?: "write" | "consume" }
```

Remove a line to silence that event. Add a line for any `ClaudeEvent` not currently mapped.

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
bun test scripts/sound-hook.test.ts   # 14 tests

# Smoke test an event directly:
echo '{"session_id":"t1"}' | bun run scripts/sound-hook.ts SessionStart
```

Logs write to `~/.claude/logs/sound-hook.log`.
