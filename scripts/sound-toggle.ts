// Toggle sound notifications on/off via a sentinel file at ~/.claude/sound-muted
// Unmuting calls route() directly; SessionStart → adjutant_online is the "I'm online" sound

import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { type ClaudeEvent, isMuted, route } from "./sound-hook.ts";

const home = process.env.HOME ?? homedir();
const sentinel = `${home}/.claude/sound-muted`;

async function toggle(): Promise<void> {
	if (await isMuted()) {
		await unmute();
	} else {
		await mute();
	}
}

async function mute(): Promise<void> {
	await Bun.write(sentinel, "");
	console.log("Sound notifications: MUTED");
}

const UNMUTE_EVENT: ClaudeEvent = "SessionStart";

async function unmute(): Promise<void> {
	await unlink(sentinel);
	console.log("Sound notifications: UNMUTED");
	await route(UNMUTE_EVENT, { session_id: "toggle" });
}

await toggle();
