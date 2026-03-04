// Toggle sound notifications on/off via a sentinel file at ~/.claude/sound-muted
// Unmuting shells out to SessionStart so the confirmation sound uses the live hook pipeline

import { unlink } from "node:fs/promises";
import { homedir } from "node:os";

const home = process.env.HOME ?? homedir();
const sentinel = `${home}/.claude/sound-muted`;
const hookScript = `${home}/.claude/plugins/sound-notifications/scripts/sound-hook.ts`;

async function toggle(): Promise<void> {
	const muted = await Bun.file(sentinel).exists();
	if (muted) {
		await unmute();
	} else {
		await mute();
	}
}

async function mute(): Promise<void> {
	await Bun.write(sentinel, "");
	console.log("Sound notifications: MUTED");
}

async function unmute(): Promise<void> {
	await unlink(sentinel);
	console.log("Sound notifications: UNMUTED");
	await playConfirmation();
}

// SessionStart → adjutant_online; coupling is intentional — it's the "I'm online" sound
async function playConfirmation(): Promise<void> {
	const proc = Bun.spawn(
		["bun", "run", hookScript, "SessionStart"],
		{
			stdin: new Blob(['{"session_id":"toggle"}']),
			stdout: "ignore",
			stderr: "ignore",
		},
	);
	await proc.exited;
}

await toggle();
