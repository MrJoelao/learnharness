/**
 * Organization store — persists OrganizationV2 to chat-organization.json.
 *
 * Lazy migration:
 * - Reading a v1 file returns it as-is via the existing ChatOrganizationStore
 *   interface.
 * - The v2 store (organizationV2Store) reads v1 files and migrates them
 *   transparently on first write, using writeFileAtomicSync to stay crash-safe.
 * - New installs start directly on v2.
 */

import fs from "node:fs";
import path from "node:path";
import { CHAT_ORGANIZATION_FILE } from "../../config.ts";
import {
	chatKey,
	emptyOrganizationV2,
	migrateV1toV2,
	parseOrganizationV2,
	toV1CompatOrganization,
	type OrganizationV2,
} from "../core/organization.ts";
import { parseChatOrganization, emptyChatOrganization, type ChatOrganization } from "../core/chat-organization.ts";
import type { ChatOrganizationStore } from "../core/ports.ts";
import { emit } from "../core/events.ts";
import { removeLeftoverTemps, writeFileAtomicSync } from "./atomic-write.ts";

// ─── V2 store port ────────────────────────────────────────────────────────────

export interface OrganizationV2Store {
	read(): OrganizationV2;
	write(state: OrganizationV2): void;
}

export const organizationV2Store: OrganizationV2Store = {
	read(): OrganizationV2 {
		let raw: string;
		try {
			raw = fs.readFileSync(CHAT_ORGANIZATION_FILE, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyOrganizationV2();
			throw error;
		}
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error(
				"Could not read organization. Its data is invalid or newer than this app. (not an object)",
			);
		}
		const obj = parsed as Record<string, unknown>;
		if (obj["version"] === 2) {
			return parseOrganizationV2(parsed);
		}
		if (obj["version"] === 1) {
			// Migrate v1 → v2 in memory; will be written on next mutation.
			const v1 = parseChatOrganization(parsed);
			return migrateV1toV2(v1 as {
				version: 1;
				folders: ChatOrganization["folders"];
				placements: Record<string, unknown>;
			});
		}
		throw new Error(
			"Could not read organization. Its data is invalid or newer than this app. (unknown version)",
		);
	},

	write(state: OrganizationV2): void {
		const valid = parseOrganizationV2(state);
		fs.mkdirSync(path.dirname(CHAT_ORGANIZATION_FILE), { recursive: true });
		writeFileAtomicSync(CHAT_ORGANIZATION_FILE, JSON.stringify(valid, null, "\t") + "\n");
		removeLeftoverTemps(CHAT_ORGANIZATION_FILE);
		emit("chat-organization-changed", {});
		emit("chats-changed", {});
	},
};

// ─── V1 compat store (preserves existing ChatOrganizationStore contract) ──────
//
// This adapter keeps serving v1 reads (bare chat IDs) to legacy consumers
// (topic auto-assignment, tests). Its write MERGES the incoming chat-only
// state into the current organization, so workspace placements recorded by
// the shared directory are never lost through the compat path (risk R2).

export const chatOrganizationStore: ChatOrganizationStore = {
	read(): ChatOrganization {
		let raw: string;
		try {
			raw = fs.readFileSync(CHAT_ORGANIZATION_FILE, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyChatOrganization();
			throw error;
		}
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return emptyChatOrganization();
		}
		const obj = parsed as Record<string, unknown>;
		if (obj["version"] === 2) {
			// Read v2 and down-project to v1 for the compat store.
			try {
				const v2 = parseOrganizationV2(parsed);
				return toV1CompatOrganization(v2);
			} catch {
				// If v2 is somehow corrupt, fail loudly (consistent with existing behavior).
				throw new Error(
					"Could not read organization. Its data is invalid or newer than this app.",
				);
			}
		}
		return parseChatOrganization(parsed);
	},
	write(state: ChatOrganization): void {
		// v1 callers express only chat placements with bare IDs. Merge them
		// into the current organization (upgrading v1 files on this write, the
		// lazy migration) so recorded workspace placements survive.
		const valid = parseChatOrganization(state);
		let next: OrganizationV2;
		try {
			const current = organizationV2Store.read();
			next = { version: 2, folders: valid.folders, placements: { ...current.placements } };
			for (const key of Object.keys(next.placements)) {
				if (key.startsWith("chat:")) delete next.placements[key];
			}
			for (const [id, placement] of Object.entries(valid.placements)) {
				next.placements[chatKey(id)] = placement;
			}
		} catch {
			// Unreadable current file (corrupt/newer): the incoming state is the
			// best available truth — same overwrite behavior as before v2.
			next = migrateV1toV2(valid);
		}
		organizationV2Store.write(next);
	},
};
