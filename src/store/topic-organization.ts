import fs from "node:fs";
import path from "node:path";
import { TOPIC_ORGANIZATION_FILE } from "../../config.ts";
import { emptyTopicOrganization, parseTopicOrganization } from "../core/topic-organization.ts";
import type { TopicOrganizationStore } from "../core/ports.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

export const topicOrganizationStore: TopicOrganizationStore = {
	read() {
		let raw: string;
		try {
			raw = fs.readFileSync(TOPIC_ORGANIZATION_FILE, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyTopicOrganization();
			throw error;
		}
		return parseTopicOrganization(JSON.parse(raw));
	},
	write(state) {
		fs.mkdirSync(path.dirname(TOPIC_ORGANIZATION_FILE), { recursive: true });
		writeFileAtomicSync(TOPIC_ORGANIZATION_FILE, JSON.stringify(state, null, "\t") + "\n");
	},
};
