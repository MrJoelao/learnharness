import fs from "node:fs";
import path from "node:path";
import { CHAT_ORGANIZATION_FILE } from "../../config.ts";
import { emptyChatOrganization, parseChatOrganization, type ChatOrganization } from "../core/chat-organization.ts";
import type { ChatOrganizationStore } from "../core/ports.ts";
import { emit } from "../core/events.ts";
import { removeLeftoverTemps, writeFileAtomicSync } from "./atomic-write.ts";

export const chatOrganizationStore: ChatOrganizationStore = {
	read(): ChatOrganization {
		let raw: string;
		try {
			raw = fs.readFileSync(CHAT_ORGANIZATION_FILE, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyChatOrganization();
			throw error;
		}
		return parseChatOrganization(JSON.parse(raw));
	},
	write(state: ChatOrganization): void {
		const valid = parseChatOrganization(state);
		fs.mkdirSync(path.dirname(CHAT_ORGANIZATION_FILE), { recursive: true });
		writeFileAtomicSync(CHAT_ORGANIZATION_FILE, JSON.stringify(valid, null, "\t") + "\n");
		removeLeftoverTemps(CHAT_ORGANIZATION_FILE);
		emit("chat-organization-changed", {});
		emit("chats-changed", {});
	},
};
